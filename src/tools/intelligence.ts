import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult, SenderRoute } from '../utils/types.js';

const DEFAULT_EXCLUDE = ['Trash', 'Spam', 'Drafts', 'Sent', 'Archive', 'All Mail'];

export async function suggestSenderRoutesHandler(
  imap: ImapClientManager,
  params: { minConfidence?: number; minVolume?: number; excludeFolders?: string[] }
): Promise<ToolResult> {
  const minConfidence = params.minConfidence ?? 0.8;
  const minVolume = params.minVolume ?? 3;
  const excludeFolders = new Set(params.excludeFolders || DEFAULT_EXCLUDE);

  const distribution = await imap.getSenderDistribution(excludeFolders);

  const suggestions: SenderRoute[] = [];
  for (const [address, data] of distribution) {
    if (data.total < minVolume) continue;
    let dominantFolder = '';
    let dominantCount = 0;
    for (const [folder, count] of Object.entries(data.byFolder)) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantFolder = folder;
      }
    }
    const confidence = dominantCount / data.total;
    if (confidence < minConfidence) continue;
    if (dominantFolder === 'INBOX') continue;

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

  return {
    content: [{ type: 'text', text: JSON.stringify({
      suggestions,
      totalSendersAnalyzed: distribution.size,
      thresholdsUsed: { minConfidence, minVolume },
    }, null, 2) }],
  };
}
