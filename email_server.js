#!/usr/bin/env node
/**
 * Unified Email Server for mchsrobotics.dev
 * ------------------------------------------------------------------
 * Fixes the Resend "email.received" webhook 404 problem by serving ALL
 * routes from ONE process on ONE port (3000):
 *
 *   POST /webhook/email    <- Resend delivers email.received events here
 *   GET  /webhook/health   <- Resend health check
 *   POST /api/send-email   <- send mail through Resend's API
 *   GET  /api/inbox        <- list received emails (JSON)
 *   GET  /api/inbox/:id    <- read one received email
 *   GET  /ui               <- embedded frontend (works inside an iframe)
 *   GET  /                 <- redirects to /ui
 *
 * Why the 404 happened:
 *   The old setup ran TWO separate servers both defaulting to port 3000
 *   (email_api_server.js and email_webhook_server.js). Whichever started
 *   first won the port. If email_api_server.js was the one running under
 *   pm2, it has NO /webhook/email route at all -> every Resend delivery
 *   attempt got HTTP 404 and Resend retried 7 times. This unified server
 *   makes that impossible: one process owns the port and serves every
 *   route.
 *
 * Security model:
 *   - Resend webhooks are accepted only with a valid svix signature
 *     (HMAC-SHA256, constant-time compare).
 *   - Localhost clients (your machine, scripts, cron jobs) may use the
 *     API/UI freely — this is what enables "custom requests from within
 *     the machine".
 *   - Remote clients must present `Authorization: Bearer <API_TOKEN>`
 *     or `X-Api-Key: <API_TOKEN>` (set the API_TOKEN env var / token.json).
 */

const express = require('express');
const cors = require('cors');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function loadJsonSafe(file) {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
    } catch (e) {
        return {};
    }
}

const config = Object.assign(
    {
        from_email: 'outreach@mchsrobotics.dev',
        reply_to_email: '',
        resend_api_key: '',
        compression_enabled: true,
        compression_level: 6
    },
    loadJsonSafe('resend_config.json')
);

const webhookConfig = loadJsonSafe('resend_webhook_config.json');

// Webhook signing secret: env var wins, then resend_webhook_config.json
const WEBHOOK_SECRET =
    process.env.RESEND_WEBHOOK_SECRET ||
    webhookConfig.resend_webhook_secret ||
    '';

// Token protecting non-localhost API access
const API_TOKEN =
    process.env.API_TOKEN ||
    loadJsonSafe('token.json').api_token ||
    '';

// Where received emails are stored (gzip compressed .eml + metadata sidecar)
const MAILDIR = process.env.MAIL_DIR || '/mail-data/new';
try {
    fs.mkdirSync(MAILDIR, { recursive: true });
} catch (e) {
    console.warn(`Could not create ${MAILDIR} (${e.message}); falling back to ./mail-data`);
}
const STORAGE_DIR = fs.existsSync(MAILDIR) ? MAILDIR : path.join(__dirname, 'mail-data');

const UI_PATH = path.join(__dirname, 'public', 'index.html');

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cors({ origin: true })); // allows any origin so the UI can be iframed

// Capture the exact raw request bytes BEFORE any body parser consumes the
// stream (signature verification must run over what Resend actually sent).
app.use((req, res, next) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 25 * 1024 * 1024) {
            res.status(413).json({ error: 'Payload too large' });
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => { req.rawBody = Buffer.concat(chunks).toString('utf8'); });
    const origListen = req.listen;
    req.listen = function (...args) { // express-streamcache compatibility hook
        this._readableState.flowing = false;
        return origListen.apply(this, args);
    };
    next();
});
app.use(express.json({ limit: '25mb' })); // parsed body for API routes + browser fetches

function isLocalhost(req) {
    let ip = req.ip || req.connection.remoteAddress || '';
    ip = ip.replace(/^::ffff:/, '');
    return (
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === '' ||
        ip.startsWith('127.') ||
        ip.startsWith('100.') ||
        ip.startsWith('172.')
    );
}

