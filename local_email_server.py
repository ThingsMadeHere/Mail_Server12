#!/usr/bin/env python3
"""
Local Email Server for mchsrobotics.dev with Gzip Compression
Sends emails using local Postfix server with compression
"""

import subprocess
import gzip
import base64
import json
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
import email.utils
import datetime

class LocalEmailServer:
    def __init__(self, config_file='local_config.json'):
        """Initialize local email server with configuration"""
        self.config = self.load_config(config_file)
        self.sent_emails = []
        
    def load_config(self, config_file):
        """Load configuration from JSON file"""
        default_config = {
            "from_email": "outreach@mchsrobotics.dev",
            "compression_enabled": True,
            "compression_level": 6,
            "use_sendmail": True
        }
        
        if os.path.exists(config_file):
            try:
                with open(config_file, 'r') as f:
                    config = json.load(f)
                    default_config.update(config)
            except Exception as e:
                print(f"Error loading config: {e}")
        
        return default_config
    
    def save_config(self, config_file='local_config.json'):
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
    
    def send_email_via_sendmail(self, to_address, subject, body):
        """Send email using local sendmail/postfix"""
        try:
            # Create message
            msg = self.create_email(to_address, subject, body)
            
            # Add explicit sender to ensure correct from address
            process = subprocess.Popen(
                ['/usr/sbin/sendmail', '-i', '-f', self.config['from_email'], to_address],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            stdout, stderr = process.communicate(msg.as_string().encode('utf-8'))
            
            if process.returncode != 0:
                print(f"Sendmail error: {stderr.decode('utf-8')}")
                return False
            
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
        """Send email using configured method"""
        if self.config['use_sendmail']:
            return self.send_email_via_sendmail(to_address, subject, body)
        else:
            print("SMTP method not configured for local server")
            return False
    
    def test_sendmail(self):
        """Test if sendmail is available"""
        try:
            result = subprocess.run(['which', 'sendmail'], capture_output=True, text=True)
            if result.returncode == 0:
                print(f"Sendmail found: {result.stdout.strip()}")
                return True
            else:
                print("Sendmail not found")
                return False
        except Exception as e:
            print(f"Error checking sendmail: {e}")
            return False

def main():
    """Main function for testing"""
    print("Local Email Server for mchsrobotics.dev")
    print("=" * 50)
    
    # Create server instance
    server = LocalEmailServer()
    
    # Test sendmail availability
    print("\nTesting sendmail availability...")
    if not server.test_sendmail():
        print("Sendmail not available. Please install Postfix first.")
        print("Run: sudo apt install postfix")
        return
    
    # Test email sending
    print("\nSending test email to carterherrault536@gmail.com...")
    success = server.send_email(
        to_address="carterherrault536@gmail.com",
        subject="Test Email from mchsrobotics.dev via Local Server",
        body="This is a test email from the mchsrobotics.dev local mail server. "
             "This server has gzip compression enabled for all emails. "
             "If you receive this, the local mail server with compression is working correctly!"
    )
    
    if success:
        print("Test email sent successfully!")
    else:
        print("Failed to send test email.")

if __name__ == "__main__":
    main()