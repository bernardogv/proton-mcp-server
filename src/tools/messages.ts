import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function getMessagesHandler(
  imap: ImapClientManager,
  params: { folder: string; limit: number; offset: number; unreadOnly: boolean }
): Promise<ToolResult> {
  const { messages, total } = await imap.getMessages(params.folder, params.limit, params.offset, params.unreadOnly);
  return {
    content: [{ type: 'text', text: JSON.stringify({ messages, total, offset: params.offset, limit: params.limit }, null, 2) }],
  };
}

export async function readMessageHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  const message = await imap.readMessage(params.folder, params.uid);
  return {
    content: [{ type: 'text', text: JSON.stringify(message, null, 2) }],
  };
}

export async function searchMessagesHandler(
  imap: ImapClientManager,
  params: {
    folder?: string;
    folders?: string[];
    from?: string;
    to?: string;
    subject?: string;
    keyword?: string;
    since?: string;
    before?: string;
    unreadOnly?: boolean;
    limit?: number;
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

  if (Object.keys(criteria).length === 0) criteria.all = true;

  const foldersToSearch = params.folders && params.folders.length > 0
    ? params.folders
    : [params.folder || 'INBOX'];
  const limit = params.limit || 20;

  const allResults: Array<{ folder: string; messages: import('../utils/types.js').MessageSummary[] }> = [];
  let totalFound = 0;

  for (const folder of foldersToSearch) {
    const uids = await imap.searchMessages(folder, criteria);
    totalFound += uids.length;
    const limited = uids.sort((a, b) => b - a).slice(0, limit);
    const messages = await imap.fetchMessagesByUid(folder, limited);
    if (messages.length > 0) {
      allResults.push({ folder, messages });
    }
  }

  if (foldersToSearch.length === 1) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ messages: allResults[0]?.messages || [], total: totalFound, folder: foldersToSearch[0] }, null, 2) }],
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify({ results: allResults, totalFound, foldersSearched: foldersToSearch.length }, null, 2) }],
  };
}

export async function getSenderSummaryHandler(
  imap: ImapClientManager,
  params: { folder: string; limit?: number }
): Promise<ToolResult> {
  const summaries = await imap.getSenderSummary(params.folder);
  const limited = params.limit ? summaries.slice(0, params.limit) : summaries;
  return {
    content: [{ type: 'text', text: JSON.stringify({ senders: limited, totalSenders: summaries.length, folder: params.folder }, null, 2) }],
  };
}

export async function getInboxDigestHandler(
  imap: ImapClientManager,
  params: { folder: string; topSendersLimit: number }
): Promise<ToolResult> {
  const digest = await imap.getInboxDigest(params.folder, params.topSendersLimit);
  return {
    content: [{ type: 'text', text: JSON.stringify(digest, null, 2) }],
  };
}

export async function getMessagesWithSnippetsHandler(
  imap: ImapClientManager,
  params: { folder: string; limit: number; offset: number; unreadOnly: boolean; snippetLength: number }
): Promise<ToolResult> {
  const { messages, total } = await imap.getMessagesWithSnippets(params.folder, params.limit, params.offset, params.unreadOnly, params.snippetLength);
  return {
    content: [{ type: 'text', text: JSON.stringify({ messages, total, offset: params.offset, limit: params.limit }, null, 2) }],
  };
}

export async function getThreadHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  const messages = await imap.getThread(params.folder, params.uid);
  return {
    content: [{ type: 'text', text: JSON.stringify({ thread: messages, count: messages.length }, null, 2) }],
  };
}

export async function getLabelsForMessageHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  const result = await imap.getLabelsForMessage(params.folder, params.uid);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

export async function getUnreadCountHandler(
  imap: ImapClientManager,
  params: { folder: string }
): Promise<ToolResult> {
  const count = await imap.getUnreadCount(params.folder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ folder: params.folder, unread: count }) }],
  };
}
