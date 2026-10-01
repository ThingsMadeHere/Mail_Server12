#!/usr/bin/env python3
"""
View and decompress stored emails from dietpi-2 Maildir
"""

import os
import gzip
import json
import email
from email import policy
from email.header import decode_header

def decode_header_value(header_value):
    """Decode email header value"""
    if header_value is None:
        return ""
    
    decoded_parts = decode_header(header_value)
    decoded_string = ""
    for part, encoding in decoded_parts:
        if isinstance(part, bytes):
            decoded_string += part.decode(encoding or 'utf-8', errors='replace')
        else:
            decoded_string += part
    return decoded_string

def view_stored_emails(maildir_path='/home/outreach/Maildir/new'):
    """View stored compressed emails"""
    print(f"Checking stored emails in: {maildir_path}")
    print("=" * 50)
    
    if not os.path.exists(maildir_path):
        print(f"Directory not found: {maildir_path}")
        return
    
    # Get all compressed email files
    email_files = [f for f in os.listdir(maildir_path) if f.endswith('.eml.gz')]
    
    if not email_files:
        print("No stored emails found")
        return
    
    print(f"Found {len(email_files)} stored emails\n")
    
    for email_file in sorted(email_files):
        filepath = os.path.join(maildir_path, email_file)
        metadata_file = filepath + '.metadata.json'
        
        print(f"📧 {email_file}")
        
        # Show metadata if available
        if os.path.exists(metadata_file):
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
            print(f"   From: {metadata.get('from', 'Unknown')}")
            print(f"   To: {metadata.get('to', 'Unknown')}")
            print(f"   Subject: {metadata.get('subject', 'No Subject')}")
            print(f"   Date: {metadata.get('timestamp', 'Unknown')}")
            print(f"   Compression: {metadata.get('original_size', 0)} -> {metadata.get('compressed_size', 0)} bytes")
            print(f"   Ratio: {metadata.get('compression_ratio', 'N/A')}")
        
        # Decompress and show preview
        try:
            with open(filepath, 'rb') as f:
                compressed_data = f.read()
            
            decompressed = gzip.decompress(compressed_data).decode('utf-8')
            msg = email.message_from_string(decompressed, policy=policy.default)
            
            # Get body preview
            body = ""
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/plain":
                        try:
                            body = part.get_payload(decode=True).decode('utf-8', errors='replace')
                            break
                        except:
                            pass
            else:
                try:
                    body = msg.get_payload(decode=True).decode('utf-8', errors='replace')
                except:
                    body = str(msg.get_payload())
            
            print(f"   Body preview: {body[:100]}...")
            
        except Exception as e:
            print(f"   Error reading email: {e}")
        
        print()

def decompress_email(email_file, maildir_path='/home/outreach/Maildir/new'):
    """Decompress and display full email"""
    filepath = os.path.join(maildir_path, email_file)
    
    try:
        with open(filepath, 'rb') as f:
            compressed_data = f.read()
        
        decompressed = gzip.decompress(compressed_data).decode('utf-8')
        print(decompressed)
        
    except Exception as e:
        print(f"Error decompressing email: {e}")

if __name__ == "__main__":
    import sys
    
    maildir_path = sys.argv[1] if len(sys.argv) > 1 else '/home/outreach/Maildir/new'
    
    if len(sys.argv) > 2 and sys.argv[2] == '--decompress':
        decompress_email(sys.argv[1], sys.argv[2] if len(sys.argv) > 3 else '/home/outreach/MailServer/new')
    else:
        view_stored_emails(maildir_path)