import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const _write = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
dotenv.config({ path: join(__dirname, '..', '.env') });
process.stdout.write = _write;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './utils/config.js';
import { ImapClientManager } from './imap-client.js';
import { SmtpClient } from './smtp-client.js';
import { listFoldersHandler, createFolderHandler, deleteFolderHandler, renameFolderHandler, getFolderStatsHandler } from './tools/folders.js';
import { getMessagesHandler, readMessageHandler, searchMessagesHandler, getSenderSummaryHandler, getInboxDigestHandler, getMessagesWithSnippetsHandler, getThreadHandler, getUnreadCountHandler } from './tools/messages.js';
import { moveMessageHandler, applyLabelHandler, removeLabelHandler, deleteMessageHandler, batchMoveHandler, batchApplyLabelHandler, batchDeleteHandler, crossFolderBatchMoveHandler, moveBySenderHandler, moveBySearchHandler } from './tools/organize.js';
import { markReadHandler, markUnreadHandler, starMessageHandler, unstarMessageHandler, batchMarkReadHandler, batchMarkUnreadHandler, markAllReadHandler } from './tools/flags.js';
import { sendEmailHandler } from './tools/send.js';
import { createDraftHandler } from './tools/drafts.js';
import { getAttachmentHandler } from './tools/attachments.js';

const config = loadConfig();
const imap = new ImapClientManager(config);
const smtp = new SmtpClient(config);

const server = new McpServer({
  name: 'protonmail',
  version: '1.0.0',
});

// --- Folder tools ---

server.registerTool('list_folders', {
  title: 'List Folders',
  description: 'List all folders and labels in the mailbox',
  inputSchema: z.object({}),
}, async () => {
  await imap.connect();
  return listFoldersHandler(imap);
});

server.registerTool('create_folder', {
  title: 'Create Folder',
  description: 'Create a new folder/label',
  inputSchema: z.object({
    name: z.string().describe('Folder name (use / for subfolders, e.g. "Projects/Work")'),
  }),
}, async ({ name }) => {
  await imap.connect();
  return createFolderHandler(imap, { name });
});

server.registerTool('delete_folder', {
  title: 'Delete Folder',
  description: 'Delete a folder/label from the mailbox. Use dryRun: true to preview what would be deleted.',
  inputSchema: z.object({
    path: z.string().describe('Full path of the folder to delete (e.g. "Folders/OldFolder")'),
    dryRun: z.boolean().default(false).describe('If true, returns folder stats without deleting. Use to preview before committing.'),
  }),
}, async ({ path, dryRun }) => {
  await imap.connect();
  return deleteFolderHandler(imap, { path, dryRun });
});

server.registerTool('rename_folder', {
  title: 'Rename Folder',
  description: 'Rename or move a folder',
  inputSchema: z.object({
    oldPath: z.string().describe('Current full path of the folder'),
    newPath: z.string().describe('New full path for the folder'),
  }),
}, async ({ oldPath, newPath }) => {
  await imap.connect();
  return renameFolderHandler(imap, { oldPath, newPath });
});

server.registerTool('get_folder_stats', {
  title: 'Folder Stats',
  description: 'Get message counts (total and unread) for all folders. Quick inbox health dashboard.',
  inputSchema: z.object({}),
}, async () => {
  await imap.connect();
  return getFolderStatsHandler(imap);
});

// --- Agent intelligence tools ---

server.registerTool('get_inbox_digest', {
  title: 'Inbox Digest',
  description: 'One-call session start: returns folder stats for all folders, inbox total/unread counts, and top senders with UIDs. Replaces needing get_folder_stats + get_sender_summary + get_messages.',
  inputSchema: z.object({
    folder: z.string().default('INBOX').describe('Primary inbox folder to analyze'),
    topSendersLimit: z.number().min(1).max(50).default(10).describe('Number of top senders to return'),
  }),
}, async ({ folder, topSendersLimit }) => {
  await imap.connect();
  return getInboxDigestHandler(imap, { folder, topSendersLimit });
});

server.registerTool('get_unread_count', {
  title: 'Unread Count',
  description: 'Lightweight check: returns just the unread message count for a folder. Faster than get_folder_stats when you only need one number.',
  inputSchema: z.object({
    folder: z.string().default('INBOX').describe('Folder to check'),
  }),
}, async ({ folder }) => {
  await imap.connect();
  return getUnreadCountHandler(imap, { folder });
});

// --- Message tools ---

server.registerTool('get_messages', {
  title: 'Get Messages',
  description: 'Get message list from a folder with metadata',
  inputSchema: z.object({
    folder: z.string().default('INBOX').describe('Folder to fetch from'),
    limit: z.number().min(1).max(100).default(20).describe('Max messages to return'),
    offset: z.number().min(0).default(0).describe('Offset for pagination'),
    unreadOnly: z.boolean().default(false).describe('Only return unread messages'),
  }),
}, async ({ folder, limit, offset, unreadOnly }) => {
  await imap.connect();
  return getMessagesHandler(imap, { folder, limit, offset, unreadOnly });
});

