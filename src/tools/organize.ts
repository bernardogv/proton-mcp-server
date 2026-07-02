import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';
import { buildSearchCriteria } from '../utils/mail-helpers.js';
import { batchMoveMessages, batchCopyMessages, crossFolderBatchMove, moveBySender, moveBySearch, batchMoveBySenders } from '../imap-batch.js';

export function registerOrganizeTools(server: McpServer, imap: ImapClientManager): void {
  server.registerTool('move_message', {
    title: 'Move Message',
    description: 'Move a message to a different folder. For combined move+label, prefer route/batch_route.',
    inputSchema: z.object({
      sourceFolder: z.string().describe('Current folder of the message'),
      uid: z.number().describe('Message UID'),
      destinationFolder: z.string().describe('Target folder'),
    }),
  }, async ({ sourceFolder, uid, destinationFolder }) => moveMessageHandler(imap, { sourceFolder, uid, destinationFolder }));

  server.registerTool('apply_label', {
    title: 'Apply Label',
    description: 'Apply a label to a message (copies to label folder, keeps original). For combined move+label, prefer route/batch_route.',
    inputSchema: z.object({
      sourceFolder: z.string().describe('Current folder of the message'),
      uid: z.number().describe('Message UID'),
      labelFolder: z.string().describe('Label folder to apply'),
    }),
  }, async ({ sourceFolder, uid, labelFolder }) => applyLabelHandler(imap, { sourceFolder, uid, labelFolder }));

  server.registerTool('remove_label', {
    title: 'Remove Label',
    description: 'Remove a label from a message',
    inputSchema: z.object({
      labelFolder: z.string().describe('Label folder to remove the message from'),
      uid: z.number().describe('Message UID within the label folder'),
    }),
  }, async ({ labelFolder, uid }) => removeLabelHandler(imap, { labelFolder, uid }));

  server.registerTool('delete_message', {
    title: 'Delete Message',
    description: 'Move a message to Trash',
    inputSchema: z.object({
      folder: z.string().describe('Current folder of the message'),
      uid: z.number().describe('Message UID'),
    }),
  }, async ({ folder, uid }) => deleteMessageHandler(imap, { folder, uid }));

  server.registerTool('batch_move_messages', {
    title: 'Batch Move Messages',
    description: 'Move multiple messages to a folder in a single operation. Pre-validates folders exist and post-verifies the move count. Returns {success, requested, moved, failedUids?}. Use dryRun:true to preview. For combined move+label, prefer route/batch_route.',
    inputSchema: z.object({
      sourceFolder: z.string().describe('Current folder of the messages'),
      uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs to move (max 500)'),
      destinationFolder: z.string().describe('Target folder'),
      dryRun: z.boolean().default(false).describe('If true, preview without mutating. Returns the UIDs that would be moved.'),
    }),
  }, async ({ sourceFolder, uids, destinationFolder, dryRun }) => batchMoveHandler(imap, { sourceFolder, uids, destinationFolder, dryRun }));

  server.registerTool('batch_apply_label', {
    title: 'Batch Apply Label',
    description: 'Apply a label to multiple messages. Pre-validates folders, post-verifies copy count. Returns {success, requested, copied}. Use dryRun:true to preview. For combined move+label, prefer route/batch_route.',
    inputSchema: z.object({
      sourceFolder: z.string().describe('Current folder of the messages'),
      uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs to label (max 500)'),
      labelFolder: z.string().describe('Label folder to apply'),
      dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
    }),
  }, async ({ sourceFolder, uids, labelFolder, dryRun }) => batchApplyLabelHandler(imap, { sourceFolder, uids, labelFolder, dryRun }));

  server.registerTool('batch_remove_label', {
    title: 'Batch Remove Label',
    description: 'Remove a label from multiple messages. Moves them back to INBOX. Returns {success, requested, moved}. Use dryRun:true to preview. For combined move+label, prefer route/batch_route.',
    inputSchema: z.object({
      labelFolder: z.string().describe('Label folder to remove messages from'),
      uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs within the label folder (max 500)'),
      dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
    }),
  }, async ({ labelFolder, uids, dryRun }) => batchRemoveLabelHandler(imap, { labelFolder, uids, dryRun }));

  server.registerTool('batch_delete_messages', {
    title: 'Batch Delete Messages',
    description: 'Move multiple messages to Trash. Pre-validates Trash exists, post-verifies count. Use dryRun:true to preview.',
    inputSchema: z.object({
      folder: z.string().describe('Current folder of the messages'),
      uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs to delete (max 500)'),
      dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
    }),
  }, async ({ folder, uids, dryRun }) => batchDeleteHandler(imap, { folder, uids, dryRun }));

  server.registerTool('cross_folder_batch_move', {
    title: 'Cross-Folder Batch Move',
    description: 'Move messages from multiple source folders to one destination. Each item specifies its own sourceFolder. Use dryRun:true to preview.',
    inputSchema: z.object({
      items: z.array(z.object({
        uid: z.number().describe('Message UID'),
        sourceFolder: z.string().describe('Folder this message is currently in'),
      })).min(1).max(500).describe('Array of messages with their source folders (max 500)'),
      destinationFolder: z.string().describe('Target folder for all messages'),
      dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
    }),
  }, async ({ items, destinationFolder, dryRun }) => crossFolderBatchMoveHandler(imap, { items, destinationFolder, dryRun }));

  server.registerTool('move_by_sender', {
    title: 'Move by Sender',
    description: 'Move all messages from a specific sender to a destination folder. Use dryRun:true to preview the UIDs that would be moved.',
    inputSchema: z.object({
      sourceFolder: z.string().describe('Folder to search in'),
      senderAddress: z.string().describe('Sender email address to match'),
      destinationFolder: z.string().describe('Target folder'),
      dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
    }),
  }, async ({ sourceFolder, senderAddress, destinationFolder, dryRun }) => moveBySenderHandler(imap, { sourceFolder, senderAddress, destinationFolder, dryRun }));

  server.registerTool('batch_move_by_senders', {
    title: 'Batch Move by Senders',
    description: 'Move messages from MANY senders in one operation over a single connection. Each route maps a sender address (matched exactly against the envelope) to a destination folder. The bulk-sort workhorse: pair with suggest_sender_routes. Use dryRun:true to preview matched UIDs per sender.',
    inputSchema: z.object({
      sourceFolder: z.string().default('INBOX').describe('Folder to move messages out of'),
      routes: z.array(z.object({
        senderAddress: z.string().describe('Sender email address (exact match)'),
        destinationFolder: z.string().describe('Target folder for this sender'),
      })).min(1).max(100).describe('Sender → folder routes (max 100)'),
      dryRun: z.boolean().default(false).describe('If true, preview matched counts/UIDs per sender without moving.'),
    }),
  }, async ({ sourceFolder, routes, dryRun }) => batchMoveBySendersHandler(imap, { sourceFolder, routes, dryRun }));

  server.registerTool('move_by_search', {
    title: 'Move by Search',
    description: 'Search for messages matching criteria and move all matches to a destination folder. Requires at least one search criterion. Use dryRun:true to preview the UIDs that would be moved.',
    inputSchema: z.object({
      sourceFolder: z.string().describe('Folder to search in'),
      destinationFolder: z.string().describe('Target folder for matched messages'),
      from: z.string().optional().describe('Filter by sender'),
      to: z.string().optional().describe('Filter by recipient'),
      subject: z.string().optional().describe('Filter by subject'),
      keyword: z.string().optional().describe('Search body text'),
      since: z.string().optional().describe('Messages since date (ISO 8601)'),
      before: z.string().optional().describe('Messages before date (ISO 8601)'),
      unreadOnly: z.boolean().default(false).describe('Only match unread messages'),
      dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
    }),
  }, async (params) => moveBySearchHandler(imap, params));
}

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

