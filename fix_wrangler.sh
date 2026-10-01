#!/bin/bash

# Fix wrangler.toml on dietpi-2

cat > /root/Mail_Server/wrangler.toml << 'EOF'
name = "email-worker"
main = "cloudflare-worker.js"
compatibility_date = "2024-01-01"

[vars]
WEBHOOK_URL = "http://100.115.4.34:3000/webhook/email"
WEBHOOK_SECRET = "your-secret-key-change-this"

[email]
name = "EMAIL_HANDLER"
EOF

echo "wrangler.toml fixed"
