import { ImapFlow } from 'imapflow';
import type { BridgeConfig, FolderInfo, FolderStats, MessageSummary, MessageFull, AttachmentMeta, AttachmentSummary, SenderSummary } from './utils/types.js';

export class ImapClientManager {
  private config: BridgeConfig;

  constructor(config: BridgeConfig) {
    this.config = config;
  }

  private createClient(): ImapFlow {
    return new ImapFlow({
      host: this.config.imap.host,
      port: this.config.imap.port,
      secure: false,
      auth: {
        user: this.config.username,
        pass: this.config.password,
      },
      tls: {
        rejectUnauthorized: false,
      },
      logger: false,
    });
  }

  /** Run a callback with a fresh IMAP connection that auto-closes */
  async withConnection<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = this.createClient();
    try {
      await client.connect();
      try {
        return await fn(client);
      } finally {
        try { await client.logout(); } catch { /* ignore logout errors */ }
      }
    } catch (err) {
      // Sanitize error messages to prevent credential leakage
      const message = err instanceof Error ? err.message : String(err);
      const sanitized = message
        .replace(new RegExp(this.config.password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***')
        .replace(new RegExp(this.config.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');
      throw new Error(sanitized);
    }
  }

  // Keep connect/disconnect for backward compat with tests
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async listFolders(): Promise<FolderInfo[]> {
    return this.withConnection(async (client) => {
      const mailboxes = await client.list();
      return mailboxes.map((mb) => ({
        name: mb.name,
        path: mb.path,
        delimiter: mb.delimiter || '/',
        flags: Array.from(mb.flags || []),
        specialUse: mb.specialUse,
      }));
    });
  }

  async getMessages(folder: string, limit: number, offset: number, unreadOnly: boolean): Promise<{ messages: MessageSummary[]; total: number }> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const mailbox = client.mailbox;
        if (!mailbox || mailbox.exists === 0) return { messages: [], total: 0 };

        let uids: number[];
        if (unreadOnly) {
          const searchResult = await client.search({ seen: false }, { uid: true });
          uids = searchResult === false ? [] : searchResult;
        } else {
          const searchResult = await client.search({ all: true }, { uid: true });
          uids = searchResult === false ? [] : searchResult;
        }

        const total = uids.length;
        uids.sort((a, b) => b - a);
        const sliced = uids.slice(offset, offset + limit);
        if (sliced.length === 0) return { messages: [], total };

        const messages: MessageSummary[] = [];
        const range = sliced.join(',');

        for await (const msg of client.fetch(range, {
          envelope: true,
          flags: true,
          bodyStructure: true,
        }, { uid: true })) {
          messages.push(this.parseMessageSummary(msg));
        }

        return { messages, total };
      } finally {
        lock.release();
      }
    });
  }

  async readMessage(folder: string, uid: number): Promise<MessageFull> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const msg = await client.fetchOne(String(uid), {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          source: true,
        }, { uid: true });

        if (!msg || !msg.source) {
          throw new Error(`Message UID ${uid} not found in folder ${folder}`);
        }

        const { simpleParser } = await import('mailparser');
        const parsed = await simpleParser(msg.source);

        return {
          uid: msg.uid,
          from: parsed.from?.text || 'unknown',
          to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(t => t.text) : [parsed.to.text]) : [],
          cc: parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc.map(c => c.text) : [parsed.cc.text]) : [],
          subject: parsed.subject || '(no subject)',
          date: parsed.date?.toISOString() || '',
          flags: Array.from(msg.flags || []),
          hasAttachments: (parsed.attachments?.length || 0) > 0,
          textBody: parsed.text || '',
          htmlBody: parsed.html || '',
          attachments: (parsed.attachments || []).map((att, i) => ({
            partId: att.contentId || String(i),
            filename: att.filename || 'unnamed',
            mimeType: att.contentType || 'application/octet-stream',
            size: att.size || 0,
          })),
        };
      } finally {
        lock.release();
      }
    });
  }

  async searchMessages(folder: string, criteria: Record<string, unknown>): Promise<number[]> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const result = await client.search(criteria, { uid: true });
        return result === false ? [] : result;
      } finally {
        lock.release();
      }
    });
  }

  async moveMessage(sourceFolder: string, uid: number, destFolder: string): Promise<void> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(sourceFolder);
      try {
        await client.messageMove(String(uid), destFolder, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async copyMessage(sourceFolder: string, uid: number, destFolder: string): Promise<void> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(sourceFolder);
      try {
        await client.messageCopy(String(uid), destFolder, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async addFlags(folder: string, uid: number, flags: string[]): Promise<void> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageFlagsAdd(String(uid), flags, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async removeFlags(folder: string, uid: number, flags: string[]): Promise<void> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        await client.messageFlagsRemove(String(uid), flags, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async fetchMessagesByUid(folder: string, uids: number[]): Promise<MessageSummary[]> {
    if (uids.length === 0) return [];
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const messages: MessageSummary[] = [];
        const range = uids.join(',');
        for await (const msg of client.fetch(range, {
          envelope: true,
          flags: true,
          bodyStructure: true,
        }, { uid: true })) {
          messages.push(this.parseMessageSummary(msg));
        }
        return messages;
      } finally {
        lock.release();
      }
    });
  }

  async createFolder(name: string): Promise<string> {
    return this.withConnection(async (client) => {
      const result = await client.mailboxCreate(name);
      return result.path;
    });
  }

  async deleteFolder(path: string): Promise<void> {
    return this.withConnection(async (client) => {
      await client.mailboxDelete(path);
    });
  }

  async renameFolder(oldPath: string, newPath: string): Promise<string> {
    return this.withConnection(async (client) => {
      const result = await client.mailboxRename(oldPath, newPath);
      return result.newPath || newPath;
    });
  }

  async getFolderStats(): Promise<FolderStats[]> {
    return this.withConnection(async (client) => {
      const mailboxes = await client.list();
      const stats: FolderStats[] = [];
      for (const mb of mailboxes) {
        try {
          const status = await client.status(mb.path, { messages: true, unseen: true });
          stats.push({
            path: mb.path,
            total: status.messages ?? 0,
            unseen: status.unseen ?? 0,
          });
        } catch {
          stats.push({ path: mb.path, total: 0, unseen: 0 });
        }
      }
      return stats;
    });
  }

  async batchMoveMessages(sourceFolder: string, uids: number[], destFolder: string): Promise<{ moved: number }> {
    if (uids.length === 0) return { moved: 0 };
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(sourceFolder);
      try {
        const range = uids.join(',');
        await client.messageMove(range, destFolder, { uid: true });
        return { moved: uids.length };
      } finally {
        lock.release();
      }
    });
  }

  async batchCopyMessages(sourceFolder: string, uids: number[], destFolder: string): Promise<{ copied: number }> {
    if (uids.length === 0) return { copied: 0 };
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(sourceFolder);
      try {
        const range = uids.join(',');
        await client.messageCopy(range, destFolder, { uid: true });
        return { copied: uids.length };
      } finally {
        lock.release();
      }
    });
  }

  async batchAddFlags(folder: string, uids: number[], flags: string[]): Promise<{ updated: number }> {
    if (uids.length === 0) return { updated: 0 };
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const range = uids.join(',');
        await client.messageFlagsAdd(range, flags, { uid: true });
        return { updated: uids.length };
      } finally {
        lock.release();
      }
    });
  }

  async batchRemoveFlags(folder: string, uids: number[], flags: string[]): Promise<{ updated: number }> {
    if (uids.length === 0) return { updated: 0 };
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const range = uids.join(',');
        await client.messageFlagsRemove(range, flags, { uid: true });
        return { updated: uids.length };
      } finally {
        lock.release();
      }
    });
  }

  async crossFolderBatchMove(
    items: Array<{ uid: number; sourceFolder: string }>,
    destFolder: string
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
      const result = await this.batchMoveMessages(folder, uids, destFolder);
      byFolder[folder] = result.moved;
      totalMoved += result.moved;
    }

    return { moved: totalMoved, byFolder };
  }

  async getSenderSummary(folder: string): Promise<SenderSummary[]> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const searchResult = await client.search({ all: true }, { uid: true });
        const uids: number[] = searchResult === false ? [] : searchResult;
        if (uids.length === 0) return [];

        const range = uids.join(',');
        const senderMap = new Map<string, { name: string; count: number; latestDate: string; uids: number[] }>();

        for await (const msg of client.fetch(range, { envelope: true }, { uid: true })) {
          const from = msg.envelope?.from?.[0];
          if (!from) continue;

          const address = (from.address || '').toLowerCase();
          const name = from.name || address;
          const date = msg.envelope?.date?.toISOString() || '';

          const existing = senderMap.get(address);
          if (existing) {
            existing.count++;
            existing.uids.push(msg.uid);
            if (date > existing.latestDate) existing.latestDate = date;
          } else {
            senderMap.set(address, { name, count: 1, latestDate: date, uids: [msg.uid] });
          }
        }

        const summaries: SenderSummary[] = [];
        for (const [address, data] of senderMap) {
          summaries.push({
            sender: data.name,
            address,
            count: data.count,
            latestDate: data.latestDate,
            uids: data.uids,
          });
        }

        summaries.sort((a, b) => b.count - a.count);
        return summaries;
      } finally {
        lock.release();
      }
    });
  }

  async getFolderMessageCount(folder: string): Promise<{ total: number; unseen: number }> {
    return this.withConnection(async (client) => {
      const status = await client.status(folder, { messages: true, unseen: true });
      return { total: status.messages ?? 0, unseen: status.unseen ?? 0 };
    });
  }

  async getUnreadCount(folder: string): Promise<number> {
    return this.withConnection(async (client) => {
      const status = await client.status(folder, { unseen: true });
      return status.unseen ?? 0;
    });
  }

  async getInboxDigest(inboxFolder: string, topSendersLimit: number): Promise<{
    folderStats: FolderStats[];
    inboxTotal: number;
    inboxUnread: number;
    topSenders: SenderSummary[];
  }> {
    return this.withConnection(async (client) => {
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

      let topSenders: SenderSummary[] = [];
      if (inboxTotal > 0) {
        const lock = await client.getMailboxLock(inboxFolder);
        try {
          const searchResult = await client.search({ all: true }, { uid: true });
          const uids: number[] = searchResult === false ? [] : searchResult;
          if (uids.length > 0) {
            const range = uids.join(',');
            const senderMap = new Map<string, { name: string; count: number; latestDate: string; uids: number[] }>();
            for await (const msg of client.fetch(range, { envelope: true }, { uid: true })) {
              const from = msg.envelope?.from?.[0];
              if (!from) continue;
              const address = (from.address || '').toLowerCase();
              const name = from.name || address;
              const date = msg.envelope?.date?.toISOString() || '';
              const existing = senderMap.get(address);
              if (existing) {
                existing.count++;
                existing.uids.push(msg.uid);
                if (date > existing.latestDate) existing.latestDate = date;
              } else {
                senderMap.set(address, { name, count: 1, latestDate: date, uids: [msg.uid] });
              }
            }
            const sorted = [...senderMap.entries()]
              .map(([address, data]) => ({ sender: data.name, address, count: data.count, latestDate: data.latestDate, uids: data.uids }))
              .sort((a, b) => b.count - a.count);
            topSenders = sorted.slice(0, topSendersLimit);
          }
        } finally {
          lock.release();
        }
      }

      return { folderStats, inboxTotal, inboxUnread, topSenders };
    });
  }

  async getMessagesWithSnippets(folder: string, limit: number, offset: number, unreadOnly: boolean, snippetLength: number): Promise<{ messages: Array<MessageSummary & { snippet: string }>; total: number }> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const mailbox = client.mailbox;
        if (!mailbox || mailbox.exists === 0) return { messages: [], total: 0 };

        let uids: number[];
        if (unreadOnly) {
          const searchResult = await client.search({ seen: false }, { uid: true });
          uids = searchResult === false ? [] : searchResult;
        } else {
          const searchResult = await client.search({ all: true }, { uid: true });
          uids = searchResult === false ? [] : searchResult;
        }

        const total = uids.length;
        uids.sort((a, b) => b - a);
        const sliced = uids.slice(offset, offset + limit);
        if (sliced.length === 0) return { messages: [], total };

        const messages: Array<MessageSummary & { snippet: string }> = [];
        const range = sliced.join(',');

        for await (const msg of client.fetch(range, {
          envelope: true,
          flags: true,
          bodyStructure: true,
          bodyParts: ['1'],
        }, { uid: true })) {
          const summary = this.parseMessageSummary(msg);
          let snippet = '';
          const bodyPart = msg.bodyParts?.get('1');
          if (bodyPart) {
            const text = bodyPart.toString('utf-8');
            snippet = text.replace(/[\r\n\t]+/g, ' ').trim().slice(0, snippetLength);
          }
          messages.push({ ...summary, snippet });
        }

        return { messages, total };
      } finally {
        lock.release();
      }
    });
  }

  async getThread(folder: string, uid: number): Promise<MessageSummary[]> {
    return this.withConnection(async (client) => {
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
          messages.push(this.parseMessageSummary(m));
        }

        messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        return messages;
      } finally {
        lock.release();
      }
    });
  }

  async markAllRead(folder: string): Promise<{ updated: number }> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const searchResult = await client.search({ seen: false }, { uid: true });
        const uids: number[] = searchResult === false ? [] : searchResult;
        if (uids.length === 0) return { updated: 0 };
        const range = uids.join(',');
        await client.messageFlagsAdd(range, ['\\Seen'], { uid: true });
        return { updated: uids.length };
      } finally {
        lock.release();
      }
    });
  }

  async moveBySender(folder: string, senderAddress: string, destFolder: string): Promise<{ moved: number; uids: number[] }> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const searchResult = await client.search({ from: senderAddress }, { uid: true });
        const uids: number[] = searchResult === false ? [] : searchResult;
        if (uids.length === 0) return { moved: 0, uids: [] };
        const range = uids.join(',');
        await client.messageMove(range, destFolder, { uid: true });
        return { moved: uids.length, uids };
      } finally {
        lock.release();
      }
    });
  }

  async moveBySearch(folder: string, criteria: Record<string, unknown>, destFolder: string): Promise<{ moved: number; uids: number[] }> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const searchResult = await client.search(criteria, { uid: true });
        const uids: number[] = searchResult === false ? [] : searchResult;
        if (uids.length === 0) return { moved: 0, uids: [] };
        const range = uids.join(',');
        await client.messageMove(range, destFolder, { uid: true });
        return { moved: uids.length, uids };
      } finally {
        lock.release();
      }
    });
  }

  async getAttachment(folder: string, uid: number, partId: string): Promise<{ content: Buffer; filename: string; mimeType: string }> {
    return this.withConnection(async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const msg = await client.fetchOne(String(uid), {
          uid: true,
          source: true,
        }, { uid: true });

        if (!msg || !msg.source) {
          throw new Error(`Message UID ${uid} not found in folder ${folder}`);
        }

        const { simpleParser } = await import('mailparser');
        const parsed = await simpleParser(msg.source);
        const attachment = parsed.attachments?.find(
          (att, i) => (att.contentId || String(i)) === partId
        );

        if (!attachment) {
          throw new Error(`Attachment with partId "${partId}" not found`);
        }

        return {
          content: attachment.content,
          filename: attachment.filename || 'unnamed',
          mimeType: attachment.contentType || 'application/octet-stream',
        };
      } finally {
        lock.release();
      }
    });
  }

  async createDraft(params: {
    to: string[];
    cc?: string[];
    subject: string;
    body: string;
    isHtml?: boolean;
    draftsFolder?: string;
  }): Promise<{ uid: number }> {
    return this.withConnection(async (client) => {
      const folder = params.draftsFolder || 'Drafts';
      const contentType = params.isHtml ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';

      const headers: string[] = [
        `From: ${this.config.username}`,
        `To: ${params.to.join(', ')}`,
      ];
      if (params.cc && params.cc.length > 0) {
        headers.push(`Cc: ${params.cc.join(', ')}`);
      }
      headers.push(
        `Subject: ${params.subject}`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        `Content-Type: ${contentType}; charset=utf-8`,
      );

      const raw = headers.join('\r\n') + '\r\n\r\n' + params.body;
      const result = await client.append(folder, Buffer.from(raw, 'utf-8'), ['\\Draft', '\\Seen']);
      if (result === false) throw new Error('Failed to create draft: server returned no response');
      return { uid: result.uid ?? 0 };
    });
  }

  private parseMessageSummary(msg: any): MessageSummary {
    const attachments = extractAttachmentInfo(msg.bodyStructure);
    return {
      uid: msg.uid,
      from: msg.envelope?.from?.[0]
        ? `${msg.envelope.from[0].name || ''} <${msg.envelope.from[0].address || ''}>`
        : 'unknown',
      to: (msg.envelope?.to || []).map(
        (t: { name?: string; address?: string }) => `${t.name || ''} <${t.address || ''}>`
      ),
      subject: msg.envelope?.subject || '(no subject)',
      date: msg.envelope?.date?.toISOString() || '',
      flags: Array.from(msg.flags || []),
      hasAttachments: attachments.length > 0,
      ...(attachments.length > 0 && { attachmentInfo: attachments }),
    };
  }
}

function extractAttachmentInfo(structure: unknown): AttachmentSummary[] {
  const attachments: AttachmentSummary[] = [];
  collectAttachments(structure, attachments);
  return attachments;
}

function collectAttachments(structure: unknown, result: AttachmentSummary[]): void {
  if (!structure || typeof structure !== 'object') return;
  const s = structure as Record<string, unknown>;
  if (s.disposition === 'attachment') {
    const params = (s.dispositionParameters || {}) as Record<string, string>;
    result.push({
      filename: params.filename || (s as any).description || 'unnamed',
      mimeType: s.type ? `${s.type}/${s.subtype || 'octet-stream'}` : 'application/octet-stream',
      size: typeof s.size === 'number' ? s.size : 0,
    });
  }
  if (Array.isArray(s.childNodes)) {
    for (const child of s.childNodes) {
      collectAttachments(child, result);
    }
  }
}
