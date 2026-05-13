import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

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
  const result = await imap.routeMessages(
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
  const result = await imap.routeMessages(
    params.sourceFolder,
    params.uids,
    params.labels || [],
    params.destinationFolder,
  );
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'batch_routed', ...result }) }],
  };
}
