import type { ImapClientManager } from './imap-client.js';
import type { BatchResult, RouteResult } from './utils/types.js';
import { assertFolderExists } from './utils/folder-validation.js';
import { exactSenderUids } from './utils/mail-helpers.js';

export interface SenderMoveResult {
  senderAddress: string;
  destination: string;
  matched: number;
  moved?: number;
  success?: boolean;
  uids: number[];
}

export async function batchMoveMessages(
  imap: ImapClientManager,
  sourceFolder: string,
  uids: number[],
  destFolder: string,
): Promise<BatchResult> {
  if (uids.length === 0) {
    return { success: true, requested: 0, moved: 0, destination: destFolder, sourceFolder };
  }
  return imap.withConnection(async (client) => {
    const mailboxes = await client.list();
    const paths = new Set(mailboxes.map((m) => m.path));
    assertFolderExists(paths, sourceFolder);
    assertFolderExists(paths, destFolder);

    // Capture source size before
    const beforeStatus = await client.status(sourceFolder, { messages: true });
    const before = beforeStatus.messages ?? 0;

    // Run the move under a lock
    const lock = await client.getMailboxLock(sourceFolder);
    try {
      const range = uids.join(',');
      await client.messageMove(range, destFolder, { uid: true });
    } finally {
      lock.release();
    }

    // Capture source size after
    const afterStatus = await client.status(sourceFolder, { messages: true });
    const after = afterStatus.messages ?? 0;
    const moved = before - after;

    // If under-counted, find which requested UIDs still exist in source
    let failedUids: number[] | undefined;
    if (moved < uids.length) {
      const checkLock = await client.getMailboxLock(sourceFolder);
      try {
        const result = await client.search({ uid: uids.join(',') }, { uid: true });
        failedUids = result === false ? [] : result;
      } finally {
        checkLock.release();
      }
    }

    return {
      success: moved === uids.length,
      requested: uids.length,
      moved,
      destination: destFolder,
      sourceFolder,
      ...(failedUids && { failedUids }),
    };
  });
}

export async function batchCopyMessages(
  imap: ImapClientManager,
  sourceFolder: string,
  uids: number[],
  destFolder: string,
): Promise<BatchResult> {
  if (uids.length === 0) {
    return { success: true, requested: 0, copied: 0, label: destFolder, sourceFolder };
  }
  return imap.withConnection(async (client) => {
    const mailboxes = await client.list();
    const paths = new Set(mailboxes.map((m) => m.path));
    assertFolderExists(paths, sourceFolder);
    assertFolderExists(paths, destFolder);

    // Capture destination size before
    const beforeStatus = await client.status(destFolder, { messages: true });
    const before = beforeStatus.messages ?? 0;

    const lock = await client.getMailboxLock(sourceFolder);
    try {
      const range = uids.join(',');
      await client.messageCopy(range, destFolder, { uid: true });
    } finally {
      lock.release();
    }

    const afterStatus = await client.status(destFolder, { messages: true });
    const after = afterStatus.messages ?? 0;
    const copied = after - before;

    return {
      success: copied === uids.length,
      requested: uids.length,
      copied,
      label: destFolder,
      sourceFolder,
    };
  });
}

export async function batchAddFlags(imap: ImapClientManager, folder: string, uids: number[], flags: string[]): Promise<{ updated: number }> {
  if (uids.length === 0) return { updated: 0 };
  return imap.withConnection(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageFlagsAdd(uids.join(','), flags, { uid: true });
      return { updated: uids.length };
    } finally {
      lock.release();
    }
  });
}

export async function batchRemoveFlags(imap: ImapClientManager, folder: string, uids: number[], flags: string[]): Promise<{ updated: number }> {
  if (uids.length === 0) return { updated: 0 };
  return imap.withConnection(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageFlagsRemove(uids.join(','), flags, { uid: true });
      return { updated: uids.length };
    } finally {
      lock.release();
    }
  });
}

