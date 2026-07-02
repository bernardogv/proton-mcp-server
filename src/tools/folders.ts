import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export function registerFolderTools(server: McpServer, imap: ImapClientManager): void {
  server.registerTool('list_folders', {
    title: 'List Folders',
    description: 'List all folders and labels in the mailbox',
    inputSchema: z.object({}),
  }, async () => listFoldersHandler(imap));

  server.registerTool('create_folder', {
    title: 'Create Folder',
    description: 'Create a new folder/label',
    inputSchema: z.object({
      name: z.string().describe('Folder name (use / for subfolders, e.g. "Projects/Work")'),
    }),
  }, async ({ name }) => createFolderHandler(imap, { name }));

  server.registerTool('delete_folder', {
    title: 'Delete Folder',
    description: 'Delete a folder/label from the mailbox. Use dryRun: true to preview what would be deleted.',
    inputSchema: z.object({
      path: z.string().describe('Full path of the folder to delete (e.g. "Folders/OldFolder")'),
      dryRun: z.boolean().default(false).describe('If true, returns folder stats without deleting. Use to preview before committing.'),
    }),
  }, async ({ path, dryRun }) => deleteFolderHandler(imap, { path, dryRun }));

  server.registerTool('rename_folder', {
    title: 'Rename Folder',
    description: 'Rename or move a folder',
    inputSchema: z.object({
      oldPath: z.string().describe('Current full path of the folder'),
      newPath: z.string().describe('New full path for the folder'),
    }),
  }, async ({ oldPath, newPath }) => renameFolderHandler(imap, { oldPath, newPath }));

  server.registerTool('get_folder_stats', {
    title: 'Folder Stats',
    description: 'Get message counts (total and unread) for all folders. Quick inbox health dashboard.',
    inputSchema: z.object({}),
  }, async () => getFolderStatsHandler(imap));
}

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
