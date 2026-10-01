// Cloudflare Worker for Email Processing
// Handles incoming emails from Cloudflare Email Routing and forwards to dietpi-2

export default {
  async email(message, env, ctx) {
    try {
      const sender = message.from;
      const recipient = message.to;
      const subject = message.headers.get("subject") || "";
      
      console.log(`Processing email from ${sender} to ${recipient}`);
      console.log(`Subject: ${subject}`);
      
      // Get raw email content
      const rawEmail = await message.raw();
      const emailSize = rawEmail.length;
      
      // Prepare webhook payload
      const webhookUrl = env.WEBHOOK_URL || "http://100.115.4.34:3000/webhook/email";
      const webhookSecret = env.WEBHOOK_SECRET || "your-secret-key";
      
      const payload = {
        raw: Array.from(rawEmail), // Convert Uint8Array to array for JSON
        from: sender,
        to: recipient,
        subject: subject,
        headers: {},
        timestamp: new Date().toISOString()
      };
      
      // Copy important headers
      const importantHeaders = ['Message-ID', 'Date', 'Content-Type', 'From', 'To', 'Subject'];
      for (const header of importantHeaders) {
        const value = message.headers.get(header);
        if (value) {
          payload.headers[header] = value;
        }
      }
      
      console.log(`Email size: ${emailSize} bytes`);
      console.log(`Sending to webhook: ${webhookUrl}`);
      
      // Send to dietpi-2 webhook
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookSecret,
          'X-Email-Size': emailSize.toString()
        },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Email forwarded successfully:', result);
        
        // Also forward to Gmail as backup
        await message.forward("carterherrault536@gmail.com");
        
        return new Response('Email processed successfully', { status: 200 });
      } else {
        console.error('Webhook failed:', response.status, response.statusText);
        
        // Still forward to Gmail as backup
        await message.forward("carterherrault536@gmail.com");
        
        return new Response('Webhook failed but email forwarded', { status: 207 });
      }
      
    } catch (error) {
      console.error('Error processing email:', error);
      
      // Always try to forward to Gmail as backup
      try {
        await message.forward("carterherrault536@gmail.com");
      } catch (forwardError) {
        console.error('Gmail forward also failed:', forwardError);
      }
      
      return new Response('Error processing email', { status: 500 });
    }
  }
}