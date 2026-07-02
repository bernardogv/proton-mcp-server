import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';
import { batchAddFlags, batchRemoveFlags, markAllRead } from '../imap-batch.js';

const singleMessage = (folderDesc: string) => z.object({
  folder: z.string().describe(folderDesc),
  uid: z.number().describe('Message UID'),
});

const batchMessages = (uidsDesc: string) => z.object({
  folder: z.string().describe('Folder containing the messages'),
  uids: z.array(z.number()).min(1).max(500).describe(uidsDesc),
});

export function registerFlagTools(server: McpServer, imap: ImapClientManager): void {
  server.registerTool('mark_read', {
    title: 'Mark Read',
    description: 'Mark a message as read',
    inputSchema: singleMessage('Folder containing the message'),
  }, async ({ folder, uid }) => markReadHandler(imap, { folder, uid }));

  server.registerTool('mark_unread', {
    title: 'Mark Unread',
    description: 'Mark a message as unread',
    inputSchema: singleMessage('Folder containing the message'),
  }, async ({ folder, uid }) => markUnreadHandler(imap, { folder, uid }));

  server.registerTool('star_message', {
    title: 'Star Message',
    description: 'Star/flag a message',
    inputSchema: singleMessage('Folder containing the message'),
  }, async ({ folder, uid }) => starMessageHandler(imap, { folder, uid }));

  server.registerTool('unstar_message', {
    title: 'Unstar Message',
    description: 'Remove star/flag from a message',
    inputSchema: singleMessage('Folder containing the message'),
  }, async ({ folder, uid }) => unstarMessageHandler(imap, { folder, uid }));

  server.registerTool('batch_mark_read', {
    title: 'Batch Mark Read',
    description: 'Mark multiple messages as read in a single operation',
    inputSchema: batchMessages('Array of message UIDs to mark as read (max 500)'),
  }, async ({ folder, uids }) => batchMarkReadHandler(imap, { folder, uids }));

  server.registerTool('batch_mark_unread', {
    title: 'Batch Mark Unread',
    description: 'Mark multiple messages as unread in a single operation',
    inputSchema: batchMessages('Array of message UIDs to mark as unread (max 500)'),
  }, async ({ folder, uids }) => batchMarkUnreadHandler(imap, { folder, uids }));

  server.registerTool('batch_star', {
    title: 'Batch Star',
    description: 'Star/flag multiple messages in a single operation',
    inputSchema: batchMessages('Array of message UIDs to star (max 500)'),
  }, async ({ folder, uids }) => batchStarHandler(imap, { folder, uids }));

  server.registerTool('batch_unstar', {
    title: 'Batch Unstar',
    description: 'Remove star/flag from multiple messages in a single operation',
    inputSchema: batchMessages('Array of message UIDs to unstar (max 500)'),
  }, async ({ folder, uids }) => batchUnstarHandler(imap, { folder, uids }));

  server.registerTool('mark_all_read', {
    title: 'Mark All Read',
    description: 'Mark all unread messages in a folder as read. No need to fetch UIDs first.',
    inputSchema: z.object({
      folder: z.string().describe('Folder to mark all messages as read'),
    }),
  }, async ({ folder }) => markAllReadHandler(imap, { folder }));
}

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

export async function batchMarkReadHandler(
  imap: ImapClientManager,
  params: { folder: string; uids: number[] }
): Promise<ToolResult> {
  const result = await batchAddFlags(imap, params.folder, params.uids, ['\\Seen']);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'batch_marked_read', ...result }) }],
  };
}

export async function batchMarkUnreadHandler(
  imap: ImapClientManager,
  params: { folder: string; uids: number[] }
): Promise<ToolResult> {
  const result = await batchRemoveFlags(imap, params.folder, params.uids, ['\\Seen']);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'batch_marked_unread', ...result }) }],
  };
}

export async function batchStarHandler(
  imap: ImapClientManager,
  params: { folder: string; uids: number[] }
): Promise<ToolResult> {
  const result = await batchAddFlags(imap, params.folder, params.uids, ['\\Flagged']);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'batch_starred', ...result }) }],
  };
}

export async function batchUnstarHandler(
  imap: ImapClientManager,
  params: { folder: string; uids: number[] }
): Promise<ToolResult> {
  const result = await batchRemoveFlags(imap, params.folder, params.uids, ['\\Flagged']);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'batch_unstarred', ...result }) }],
  };
}

export async function markAllReadHandler(
  imap: ImapClientManager,
  params: { folder: string }
): Promise<ToolResult> {
  const result = await markAllRead(imap, params.folder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'mark_all_read', folder: params.folder, ...result }) }],
  };
}
