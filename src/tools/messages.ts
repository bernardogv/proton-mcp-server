import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';
import { buildSearchCriteria } from '../utils/mail-helpers.js';
import { getSenderSummary, getInboxDigest, getMessagesWithSnippets, getThread, getLabelsForMessage } from '../imap-insights.js';

export function registerMessageTools(server: McpServer, imap: ImapClientManager): void {
  server.registerTool('get_inbox_digest', {
    title: 'Inbox Digest',
    description: 'One-call session start: returns folder stats for all folders, inbox total/unread counts, and top senders with UIDs. Replaces needing get_folder_stats + get_sender_summary + get_messages.',
    inputSchema: z.object({
      folder: z.string().default('INBOX').describe('Primary inbox folder to analyze'),
      topSendersLimit: z.number().min(1).max(50).default(10).describe('Number of top senders to return'),
    }),
  }, async ({ folder, topSendersLimit }) => getInboxDigestHandler(imap, { folder, topSendersLimit }));

  server.registerTool('get_unread_count', {
    title: 'Unread Count',
    description: 'Lightweight check: returns just the unread message count for a folder. Faster than get_folder_stats when you only need one number.',
    inputSchema: z.object({
      folder: z.string().default('INBOX').describe('Folder to check'),
    }),
  }, async ({ folder }) => getUnreadCountHandler(imap, { folder }));

  server.registerTool('get_messages', {
    title: 'Get Messages',
    description: 'Get message list from a folder with metadata',
    inputSchema: z.object({
      folder: z.string().default('INBOX').describe('Folder to fetch from'),
      limit: z.number().min(1).max(100).default(20).describe('Max messages to return'),
      offset: z.number().min(0).default(0).describe('Offset for pagination'),
      unreadOnly: z.boolean().default(false).describe('Only return unread messages'),
    }),
  }, async ({ folder, limit, offset, unreadOnly }) => getMessagesHandler(imap, { folder, limit, offset, unreadOnly }));

  server.registerTool('read_message', {
    title: 'Read Message',
    description: 'Get full message content by UID',
    inputSchema: z.object({
      folder: z.string().default('INBOX').describe('Folder containing the message'),
      uid: z.number().describe('Message UID'),
    }),
  }, async ({ folder, uid }) => readMessageHandler(imap, { folder, uid }));

  server.registerTool('get_messages_with_snippets', {
    title: 'Messages with Snippets',
    description: 'Like get_messages but includes a text snippet (first N chars of body) for each message. Helps agents make routing decisions without calling read_message.',
    inputSchema: z.object({
      folder: z.string().default('INBOX').describe('Folder to fetch from'),
      limit: z.number().min(1).max(100).default(20).describe('Max messages to return'),
      offset: z.number().min(0).default(0).describe('Offset for pagination'),
      unreadOnly: z.boolean().default(false).describe('Only return unread messages'),
      snippetLength: z.number().min(1).max(1000).default(150).describe('Max characters for the body snippet'),
      includeUnsubscribeLinks: z.boolean().default(false).describe('Include full unsubscribe mailto/http URLs (long). Flags hasUnsubscribe/unsubscribeOneClick are always included.'),
    }),
  }, async ({ folder, limit, offset, unreadOnly, snippetLength, includeUnsubscribeLinks }) => getMessagesWithSnippetsHandler(imap, { folder, limit, offset, unreadOnly, snippetLength, includeUnsubscribeLinks }));

  server.registerTool('get_thread', {
    title: 'Get Thread',
    description: 'Get all messages in the same conversation thread as the given message UID. Groups by subject line, sorted chronologically.',
    inputSchema: z.object({
      folder: z.string().default('INBOX').describe('Folder containing the message'),
      uid: z.number().describe('Message UID to find the thread for'),
    }),
  }, async ({ folder, uid }) => getThreadHandler(imap, { folder, uid }));

  server.registerTool('search_messages', {
    title: 'Search Messages',
    description: 'Search messages with criteria. Supports searching across multiple folders.',
    inputSchema: z.object({
      folder: z.string().default('INBOX').describe('Folder to search in (used when folders is not provided)'),
      folders: z.array(z.string()).max(10).optional().describe('Search across multiple folders (max 10). Overrides folder if provided.'),
      from: z.string().optional().describe('Filter by sender'),
      to: z.string().optional().describe('Filter by recipient'),
      subject: z.string().optional().describe('Filter by subject'),
      keyword: z.string().optional().describe('Search body text'),
      since: z.string().optional().describe('Messages since date (ISO 8601)'),
      before: z.string().optional().describe('Messages before date (ISO 8601)'),
      unreadOnly: z.boolean().default(false).describe('Only unread messages'),
      limit: z.number().min(1).max(100).default(20).describe('Max results per folder'),
    }),
  }, async (params) => searchMessagesHandler(imap, params));

  server.registerTool('get_sender_summary', {
    title: 'Sender Summary',
    description: 'Get a breakdown of messages grouped by sender in a folder. Returns sender address, count, latest date, and UIDs. Sorted by count descending.',
    inputSchema: z.object({
      folder: z.string().default('INBOX').describe('Folder to summarize'),
      limit: z.number().optional().describe('Max number of senders to return (omit for all)'),
    }),
  }, async ({ folder, limit }) => getSenderSummaryHandler(imap, { folder, limit }));

  server.registerTool('get_labels_for_message', {
    title: 'Get Labels for Message',
    description: 'Check which labels are applied to a message by searching all label folders for it',
    inputSchema: z.object({
      folder: z.string().describe('Folder containing the message'),
      uid: z.number().describe('Message UID'),
    }),
  }, async ({ folder, uid }) => getLabelsForMessageHandler(imap, { folder, uid }));
}

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
  const criteria = buildSearchCriteria(params);
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
  const summaries = await getSenderSummary(imap, params.folder);
  const limited = params.limit ? summaries.slice(0, params.limit) : summaries;
  return {
    content: [{ type: 'text', text: JSON.stringify({ senders: limited, totalSenders: summaries.length, folder: params.folder }, null, 2) }],
  };
}

export async function getInboxDigestHandler(
  imap: ImapClientManager,
  params: { folder: string; topSendersLimit: number }
): Promise<ToolResult> {
  const digest = await getInboxDigest(imap, params.folder, params.topSendersLimit);
  return {
    content: [{ type: 'text', text: JSON.stringify(digest, null, 2) }],
  };
}

export async function getMessagesWithSnippetsHandler(
  imap: ImapClientManager,
  params: { folder: string; limit: number; offset: number; unreadOnly: boolean; snippetLength: number; includeUnsubscribeLinks?: boolean }
): Promise<ToolResult> {
  const { messages, total } = await getMessagesWithSnippets(imap, params.folder, params.limit, params.offset, params.unreadOnly, params.snippetLength, params.includeUnsubscribeLinks);
  return {
    content: [{ type: 'text', text: JSON.stringify({ messages, total, offset: params.offset, limit: params.limit }, null, 2) }],
  };
}

export async function getThreadHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  const messages = await getThread(imap, params.folder, params.uid);
  return {
    content: [{ type: 'text', text: JSON.stringify({ thread: messages, count: messages.length }, null, 2) }],
  };
}

export async function getLabelsForMessageHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  const result = await getLabelsForMessage(imap, params.folder, params.uid);
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