server.registerTool('read_message', {
  title: 'Read Message',
  description: 'Get full message content by UID',
  inputSchema: z.object({
    folder: z.string().default('INBOX').describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return readMessageHandler(imap, { folder, uid });
});

server.registerTool('get_messages_with_snippets', {
  title: 'Messages with Snippets',
  description: 'Like get_messages but includes a text snippet (first N chars of body) for each message. Helps agents make routing decisions without calling read_message.',
  inputSchema: z.object({
    folder: z.string().default('INBOX').describe('Folder to fetch from'),
    limit: z.number().min(1).max(100).default(20).describe('Max messages to return'),
    offset: z.number().min(0).default(0).describe('Offset for pagination'),
    unreadOnly: z.boolean().default(false).describe('Only return unread messages'),
    snippetLength: z.number().min(1).max(1000).default(150).describe('Max characters for the body snippet'),
  }),
}, async ({ folder, limit, offset, unreadOnly, snippetLength }) => {
  await imap.connect();
  return getMessagesWithSnippetsHandler(imap, { folder, limit, offset, unreadOnly, snippetLength });
});

server.registerTool('get_thread', {
  title: 'Get Thread',
  description: 'Get all messages in the same conversation thread as the given message UID. Groups by subject line, sorted chronologically.',
  inputSchema: z.object({
    folder: z.string().default('INBOX').describe('Folder containing the message'),
    uid: z.number().describe('Message UID to find the thread for'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return getThreadHandler(imap, { folder, uid });
});

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
}, async (params) => {
  await imap.connect();
  return searchMessagesHandler(imap, params);
});

server.registerTool('get_sender_summary', {
  title: 'Sender Summary',
  description: 'Get a breakdown of messages grouped by sender in a folder. Returns sender address, count, latest date, and UIDs. Sorted by count descending.',
  inputSchema: z.object({
    folder: z.string().default('INBOX').describe('Folder to summarize'),
    limit: z.number().optional().describe('Max number of senders to return (omit for all)'),
  }),
}, async ({ folder, limit }) => {
  await imap.connect();
  return getSenderSummaryHandler(imap, { folder, limit });
});

// --- Organization tools ---

server.registerTool('move_message', {
  title: 'Move Message',
  description: 'Move a message to a different folder',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Current folder of the message'),
    uid: z.number().describe('Message UID'),
    destinationFolder: z.string().describe('Target folder'),
  }),
}, async ({ sourceFolder, uid, destinationFolder }) => {
  await imap.connect();
  return moveMessageHandler(imap, { sourceFolder, uid, destinationFolder });
});

server.registerTool('apply_label', {
  title: 'Apply Label',
  description: 'Apply a label to a message (copies to label folder, keeps original)',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Current folder of the message'),
    uid: z.number().describe('Message UID'),
    labelFolder: z.string().describe('Label folder to apply'),
  }),
}, async ({ sourceFolder, uid, labelFolder }) => {
  await imap.connect();
  return applyLabelHandler(imap, { sourceFolder, uid, labelFolder });
});

server.registerTool('remove_label', {
  title: 'Remove Label',
  description: 'Remove a label from a message',
  inputSchema: z.object({
    labelFolder: z.string().describe('Label folder to remove the message from'),
    uid: z.number().describe('Message UID within the label folder'),
  }),
}, async ({ labelFolder, uid }) => {
  await imap.connect();
  return removeLabelHandler(imap, { labelFolder, uid });
});

server.registerTool('delete_message', {
  title: 'Delete Message',
  description: 'Move a message to Trash',
  inputSchema: z.object({
    folder: z.string().describe('Current folder of the message'),
    uid: z.number().describe('Message UID'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return deleteMessageHandler(imap, { folder, uid });
});

// --- Batch organization tools ---

server.registerTool('batch_move_messages', {
  title: 'Batch Move Messages',
  description: 'Move multiple messages to a folder in a single operation. Accepts an array of UIDs.',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Current folder of the messages'),
    uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs to move (max 500)'),
    destinationFolder: z.string().describe('Target folder'),
  }),
}, async ({ sourceFolder, uids, destinationFolder }) => {
  await imap.connect();
  return batchMoveHandler(imap, { sourceFolder, uids, destinationFolder });
});

server.registerTool('batch_apply_label', {
  title: 'Batch Apply Label',
  description: 'Apply a label to multiple messages in a single operation',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Current folder of the messages'),
    uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs to label (max 500)'),
    labelFolder: z.string().describe('Label folder to apply'),
  }),
}, async ({ sourceFolder, uids, labelFolder }) => {
  await imap.connect();
  return batchApplyLabelHandler(imap, { sourceFolder, uids, labelFolder });
});

server.registerTool('batch_delete_messages', {
  title: 'Batch Delete Messages',
  description: 'Move multiple messages to Trash in a single operation',
  inputSchema: z.object({
    folder: z.string().describe('Current folder of the messages'),
    uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs to delete (max 500)'),
  }),
}, async ({ folder, uids }) => {
  await imap.connect();
  return batchDeleteHandler(imap, { folder, uids });
});

