import type { ImapFlow } from 'imapflow';
import type { ImapClientManager } from './imap-client.js';
import { parseMessageSummary } from './imap-client.js';
import type { FolderStats, MessageSummary, SenderSummary, SnippetMessage, SenderSummaryWithClusters, ChangesSinceResult } from './utils/types.js';
import { clusterSubjects } from './utils/clustering.js';
import { buildCleanSnippet } from './utils/snippet.js';

type SenderAggregate = Map<string, { name: string; count: number; latestDate: string; uids: number[]; subjects: Array<{ uid: number; subject: string }> }>;

/** Aggregate messages in a folder by sender. Caller must NOT hold the mailbox lock. */
async function aggregateSenders(client: ImapFlow, folder: string): Promise<SenderAggregate> {
  const senderMap: SenderAggregate = new Map();
  const lock = await client.getMailboxLock(folder);
  try {
    const searchResult = await client.search({ all: true }, { uid: true });
    const uids: number[] = searchResult === false ? [] : searchResult;
    if (uids.length === 0) return senderMap;

    for await (const msg of client.fetch(uids.join(','), { envelope: true }, { uid: true })) {
      const from = msg.envelope?.from?.[0];
      if (!from) continue;

      const address = (from.address || '').toLowerCase();
      const name = from.name || address;
      const date = msg.envelope?.date?.toISOString() || '';
      const subject = msg.envelope?.subject || '';

      const existing = senderMap.get(address);
      if (existing) {
        existing.count++;
        existing.uids.push(msg.uid);
        existing.subjects.push({ uid: msg.uid, subject });
        if (date > existing.latestDate) existing.latestDate = date;
      } else {
        senderMap.set(address, { name, count: 1, latestDate: date, uids: [msg.uid], subjects: [{ uid: msg.uid, subject }] });
      }
    }
    return senderMap;
  } finally {
    lock.release();
  }
}

export async function getSenderSummary(imap: ImapClientManager, folder: string): Promise<SenderSummary[]> {
  return imap.withConnection(async (client) => {
    const senderMap = await aggregateSenders(client, folder);
    const summaries: SenderSummary[] = [...senderMap.entries()].map(([address, data]) => ({
      sender: data.name,
      address,
      count: data.count,
      latestDate: data.latestDate,
      uids: data.uids,
    }));
    summaries.sort((a, b) => b.count - a.count);
    return summaries;
  });
}

