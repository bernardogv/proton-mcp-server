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
  const result = await imap.batchMoveMessages(params.sourceFolder, params.uids, params.destinationFolder);
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
  const result = await imap.batchCopyMessages(params.sourceFolder, params.uids, params.labelFolder);
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
  const result = await imap.batchMoveMessages(params.folder, params.uids, 'Trash');
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
  const result = await imap.crossFolderBatchMove(params.items, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'cross_folder_batch_moved', success: true, ...result, to: params.destinationFolder }) }],
  };
}

export async function moveBySenderHandler(
  imap: ImapClientManager,
  params: { sourceFolder: string; senderAddress: string; destinationFolder: string; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    await imap.assertFoldersExist([params.sourceFolder, params.destinationFolder]);
    const uids = await imap.searchUidsBySender(params.sourceFolder, params.senderAddress);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: uids.length,
        uids,
        sourceFolder: params.sourceFolder,
        destination: params.destinationFolder,
        sender: params.senderAddress,
      }) }],
    };
  }
  const result = await imap.moveBySender(params.sourceFolder, params.senderAddress, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'moved_by_sender', sender: params.senderAddress, ...result }) }],
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
  const result = await imap.batchMoveMessages(params.labelFolder, params.uids, 'INBOX');
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
  const criteria: Record<string, unknown> = {};
  if (params.from) criteria.from = params.from;
  if (params.to) criteria.to = params.to;
  if (params.subject) criteria.subject = params.subject;
  if (params.keyword) criteria.body = params.keyword;
  if (params.since) criteria.since = new Date(params.since);
  if (params.before) criteria.before = new Date(params.before);
  if (params.unreadOnly) criteria.seen = false;

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

  const result = await imap.moveBySearch(params.sourceFolder, criteria, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'moved_by_search', ...result }) }],
  };
}
