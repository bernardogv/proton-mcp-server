import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function createDraftHandler(
  imap: ImapClientManager,
  params: {
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    isHtml?: boolean;
    draftsFolder?: string;
  }
): Promise<ToolResult> {
  const result = await imap.createDraft(params);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, uid: result.uid }) }],
  };
}
