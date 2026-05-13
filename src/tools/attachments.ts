import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

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
