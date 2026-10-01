#!/usr/bin/env python3
"""
Email Stress Test for mchsrobotics.dev
Tests the current Cloudflare + Resend setup under load
"""

import requests
import time
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import statistics

class EmailStressTest:
    def __init__(self, api_url, from_email, to_email):
        self.api_url = api_url
        self.from_email = from_email
        self.to_email = to_email
        self.results = []
        self.lock = threading.Lock()
    
    def send_single_email(self, test_num):
        """Send a single test email"""
        start_time = time.time()
        
        try:
            payload = {
                "to": self.to_email,
                "subject": f"Stress Test Email #{test_num}",
                "body": f"This is stress test email #{test_num} from mchsrobotics.dev. "
                       f"Testing system performance under load. "
                       f"Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}",
                "from": self.from_email
            }
            
            response = requests.post(
                f"{self.api_url}/api/send-email",
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=30
            )
            
            end_time = time.time()
            duration = end_time - start_time
            
            result = {
                "test_num": test_num,
                "success": response.status_code == 200,
                "status_code": response.status_code,
                "duration": duration,
                "timestamp": time.strftime('%Y-%m-%d %H:%M:%S')
            }
            
            if response.status_code == 200:
                data = response.json()
                result["message_id"] = data.get("messageId")
                result["compression"] = data.get("compression", {})
            else:
                result["error"] = response.text
            
            with self.lock:
                self.results.append(result)
            
            return result
            
        except Exception as e:
            end_time = time.time()
            duration = end_time - start_time
            
            result = {
                "test_num": test_num,
                "success": False,
                "error": str(e),
                "duration": duration,
                "timestamp": time.strftime('%Y-%m-%d %H:%M:%S')
            }
            
            with self.lock:
                self.results.append(result)
            
            return result
    
    def run_stress_test(self, num_emails, concurrency=5):
        """Run stress test with specified parameters"""
        print(f"Starting stress test: {num_emails} emails with {concurrency} concurrent requests")
        print(f"API URL: {self.api_url}")
        print(f"From: {self.from_email}")
        print(f"To: {self.to_email}")
        print("=" * 60)
        
        start_time = time.time()
        
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [
                executor.submit(self.send_single_email, i)
                for i in range(1, num_emails + 1)
            ]
            
            # Collect results as they complete
            for future in as_completed(futures):
                result = future.result()
                if result["test_num"] % 10 == 0 or not result["success"]:
                    status = "✓" if result["success"] else "✗"
                    print(f"{status} Test #{result['test_num']}: {result['duration']:.2f}s - "
                          f"{'Success' if result['success'] else result.get('error', 'Failed')}")
        
        end_time = time.time()
        total_duration = end_time - start_time
        
        self.print_results(total_duration, num_emails, concurrency)
        
        return self.results
    
    def print_results(self, total_duration, num_emails, concurrency):
        """Print stress test results"""
        print("\n" + "=" * 60)
        print("STRESS TEST RESULTS")
        print("=" * 60)
        
        successful = [r for r in self.results if r["success"]]
        failed = [r for r in self.results if not r["success"]]
        
        success_rate = (len(successful) / len(self.results)) * 100 if self.results else 0
        
        durations = [r["duration"] for r in successful]
        avg_duration = statistics.mean(durations) if durations else 0
        min_duration = min(durations) if durations else 0
        max_duration = max(durations) if durations else 0
        
        emails_per_second = num_emails / total_duration if total_duration > 0 else 0
        
        print(f"Total emails sent: {num_emails}")
        print(f"Concurrent requests: {concurrency}")
        print(f"Successful: {len(successful)} ({success_rate:.1f}%)")
        print(f"Failed: {len(failed)}")
        print(f"Total duration: {total_duration:.2f}s")
        print(f"Emails per second: {emails_per_second:.2f}")
        print(f"Average response time: {avg_duration:.2f}s")
        print(f"Min response time: {min_duration:.2f}s")
        print(f"Max response time: {max_duration:.2f}s")
        
        if successful:
            compression_ratios = []
            for r in successful:
                if "compression" in r and r["compression"]:
                    ratio_str = r["compression"].get("compressionRatio", "0%").replace("%", "")
                    try:
                        compression_ratios.append(float(ratio_str))
                    except:
                        pass
            
            if compression_ratios:
                avg_compression = statistics.mean(compression_ratios)
                print(f"Average compression ratio: {avg_compression:.2f}%")
        
        if failed:
            print("\nFailed tests:")
            for r in failed[:5]:  # Show first 5 failures
                print(f"  Test #{r['test_num']}: {r.get('error', 'Unknown error')}")
            if len(failed) > 5:
                print(f"  ... and {len(failed) - 5} more failures")
        
        print("\nSystem Assessment:")
        if success_rate >= 95:
            print("✓ System performs excellently under load")
        elif success_rate >= 80:
            print("⚠ System performs well but may need optimization for higher loads")
        else:
            print("✗ System struggled under this load - investigate failures")
        
        if emails_per_second >= 5:
            print("✓ Good throughput for email operations")
        elif emails_per_second >= 2:
            print("⚠ Moderate throughput - acceptable for most use cases")
        else:
            print("✗ Low throughput - may need optimization")

def main():
    """Main stress test function"""
    print("Email Stress Test for mchsrobotics.dev")
    print("=" * 60)
    
    # Configuration
    api_url = "http://100.115.4.34:3000"  # Your dietpi-2 API server
    from_email = "outreach@mchsrobotics.dev"
    to_email = "carterherrault536@gmail.com"
    
    # Test parameters
    num_emails = 20  # Number of test emails
    concurrency = 3  # Concurrent requests
    
    print(f"Test configuration:")
    print(f"  Number of emails: {num_emails}")
    print(f"  Concurrency: {concurrency}")
    print(f"  API server: {api_url}")
    print("")
    
    input("Press Enter to start stress test...")
    
    # Run stress test
    tester = EmailStressTest(api_url, from_email, to_email)
    results = tester.run_stress_test(num_emails, concurrency)
    
    # Save results
    with open('stress_test_results.json', 'w') as f:
        json.dump({
            "timestamp": time.strftime('%Y-%m-%d %H:%M:%S'),
            "config": {
                "num_emails": num_emails,
                "concurrency": concurrency,
                "api_url": api_url,
                "from_email": from_email,
                "to_email": to_email
            },
            "results": results
        }, f, indent=2)
    
    print(f"\nResults saved to stress_test_results.json")

if __name__ == "__main__":
    main()