export async function getInboxDigest(imap: ImapClientManager, inboxFolder: string, topSendersLimit: number): Promise<{
  folderStats: FolderStats[];
  inboxTotal: number;
  inboxUnread: number;
  topSenders: SenderSummaryWithClusters[];
}> {
  return imap.withConnection(async (client) => {
    const mailboxes = await client.list();
    const folderStats: FolderStats[] = [];
    let inboxTotal = 0;
    let inboxUnread = 0;

    for (const mb of mailboxes) {
      try {
        const status = await client.status(mb.path, { messages: true, unseen: true });
        const total = status.messages ?? 0;
        const unseen = status.unseen ?? 0;
        folderStats.push({ path: mb.path, total, unseen });
        if (mb.path === inboxFolder) {
          inboxTotal = total;
          inboxUnread = unseen;
        }
      } catch {
        folderStats.push({ path: mb.path, total: 0, unseen: 0 });
      }
    }

    let topSenders: SenderSummaryWithClusters[] = [];
    if (inboxTotal > 0) {
      const senderMap = await aggregateSenders(client, inboxFolder);
      topSenders = [...senderMap.entries()]
        .map(([address, data]) => ({
          sender: data.name,
          address,
          count: data.count,
          latestDate: data.latestDate,
          uids: data.uids,
          subjects: data.subjects,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topSendersLimit)
        .map((s) => {
          const clusters = clusterSubjects(s.subjects);
          const { subjects: _drop, ...rest } = s;
          return clusters.length > 0 ? { ...rest, topClusters: clusters } : rest;
        });
    }

    return { folderStats, inboxTotal, inboxUnread, topSenders };
  });
}

export async function getMessagesWithSnippets(
  imap: ImapClientManager,
  folder: string,
  limit: number,
  offset: number,
  unreadOnly: boolean,
  snippetLength: number,
  includeUnsubscribeLinks = false,
): Promise<{ messages: SnippetMessage[]; total: number }> {
  return imap.withConnection(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const mailbox = client.mailbox;
      if (!mailbox || (mailbox as any).exists === 0) return { messages: [], total: 0 };

      const searchResult = await client.search(unreadOnly ? { seen: false } : { all: true }, { uid: true });
      const uids: number[] = searchResult === false ? [] : searchResult;

      const total = uids.length;
      uids.sort((a, b) => b - a);
      const sliced = uids.slice(offset, offset + limit);
      if (sliced.length === 0) return { messages: [], total };

      const messages: SnippetMessage[] = [];
      const range = sliced.join(',');

      for await (const msg of client.fetch(range, {
        envelope: true,
        flags: true,
        bodyStructure: true,
        source: true,
      }, { uid: true })) {
        const summary = parseMessageSummary(msg);
        let snippetData: {
          snippet: string;
          hasUnsubscribe: boolean;
          unsubscribeMailto?: string;
          unsubscribeHttp?: string;
          unsubscribeOneClick: boolean;
        } = {
          snippet: '',
          hasUnsubscribe: false,
          unsubscribeOneClick: false,
        };
        if (msg.source) {
          try {
            snippetData = await buildCleanSnippet(msg.source as Buffer, snippetLength);
          } catch {
            // fall through with empty snippet
          }
        }
        // Unsubscribe URLs can be 500+ char blobs — flags only unless links are requested
        messages.push({
          ...summary,
          snippet: snippetData.snippet,
          ...(snippetData.hasUnsubscribe && { hasUnsubscribe: true }),
          ...(includeUnsubscribeLinks && snippetData.unsubscribeMailto && { unsubscribeMailto: snippetData.unsubscribeMailto }),
          ...(includeUnsubscribeLinks && snippetData.unsubscribeHttp && { unsubscribeHttp: snippetData.unsubscribeHttp }),
          ...(snippetData.unsubscribeOneClick && { unsubscribeOneClick: true }),
        });
      }

      return { messages, total };
    } finally {
      lock.release();
    }
  });
}

export async function getThread(imap: ImapClientManager, folder: string, uid: number): Promise<MessageSummary[]> {
  return imap.withConnection(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const msg = await client.fetchOne(String(uid), {
        uid: true,
        envelope: true,
        headers: ['references', 'in-reply-to', 'message-id'],
      }, { uid: true });

      if (!msg) throw new Error(`Message UID ${uid} not found in folder ${folder}`);

      const subject = msg.envelope?.subject || '';
      const baseSubject = subject.replace(/^(Re|Fwd|Fw):\s*/gi, '').trim();

      if (!baseSubject) return [];

      const searchResult = await client.search({ subject: baseSubject }, { uid: true });
      const threadUids: number[] = searchResult === false ? [] : searchResult;
      if (threadUids.length === 0) return [];

      const messages: MessageSummary[] = [];
      const range = threadUids.join(',');
      for await (const m of client.fetch(range, {
        envelope: true,
        flags: true,
        bodyStructure: true,
      }, { uid: true })) {
        messages.push(parseMessageSummary(m));
      }

      messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      return messages;
    } finally {
      lock.release();
    }
  });
}

