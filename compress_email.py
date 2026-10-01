#!/usr/bin/env python3
"""
Email Compression Script for mchsrobotics.dev Postfix
Compresses and stores incoming emails as compressed files
"""

import sys
import gzip
import email
import email.policy
from email import message_from_string
import subprocess
import os
import datetime
import json

def compress_and_store_email(raw_email):
    """Compress email content and store as file"""
    try:
        # Parse the email
        msg = message_from_string(raw_email, policy=email.policy.default)
        
        # Extract email info
        subject = msg.get('Subject', 'No Subject')
        from_addr = msg.get('From', 'Unknown')
        to_addr = msg.get('To', 'Unknown')
        date = msg.get('Date', datetime.datetime.now().isoformat())
        
        # Track compression statistics
        total_original = 0
        total_compressed = 0
        
        # Compress the body content
        for part in msg.walk():
            content_type = part.get_content_type()
            if content_type in ["text/plain", "text/html"]:
                original_content = part.get_payload(decode=True)
                if original_content:
                    original_size = len(original_content)
                    compressed = gzip.compress(original_content, compresslevel=6)
                    compressed_size = len(compressed)
                    
                    total_original += original_size
                    total_compressed += compressed_size
                    
                    # Replace with compressed content
                    part.set_payload(compressed)
                    part.replace_header('Content-Transfer-Encoding', 'base64')
                    part.add_header('X-Compressed', 'gzip')
                    part.add_header('X-Original-Size', str(original_size))
                    part.add_header('X-Compressed-Size', str(compressed_size))
        
        # Add overall compression headers to the message
        if total_original > 0:
            ratio = total_compressed / total_original
            msg.add_header('X-Compression-Enabled', 'true')
            msg.add_header('X-Compression-Level', '6')
            msg.add_header('X-Compression-Ratio', f"{ratio:.2%}")
            msg.add_header('X-Total-Original-Size', str(total_original))
            msg.add_header('X-Total-Compressed-Size', str(total_compressed))
        
        # Generate filename
        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        safe_subject = ''.join(c for c in subject if c.isalnum() or c in (' ', '-', '_')).rstrip()
        filename = f"{timestamp}_{safe_subject[:50]}.eml.gz"
        
        # Store compressed email
        maildir_path = '/home/outreach/Maildir/new'
        os.makedirs(maildir_path, exist_ok=True)
        
        # Compress the entire email and save
        compressed_email = gzip.compress(msg.as_string().encode('utf-8'), compresslevel=6)
        filepath = os.path.join(maildir_path, filename)
        
        with open(filepath, 'wb') as f:
            f.write(compressed_email)
        
        # Also save metadata
        metadata = {
            'timestamp': datetime.datetime.now().isoformat(),
            'from': from_addr,
            'to': to_addr,
            'subject': subject,
            'original_size': total_original,
            'compressed_size': len(compressed_email),
            'compression_ratio': f"{(len(compressed_email)/total_original)*100:.2f}%" if total_original > 0 else "0%",
            'filename': filename
        }
        
        metadata_path = os.path.join(maildir_path, f"{filename}.metadata.json")
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        # Change ownership
        os.chown(filepath, 1000, 1000)  # outreach user
        os.chown(metadata_path, 1000, 1000)
        
        print(f"Email compressed and stored: {filepath}", file=sys.stderr)
        print(f"Compression: {total_original} -> {len(compressed_email)} bytes", file=sys.stderr)
        
        return True
        
    except Exception as e:
        print(f"Error compressing and storing email: {e}", file=sys.stderr)
        return False

def process_postfix_email():
    """Process incoming email from Postfix"""
    try:
        # Read raw email from stdin
        raw_email = sys.stdin.read()
        
        if not raw_email:
            print("No email content received", file=sys.stderr)
            sys.exit(1)
        
        # Compress and store the email
        success = compress_and_store_email(raw_email)
        
        if success:
            print("Email processed successfully", file=sys.stderr)
            sys.exit(0)
        else:
            print("Email processing failed", file=sys.stderr)
            sys.exit(1)
        
    except Exception as e:
        print(f"Error processing email: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    # Process incoming email
    process_postfix_email()
