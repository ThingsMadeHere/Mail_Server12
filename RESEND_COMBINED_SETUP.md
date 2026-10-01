# Resend Combined Setup for mchsrobotics.dev

## Overview
Use Resend for both sending and receiving from your custom domain mchsrobotics.dev.

## Architecture
```
Sending: outreach@mchsrobotics.dev → Resend Sending → Recipient
Receiving: Sender → outreach@mchsrobotics.dev → Resend Receiving → Webhook → dietpi-2 → Compression → Storage
```

## Benefits
- ✅ Same domain for sending and receiving
- ✅ Same service (Resend) for everything
- ✅ Professional email address
- ✅ Webhook to your dietpi-2
- ✅ Local compression and storage

## Trade-offs
- ❌ Requires MX record changes (switch from Cloudflare to Resend)
- ❌ Breaks current Cloudflare Email Routing
- ❌ Combined quota (3,000 emails/month for sending + receiving)

## Setup Steps

### Step 1: Enable Receiving for mchsrobotics.dev
1. Go to Resend Dashboard → **Domains** → **mchsrobotics.dev**
2. Look for **Receiving** section or toggle
3. Enable receiving for the domain
4. Resend will provide MX records to add

### Step 2: Update MX Records in Cloudflare
1. Go to Cloudflare Dashboard → **DNS**
2. **Remove current MX records** (Cloudflare MX records)
3. **Add Resend MX records** (provided by Resend):
   - Type: **MX**
   - Name: **@**
   - Content: **mx.resend.com** (or whatever Resend provides)
   - Priority: **10**

### Step 3: Create Webhook in Resend
1. Go to Resend Dashboard → **Webhooks**
2. Click **Add Webhook**
3. **URL**: `http://100.115.4.34:3000/webhook/email`
4. **Events**: Select `email.received`
5. **Add webhook**
6. Copy the **Webhook Secret**

### Step 4: Configure Webhook Server
On dietpi-2:
```bash
cd /root/Mail_Server
nano resend_webhook_config.json
# Add your webhook secret
```

### Step 5: Copy Files to dietpi-2
```bash
scp email_webhook_server.js resend_webhook_config.json root@100.115.4.34:/root/Mail_Server/
```

### Step 6: Start Webhook Server on dietpi-2
```bash
cd /root/Mail_Server
export RESEND_WEBHOOK_SECRET=your-webhook-secret
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
    "body": "This is a test email with combined Resend setup"
  }'
```

2. Test receiving (send email to outreach@mchsrobotics.dev from another account)

3. Check webhook logs:
```bash
pm2 logs resend-webhook
```

4. Check stored emails:
```bash
ls -la /mail-data/new/
```

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
- This replaces Cloudflare Email Routing with Resend Receiving
- Combined sending + receiving quota: 3,000 emails/month
- All emails are compressed and stored locally
- Webhook signature verification ensures security
- Use your Resend dashboard to monitor webhook delivery

This gives you a complete Resend-based email system with local compression storage!