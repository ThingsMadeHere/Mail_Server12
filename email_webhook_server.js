const express = require('express');
const cors = require('cors');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Load webhook secret from environment or use default
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || 'your-resend-webhook-secret';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'application/json', limit: '10mb' }));

// Verify Resend webhook signature
function verifyWebhookSignature(payload, signature, secret) {
    if (!signature || !secret) {
        console.warn('Webhook signature or secret missing, skipping verification');
        return true; // Allow in development
    }
    
    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
    
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
}

// Resend webhook endpoint
app.post('/webhook/email', async (req, res) => {
    try {
        const payload = req.body;
        const signature = req.headers['resend-signature'] || req.headers['x-resend-signature'];
        
        console.log('Received Resend webhook');
        console.log('Event type:', payload.type);
        
        // Verify webhook signature
        const rawPayload = req.body instanceof Buffer ? req.body : JSON.stringify(req.body);
        if (!verifyWebhookSignature(rawPayload, signature, WEBHOOK_SECRET)) {
            console.error('Invalid webhook signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }
        
        // Process email.received events
        if (payload.type === 'email.received') {
            const emailData = payload.data;
            
            console.log(`From: ${emailData.from}`);
            console.log(`To: ${emailData.to.join(', ')}`);
            console.log(`Subject: ${emailData.subject}`);
            
            // Build email content from Resend data
            const emailContent = buildEmailContent(emailData);
            const emailBuffer = Buffer.from(emailContent, 'utf-8');
            
            // Compress the email
            const compressed = zlib.gzipSync(emailBuffer, { level: 6 });
            
            // Generate filename
            const date = new Date(emailData.created_at || Date.now());
            const timestamp = date.toISOString().replace(/[:.]/g, '-');
            const safeSubject = (emailData.subject || 'no-subject').replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
            const filename = `${timestamp}_${safeSubject}.eml.gz`;
            
            // Store compressed email
            const maildirPath = '/mail-data/new';
            fs.mkdirSync(maildirPath, { recursive: true });
            
            const filepath = path.join(maildirPath, filename);
            fs.writeFileSync(filepath, compressed);
            
            // Store metadata
            const metadata = {
                timestamp: new Date().toISOString(),
                source: 'resend-webhook',
                from: emailData.from,
                to: emailData.to,
                subject: emailData.subject,
                messageId: emailData.message_id,
                headers: emailData.headers,
                originalSize: emailBuffer.length,
                compressedSize: compressed.length,
                compressionRatio: ((compressed.length / emailBuffer.length) * 100).toFixed(2) + '%',
                filename: filename,
                webhookEventId: payload.id
            };
            
            const metadataPath = filepath + '.metadata.json';
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
            
            console.log(`Email compressed and stored: ${filename}`);
            console.log(`Compression: ${emailBuffer.length} -> ${compressed.length} bytes (${metadata.compressionRatio})`);
            
            res.status(200).json({ 
                success: true, 
                message: 'Email received and stored',
                filename: filename,
                compression: metadata.compressionRatio
            });
        } else {
            console.log('Non-email.received event:', payload.type);
            res.status(200).json({ success: true, message: 'Event acknowledged' });
        }
        
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).json({ error: 'Failed to process email', details: error.message });
    }
});

// Build email content from Resend webhook data
function buildEmailContent(emailData) {
    const lines = [];
    
    // Add headers
    if (emailData.headers) {
        Object.entries(emailData.headers).forEach(([key, value]) => {
            lines.push(`${key}: ${value}`);
        });
    }
    
    // Add standard headers if not present
    if (!emailData.headers || !emailData.headers['From']) {
        lines.push(`From: ${emailData.from}`);
    }
    if (!emailData.headers || !emailData.headers['To']) {
        lines.push(`To: ${emailData.to.join(', ')}`);
    }
    if (!emailData.headers || !emailData.headers['Subject']) {
        lines.push(`Subject: ${emailData.subject}`);
    }
    if (!emailData.headers || !emailData.headers['Date']) {
        lines.push(`Date: ${new Date(emailData.created_at).toUTCString()}`);
    }
    if (!emailData.headers || !emailData.headers['Message-ID']) {
        lines.push(`Message-ID: ${emailData.message_id}`);
    }
    
    lines.push(''); // Empty line between headers and body
    
    // Add body
    if (emailData.html) {
        lines.push('--');
        lines.push('HTML Content:');
        lines.push(emailData.html);
    }
    
    if (emailData.text) {
        lines.push('--');
        lines.push('Text Content:');
        lines.push(emailData.text);
    }
    
    return lines.join('\n');
}

// Health check
app.get('/webhook/health', (req, res) => {
    res.json({ status: 'ok', service: 'resend-webhook' });
});

app.listen(PORT, () => {
    console.log(`Resend webhook server running on port ${PORT}`);
});