export async function batchMoveHandler(
  imap: ImapClientManager,
  params: { sourceFolder: string; uids: number[]; destinationFolder: string; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    await imap.assertFoldersExist([params.sourceFolder, params.destinationFolder]);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: params.uids.length,
        uids: params.uids,
        sourceFolder: params.sourceFolder,
        destination: params.destinationFolder,
      }) }],
    };
  }
  const result = await batchMoveMessages(imap, params.sourceFolder, params.uids, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'batch_moved', ...result }) }],
  };
}

export async function batchApplyLabelHandler(
  imap: ImapClientManager,
  params: { sourceFolder: string; uids: number[]; labelFolder: string; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    await imap.assertFoldersExist([params.sourceFolder, params.labelFolder]);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: params.uids.length,
        uids: params.uids,
        sourceFolder: params.sourceFolder,
        label: params.labelFolder,
      }) }],
    };
  }
  const result = await batchCopyMessages(imap, params.sourceFolder, params.uids, params.labelFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'batch_labeled', ...result }) }],
  };
}

export async function batchDeleteHandler(
  imap: ImapClientManager,
  params: { folder: string; uids: number[]; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    await imap.assertFoldersExist([params.folder, 'Trash']);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: params.uids.length,
        uids: params.uids,
        sourceFolder: params.folder,
        destination: 'Trash',
      }) }],
    };
  }
  const result = await batchMoveMessages(imap, params.folder, params.uids, 'Trash');
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'batch_deleted', ...result }) }],
  };
}

