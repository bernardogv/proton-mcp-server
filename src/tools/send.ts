import type { SmtpClient } from '../smtp-client.js';
import type { ImapClientManager } from '../imap-client.js';
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
  const subject = original.subject.match(/^Re:/i)
    ? original.subject
    : `Re: ${original.subject}`;

  // 3. Build threading headers
  const inReplyTo = original.messageId;
  const references = original.references
    ? `${original.references} ${original.messageId}`
    : original.messageId;

  // 4. Determine recipients
  // Extract email addresses from "Name <email>" format
  const extractEmail = (addr: string): string => {
    const match = addr.match(/<([^>]+)>/);
    return match ? match[1] : addr.trim();
  };
  const originalFrom = extractEmail(original.from);
  const to = [originalFrom];
  let cc: string[] | undefined;

  if (params.replyAll) {
    const selfAddress = smtp.getUsername().toLowerCase();
    const allTo = original.to.map(extractEmail).filter(a => a.toLowerCase() !== selfAddress);
    const allCc = original.cc.map(extractEmail).filter(a => a.toLowerCase() !== selfAddress && a.toLowerCase() !== originalFrom.toLowerCase());
    const additionalRecipients = [...allTo, ...allCc].filter(a => a.toLowerCase() !== originalFrom.toLowerCase());
    if (additionalRecipients.length > 0) {
      cc = additionalRecipients;
    }
  }

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
  const forwardedSubject = original.subject.startsWith('Fwd:')
    ? original.subject
    : `Fwd: ${original.subject}`;

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

  const originalBody = original.textBody || original.htmlBody || '';
  const userNote = params.body ? `${params.body}\n\n` : '';
  const forwardedBody = `${userNote}${quotedHeaders}\n${originalBody}`;

  // 4. Fetch attachments if present
  const attachments: Array<{ filename: string; contentBase64: string; mimeType?: string }> = [];
  if (original.attachments && original.attachments.length > 0) {
    for (const att of original.attachments) {
      const fetched = await imap.getAttachment(params.folder, params.uid, att.partId);
      attachments.push({
        filename: fetched.filename,
        contentBase64: fetched.content.toString('base64'),
        mimeType: fetched.mimeType,
      });
    }
  }

  // 5. Send via SMTP
  const result = await smtp.sendEmail({
    to: params.to,
    cc: params.cc,
    subject: forwardedSubject,
    body: forwardedBody,
    isHtml: false,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, messageId: result.messageId, forwardedSubject }) }],
  };
}
