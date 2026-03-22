import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function listFoldersHandler(imap: ImapClientManager): Promise<ToolResult> {
  const folders = await imap.listFolders();
  return {
    content: [{ type: 'text', text: JSON.stringify(folders, null, 2) }],
  };
}

export async function createFolderHandler(
  imap: ImapClientManager,
  params: { name: string }
): Promise<ToolResult> {
  const path = await imap.createFolder(params.name);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, path }) }],
  };
}