export async function markAllRead(imap: ImapClientManager, folder: string): Promise<{ updated: number }> {
  return imap.withConnection(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const searchResult = await client.search({ seen: false }, { uid: true });
      const uids: number[] = searchResult === false ? [] : searchResult;
      if (uids.length === 0) return { updated: 0 };
      await client.messageFlagsAdd(uids.join(','), ['\\Seen'], { uid: true });
      return { updated: uids.length };
    } finally {
      lock.release();
    }
  });
}

export async function crossFolderBatchMove(
  imap: ImapClientManager,
  items: Array<{ uid: number; sourceFolder: string }>,
  destFolder: string,
): Promise<{ moved: number; byFolder: Record<string, number> }> {
  const grouped = new Map<string, number[]>();
  for (const item of items) {
    const existing = grouped.get(item.sourceFolder) || [];
    existing.push(item.uid);
    grouped.set(item.sourceFolder, existing);
  }

  const byFolder: Record<string, number> = {};
  let totalMoved = 0;

  for (const [folder, uids] of grouped) {
    const result = await batchMoveMessages(imap, folder, uids, destFolder);
    byFolder[folder] = result.moved ?? 0;
    totalMoved += result.moved ?? 0;
  }

  return { moved: totalMoved, byFolder };
}

/**
 * Move messages from many senders in ONE connection. Senders are matched exactly
 * against the envelope address (IMAP FROM search alone is substring-based).
 * With dryRun, reports matched UIDs per sender without moving.
 */
export async function batchMoveBySenders(
  imap: ImapClientManager,
  sourceFolder: string,
  routes: Array<{ senderAddress: string; destinationFolder: string }>,
  dryRun = false,
): Promise<{ results: SenderMoveResult[]; totalMoved: number }> {
  return imap.withConnection(async (client) => {
    const mailboxes = await client.list();
    const paths = new Set(mailboxes.map((m) => m.path));
    assertFolderExists(paths, sourceFolder);
    for (const r of routes) assertFolderExists(paths, r.destinationFolder);

    const results: SenderMoveResult[] = [];
    let totalMoved = 0;

    for (const route of routes) {
      // Find candidates by substring FROM search, then keep exact envelope matches only
      const lock = await client.getMailboxLock(sourceFolder);
      let uids: number[] = [];
      try {
        const found = await client.search({ from: route.senderAddress }, { uid: true });
        const candidates: number[] = found === false ? [] : found;
        if (candidates.length > 0) {
          const pairs: Array<{ uid: number; address: string }> = [];
          for await (const msg of client.fetch(candidates.join(','), { envelope: true }, { uid: true })) {
            pairs.push({ uid: msg.uid, address: msg.envelope?.from?.[0]?.address || '' });
          }
          uids = exactSenderUids(pairs, route.senderAddress);
        }
      } finally {
        lock.release();
      }

      if (dryRun) {
        results.push({ senderAddress: route.senderAddress, destination: route.destinationFolder, matched: uids.length, uids });
        continue;
      }
      if (uids.length === 0) {
        results.push({ senderAddress: route.senderAddress, destination: route.destinationFolder, matched: 0, moved: 0, success: true, uids: [] });
        continue;
      }

      const before = (await client.status(sourceFolder, { messages: true })).messages ?? 0;
      const moveLock = await client.getMailboxLock(sourceFolder);
      try {
        await client.messageMove(uids.join(','), route.destinationFolder, { uid: true });
      } finally {
        moveLock.release();
      }
      const after = (await client.status(sourceFolder, { messages: true })).messages ?? 0;
      const moved = before - after;
      totalMoved += moved;
      results.push({
        senderAddress: route.senderAddress,
        destination: route.destinationFolder,
        matched: uids.length,
        moved,
        success: moved === uids.length,
        uids,
      });
    }

    return { results, totalMoved };
  });
}

export async function moveBySender(imap: ImapClientManager, folder: string, senderAddress: string, destFolder: string): Promise<BatchResult & { uids: number[] }> {
  const { results } = await batchMoveBySenders(imap, folder, [{ senderAddress, destinationFolder: destFolder }]);
  const r = results[0];
  return {
    success: r.success ?? true,
    requested: r.matched,
    moved: r.moved ?? 0,
    destination: destFolder,
    sourceFolder: folder,
    uids: r.uids,
  };
}