function authGuard(req, res, next) {
    if (isLocalhost(req)) return next(); // local scripts get free access
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const apiKey = req.headers['x-api-key'] || null;
    const provided = bearer || apiKey;
    if (API_TOKEN && provided === API_TOKEN) return next();
    return res.status(401).json({
        error: 'Unauthorized',
        hint: API_TOKEN
            ? 'Provide Authorization: Bearer <API_TOKEN> (or run the request from localhost).'
            : 'No API_TOKEN configured on the server; only localhost requests are allowed.'
    });
}

// ---------------------------------------------------------------------------
// Resend (svix-style) webhook signature verification
// ---------------------------------------------------------------------------
// Resend signs webhook deliveries using Svix-compatible format:
// Headers: svix-id, svix-timestamp, svix-signature
// Signature format: v1,<base64-hmac>
// Signed content: ${svix_id}.${svix_timestamp}.${raw_body}
// Secret: whsec_<base64> (decode base64 after stripping prefix)
// Validity: timestamp must be within 5 minutes

function parseSvixSignature(headerValue) {
    if (!headerValue) return { signatures: [], timestamp: null };
    let timestamp = null;
    const signatures = [];
    for (const part of String(headerValue).split(' ')) {
        if (part.startsWith('t=')) {
            timestamp = parseInt(part.slice(2), 10);
        } else if (part.startsWith('v1,')) {
            // Extract base64 signature after "v1,"
            signatures.push(part.slice(3));
        }
    }
    return { signatures, timestamp };
}

function hmacBase64(secretPayload, keyBytes) {
    return crypto.createHmac('sha256', keyBytes).update(secretPayload, 'utf8').digest('base64');
}