server.registerTool('cross_folder_batch_move', {
  title: 'Cross-Folder Batch Move',
  description: 'Move messages from multiple source folders to one destination in a single call. Each item specifies its own sourceFolder.',
  inputSchema: z.object({
    items: z.array(z.object({
      uid: z.number().describe('Message UID'),
      sourceFolder: z.string().describe('Folder this message is currently in'),
    })).min(1).max(500).describe('Array of messages with their source folders (max 500)'),
    destinationFolder: z.string().describe('Target folder for all messages'),
  }),
}, async ({ items, destinationFolder }) => {
  await imap.connect();
  return crossFolderBatchMoveHandler(imap, { items, destinationFolder });
});

server.registerTool('move_by_sender', {
  title: 'Move by Sender',
  description: 'Move all messages from a specific sender to a destination folder. Search + move in one call.',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Folder to search in'),
    senderAddress: z.string().describe('Sender email address to match'),
    destinationFolder: z.string().describe('Target folder'),
  }),
}, async ({ sourceFolder, senderAddress, destinationFolder }) => {
  await imap.connect();
  return moveBySenderHandler(imap, { sourceFolder, senderAddress, destinationFolder });
});

server.registerTool('move_by_search', {
  title: 'Move by Search',
  description: 'Search for messages matching criteria and move all matches to a destination folder. Search + move in one call. Requires at least one search criterion.',
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
  }),
}, async (params) => {
  await imap.connect();
  return moveBySearchHandler(imap, params);
});

// --- Flag tools ---

server.registerTool('mark_read', {
  title: 'Mark Read',
  description: 'Mark a message as read',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return markReadHandler(imap, { folder, uid });
});

server.registerTool('mark_unread', {
  title: 'Mark Unread',
  description: 'Mark a message as unread',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return markUnreadHandler(imap, { folder, uid });
});

server.registerTool('star_message', {
  title: 'Star Message',
  description: 'Star/flag a message',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return starMessageHandler(imap, { folder, uid });
});

server.registerTool('unstar_message', {
  title: 'Unstar Message',
  description: 'Remove star/flag from a message',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return unstarMessageHandler(imap, { folder, uid });
});

// --- Batch flag tools ---

server.registerTool('batch_mark_read', {
  title: 'Batch Mark Read',
  description: 'Mark multiple messages as read in a single operation',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the messages'),
    uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs to mark as read (max 500)'),
  }),
}, async ({ folder, uids }) => {
  await imap.connect();
  return batchMarkReadHandler(imap, { folder, uids });
});

server.registerTool('batch_mark_unread', {
  title: 'Batch Mark Unread',
  description: 'Mark multiple messages as unread in a single operation',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the messages'),
    uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs to mark as unread (max 500)'),
  }),
}, async ({ folder, uids }) => {
  await imap.connect();
  return batchMarkUnreadHandler(imap, { folder, uids });
});

server.registerTool('mark_all_read', {
  title: 'Mark All Read',
  description: 'Mark all unread messages in a folder as read. No need to fetch UIDs first.',
  inputSchema: z.object({
    folder: z.string().describe('Folder to mark all messages as read'),
  }),
}, async ({ folder }) => {
  await imap.connect();
  return markAllReadHandler(imap, { folder });
});

// --- Draft tool ---

server.registerTool('create_draft', {
  title: 'Create Draft',
  description: 'Save an email as a draft in the Proton Mail Drafts folder without sending it',
  inputSchema: z.object({
    to: z.array(z.string().email()).min(1).describe('Recipient email addresses'),
    cc: z.array(z.string().email()).optional().describe('CC recipients'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body (text or HTML)'),
    isHtml: z.boolean().default(false).describe('Whether body is HTML'),
    draftsFolder: z.string().default('Drafts').describe('Drafts folder name (default: Drafts)'),
  }),
}, async (params) => {
  await imap.connect();
  return createDraftHandler(imap, params);
});

// --- Send tool ---

server.registerTool('send_email', {
  title: 'Send Email',
  description: 'Send an email via SMTP through Proton Bridge',
  inputSchema: z.object({
    to: z.array(z.string().email()).min(1).describe('Recipient email addresses'),
    cc: z.array(z.string().email()).optional().describe('CC recipients'),
    bcc: z.array(z.string().email()).optional().describe('BCC recipients'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body (text or HTML)'),
    isHtml: z.boolean().default(false).describe('Whether body is HTML'),
    inReplyTo: z.string().regex(/^<[^>]+>$/, 'Must be a valid Message-ID (e.g. <id@domain>)').optional().describe('Message-ID to reply to (for threading)'),
  }),
}, async (params) => {
  return sendEmailHandler(smtp, params);
});

// --- Attachment tool ---

server.registerTool('get_attachment', {
  title: 'Get Attachment',
  description: 'Download a specific attachment from a message',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
    attachmentPartId: z.string().describe('Attachment part ID from read_message response'),
  }),
}, async ({ folder, uid, attachmentPartId }) => {
  await imap.connect();
  return getAttachmentHandler(imap, { folder, uid, attachmentPartId });
});

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Proton Mail MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
