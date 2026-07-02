import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';
import { getSenderDistribution } from '../imap-insights.js';
import { buildSenderRoutes } from '../utils/sender-routes.js';

const DEFAULT_EXCLUDE = ['Trash', 'Spam', 'Drafts', 'Sent', 'Archive', 'All Mail'];

export function registerIntelligenceTools(server: McpServer, imap: ImapClientManager): void {
  server.registerTool('suggest_sender_routes', {
    title: 'Suggest Sender Routes',
    description: 'Analyze where each sender\'s mail has historically lived (across all folders) and suggest routing rules for senders whose mail consistently belongs in a non-INBOX folder. Stateless — re-derives from current IMAP state each call. Returns suggestions, does not auto-route. Pair with batch_move_by_senders to apply.',
    inputSchema: z.object({
      minConfidence: z.number().min(0.5).max(1).default(0.8).describe('Minimum dominant-folder ratio (default 0.8)'),
      minVolume: z.number().min(1).default(3).describe('Minimum total messages from sender (default 3)'),
      excludeFolders: z.array(z.string()).optional().describe('Folders to skip during analysis (default: Trash, Spam, Drafts, Sent, Archive, All Mail)'),
      inboxOnly: z.boolean().default(false).describe('Only suggest senders that currently have mail in INBOX (i.e. actionable routes)'),
      limit: z.number().min(1).max(500).default(50).describe('Max suggestions to return (default 50)'),
    }),
  }, async ({ minConfidence, minVolume, excludeFolders, inboxOnly, limit }) => suggestSenderRoutesHandler(imap, { minConfidence, minVolume, excludeFolders, inboxOnly, limit }));
}

export async function suggestSenderRoutesHandler(
  imap: ImapClientManager,
  params: { minConfidence?: number; minVolume?: number; excludeFolders?: string[]; inboxOnly?: boolean; limit?: number }
): Promise<ToolResult> {
  const minConfidence = params.minConfidence ?? 0.8;
  const minVolume = params.minVolume ?? 3;
  const limit = params.limit ?? 50;
  const excludeFolders = new Set(params.excludeFolders || DEFAULT_EXCLUDE);

  const distribution = await getSenderDistribution(imap, excludeFolders);
  const suggestions = buildSenderRoutes(distribution, {
    minConfidence,
    minVolume,
    inboxOnly: params.inboxOnly,
    limit,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify({
      suggestions,
      totalSendersAnalyzed: distribution.size,
      thresholdsUsed: { minConfidence, minVolume, inboxOnly: !!params.inboxOnly, limit },
    }) }],
  };
}
