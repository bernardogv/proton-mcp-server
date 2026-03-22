import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function markReadHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  await imap.addFlags(params.folder, params.uid, ['\\Seen']);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'marked_read', uid: params.uid }) }],
  };
}

export async function markUnreadHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  await imap.removeFlags(params.folder, params.uid, ['\\Seen']);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'marked_unread', uid: params.uid }) }],
  };
}

export async function starMessageHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  await imap.addFlags(params.folder, params.uid, ['\\Flagged']);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'starred', uid: params.uid }) }],
  };
}

export async function unstarMessageHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  await imap.removeFlags(params.folder, params.uid, ['\\Flagged']);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'unstarred', uid: params.uid }) }],
  };
}
