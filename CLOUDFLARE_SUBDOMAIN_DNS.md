# Cloudflare DNS Setup for Subdomain Receiving

## Overview
Set up Cloudflare DNS for subdomain receiving with Resend while keeping main domain routing through Cloudflare.

## DNS Configuration

### Current Main Domain Records (Keep These)
```
Type: MX
Name: @
Content: route1.mx.cloudflare.net
Priority: 10

Type: MX
Name: @
Content: route2.mx.cloudflare.net
Priority: 32

Type: MX
Name: @
Content: route3.mx.cloudflare.net
Priority: 47
```

### New Subdomain Records (Add These)
```
Type: MX
Name: receiving
Content: mx.resend.com
Priority: 10
```

## Step-by-Step Cloudflare Setup

### Step 1: Go to Cloudflare DNS
1. Log into https://dash.cloudflare.com
2. Select **mchsrobotics.dev**
3. Click **DNS** in the sidebar

### Step 2: Add Subdomain MX Record
1. Click **Add Record**
2. Fill in the form:
   - **Type**: Select **MX**
   - **Name**: Enter `receiving`
   - **Target**: Enter `mx.resend.com` (or whatever Resend provides)
   - **Priority**: Enter `10`
   - **Proxy status**: Leave as **DNS only** (grey cloud)
3. Click **Save**

### Step 3: Verify MX Record
1. Check the DNS records list
2. Confirm you see:
   - `@ MX route1.mx.cloudflare.net` (existing)
   - `@ MX route2.mx.cloudflare.net` (existing)
   - `@ MX route3.mx.cloudflare.net` (existing)
   - `receiving MX mx.resend.com` (new)

### Step 4: Test DNS Propagation
```bash
# Test main domain MX records
dig MX mchsrobotics.dev

# Test subdomain MX records
dig MX receiving.mchsrobotics.dev
```

## Resend Setup for Subdomain

### Step 1: Add Subdomain in Resend
1. Go to Resend Dashboard → **Domains**
2. Click **Add Domain**
3. Enter: `receiving.mchsrobotics.dev`
4. Add the required DNS records from Resend (TXT, CNAME)
5. Wait for domain verification

### Step 2: Enable Receiving for Subdomain
1. Go to Resend Dashboard → **Domains** → **receiving.mchsrobotics.dev**
2. Look for **Receiving** section
3. Enable receiving
4. Resend will provide the exact MX record to use
5. Update Cloudflare MX record with the Resend-provided value

### Step 3: Create Webhook
1. Go to Resend Dashboard → **Webhooks**
2. Add webhook pointing to: `http://100.115.4.34:3000/webhook/email`
3. Select `email.received` events
4. Copy webhook secret

## Complete DNS Configuration Example

**Final Cloudflare DNS Records:**
```
# Main domain (Cloudflare Email Routing)
@ MX 10 route1.mx.cloudflare.net
@ MX 32 route2.mx.cloudflare.net
@ MX 47 route3.mx.cloudflare.net

# Subdomain (Resend Receiving)
receiving MX 10 mx.resend.com

# Subdomain verification (from Resend)
receiving TXT resend-verification-token
receiving CNAME resend-verification-url
```

## Testing

### Test Main Domain Routing
```bash
# Send email to outreach@mchsrobotics.dev
# Should route through Cloudflare Email Routing
```

### Test Subdomain Receiving
```bash
# Send email to outreach@receiving.mchsrobotics.dev
# Should route through Resend Receiving
```

### Verify DNS
```bash
# Check main domain MX
dig MX mchsrobotics.dev +short

# Check subdomain MX
dig MX receiving.mchsrobotics.dev +short
```

## Important Notes

- **Proxy Status**: Keep MX records as **DNS only** (grey cloud) - do not proxy
- **Priority**: Ensure main domain MX has higher priority than subdomain
- **Propagation**: DNS changes can take up to 24 hours to propagate
- **Cloudflare Email Routing**: Main domain routing remains active
- **Resend Receiving**: Subdomain uses Resend exclusively

## Troubleshooting

### If emails don't route to subdomain:
1. Check MX record priority (subdomain should be 10)
2. Verify DNS propagation has completed
3. Check Resend domain verification status
4. Confirm Resend receiving is enabled

### If main domain routing breaks:
1. Verify main domain MX records are still present
2. Check Cloudflare Email Routing is still active
3. Ensure subdomain MX doesn't conflict with main domain

This setup gives you Cloudflare for main domain routing and Resend for subdomain receiving!