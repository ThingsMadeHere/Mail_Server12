# Resend Subdomain Receiving Setup for mchsrobotics.dev

## Overview
Use a subdomain for receiving emails with Resend while keeping your main domain for sending. No MX record conflicts with Cloudflare.

## Architecture
```
Sending: outreach@mchsrobotics.dev → Resend Sending → Recipient
Receiving: Sender → outreach@receiving.mchsrobotics.dev → Resend Receiving → Webhook → dietpi-2 → Compression → Storage
```

## Benefits
- ✅ Main domain MX records unchanged (keeps Cloudflare)
- ✅ Professional subdomain (receiving.mchsrobotics.dev)
- ✅ Same service (Resend) for sending and receiving
- ✅ No conflicts with existing email setup
- ✅ Webhook to your dietpi-2
- ✅ Local compression and storage

## Setup Steps

### Step 1: Create Subdomain for Receiving
Choose a subdomain name:
- `receiving.mchsrobotics.dev` (recommended)
- `mail.mchsrobotics.dev`
- `inbound.mchsrobotics.dev`

### Step 2: Add Subdomain in Cloudflare DNS
1. Go to Cloudflare Dashboard → **DNS**
2. Add MX record for the subdomain:
   - Type: **MX**
   - Name: **receiving** (or your chosen subdomain)
   - Content: **Resend MX records** (get from Resend Dashboard)
   - Priority: **10**
   - **Proxy status**: DNS only (grey cloud)

See [CLOUDFLARE_SUBDOMAIN_DNS.md](CLOUDFLARE_SUBDOMAIN_DNS.md) for detailed Cloudflare DNS setup instructions.

### Step 3: Enable Receiving in Resend
1. Go to Resend Dashboard → **Domains**
2. Add your subdomain: `receiving.mchsrobotics.dev`
3. Enable receiving for the subdomain
4. Resend will provide MX records for the subdomain
5. Add those MX records to Cloudflare

### Step 4: Create Webhook in Resend
1. Go to Resend Dashboard → **Webhooks**
2. Click **Add Webhook**
3. **URL**: `http://100.115.4.34:3000/webhook/email`
4. **Events**: Select `email.received`
5. **Add webhook**
6. Copy the **Webhook Secret**

### Step 5: Update Sending Configuration
Update your sending to use reply-to for the subdomain:
```json
{
  "from": "outreach@mchsrobotics.dev",
  "reply_to": "outreach@receiving.mchsrobotics.dev"
}
```

### Step 6: Configure Webhook Server
On dietpi-2:
```bash
cd /root/Mail_Server
nano resend_webhook_config.json
# Add your webhook secret
```

### Step 7: Copy Files to dietpi-2
```bash
scp email_api_server.js email_webhook_server.js resend_config.json resend_webhook_config.json root@100.115.4.34:/root/Mail_Server/
```

### Step 8: Start Webhook Server on dietpi-2
```bash
cd /root/Mail_Server
export RESEND_WEBHOOK_SECRET=your-webhook-secret
pm2 restart email-api
pm2 start email_webhook_server.js --name resend-webhook
pm2 save
```

### Step 9: Test Sending and Receiving
1. Test sending (from dietpi-2):
```bash
curl -X POST http://100.115.4.34:3000/api/send-email \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@example.com",
    "subject": "Test Email",
    "body": "This is a test email with subdomain receiving"
  }'
```

2. Test receiving (send email to outreach@receiving.mchsrobotics.dev from another account)

3. Check webhook logs:
```bash
pm2 logs resend-webhook
```

4. Check stored emails:
```bash
ls -la /mail-data/new/
```

## DNS Configuration Example

**Cloudflare DNS Records:**
```
# Main domain (keep existing)
@ MX 10 route1.mx.cloudflare.net
@ MX 32 route2.mx.cloudflare.net
@ MX 47 route3.mx.cloudflare.net

# Subdomain for receiving
receiving MX 10 mx.resend.com
```

## Features
- ✅ Subdomain-based receiving (no main domain conflicts)
- ✅ Main domain keeps existing MX records
- ✅ Automatic reply-to configuration
- ✅ Webhook signature verification
- ✅ Email content reconstruction
- ✅ Compression (gzip level 6)
- ✅ Metadata storage
- ✅ Health check endpoints
- ✅ Error handling

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

## Notes
- Main domain MX records remain unchanged
- Subdomain MX records point to Resend
- Combined sending + receiving quota: 3,000 emails/month
- All emails are compressed and stored locally
- Webhook signature verification ensures security
- Use your Resend dashboard to monitor webhook delivery

This gives you the best of both worlds - keep your main domain setup while adding subdomain receiving with Resend!