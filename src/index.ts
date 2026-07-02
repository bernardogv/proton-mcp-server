import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Suppress dotenv v17 stdout banner — it corrupts MCP stdio protocol
const _origLog = console.log;
console.log = () => {};
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });
console.log = _origLog;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './utils/config.js';
import { ImapClientManager } from './imap-client.js';
import { SmtpClient } from './smtp-client.js';
import { registerFolderTools } from './tools/folders.js';
import { registerMessageTools } from './tools/messages.js';
import { registerOrganizeTools } from './tools/organize.js';
import { registerFlagTools } from './tools/flags.js';
import { registerSendTools } from './tools/send.js';
import { registerAttachmentTools } from './tools/attachments.js';
import { registerChangesTools } from './tools/changes.js';
import { registerRouteTools } from './tools/route.js';
import { registerIntelligenceTools } from './tools/intelligence.js';

const config = loadConfig();
const imap = new ImapClientManager(config);
const smtp = new SmtpClient(config);

const server = new McpServer({
  name: 'protonmail',
  version: '1.0.0',
});

registerFolderTools(server, imap);
registerMessageTools(server, imap);
registerOrganizeTools(server, imap);
registerFlagTools(server, imap);
registerSendTools(server, imap, smtp);
registerAttachmentTools(server, imap);
registerChangesTools(server, imap);
registerRouteTools(server, imap);
registerIntelligenceTools(server, imap);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Proton Mail MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
