import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function getMessagesHandler(
  imap: ImapClientManager,
  params: { folder: string; limit: number; offset: number; unreadOnly: boolean }
): Promise<ToolResult> {
  const messages = await imap.getMessages(params.folder, params.limit, params.offset, params.unreadOnly);
  return {
    content: [{ type: 'text', text: JSON.stringify(messages, null, 2) }],
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
    folder: string;
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

  const uids = await imap.searchMessages(params.folder, criteria);
  const limited = uids.sort((a, b) => b - a).slice(0, params.limit || 20);
  const messages = await imap.fetchMessagesByUid(params.folder, limited);

  return {
    content: [{ type: 'text', text: JSON.stringify(messages, null, 2) }],
  };
}
