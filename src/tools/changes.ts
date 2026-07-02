import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';
import { getChangesSince } from '../imap-insights.js';

export function registerChangesTools(server: McpServer, imap: ImapClientManager): void {
  server.registerTool('get_changes_since', {
    title: 'Changes Since Timestamp',
    description: 'Stateless diff: returns new messages received since the given ISO 8601 timestamp across the specified folders. Default folder is INBOX. Catches new arrivals only (flag changes are not surfaced).',
    inputSchema: z.object({
      since: z.string().describe('ISO 8601 timestamp, e.g. "2026-05-07T00:00:00Z"'),
      folders: z.array(z.string()).max(20).optional().describe('Folders to check (default: ["INBOX"])'),
    }),
  }, async ({ since, folders }) => getChangesSinceHandler(imap, { since, folders }));
}

export async function getChangesSinceHandler(
  imap: ImapClientManager,
  params: { since: string; folders?: string[] }
): Promise<ToolResult> {
  const sinceDate = new Date(params.since);
  if (isNaN(sinceDate.getTime())) {
    throw new Error(`Invalid 'since' timestamp: ${params.since}. Expected ISO 8601.`);
  }
  const folders = params.folders && params.folders.length > 0 ? params.folders : ['INBOX'];
  const result = await getChangesSince(imap, sinceDate, folders);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
