import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';
import { routeMessages } from '../imap-batch.js';

export function registerRouteTools(server: McpServer, imap: ImapClientManager): void {
  server.registerTool('route', {
    title: 'Route Message',
    description: 'Atomic label-and-move: copy to each label folder (UIDs stay valid), then optionally move to a destination. Use this instead of separate apply_label + move_message calls to avoid UID invalidation between steps.',
    inputSchema: z.object({
      sourceFolder: z.string().describe('Current folder of the message'),
      uid: z.number().describe('Message UID'),
      labels: z.array(z.string()).optional().describe('Label folder paths to copy the message to (preserves source UID)'),
      destinationFolder: z.string().optional().describe('Destination folder for the move (omit for label-only)'),
    }),
  }, async ({ sourceFolder, uid, labels, destinationFolder }) => routeHandler(imap, { sourceFolder, uid, labels, destinationFolder }));

  server.registerTool('batch_route', {
    title: 'Batch Route Messages',
    description: 'Atomic label-and-move for up to 500 messages. Labels copy first (preserving UIDs), then move. Use dryRun:true to preview.',
    inputSchema: z.object({
      sourceFolder: z.string().describe('Current folder of the messages'),
      uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs (max 500)'),
      labels: z.array(z.string()).optional().describe('Label folder paths to copy the messages to'),
      destinationFolder: z.string().optional().describe('Destination folder for the move (omit for label-only)'),
      dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
    }),
  }, async ({ sourceFolder, uids, labels, destinationFolder, dryRun }) => batchRouteHandler(imap, { sourceFolder, uids, labels, destinationFolder, dryRun }));
}

export async function routeHandler(
  imap: ImapClientManager,
  params: {
    sourceFolder: string;
    uid: number;
    labels?: string[];
    destinationFolder?: string;
  }
): Promise<ToolResult> {
  if ((!params.labels || params.labels.length === 0) && !params.destinationFolder) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Must provide labels[] or destinationFolder (or both)' }) }],
    };
  }
  const result = await routeMessages(
    imap,
    params.sourceFolder,
    [params.uid],
    params.labels || [],
    params.destinationFolder,
  );
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'routed', ...result }) }],
  };
}

export async function batchRouteHandler(
  imap: ImapClientManager,
  params: {
    sourceFolder: string;
    uids: number[];
    labels?: string[];
    destinationFolder?: string;
    dryRun?: boolean;
  }
): Promise<ToolResult> {
  if ((!params.labels || params.labels.length === 0) && !params.destinationFolder) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Must provide labels[] or destinationFolder (or both)' }) }],
    };
  }
  if (params.dryRun) {
    const toValidate = [params.sourceFolder, ...(params.labels || [])];
    if (params.destinationFolder) toValidate.push(params.destinationFolder);
    await imap.assertFoldersExist(toValidate);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: params.uids.length,
        uids: params.uids,
        sourceFolder: params.sourceFolder,
        labels: params.labels || [],
        destination: params.destinationFolder,
      }) }],
    };
  }
  const result = await routeMessages(
    imap,
    params.sourceFolder,
    params.uids,
    params.labels || [],
    params.destinationFolder,
  );
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'batch_routed', ...result }) }],
  };
}