export async function crossFolderBatchMoveHandler(
  imap: ImapClientManager,
  params: { items: Array<{ uid: number; sourceFolder: string }>; destinationFolder: string; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    const sources = Array.from(new Set(params.items.map((i) => i.sourceFolder)));
    await imap.assertFoldersExist([...sources, params.destinationFolder]);
    const grouped: Record<string, number[]> = {};
    for (const item of params.items) {
      (grouped[item.sourceFolder] ||= []).push(item.uid);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: params.items.length,
        byFolder: grouped,
        destination: params.destinationFolder,
      }) }],
    };
  }
  const result = await crossFolderBatchMove(imap, params.items, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'cross_folder_batch_moved', success: true, ...result, to: params.destinationFolder }) }],
  };
}

export async function moveBySenderHandler(
  imap: ImapClientManager,
  params: { sourceFolder: string; senderAddress: string; destinationFolder: string; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    const { results } = await batchMoveBySenders(
      imap,
      params.sourceFolder,
      [{ senderAddress: params.senderAddress, destinationFolder: params.destinationFolder }],
      true,
    );
    const r = results[0];
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: r.matched,
        uids: r.uids,
        sourceFolder: params.sourceFolder,
        destination: params.destinationFolder,
        sender: params.senderAddress,
      }) }],
    };
  }
  const result = await moveBySender(imap, params.sourceFolder, params.senderAddress, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'moved_by_sender', sender: params.senderAddress, ...result }) }],
  };
}

export async function batchMoveBySendersHandler(
  imap: ImapClientManager,
  params: { sourceFolder: string; routes: Array<{ senderAddress: string; destinationFolder: string }>; dryRun?: boolean }
): Promise<ToolResult> {
  const result = await batchMoveBySenders(imap, params.sourceFolder, params.routes, params.dryRun ?? false);
  return {
    content: [{ type: 'text', text: JSON.stringify({
      action: params.dryRun ? 'batch_move_by_senders_dry_run' : 'batch_moved_by_senders',
      sourceFolder: params.sourceFolder,
      ...(params.dryRun ? {} : { success: result.results.every((r) => r.success), totalMoved: result.totalMoved }),
      results: result.results,
    }) }],
  };
}

export async function batchRemoveLabelHandler(
  imap: ImapClientManager,
  params: { labelFolder: string; uids: number[]; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    await imap.assertFoldersExist([params.labelFolder, 'INBOX']);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: params.uids.length,
        uids: params.uids,
        sourceFolder: params.labelFolder,
        destination: 'INBOX',
      }) }],
    };
  }
  const result = await batchMoveMessages(imap, params.labelFolder, params.uids, 'INBOX');
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'batch_label_removed', ...result, removedFrom: params.labelFolder }) }],
  };
}

export async function moveBySearchHandler(
  imap: ImapClientManager,
  params: {
    sourceFolder: string;
    destinationFolder: string;
    from?: string;
    to?: string;
    subject?: string;
    keyword?: string;
    since?: string;
    before?: string;
    unreadOnly?: boolean;
    dryRun?: boolean;
  }
): Promise<ToolResult> {
  const criteria = buildSearchCriteria(params);
  if (Object.keys(criteria).length === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'At least one search criterion is required to prevent accidental moves' }) }],
    };
  }

  if (params.dryRun) {
    await imap.assertFoldersExist([params.sourceFolder, params.destinationFolder]);
    const uids = await imap.searchMessages(params.sourceFolder, criteria);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: uids.length,
        uids,
        sourceFolder: params.sourceFolder,
        destination: params.destinationFolder,
        criteria,
      }) }],
    };
  }

  const result = await moveBySearch(imap, params.sourceFolder, criteria, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'moved_by_search', ...result }) }],
  };
}
