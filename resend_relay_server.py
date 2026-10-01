#!/usr/bin/env python3
"""
Email Server using Resend for mchsrobotics.dev
Free tier: 3,000 emails/month, no app password needed
"""

import smtplib
import gzip
import json
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import email.utils
import datetime

class ResendRelayServer:
    def __init__(self, config_file='resend_config.json'):
        """Initialize Resend relay email server"""
        self.config = self.load_config(config_file)
        self.sent_emails = []
        
    def load_config(self, config_file):
        """Load configuration from JSON file"""
        default_config = {
            "from_email": "outreach@mchsrobotics.dev",
            "resend_api_key": "",  # Get from resend.com
            "smtp_server": "smtp.resend.com",
            "smtp_port": 587,
            "smtp_username": "resend",  # Resend uses "resend" as username
            "compression_enabled": True,
            "compression_level": 6
        }
        
        if os.path.exists(config_file):
            try:
                with open(config_file, 'r') as f:
                    config = json.load(f)
                    default_config.update(config)
            except Exception as e:
                print(f"Error loading config: {e}")
        
        return default_config
    
    def save_config(self, config_file='resend_config.json'):
        """Save configuration to JSON file"""
        with open(config_file, 'w') as f:
            json.dump(self.config, f, indent=2)
    
    def get_compression_info(self, data):
        """Get compression information for data"""
        if self.config['compression_enabled']:
            original_size = len(data.encode('utf-8'))
            compressed = gzip.compress(data.encode('utf-8'), 
                                      compresslevel=self.config['compression_level'])
            compressed_size = len(compressed)
            ratio = compressed_size / original_size if original_size > 0 else 0
            
            return {
                'enabled': True,
                'original_size': original_size,
                'compressed_size': compressed_size,
                'ratio': ratio,
                'level': self.config['compression_level']
            }
        return {'enabled': False}
    
    def create_email(self, to_address, subject, body):
        """Create email message with compression information"""
        msg = MIMEMultipart()
        msg['From'] = self.config['from_email']
        msg['To'] = to_address
        msg['Subject'] = subject
        msg['Date'] = email.utils.formatdate(localtime=True)
        
        # Get compression info
        comp_info = self.get_compression_info(body)
        
        # Add compression headers
        msg['X-Compression-Enabled'] = str(comp_info['enabled'])
        if comp_info['enabled']:
            msg['X-Compression-Level'] = str(comp_info['level'])
            msg['X-Compression-Ratio'] = f"{comp_info['ratio']:.2%}"
            msg['X-Original-Size'] = str(comp_info['original_size'])
            msg['X-Compressed-Size'] = str(comp_info['compressed_size'])
        
        # Create enhanced body with compression info
        enhanced_body = body
        if comp_info['enabled']:
            enhanced_body += f"\n\n---\nEmail Compression Info:\n"
            enhanced_body += f"Compression: Enabled (Gzip, Level {comp_info['level']})\n"
            enhanced_body += f"Original Size: {comp_info['original_size']} bytes\n"
            enhanced_body += f"Compressed Size: {comp_info['compressed_size']} bytes\n"
            enhanced_body += f"Compression Ratio: {comp_info['ratio']:.2%}\n"
        
        msg.attach(MIMEText(enhanced_body, 'plain'))
        
        return msg
    
    def send_email_via_resend(self, to_address, subject, body):
        """Send email using Resend SMTP"""
        try:
            if not self.config['resend_api_key']:
                print("Error: Resend API key not configured")
                print("Please get a free API key from resend.com")
                return False
            
            # Create message
            msg = self.create_email(to_address, subject, body)
            
            # Connect to Resend SMTP
            server = smtplib.SMTP(self.config['smtp_server'], self.config['smtp_port'])
            server.starttls()
            server.login(self.config['smtp_username'], self.config['resend_api_key'])
            
            # Send email
            server.send_message(msg)
            server.quit()
            
            # Log sent email
            comp_info = self.get_compression_info(body)
            email_log = {
                'timestamp': datetime.datetime.now().isoformat(),
                'to': to_address,
                'subject': subject,
                'compressed': comp_info['enabled'],
                'original_size': comp_info.get('original_size', len(body)),
                'compressed_size': comp_info.get('compressed_size', 0)
            }
            self.sent_emails.append(email_log)
            
            print(f"Email sent successfully to {to_address}")
            if comp_info['enabled']:
                print(f"Compression: {comp_info['original_size']} -> {comp_info['compressed_size']} bytes ({comp_info['ratio']:.2%})")
            return True
            
        except Exception as e:
            print(f"Error sending email: {e}")
            return False
    
    def send_email(self, to_address, subject, body):
        """Send email using Resend relay"""
        return self.send_email_via_resend(to_address, subject, body)
    
    def test_connection(self):
        """Test Resend SMTP connection"""
        try:
            if not self.config['resend_api_key']:
                print("Resend API key not configured")
                return False
            
            server = smtplib.SMTP(self.config['smtp_server'], self.config['smtp_port'])
            server.starttls()
            server.login(self.config['smtp_username'], self.config['resend_api_key'])
            server.quit()
            print("Resend SMTP connection successful")
            return True
        except Exception as e:
            print(f"Resend SMTP connection failed: {e}")
            return False

def main():
    """Main function for testing"""
    print("Resend Relay Email Server for mchsrobotics.dev")
    print("=" * 50)
    
    # Create server instance
    server = ResendRelayServer()
    
    # Check if credentials are set
    if not server.config['resend_api_key']:
        print("Resend API key not configured.")
        print("Getting a free Resend API key:")
        print("1. Go to https://resend.com/")
        print("2. Sign up for free account (3,000 emails/month)")
        print("3. Go to API Keys")
        print("4. Create API Key")
        print("5. Copy the API key")
        print("\nAdd it to resend_config.json")
        return
    
    # Test connection
    print("\nTesting Resend SMTP connection...")
    if server.test_connection():
        print("\nSending test email to carterherrault536@gmail.com...")
        success = server.send_email(
            to_address="carterherrault536@gmail.com",
            subject="Test Email from mchsrobotics.dev via Resend",
            body="This is a test email from the mchsrobotics.dev mail server via Resend. "
                 "This server has gzip compression enabled for all emails. "
                 "If you receive this, the Resend relay with compression is working correctly!"
        )
        
        if success:
            print("Test email sent successfully!")
        else:
            print("Failed to send test email.")
    else:
        print("Cannot send test email - Resend SMTP connection failed")

if __name__ == "__main__":
    main()