import type { SmtpClient } from '../smtp-client.js';
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';
import { replySubject, forwardSubject, buildReplyRecipients } from '../utils/mail-helpers.js';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerSendTools(server: McpServer, imap: ImapClientManager, smtp: SmtpClient): void {
  server.registerTool('send_email', {
    title: 'Send Email',
    description: 'Send a NEW standalone email. WARNING: Do NOT use this for replying to existing threads — use reply_message instead, which handles threading headers automatically. Use dryRun: true to preview before sending.',
    inputSchema: z.object({
      to: z.array(z.email()).min(1).describe('Recipient email addresses'),
      cc: z.array(z.email()).optional().describe('CC recipients'),
      bcc: z.array(z.email()).optional().describe('BCC recipients'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Email body (text or HTML)'),
      isHtml: z.boolean().default(false).describe('Whether body is HTML'),
      inReplyTo: z.string().regex(/^<[^>]+>$/, 'Must be a valid Message-ID (e.g. <id@domain>)').optional().describe('Message-ID to reply to (for threading)'),
      dryRun: z.boolean().default(false).describe('If true, returns a preview of the email without sending. Always preview before sending.'),
      attachments: z.array(z.object({
        filename: z.string().describe('Attachment filename'),
        contentBase64: z.string().describe('Base64-encoded file content'),
        mimeType: z.string().optional().describe('MIME type (defaults to application/octet-stream)'),
      })).optional().describe('File attachments'),
    }),
  }, async (params) => sendEmailHandler(smtp, params));

  server.registerTool('reply_message', {
    title: 'Reply to Message',
    description: 'Reply to an email with proper threading. Reads the original message, sets In-Reply-To and References headers, handles recipients (reply or reply-all), quotes the original body, and sends. Use this instead of send_email when replying to an existing email. Use dryRun: true to preview before sending.',
    inputSchema: z.object({
      folder: z.string().describe('Folder containing the message to reply to'),
      uid: z.number().describe('UID of the message to reply to'),
      body: z.string().describe('Reply body text'),
      isHtml: z.boolean().default(false).describe('Whether body is HTML'),
      replyAll: z.boolean().default(false).describe('If true, reply to all recipients (To + CC). If false, reply only to the sender.'),
      dryRun: z.boolean().default(false).describe('If true, returns a preview of the reply without sending. Always preview before sending.'),
    }),
  }, async (params) => replyMessageHandler(imap, smtp, params));

  server.registerTool('forward_message', {
    title: 'Forward Message',
    description: 'Forward an email to new recipients. Reads the original message, builds a forwarded email with quoted headers and original body, and includes any attachments.',
    inputSchema: z.object({
      folder: z.string().describe('Folder containing the message to forward'),
      uid: z.number().describe('UID of the message to forward'),
      to: z.array(z.email()).min(1).describe('Recipient email addresses'),
      cc: z.array(z.email()).optional().describe('CC recipients'),
      body: z.string().optional().describe('Optional note to prepend above the forwarded message'),
    }),
  }, async (params) => forwardMessageHandler(imap, smtp, params));
}

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
    dryRun?: boolean;
    attachments?: Array<{ filename: string; contentBase64: string; mimeType?: string }>;
  }
): Promise<ToolResult> {
  const preview = {
    type: 'standalone' as const,
    to: params.to,
    cc: params.cc,
    subject: params.subject,
    body: params.body.slice(0, 500) + (params.body.length > 500 ? '...' : ''),
    isHtml: params.isHtml || false,
    inReplyTo: params.inReplyTo || null,
    attachmentCount: params.attachments?.length || 0,
    warning: params.inReplyTo
      ? null
      : 'This is a STANDALONE email, NOT a threaded reply. If you intend to reply to an existing email, use reply_message instead.',
  };

  if (params.dryRun) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ dryRun: true, preview }, null, 2) }],
    };
  }

  const result = await smtp.sendEmail({
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    isHtml: params.isHtml || false,
    inReplyTo: params.inReplyTo,
    attachments: params.attachments,
  });
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, messageId: result.messageId, preview }) }],
  };
}

