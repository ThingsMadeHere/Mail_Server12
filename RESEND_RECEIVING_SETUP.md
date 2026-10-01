# Resend Hybrid Email Setup for mchsrobotics.dev

## Overview
Hybrid email setup using Resend for both sending and receiving with your custom domain for sending and .resend.app for receiving.

## Architecture
```
Sending: outreach@mchsrobotics.dev → Resend Sending → Recipient
Receiving: Sender → outreach@your-name.resend.app → Resend Receiving → Webhook → dietpi-2 → Compression → Storage
```

## Benefits
- ✅ Professional sending address (your custom domain)
- ✅ Functional receiving address (no MX record conflicts)
- ✅ Same service for sending and receiving
- ✅ Webhook to your dietpi-2
- ✅ Local compression and storage
- ✅ No DNS changes needed

## Setup Steps

### Step 1: Get Your Resend Receiving Address
1. Go to Resend Dashboard → **Domains** → **Receiving**
2. Click **Add Receiving Domain** or use existing .resend.app domain
3. Copy your receiving address (e.g., `your-name.resend.app`)

### Step 2: Create Webhook in Resend
1. Go to Resend Dashboard → **Webhooks**
2. Click **Add Webhook**
3. **URL**: `http://100.115.4.34:3000/webhook/email`
4. **Events**: Select `email.received`
5. **Add webhook**
6. Copy the **Webhook Secret** from webhook details

### Step 3: Update resend_config.json
Add your receiving address as reply_to:
```json
{
  "from_email": "outreach@mchsrobotics.dev",
  "reply_to_email": "outreach@your-name.resend.app",
  "resend_api_key": "your-api-key",
  "smtp_server": "smtp.resend.com",
  "smtp_port": 587,
  "smtp_username": "resend",
  "compression_enabled": true,
  "compression_level": 6
}
```

### Step 4: Configure Webhook Server
On dietpi-2:
```bash
cd /root/Mail_Server
nano resend_webhook_config.json
# Add your webhook secret
```

### Step 5: Copy Files to dietpi-2
```bash
scp email_api_server.js email_webhook_server.js resend_config.json resend_webhook_config.json root@100.115.4.34:/root/Mail_Server/
```

### Step 6: Restart Services on dietpi-2
```bash
cd /root/Mail_Server
export RESEND_WEBHOOK_SECRET=your-webhook-secret
pm2 restart email-api
pm2 start email_webhook_server.js --name resend-webhook
pm2 save
```

### Step 7: Test Sending and Receiving
1. Test sending (from dietpi-2):
```bash
curl -X POST http://100.115.4.34:3000/api/send-email \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@example.com",
    "subject": "Test Email",
    "body": "This is a test email with hybrid setup"
  }'
```

2. Test receiving (send email to your .resend.app address from another account)

3. Check webhook logs:
```bash
pm2 logs resend-webhook
```

4. Check stored emails:
```bash
ls -la /mail-data/new/
```

## Features
- ✅ Hybrid sending/receiving configuration
- ✅ Professional sending address (your custom domain)
- ✅ Functional receiving address (no MX conflicts)
- ✅ Automatic reply-to configuration
- ✅ Webhook signature verification
- ✅ Email content reconstruction
- ✅ Compression (gzip level 6)
- ✅ Metadata storage
- ✅ Health check endpoints
- ✅ Error handling

## How It Works

### Sending
- **From**: `outreach@mchsrobotics.dev` (your professional address)
- **Reply-to**: `outreach@your-name.resend.app` (receives replies)
- **Through**: Resend API
- **Compression**: Applied to email body

### Receiving
- **To**: `outreach@your-name.resend.app` (your receiving address)
- **Through**: Resend Receiving service
- **Webhook**: POST to dietpi-2 webhook server
- **Storage**: Compressed and stored locally

## Monitoring
```bash
# Check API server logs
pm2 logs email-api

# Check webhook server logs
pm2 logs resend-webhook

# Check stored emails
ls -la /mail-data/new/

# View email metadata
cat /mail-data/new/*.metadata.json

# View stored emails
python3 view_stored_emails.py /mail-data/new/
```

## Webhook Payload Format
Resend sends `email.received` events with this structure:
```json
{
  "type": "email.received",
  "id": "event_id",
  "created_at": "2024-01-15T10:30:00Z",
  "data": {
    "from": "sender@example.com",
    "to": ["outreach@your-name.resend.app"],
    "subject": "Email Subject",
    "html": "<html>...</html>",
    "text": "Plain text content",
    "headers": {},
    "message_id": "message-id"
  }
}
```

## Notes
- The .resend.app domain avoids MX record conflicts
- Webhook signature verification ensures security
- All emails are compressed and stored locally
- Use your Resend dashboard to monitor webhook delivery
- Combined sending + receiving quota: 3,000 emails/month
- Reply-to is automatically set to your receiving address

This hybrid setup gives you the best of both worlds - professional sending address with functional receiving without DNS conflicts!

## Features
- ✅ Webhook signature verification
- ✅ Email content reconstruction
- ✅ Compression (gzip level 6)
- ✅ Metadata storage
- ✅ Health check endpoint
- ✅ Error handling

## Monitoring
```bash
# Check webhook server logs
pm2 logs resend-webhook

# Check stored emails
ls -la /mail-data/new/

# View email metadata
cat /mail-data/new/*.metadata.json

# View stored emails
python3 view_stored_emails.py /mail-data/new/
```

## Webhook Payload Format
Resend sends `email.received` events with this structure:
```json
{
  "type": "email.received",
  "id": "event_id",
  "created_at": "2024-01-15T10:30:00Z",
  "data": {
    "from": "sender@example.com",
    "to": ["outreach@your-name.resend.app"],
    "subject": "Email Subject",
    "html": "<html>...</html>",
    "text": "Plain text content",
    "headers": {},
    "message_id": "message-id"
  }
}
```

## Notes
- The .resend.app domain avoids MX record conflicts
- Webhook signature verification ensures security
- All emails are compressed and stored locally
- Use your Resend dashboard to monitor webhook delivery
- Combined sending + receiving quota: 3,000 emails/month

This gives you direct email receiving with compression using the same Resend service you already use for sending!