export async function getLabelsForMessage(imap: ImapClientManager, folder: string, uid: number): Promise<{ labels: string[]; messageId: string }> {
  return imap.withConnection(async (client) => {
    // 1. Read the target message to get its Message-ID header
    const lock = await client.getMailboxLock(folder);
    let messageId: string;
    try {
      const msg = await client.fetchOne(String(uid), {
        uid: true,
        envelope: true,
      }, { uid: true });
      if (!msg) throw new Error(`Message UID ${uid} not found in folder ${folder}`);
      messageId = msg.envelope?.messageId || '';
      if (!messageId) throw new Error(`Message UID ${uid} has no Message-ID header`);
    } finally {
      lock.release();
    }

    // 2. List all mailbox folders, filter to those under Labels/
    const mailboxes = await client.list();
    const labelFolders = mailboxes.filter(mb => mb.path.startsWith('Labels/'));

    // 3. For each label folder, search by Message-ID header
    const labels: string[] = [];
    for (const lf of labelFolders) {
      const lfLock = await client.getMailboxLock(lf.path);
      try {
        const result = await client.search({ header: { 'message-id': messageId } }, { uid: true });
        const uids: number[] = result === false ? [] : result;
        if (uids.length > 0) {
          labels.push(lf.path);
        }
      } catch {
        // skip folders that can't be searched
      } finally {
        lfLock.release();
      }
    }

    return { labels, messageId };
  });
}

export async function getChangesSince(
  imap: ImapClientManager,
  since: Date,
  folders: string[],
): Promise<ChangesSinceResult> {
  return imap.withConnection(async (client) => {
    const mailboxes = await client.list();
    const known = new Set(mailboxes.map((m) => m.path));
    const byFolder: Record<string, { newMessages: MessageSummary[]; count: number }> = {};
    let totalNew = 0;

    for (const folder of folders) {
      if (!known.has(folder)) {
        byFolder[folder] = { newMessages: [], count: 0 };
        continue;
      }
      const lock = await client.getMailboxLock(folder);
      try {
        // IMAP SINCE has day granularity — fetch then filter to exact timestamp
        const sinceDate = new Date(since);
        sinceDate.setHours(0, 0, 0, 0);
        const searchResult = await client.search({ since: sinceDate }, { uid: true });
        const uids: number[] = searchResult === false ? [] : searchResult;
        if (uids.length === 0) {
          byFolder[folder] = { newMessages: [], count: 0 };
          continue;
        }
        const range = uids.join(',');
        const messages: MessageSummary[] = [];
        for await (const msg of client.fetch(range, {
          envelope: true,
          flags: true,
          bodyStructure: true,
          internalDate: true,
        }, { uid: true })) {
          const internal = (msg as any).internalDate as Date | undefined;
          if (internal && internal.getTime() < since.getTime()) continue;
          messages.push(parseMessageSummary(msg));
        }
        messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        byFolder[folder] = { newMessages: messages, count: messages.length };
        totalNew += messages.length;
      } finally {
        lock.release();
      }
    }

    return { since: since.toISOString(), byFolder, totalNew };
  });
}

export async function getSenderDistribution(
  imap: ImapClientManager,
  excludeFolders: Set<string>,
): Promise<Map<string, { name: string; total: number; byFolder: Record<string, number> }>> {
  return imap.withConnection(async (client) => {
    const mailboxes = await client.list();
    const senders = new Map<string, { name: string; total: number; byFolder: Record<string, number> }>();

    for (const mb of mailboxes) {
      if (excludeFolders.has(mb.path)) continue;
      if (mb.flags && (mb.flags as Set<string>).has('\\Noselect')) continue;
      let lock;
      try {
        lock = await client.getMailboxLock(mb.path);
      } catch {
        continue;
      }
      try {
        const result = await client.search({ all: true }, { uid: true });
        const uids: number[] = result === false ? [] : result;
        if (uids.length === 0) continue;
        const range = uids.join(',');
        for await (const msg of client.fetch(range, { envelope: true }, { uid: true })) {
          const from = msg.envelope?.from?.[0];
          if (!from || !from.address) continue;
          const address = from.address.toLowerCase();
          const name = from.name || address;
          const entry = senders.get(address) || { name, total: 0, byFolder: {} };
          entry.total++;
          entry.byFolder[mb.path] = (entry.byFolder[mb.path] || 0) + 1;
          if (!senders.has(address)) senders.set(address, entry);
        }
      } finally {
        lock.release();
      }
    }

    return senders;
  });
}
