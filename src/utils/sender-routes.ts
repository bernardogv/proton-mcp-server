import type { SenderRoute } from './types.js';

export interface SenderRouteOptions {
  minConfidence: number;
  minVolume: number;
  inboxOnly?: boolean;
  limit?: number;
}

export type SenderDistribution = Map<string, { name: string; total: number; byFolder: Record<string, number> }>;

/** Derive routing suggestions from a sender→folder distribution. Pure — no IMAP access. */
export function buildSenderRoutes(distribution: SenderDistribution, opts: SenderRouteOptions): SenderRoute[] {
  const suggestions: SenderRoute[] = [];
  for (const [address, data] of distribution) {
    if (data.total < opts.minVolume) continue;

    let dominantFolder = '';
    let dominantCount = 0;
    for (const [folder, count] of Object.entries(data.byFolder)) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantFolder = folder;
      }
    }
    const confidence = dominantCount / data.total;
    if (confidence < opts.minConfidence) continue;
    if (dominantFolder === 'INBOX') continue;
    if (opts.inboxOnly && !(data.byFolder['INBOX'] > 0)) continue;

    const otherFolders: Record<string, number> = {};
    for (const [folder, count] of Object.entries(data.byFolder)) {
      if (folder !== dominantFolder) otherFolders[folder] = count;
    }

    suggestions.push({
      sender: data.name,
      address,
      totalMessages: data.total,
      dominantFolder,
      confidence,
      otherFolders,
      suggestedTool: 'move_by_sender',
      suggestedArgs: {
        sourceFolder: 'INBOX',
        senderAddress: address,
        destinationFolder: dominantFolder,
      },
    });
  }

  suggestions.sort((a, b) => b.totalMessages - a.totalMessages);
  return opts.limit ? suggestions.slice(0, opts.limit) : suggestions;
}