function safeEqualBase64(a, b) {
    const bufA = Buffer.from(String(a), 'base64');
    const bufB = Buffer.from(String(b), 'base64');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function verifyWebhookSignature(rawBody, signatureHeader, svixId, svixTimestamp) {
    if (!WEBHOOK_SECRET) {
        // No secret configured: accept but warn loudly (development mode).
        console.warn('RESEND_WEBHOOK_SECRET not set - accepting webhook WITHOUT signature verification.');
        return true;
    }

    // Parse svix-signature header for signatures and timestamp
    const { signatures, timestamp: parsedTimestamp } = parseSvixSignature(signatureHeader);
    
    // Use svix-timestamp header if signature header doesn't have it
    const timestamp = parsedTimestamp || svixTimestamp || null;
    
    if (signatures.length === 0) {
        console.warn('Webhook delivered without a signature header.');
        return false;
    }

    // Validate timestamp is within 5 minutes (600 seconds)
    if (timestamp) {
        const now = Math.floor(Date.now() / 1000);
        const diff = Math.abs(now - timestamp);
        if (diff > 600) {
            console.warn(`Webhook timestamp is ${diff} seconds old (max 600).`);
            return false;
        }
    }

    // Decode the webhook secret: remove whsec_ prefix, then base64 decode
    const trimmed = WEBHOOK_SECRET.trim();
    let secretKey;
    if (trimmed.startsWith('whsec_')) {
        try {
            secretKey = Buffer.from(trimmed.slice('whsec_'.length), 'base64');
        } catch (e) {
            console.error('Failed to decode webhook secret:', e.message);
            return false;
        }
    } else {
        // Try base64 directly if no prefix
        try {
            secretKey = Buffer.from(trimmed, 'base64');
        } catch (e) {
            console.error('Failed to decode webhook secret as base64:', e.message);
            return false;
        }
    }

    // Build signed content: ${svix_id}.${svix_timestamp}.${raw_body}
    // Use svix-id from header if available, fall back to svixId parameter
    const id = svixId || '';
    const ts = timestamp ? String(timestamp) : '';
    const signedContent = `${id}.${ts}.${rawBody}`;

    // Compute expected signature
    const expectedSignature = hmacBase64(signedContent, secretKey);

    // Compare using constant-time comparison
    for (const sig of signatures) {
        if (safeEqualBase64(expectedSignature, sig)) {
            return true;
        }
    }

    console.warn('Webhook signature verification failed.');
    return false;
}

// ---------------------------------------------------------------------------
// Helpers: build/store/receive emails
// ---------------------------------------------------------------------------

function decodeQuotedPrintable(str) {
    return String(str)
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function decodeBase64Maybe(str) {
    if (!str) return str;
    try {
        const cleaned = String(str).replace(/\s+/g, '');
        if (/^[A-Za-z0-9+/=]+$/.test(cleaned) && cleaned.length % 4 === 0 && cleaned.length > 24) {
            const decoded = Buffer.from(cleaned, 'base64').toString('utf8');
            // Keep decoded only if it looks like text
            if (!decoded.includes('\u0000')) return decoded;
        }
    } catch (e) { /* fall through */ }
    return str;
}

// Reconstruct a full RFC-822 style .eml document from Resend's webhook data
function buildEmlContent(d) {
    const lines = [];
    const headerMap = {};
    if (d.headers && typeof d.headers === 'object') {
        for (const [k, v] of Object.entries(d.headers)) headerMap[k.toLowerCase()] = v;
    }
    const set = (name, value) => {
        if (value && !headerMap[name.toLowerCase()]) lines.push(`${name}: ${value}`);
    };

    // Emit provided headers first (normalized)
    if (Object.keys(headerMap).length) {
        for (const [lc, v] of Object.entries(headerMap)) {
            const name = lc.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());
            lines.push(`${name}: ${v}`);
        }
    }

    set('From', d.from);
    set('To', Array.isArray(d.to) ? d.to.join(', ') : d.to);
    set('Cc', Array.isArray(d.cc) ? d.cc.join(', ') : d.cc);
    set('Subject', d.subject);
    set('Date', d.created_at ? new Date(d.created_at).toUTCString() : new Date().toUTCString());
    set('Message-ID', d.message_id);

    lines.push('MIME-Version: 1.0');

    const html = d.html ? decodeQuotedPrintable(d.html) : null;
    const text = d.text ? decodeQuotedPrintable(decodeBase64Maybe(d.text)) : null;

    if (html && text) {
        const boundary = '----=_Resend_' + crypto.randomBytes(8).toString('hex');
        lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
        lines.push('');
        lines.push(`--${boundary}`);
        lines.push('Content-Type: text/plain; charset="utf-8"');
        lines.push('');
        lines.push(text || '');
        lines.push(`--${boundary}`);
        lines.push('Content-Type: text/html; charset="utf-8"');
        lines.push('');
        lines.push(html);
        lines.push(`--${boundary}--`);
    } else if (html) {
        lines.push('Content-Type: text/html; charset="utf-8"');
        lines.push('');
        lines.push(html);
    } else {
        lines.push('Content-Type: text/plain; charset="utf-8"');
        lines.push('');
        lines.push(text || '');
    }

    return lines.join('\r\n') + '\r\n';
}

function storeReceivedEmail(emlContent, meta) {
    const buffer = Buffer.from(emlContent, 'utf-8');
    const compressed = config.compression_enabled
        ? zlib.gzipSync(buffer, { level: config.compression_level || 6 })
        : buffer;

    const date = new Date(meta.created_at || Date.now());
    const timestamp = date.toISOString().replace(/[:.]/g, '-');
    const safeSubject = String(meta.subject || 'no-subject').replace(/[^a-zA-Z0-9-_ ]/g, '_').trim().substring(0, 50).replace(/\s+/g, '_') || 'no-subject';
    const id = `${timestamp}_${safeSubject}`;
    const filename = `${id}.eml${config.compression_enabled ? '.gz' : ''}`;

    fs.writeFileSync(path.join(STORAGE_DIR, filename), compressed);

    const metadata = Object.assign({}, meta, {
        id,
        filename,
        storedAt: new Date().toISOString(),
        originalSize: buffer.length,
        storedSize: compressed.length,
        compressionRatio: ((compressed.length / Math.max(buffer.length, 1)) * 100).toFixed(2) + '%'
    });
    fs.writeFileSync(path.join(STORAGE_DIR, filename + '.metadata.json'), JSON.stringify(metadata, null, 2));

    return { filename, metadata };
}

function listStoredEmails() {
    let files = [];
    try {
        files = fs.readdirSync(STORAGE_DIR);
    } catch (e) {
        return [];
    }
    const emails = [];
    for (const f of files) {
        if (!f.endsWith('.metadata.json')) continue;
        try {
            const meta = JSON.parse(fs.readFileSync(path.join(STORAGE_DIR, f), 'utf8'));
            emails.push({
                id: meta.id || f.replace(/\.eml(\.gz)?\.metadata\.json$/, ''),
                filename: meta.filename,
                subject: meta.subject || '(no subject)',
                from: meta.from,
                to: meta.to,
                receivedAt: meta.storedAt || meta.created_at,
                size: meta.originalSize,
                compressedSize: meta.storedSize,
                source: meta.source
            });
        } catch (e) { /* skip unreadable metadata */ }
    }
    emails.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
    return emails;
}

function readStoredEmail(id) {
    const safeId = String(id).replace(/[^\w.\-]/g, '');
    const candidates = [`${safeId}.eml.gz.metadata.json`, `${safeId}.eml.metadata.json`];
    let metaFile = null;
    for (const c of candidates) {
        if (fs.existsSync(path.join(STORAGE_DIR, c))) { metaFile = c; break; }
    }
    if (!metaFile) {
        // try matching by id field inside any metadata file
        const found = listStoredEmails().find(e => e.id === safeId);
        if (!found) return null;
        metaFile = found.filename + '.metadata.json';
    }
    const meta = JSON.parse(fs.readFileSync(path.join(STORAGE_DIR, metaFile), 'utf8'));
    const emlPath = path.join(STORAGE_DIR, meta.filename);
    if (!fs.existsSync(emlPath)) return null;
    let raw = fs.readFileSync(emlPath);
    if (meta.filename.endsWith('.gz')) raw = zlib.gunzipSync(raw);
    return { metadata: meta, content: raw.toString('utf8') };
}

// Simple in-memory log of recent webhook deliveries (for the UI status panel)
const deliveryLog = [];
function logDelivery(entry) {
    deliveryLog.unshift(Object.assign({ time: new Date().toISOString() }, entry));
    while (deliveryLog.length > 50) deliveryLog.pop();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Root -> embedded UI
app.get('/', (req, res) => res.redirect('/ui'));
app.get('/ui', (req, res) => {
    if (fs.existsSync(UI_PATH)) return res.type('html').send(fs.readFileSync(UI_PATH));
    res.status(500).type('html').send('<h1>public/index.html missing</h1>');
});

// Health checks (both paths, so Resend's configured URL always resolves)
function healthPayload() {
    return {
        status: 'ok',
        service: 'email-server-unified',
        version: '2.0.0',
        port: PORT,
        storageDir: STORAGE_DIR,
        webhookSecretConfigured: !!WEBHOOK_SECRET,
        resendApiKeyConfigured: !!config.resend_api_key,
        apiTokenRequiredForRemote: !!API_TOKEN,
        time: new Date().toISOString()
    };
}
app.get('/webhook/health', (req, res) => res.json(healthPayload()));
app.get('/api/health', (req, res) => res.json(healthPayload()));

// --- Resend receiving webhook ---------------------------------------------

app.post('/webhook/email', async (req, res) => {
    let payload;
    try {
        // req.rawBody holds the exact bytes sent by Resend (captured by the
        // middleware above before express.json() consumed the stream).
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const svixId = req.headers['svix-id'] || req.headers['webhook-id'] || '';
        const svixTimestamp = req.headers['svix-timestamp'] || req.headers['webhook-timestamp'] || '';
        const signature =
            req.headers['svix-signature'] ||
            req.headers['resend-signature'] ||
            req.headers['x-resend-signature'] || '';

        // Debug: log the actual signature header if present
        if (signature) {
            console.log(`[webhook] Received signature header: ${signature.substring(0, 50)}${signature.length > 50 ? '...' : ''}`);
        } else {
            console.log('[webhook] No signature header received');
        }
        console.log(`[webhook] Svix-ID: ${svixId}, Timestamp: ${svixTimestamp}`);

        payload = JSON.parse(rawBody);

        if (payload.type === 'email.received') {
            if (!verifyWebhookSignature(rawBody, signature, svixId, svixTimestamp)) {
                logDelivery({ event: payload.type, result: 'rejected-bad-signature' });
                console.error('Rejected webhook: invalid signature');
                return res.status(401).json({ error: 'Invalid signature' });
            }
        } else if (signature && !verifyWebhookSignature(rawBody, signature, svixId, svixTimestamp)) {
            logDelivery({ event: payload.type || 'unknown', result: 'rejected-bad-signature' });
            console.error('Rejected webhook: invalid signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }
        // Unsigned non-email.received events (e.g. dashboard "test" pings and
        // email.sent/email.delivered notifications) are acknowledged with 200
        // but never stored — they carry no inbound mail.
    } catch (error) {
        console.error('Malformed webhook payload:', error.message);
        logDelivery({ event: 'malformed', result: 'rejected' });
        return res.status(400).json({ error: 'Malformed payload', details: error.message });
    }

    try {
        console.log(`[webhook] event: ${payload.type}`);

        if (payload.type === 'email.received') {
            const d = payload.data || {};
            const recipients = [].concat(d.to || []).concat(d.recipients || []);
            console.log(`[webhook] email.received from=${d.from} to=${recipients.join(',')} subject="${d.subject}"`);

            // Try to fetch full email content from Resend API
            let fullEmailContent = buildEmlContent(d);
            if (config.resend_api_key && d.id) {
                try {
                    const emailResp = await fetch(`https://api.resend.com/emails/${d.id}`, {
                        headers: {
                            'Authorization': `Bearer ${config.resend_api_key}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    if (emailResp.ok) {
                        const emailData = await emailResp.json();
                        console.log('[webhook] Fetched full email content from Resend API');
                        // Rebuild EML with the full content
                        const fullD = emailData.data || {};
                        fullEmailContent = buildEmlContent(fullD);
                    }
                } catch (e) {
                    console.warn('[webhook] Failed to fetch full email content:', e.message);
                }
            }

            const { filename, metadata } = storeReceivedEmail(fullEmailContent, {
                source: 'resend-webhook',
                webhookEventId: payload.id,
                from: d.from,
                to: recipients,
                cc: d.cc,
                subject: d.subject,
                created_at: d.created_at,
                messageId: d.message_id,
                headers: d.headers
            });

            logDelivery({ event: 'email.received', result: 'stored', filename });
            console.log(`[webhook] stored ${filename} (${metadata.compressionRatio} of original)`);
            return res.status(200).json({ success: true, message: 'Email received and stored', filename });
        }

        // Acknowledge everything else (email.sent, email.delivered, test events...)
        logDelivery({ event: payload.type || 'unknown', result: 'acknowledged' });
        return res.status(200).json({ success: true, message: 'Event acknowledged', type: payload.type });
    } catch (error) {
        console.error('Error processing webhook:', error);
        logDelivery({ event: payload && payload.type, result: 'error', error: error.message });
        // Return 200 anyway? No - let Resend retry real processing errors.
        return res.status(500).json({ error: 'Failed to process email', details: error.message });
    }
});

// --- Sending API -----------------------------------------------------------
async function sendViaResendApi(mailOptions) {
    const body = {
        from: mailOptions.from,
        to: mailOptions.to,
        subject: mailOptions.subject,
        text: mailOptions.text
    };
    if (mailOptions.html) body.html = mailOptions.html;
    if (mailOptions.replyTo) body.reply_to = mailOptions.replyTo;
    if (mailOptions.cc) body.cc = mailOptions.cc;

    const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.resend_api_key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        const err = new Error(json.message || `Resend API error (${resp.status})`);
        err.details = json;
        throw err;
    }
    return json;
}

app.post('/api/send-email', authGuard, async (req, res) => {
    try {
        const { to, subject, body, html, from, reply_to, cc } = req.body || {};
        if (!to || !subject || (!body && !html)) {
            return res.status(400).json({ error: 'Missing required fields: to, subject, and body or html' });
        }
        if (!config.resend_api_key) {
            return res.status(500).json({
                error: 'Resend API key not configured',
                hint: 'Add your key to resend_config.json (resend_api_key) - see RESEND_RECEIVING_SETUP.md'
            });
        }

        const text = String(body || '');
        let compressionInfo = null;
        if (config.compression_enabled) {
            const original = Buffer.byteLength(text, 'utf8');
            const compressed = zlib.gzipSync(Buffer.from(text, 'utf8'), { level: config.compression_level || 6 });
            compressionInfo = {
                enabled: true,
                originalSize: original,
                compressedSize: compressed.length,
                compressionRatio: ((compressed.length / Math.max(original, 1)) * 100).toFixed(2) + '%'
            };
        }

        const mailOptions = {
            from: from || config.from_email,
            to,
            cc,
            subject,
            text,
            html,
            replyTo: reply_to || config.reply_to_email || undefined
        };

        const result = await sendViaResendApi(mailOptions);
        console.log(`[api] sent email id=${result.id} to=${to}`);
        res.json({
            success: true,
            messageId: result.id,
            from: mailOptions.from,
            replyTo: mailOptions.replyTo,
            compression: compressionInfo
        });
    } catch (error) {
        console.error('[api] send failed:', error.message);
        res.status(500).json({ error: 'Failed to send email', details: error.message, info: error.details });
    }
});

// --- Inbox API (used by the embedded UI, usable from scripts too) ---------
app.get('/api/inbox', authGuard, (req, res) => {
    res.json({ count: listStoredEmails().length, emails: listStoredEmails() });
});

app.get('/api/inbox/:id', authGuard, (req, res) => {
    const email = readStoredEmail(req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found', id: req.params.id });
    if (req.query.format === 'raw') return res.type('text/plain').send(email.content);
    res.json(email);
});

app.get('/api/status', authGuard, (req, res) => {
    res.json({
        health: healthPayload(),
        recentDeliveries: deliveryLog,
        inboxCount: listStoredEmails().length
    });
});

// Anything unknown gets a helpful JSON 404 instead of Express's HTML page
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        path: req.path,
        routes: ['POST /webhook/email', 'GET /webhook/health', 'POST /api/send-email',
                 'GET /api/inbox', 'GET /api/inbox/:id', 'GET /api/status', 'GET /ui']
    });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`Unified email server listening on port ${PORT}`);
    console.log(`  Webhook URL : http://<this-machine>:${PORT}/webhook/email`);
    console.log(`  Send API    : POST http://localhost:${PORT}/api/send-email`);
    console.log(`  Embedded UI : http://localhost:${PORT}/ui  (iframe-friendly)`);
    console.log(`  Storage dir : ${STORAGE_DIR}`);
    if (!WEBHOOK_SECRET) console.warn('  WARNING: no webhook secret configured - signatures NOT verified!');
    if (!config.resend_api_key) console.warn('  WARNING: resend_config.json missing or no resend_api_key - sending disabled.');
});

module.exports = app;