export async function replyMessageHandler(
  imap: ImapClientManager,
  smtp: SmtpClient,
  params: {
    folder: string;
    uid: number;
    body: string;
    isHtml?: boolean;
    replyAll?: boolean;
    dryRun?: boolean;
  }
): Promise<ToolResult> {
  // 1. Read original message
  const original = await imap.readMessage(params.folder, params.uid);

  // 2. Build subject
  const subject = replySubject(original.subject);

  // 3. Build threading headers
  const inReplyTo = original.messageId;
  const references = original.references
    ? `${original.references} ${original.messageId}`
    : original.messageId;

  // 4. Determine recipients
  const { to, cc } = buildReplyRecipients(
    original.from, original.to, original.cc, smtp.getUsername(), params.replyAll || false,
  );

  // 5. Build quoted body
  const originalDate = original.date ? new Date(original.date).toLocaleString() : '';
  const quotedHeader = `\n\nOn ${originalDate}, ${original.from} wrote:\n`;
  const originalBody = original.textBody || '';
  const quotedBody = originalBody.split('\n').map(line => `> ${line}`).join('\n');
  const fullBody = `${params.body}${quotedHeader}\n${quotedBody}`;

  const preview = {
    type: 'threaded_reply' as const,
    replyAll: params.replyAll || false,
    to,
    cc: cc || null,
    subject,
    inReplyTo,
    replyingTo: { from: original.from, date: original.date, subject: original.subject },
    body: params.body,
  };

  // 6. Dry run — return preview without sending
  if (params.dryRun) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ dryRun: true, preview }, null, 2) }],
    };
  }

  // 7. Send
  const result = await smtp.sendEmail({
    to,
    cc,
    subject,
    body: fullBody,
    isHtml: params.isHtml || false,
    inReplyTo,
    references,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, messageId: result.messageId, preview }) }],
  };
}

export async function forwardMessageHandler(
  imap: ImapClientManager,
  smtp: SmtpClient,
  params: {
    folder: string;
    uid: number;
    to: string[];
    cc?: string[];
    body?: string;
  }
): Promise<ToolResult> {
  // 1. Read original message
  const original = await imap.readMessage(params.folder, params.uid);

  // 2. Build forwarded subject
  const forwardedSubject = forwardSubject(original.subject);

  // 3. Build forwarded body with original headers
  const quotedHeaders = [
    `---------- Forwarded message ----------`,
    `From: ${original.from}`,
    `Date: ${original.date}`,
    `Subject: ${original.subject}`,
    `To: ${original.to.join(', ')}`,
    ...(original.cc.length > 0 ? [`Cc: ${original.cc.join(', ')}`] : []),
    ``,
  ].join('\n');

  const userNote = params.body ? `${params.body}\n\n` : '';
  // HTML-only originals must be forwarded as HTML, not raw markup in a text body
  const isHtml = !original.textBody && !!original.htmlBody;
  const forwardedBody = isHtml
    ? `${userNote}${quotedHeaders}\n`.replace(/\n/g, '<br>\n') + original.htmlBody
    : `${userNote}${quotedHeaders}\n${original.textBody}`;

  // 4. Fetch attachments if present (single fetch/parse for all of them)
  const fetched = original.attachments.length > 0
    ? await imap.getAttachments(params.folder, params.uid)
    : [];
  const attachments = fetched.map((att) => ({
    filename: att.filename,
    contentBase64: att.content.toString('base64'),
    mimeType: att.mimeType,
  }));

  // 5. Send via SMTP
  const result = await smtp.sendEmail({
    to: params.to,
    cc: params.cc,
    subject: forwardedSubject,
    body: forwardedBody,
    isHtml,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, messageId: result.messageId, forwardedSubject }) }],
  };
}
