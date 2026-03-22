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

export async function deleteFolderHandler(
  imap: ImapClientManager,
  params: { path: string; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    const stats = await imap.getFolderMessageCount(params.path);
    return {
      content: [{ type: 'text', text: JSON.stringify({ dryRun: true, path: params.path, wouldDelete: stats, warning: `This folder contains ${stats.total} messages (${stats.unseen} unread). Set dryRun to false to proceed.` }) }],
    };
  }
  await imap.deleteFolder(params.path);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'deleted', path: params.path }) }],
  };
}

export async function renameFolderHandler(
  imap: ImapClientManager,
  params: { oldPath: string; newPath: string }
): Promise<ToolResult> {
  const newPath = await imap.renameFolder(params.oldPath, params.newPath);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'renamed', oldPath: params.oldPath, newPath }) }],
  };
}

export async function getFolderStatsHandler(imap: ImapClientManager): Promise<ToolResult> {
  const stats = await imap.getFolderStats();
  return {
    content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
  };
}
