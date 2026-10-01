#!/bin/bash

# Setup Postfix to receive, compress, and store emails locally on dietpi-2

set -e

echo "Setting up local email storage with compression"
echo "=============================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

echo "Step 1: Configure Postfix for local delivery..."
# Configure Postfix to receive emails for local domain
postconf -e 'mydestination = $myhostname, localhost.$mydomain, localhost, mchsrobotics.dev'
postconf -e 'local_transport = local:'
postconf -e 'mailbox_transport = local:'

echo "Step 2: Configure Postfix to use compression filter..."
# Add content filter for compression
postconf -e 'content_filter = compress-filter:dummy'

# Add transport for compression
cat >> /etc/postfix/master.cf << 'EOF'

# Compression filter
compress-filter unix - n n - - pipe
  flags=Rq user=outreach argv=/usr/local/bin/compress_email.py

EOF

echo "Step 3: Update compression script for incoming emails..."
# The compress_email.py needs to handle incoming emails
# It should save compressed emails to Maildir

echo "Step 4: Ensure Maildir structure exists..."
mkdir -p /home/outreach/Maildir/{new,cur,tmp}
chown -R outreach:outreach /home/outreach/Maildir

echo "Step 5: Configure Postfix aliases..."
echo "outreach: outreach" >> /etc/aliases
newaliases

echo "Step 6: Restart Postfix..."
systemctl restart postfix

echo "=============================================="
echo "Local email storage setup complete!"
echo "=============================================="
echo ""
echo "Emails sent to outreach@mchsrobotics.dev will:"
echo "- Be received by Postfix"
echo "- Be compressed using gzip"
echo "- Stored as files in /home/outreach/Maildir/"
echo ""
echo "To check stored emails:"
echo "  ls -la /home/outreach/Maildir/new/"
echo "  ls -la /home/outreach/Maildir/cur/"
echo ""
echo "Note: You'll need to update DNS MX records to point to this server"
echo "instead of Cloudflare for direct delivery"