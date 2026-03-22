import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './utils/config.js';
import { ImapClientManager } from './imap-client.js';
import { SmtpClient } from './smtp-client.js';
import { listFoldersHandler, createFolderHandler } from './tools/folders.js';
import { getMessagesHandler, readMessageHandler, searchMessagesHandler } from './tools/messages.js';
import { moveMessageHandler, applyLabelHandler, removeLabelHandler, deleteMessageHandler } from './tools/organize.js';
import { markReadHandler, markUnreadHandler, starMessageHandler, unstarMessageHandler } from './tools/flags.js';
import { sendEmailHandler } from './tools/send.js';
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

// --- Message tools ---

server.registerTool('get_messages', {
  title: 'Get Messages',
  description: 'Get message list from a folder with metadata',
  inputSchema: z.object({
    folder: z.string().default('INBOX').describe('Folder to fetch from'),
    limit: z.number().default(20).describe('Max messages to return'),
    offset: z.number().default(0).describe('Offset for pagination'),
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

server.registerTool('search_messages', {
  title: 'Search Messages',
  description: 'Search messages with criteria',
  inputSchema: z.object({
    folder: z.string().default('INBOX').describe('Folder to search in'),
    from: z.string().optional().describe('Filter by sender'),
    to: z.string().optional().describe('Filter by recipient'),
    subject: z.string().optional().describe('Filter by subject'),
    keyword: z.string().optional().describe('Search body text'),
    since: z.string().optional().describe('Messages since date (ISO 8601)'),
    before: z.string().optional().describe('Messages before date (ISO 8601)'),
    unreadOnly: z.boolean().default(false).describe('Only unread messages'),
    limit: z.number().default(20).describe('Max results'),
  }),
}, async (params) => {
  await imap.connect();
  return searchMessagesHandler(imap, params);
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

// --- Send tool ---

server.registerTool('send_email', {
  title: 'Send Email',
  description: 'Send an email via SMTP through Proton Bridge',
  inputSchema: z.object({
    to: z.array(z.string()).describe('Recipient email addresses'),
    cc: z.array(z.string()).optional().describe('CC recipients'),
    bcc: z.array(z.string()).optional().describe('BCC recipients'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body (text or HTML)'),
    isHtml: z.boolean().default(false).describe('Whether body is HTML'),
    inReplyTo: z.string().optional().describe('Message-ID to reply to (for threading)'),
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
