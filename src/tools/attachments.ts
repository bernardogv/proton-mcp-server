import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export function registerAttachmentTools(server: McpServer, imap: ImapClientManager): void {
  server.registerTool('get_attachment', {
    title: 'Get Attachment',
    description: 'Download a specific attachment from a message',
    inputSchema: z.object({
      folder: z.string().describe('Folder containing the message'),
      uid: z.number().describe('Message UID'),
      attachmentPartId: z.string().describe('Attachment part ID from read_message response'),
    }),
  }, async ({ folder, uid, attachmentPartId }) => getAttachmentHandler(imap, { folder, uid, attachmentPartId }));

  server.registerTool('get_attachment_text', {
    title: 'Get Attachment Text',
    description: 'Extract plain text from an attachment. Supports application/pdf (via pdf-parse) and text/* MIME types. Returns truncated text up to maxChars.',
    inputSchema: z.object({
      folder: z.string().describe('Folder containing the message'),
      uid: z.number().describe('Message UID'),
      attachmentPartId: z.string().describe('Attachment part ID from the message'),
      maxChars: z.number().min(100).max(200000).default(20000).describe('Max characters to return (default 20000)'),
    }),
  }, async ({ folder, uid, attachmentPartId, maxChars }) => getAttachmentTextHandler(imap, { folder, uid, attachmentPartId, maxChars }));
}

export async function getAttachmentHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number; attachmentPartId: string }
): Promise<ToolResult> {
  const attachment = await imap.getAttachment(params.folder, params.uid, params.attachmentPartId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        contentBase64: attachment.content.toString('base64'),
      }),
    }],
  };
}

export async function getAttachmentTextHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number; attachmentPartId: string; maxChars?: number }
): Promise<ToolResult> {
  const maxChars = params.maxChars ?? 20000;
  const attachment = await imap.getAttachment(params.folder, params.uid, params.attachmentPartId);

  let text = '';
  let numPages: number | undefined;

  if (attachment.mimeType === 'application/pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: attachment.content });
    const result = await parser.getText();
    text = result.text;
    numPages = result.total;
    await parser.destroy();
  } else if (attachment.mimeType.startsWith('text/')) {
    text = attachment.content.toString('utf-8');
  } else {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        error: `Unsupported MIME type for text extraction: ${attachment.mimeType}`,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
      }) }],
    };
  }

  const originalLength = text.length;
  const truncated = originalLength > maxChars;
  if (truncated) text = text.slice(0, maxChars);

  return {
    content: [{ type: 'text', text: JSON.stringify({
      text,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      ...(numPages !== undefined && { numPages }),
      truncated,
      originalLength,
    }) }],
  };
}
