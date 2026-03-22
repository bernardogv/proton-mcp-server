import { ImapFlow } from 'imapflow';
import type { BridgeConfig, FolderInfo, MessageSummary, MessageFull, AttachmentMeta } from './utils/types.js';

export class ImapClientManager {
  private client: ImapFlow;

  constructor(config: BridgeConfig) {
    this.client = new ImapFlow({
      host: config.imap.host,
      port: config.imap.port,
      secure: false,
      auth: {
        user: config.username,
        pass: config.password,
      },
      tls: {
        rejectUnauthorized: false,
      },
      logger: false,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.logout();
  }

  async listFolders(): Promise<FolderInfo[]> {
    const mailboxes = await this.client.list();
    return mailboxes.map((mb) => ({
      name: mb.name,
      path: mb.path,
      delimiter: mb.delimiter || '/',
      flags: Array.from(mb.flags || []),
      specialUse: mb.specialUse,
    }));
  }

  async getMessages(folder: string, limit: number, offset: number, unreadOnly: boolean): Promise<MessageSummary[]> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const mailbox = this.client.mailbox;
      if (!mailbox || mailbox.exists === 0) return [];

      let uids: number[];
      if (unreadOnly) {
        const searchResult = await this.client.search({ seen: false }, { uid: true });
        uids = searchResult === false ? [] : searchResult;
      } else {
        const searchResult = await this.client.search({ all: true }, { uid: true });
        uids = searchResult === false ? [] : searchResult;
      }

      uids.sort((a, b) => b - a);
      const sliced = uids.slice(offset, offset + limit);
      if (sliced.length === 0) return [];

      const messages: MessageSummary[] = [];
      const range = sliced.join(',');

      for await (const msg of this.client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
      })) {
        messages.push({
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
          hasAttachments: hasAttachmentParts(msg.bodyStructure),
        });
      }

      return messages;
    } finally {
      lock.release();
    }
  }

  async readMessage(folder: string, uid: number): Promise<MessageFull> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const msg = await this.client.fetchOne(String(uid), {
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
  }

  async searchMessages(folder: string, criteria: Record<string, unknown>): Promise<number[]> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const result = await this.client.search(criteria, { uid: true });
      return result === false ? [] : result;
    } finally {
      lock.release();
    }
  }

  async moveMessage(sourceFolder: string, uid: number, destFolder: string): Promise<void> {
    const lock = await this.client.getMailboxLock(sourceFolder);
    try {
      await this.client.messageMove(String(uid), destFolder, { uid: true });
    } finally {
      lock.release();
    }
  }

  async copyMessage(sourceFolder: string, uid: number, destFolder: string): Promise<void> {
    const lock = await this.client.getMailboxLock(sourceFolder);
    try {
      await this.client.messageCopy(String(uid), destFolder, { uid: true });
    } finally {
      lock.release();
    }
  }

  async addFlags(folder: string, uid: number, flags: string[]): Promise<void> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      await this.client.messageFlagsAdd(String(uid), flags, { uid: true });
    } finally {
      lock.release();
    }
  }

  async removeFlags(folder: string, uid: number, flags: string[]): Promise<void> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      await this.client.messageFlagsRemove(String(uid), flags, { uid: true });
    } finally {
      lock.release();
    }
  }

  async fetchMessagesByUid(folder: string, uids: number[]): Promise<MessageSummary[]> {
    if (uids.length === 0) return [];
    const lock = await this.client.getMailboxLock(folder);
    try {
      const messages: MessageSummary[] = [];
      const range = uids.join(',');
      for await (const msg of this.client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
      })) {
        messages.push({
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
          hasAttachments: hasAttachmentParts(msg.bodyStructure),
        });
      }
      return messages;
    } finally {
      lock.release();
    }
  }

  async createFolder(name: string): Promise<string> {
    const result = await this.client.mailboxCreate(name);
    return result.path;
  }

  async getAttachment(folder: string, uid: number, partId: string): Promise<{ content: Buffer; filename: string; mimeType: string }> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const msg = await this.client.fetchOne(String(uid), {
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
  }
}

function hasAttachmentParts(structure: unknown): boolean {
  if (!structure || typeof structure !== 'object') return false;
  const s = structure as Record<string, unknown>;
  if (s.disposition === 'attachment') return true;
  if (Array.isArray(s.childNodes)) {
    return s.childNodes.some((child: unknown) => hasAttachmentParts(child));
  }
  return false;
}