export async function moveBySearch(imap: ImapClientManager, folder: string, criteria: Record<string, unknown>, destFolder: string): Promise<BatchResult & { uids: number[] }> {
  return imap.withConnection(async (client) => {
    const mailboxes = await client.list();
    const paths = new Set(mailboxes.map((m) => m.path));
    assertFolderExists(paths, folder);
    assertFolderExists(paths, destFolder);

    const lock = await client.getMailboxLock(folder);
    let uids: number[];
    try {
      const searchResult = await client.search(criteria, { uid: true });
      uids = searchResult === false ? [] : searchResult;
    } finally {
      lock.release();
    }
    if (uids.length === 0) {
      return { success: true, requested: 0, moved: 0, destination: destFolder, sourceFolder: folder, uids: [] };
    }

    const beforeStatus = await client.status(folder, { messages: true });
    const before = beforeStatus.messages ?? 0;

    const moveLock = await client.getMailboxLock(folder);
    try {
      await client.messageMove(uids.join(','), destFolder, { uid: true });
    } finally {
      moveLock.release();
    }

    const afterStatus = await client.status(folder, { messages: true });
    const after = afterStatus.messages ?? 0;
    const moved = before - after;

    return {
      success: moved === uids.length,
      requested: uids.length,
      moved,
      destination: destFolder,
      sourceFolder: folder,
      uids,
    };
  });
}

export async function routeMessages(
  imap: ImapClientManager,
  sourceFolder: string,
  uids: number[],
  labels: string[],
  destinationFolder: string | undefined,
): Promise<RouteResult> {
  if (uids.length === 0) {
    return { success: true, requested: 0, labeled: [] };
  }
  return imap.withConnection(async (client) => {
    const mailboxes = await client.list();
    const paths = new Set(mailboxes.map((m) => m.path));
    assertFolderExists(paths, sourceFolder);
    for (const lbl of labels) {
      assertFolderExists(paths, lbl);
    }
    if (destinationFolder) {
      assertFolderExists(paths, destinationFolder);
    }

    const range = uids.join(',');
    const labeled: Array<{ folder: string; copied: number; success: boolean }> = [];

    // Apply labels first (COPY — UIDs stay valid)
    for (const lbl of labels) {
      const before = (await client.status(lbl, { messages: true })).messages ?? 0;
      const lock = await client.getMailboxLock(sourceFolder);
      try {
        await client.messageCopy(range, lbl, { uid: true });
      } finally {
        lock.release();
      }
      const after = (await client.status(lbl, { messages: true })).messages ?? 0;
      const copied = after - before;
      labeled.push({ folder: lbl, copied, success: copied === uids.length });
    }

    // Move last (MOVE invalidates source UIDs)
    let movedResult: { destination: string; moved: number; success: boolean } | undefined;
    let failedUids: number[] | undefined;
    if (destinationFolder) {
      const before = (await client.status(sourceFolder, { messages: true })).messages ?? 0;
      const lock = await client.getMailboxLock(sourceFolder);
      try {
        await client.messageMove(range, destinationFolder, { uid: true });
      } finally {
        lock.release();
      }
      const after = (await client.status(sourceFolder, { messages: true })).messages ?? 0;
      const moved = before - after;
      movedResult = { destination: destinationFolder, moved, success: moved === uids.length };

      if (moved < uids.length) {
        const checkLock = await client.getMailboxLock(sourceFolder);
        try {
          const result = await client.search({ uid: range }, { uid: true });
          failedUids = result === false ? [] : result;
        } finally {
          checkLock.release();
        }
      }
    }

    const allLabeledOk = labeled.every((l) => l.success);
    const moveOk = movedResult ? movedResult.success : true;
    return {
      success: allLabeledOk && moveOk,
      requested: uids.length,
      labeled,
      ...(movedResult && { moved: movedResult }),
      ...(failedUids && { failedUids }),
    };
  });
}
