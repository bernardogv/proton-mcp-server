import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function getChangesSinceHandler(
  imap: ImapClientManager,
  params: { since: string; folders?: string[] }
): Promise<ToolResult> {
  const sinceDate = new Date(params.since);
  if (isNaN(sinceDate.getTime())) {
    throw new Error(`Invalid 'since' timestamp: ${params.since}. Expected ISO 8601.`);
  }
  const folders = params.folders && params.folders.length > 0 ? params.folders : ['INBOX'];
  const result = await imap.getChangesSince(sinceDate, folders);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
