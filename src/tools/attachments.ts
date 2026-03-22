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
