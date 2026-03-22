import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function moveMessageHandler(
  imap: ImapClientManager,
  params: { sourceFolder: string; uid: number; destinationFolder: string }
): Promise<ToolResult> {
  await imap.moveMessage(params.sourceFolder, params.uid, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'moved', uid: params.uid, to: params.destinationFolder }) }],
  };
}

export async function applyLabelHandler(
  imap: ImapClientManager,
  params: { sourceFolder: string; uid: number; labelFolder: string }
): Promise<ToolResult> {
  await imap.copyMessage(params.sourceFolder, params.uid, params.labelFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'labeled', uid: params.uid, label: params.labelFolder }) }],
  };
}

export async function removeLabelHandler(
  imap: ImapClientManager,
  params: { labelFolder: string; uid: number }
): Promise<ToolResult> {
  await imap.moveMessage(params.labelFolder, params.uid, 'INBOX');
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'label_removed', uid: params.uid, removedFrom: params.labelFolder }) }],
  };
}

export async function deleteMessageHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  await imap.moveMessage(params.folder, params.uid, 'Trash');
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'deleted', uid: params.uid }) }],
  };
}
