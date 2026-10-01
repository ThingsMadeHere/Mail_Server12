# Webhook 404 Fix + Unified Email Server (v2)

## Why receiving failed ("HTTP status code 404 - Not Found, Attempts: 7")

Resend's `email.received` webhook was being delivered to
`http://100.115.4.34:3000/webhook/email`, but **nothing on port 3000 served that
route**. Root cause in the old setup:

1. **Two servers, one port.** `email_api_server.js` (sending API) and
   `email_webhook_server.js` (receiving webhook) BOTH default to `PORT || 3000`.
   Only one process can bind a port — whichever pm2 process started first won.
   If `email-api` was the live process, it has **no `/webhook/email` route at
   all**, so every Resend delivery got an instant `404 Not Found` (exactly what
   your dashboard shows), and Resend retried 7 times before pausing.
2. Secondary bugs fixed along the way:
   - The old webhook server verified signatures with a plain-HMAC hex scheme
     that never matches how Resend actually signs webhooks (svix-style:
     `HMAC-SHA256("<webhook-id>.<raw body>")` with the base64 key from the
     `whsec_...` secret). It also compared buffers of possibly different
     lengths inside `timingSafeEqual`, which throws.
   - It registered `express.json()` AND `express.raw()` on the same content
     type, corrupting the raw body needed for signature verification.
   - It ignored `data.recipients` (the address your mail actually went to —
     e.g. `Outreach Receive <outreach.receive@mchsrobotics.dev>`).
   - Sending used SMTP through nodemailer; now it uses the Resend HTTPS API
     directly (same key, fewer moving parts).

**The structural fix:** everything now lives in ONE server (`email_server.js`)
on ONE port. It serves `/webhook/email`, `/api/send-email`, the inbox API and
the embedded UI simultaneously, so a "wrong server owns the port" situation is
impossible.

## What's new

| Route | Purpose |
|---|---|
| `POST /webhook/email` | Resend receiving endpoint (proper svix signature verification) |
| `GET /webhook/health`, `GET /api/health` | Health checks |
| `POST /api/send-email` | Send via Resend API (`to, subject, body/html, cc, from, reply_to`) |
| `GET /api/inbox` | List received emails (JSON) |
| `GET /api/inbox/:id` | Read one stored email (`?format=raw` for the .eml only) |
| `GET /api/status` | Health + recent webhook deliveries + inbox count |
| `GET /ui` (and `/`) | Embedded frontend — designed to be dropped into an `<iframe>` on your existing site |

Unknown paths return a JSON 404 listing valid routes (helpful while debugging).

### Custom requests from within the machine
- Requests from **localhost are trusted automatically** — scripts, cron jobs,
  curl, Python, etc. on dietpi-2 need no credentials.
- Remote callers must send `Authorization: Bearer <API_TOKEN>` (or
  `X-Api-Key`). Set `API_TOKEN` as an env var or put `{"api_token": "..."}` in
  `token.json` (gitignored). Without a token configured, non-localhost API
  access is simply denied — safe default.

### Embedded frontend (not a separate website)
`public/index.html` is a single self-contained page served by the same server.
Embed it in any existing page:

```html
<iframe src="http://100.115.4.34:3000/ui"
        style="width:100%;height:800px;border:1px solid #ccc;border-radius:8px"
        title="MCHS Robotics Mail Console"></iframe>
```

Tabs: **Inbox** (received emails + full decoded .eml view), **Send** (compose →
Resend), **Status** (config check + recent webhook deliveries — great for
debugging), **Embed/API** (copy-paste snippets). CORS is open and no
`X-Frame-Options`/CSP frame-ancestors header is set, so iframing works. The UI
prompts once for an API token if you browse it from a non-localhost machine.

## Deploy on dietpi-2

```bash
cd /root/Mail_Server
# copy over: email_server.js public/ package.json resend_webhook_config.json
# create resend_config.json from resend_config.example.json with your real API key

# stop BOTH old processes — they conflict on port 3000
pm2 delete email-api resend-webhook 2>/dev/null

RESEND_WEBHOOK_SECRET=whsec_XJ04... \
API_TOKEN=$(openssl rand -hex 24) \
pm2 start email_server.js --name email-server
pm2 save
```

Verify locally:

```bash
curl http://localhost:3000/webhook/health
curl -X POST http://localhost:3000/api/send-email \
  -H 'Content-Type: application/json' \
  -d '{"to":"you@gmail.com","subject":"test","body":"hello from unified server"}'
curl http://localhost:3000/api/inbox
```

## Then in the Resend dashboard

1. **Webhooks**: point the URL at `http://100.115.4.34:3000/webhook/email`
   and make sure the event `email.received` is enabled. Use the
   dashboard's **"Send test"** / redeliver option — it should now return 200.
2. Check the delivery appears under **Status → Recent webhook deliveries** in
   the UI (`http://100.115.4.34:3000/ui`).
3. Re-enable the paused webhook (the failing one with 7 attempts) or just send
   a fresh email to `outreach.receive@mchsrobotics.dev`.
4. If Resend still reports failures, confirm reachability FROM THE INTERNET —
   `100.115.4.34` is a Tailscale IP. If Resend cannot route to it, expose the
   server with a tunnel and use its https URL instead, e.g.:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   # then set webhook URL to https://<tunnel>.trycloudflare.com/webhook/email
   ```

## Files

- `email_server.js` — the unified server (start this, not the old two)
- `public/index.html` — embedded console UI
- `resend_config.example.json` — template; copy to `resend_config.json` (gitignored) and paste your Resend API key
- `email_api_server.js` / `email_webhook_server.js` — superseded; kept for reference, do NOT run them alongside `email_server.js`
