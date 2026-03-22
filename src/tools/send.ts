import type { SmtpClient } from '../smtp-client.js';
import type { ToolResult } from '../utils/types.js';

export async function sendEmailHandler(
  smtp: SmtpClient,
  params: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    isHtml?: boolean;
    inReplyTo?: string;
  }
): Promise<ToolResult> {
  const result = await smtp.sendEmail({
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    isHtml: params.isHtml || false,
    inReplyTo: params.inReplyTo,
  });
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, messageId: result.messageId }) }],
  };
}
