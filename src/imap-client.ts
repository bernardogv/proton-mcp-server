import { ImapFlow } from 'imapflow';
import type { BridgeConfig, FolderInfo, FolderStats, MessageSummary, MessageFull, AttachmentSummary } from './utils/types.js';
import { assertFolderExists } from './utils/folder-validation.js';
import { isLoopbackHost } from './utils/config.js';

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
        // Proton Bridge uses a self-signed cert; only skip verification for local Bridge
        rejectUnauthorized: !isLoopbackHost(this.config.imap.host),
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

  /** Assert that all named folder paths exist; throws if any are missing */
  async assertFoldersExist(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    return this.withConnection(async (client) => {
      const mailboxes = await client.list();
      const known = new Set(mailboxes.map((m) => m.path));
      for (const p of paths) {
        assertFolderExists(known, p);
      }
    });
  }

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

        const searchResult = await client.search(unreadOnly ? { seen: false } : { all: true }, { uid: true });
        const uids: number[] = searchResult === false ? [] : searchResult;

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
          messages.push(parseMessageSummary(msg));
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

        // Build references string from parsed headers
        let referencesStr = '';
        if (parsed.references) {
          referencesStr = Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references;
        }

        return {
          uid: msg.uid,
          from: parsed.from?.text || 'unknown',
          to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(t => t.text) : [parsed.to.text]) : [],
          cc: parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc.map(c => c.text) : [parsed.cc.text]) : [],
          messageId: parsed.messageId || '',
          inReplyTo: (parsed.inReplyTo as string) || '',
          references: referencesStr,
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
      const mailboxes = await client.list();
      const paths = new Set(mailboxes.map((m) => m.path));
      assertFolderExists(paths, sourceFolder);
      assertFolderExists(paths, destFolder);
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
      const mailboxes = await client.list();
      const paths = new Set(mailboxes.map((m) => m.path));
      assertFolderExists(paths, sourceFolder);
      assertFolderExists(paths, destFolder);
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
          messages.push(parseMessageSummary(msg));
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

  /** Fetch and parse the message source once, returning all attachments */
  async getAttachments(folder: string, uid: number): Promise<Array<{ partId: string; content: Buffer; filename: string; mimeType: string }>> {
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
        return (parsed.attachments || []).map((att, i) => ({
          partId: att.contentId || String(i),
          content: att.content,
          filename: att.filename || 'unnamed',
          mimeType: att.contentType || 'application/octet-stream',
        }));
      } finally {
        lock.release();
      }
    });
  }

  async getAttachment(folder: string, uid: number, partId: string): Promise<{ content: Buffer; filename: string; mimeType: string }> {
    const attachments = await this.getAttachments(folder, uid);
    const attachment = attachments.find((att) => att.partId === partId);
    if (!attachment) {
      throw new Error(`Attachment with partId "${partId}" not found`);
    }
    return attachment;
  }
}

/** Convert an imapflow fetch result into a MessageSummary */
export function parseMessageSummary(msg: any): MessageSummary {
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
