const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Load configuration
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'resend_config.json'), 'utf8'));

// Email compression function
function compressEmail(text) {
    const compressed = zlib.gzipSync(text, { level: 6 });
    return {
        original: text,
        compressed: compressed,
        originalSize: Buffer.byteLength(text, 'utf8'),
        compressedSize: compressed.length,
        compressionRatio: (compressed.length / Buffer.byteLength(text, 'utf8')) * 100
    };
}

// Create Resend transporter
const transporter = nodemailer.createTransport({
    host: config.smtp_server,
    port: config.smtp_port,
    secure: false,
    auth: {
        user: config.smtp_username,
        pass: config.resend_api_key
    }
});

// Email sending endpoint
app.post('/api/send-email', async (req, res) => {
    try {
        const { to, subject, body, from, reply_to } = req.body;

        if (!to || !subject || !body) {
            return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
        }

        // Compress the email body
        const compression = compressEmail(body);

        // Create enhanced body with compression info
        const enhancedBody = body + `\n\n---\nEmail Compression Info:\n` +
            `Compression: Enabled (Gzip, Level 6)\n` +
            `Original Size: ${compression.originalSize} bytes\n` +
            `Compressed Size: ${compression.compressedSize} bytes\n` +
            `Compression Ratio: ${compression.compressionRatio.toFixed(2)}%\n`;

        // Send email with subdomain reply-to
        const mailOptions = {
            from: from || config.from_email,
            to: to,
            subject: subject,
            text: enhancedBody,
            headers: {
                'X-Compression-Enabled': 'true',
                'X-Compression-Level': '6',
                'X-Compression-Ratio': `${compression.compressionRatio.toFixed(2)}%`,
                'X-Original-Size': compression.originalSize.toString(),
                'X-Compressed-Size': compression.compressedSize.toString()
            }
        };

        // Add reply-to if provided or use config
        if (reply_to) {
            mailOptions.replyTo = reply_to;
        } else if (config.reply_to_email) {
            mailOptions.replyTo = config.reply_to_email;
        }

        const info = await transporter.sendMail(mailOptions);

        res.json({
            success: true,
            messageId: info.messageId,
            from: mailOptions.from,
            replyTo: mailOptions.replyTo,
            compression: {
                enabled: true,
                originalSize: compression.originalSize,
                compressedSize: compression.compressedSize,
                compressionRatio: compression.compressionRatio.toFixed(2) + '%'
            }
        });

    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ error: 'Failed to send email', details: error.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'email-api' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Email API server running on port ${PORT}`);
    console.log(`Email will be sent from: ${config.from_email}`);
});