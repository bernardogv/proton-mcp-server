import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImapClientManager } from '../src/imap-client.js';
import type { BridgeConfig } from '../src/utils/types.js';

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn(() => ({
    connect: vi.fn(),
    logout: vi.fn(),
    list: vi.fn().mockResolvedValue([
      { name: 'INBOX', path: 'INBOX', delimiter: '/', flags: new Set(['\\HasNoChildren']), specialUse: '\\Inbox' },
      { name: 'Sent', path: 'Sent', delimiter: '/', flags: new Set([]), specialUse: '\\Sent' },
    ]),
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    fetch: vi.fn(),
    fetchOne: vi.fn(),
    search: vi.fn().mockResolvedValue([1, 2, 3]),
    messageMove: vi.fn().mockResolvedValue(true),
    messageCopy: vi.fn().mockResolvedValue({ uidMap: new Map() }),
    messageFlagsAdd: vi.fn().mockResolvedValue(true),
    messageFlagsRemove: vi.fn().mockResolvedValue(true),
    mailboxCreate: vi.fn().mockResolvedValue({ path: 'TestFolder' }),
    mailbox: { exists: 5 },
    usable: true,
  })),
}));

const testConfig: BridgeConfig = {
  imap: { host: '127.0.0.1', port: 1143 },
  smtp: { host: '127.0.0.1', port: 1025 },
  username: 'test@proton.me',
  password: 'test-pass',
};

describe('ImapClientManager', () => {
  let manager: ImapClientManager;

  beforeEach(() => {
    manager = new ImapClientManager(testConfig);
  });

  it('creates an ImapFlow client with correct config', async () => {
    const { ImapFlow } = await import('imapflow');
    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1143,
        secure: false,
        auth: { user: 'test@proton.me', pass: 'test-pass' },
      })
    );
  });

  it('connects and disconnects', async () => {
    await manager.connect();
    await manager.disconnect();
  });

  it('lists folders', async () => {
    await manager.connect();
    const folders = await manager.listFolders();
    expect(folders).toHaveLength(2);
    expect(folders[0].name).toBe('INBOX');
  });

  it('searches messages', async () => {
    await manager.connect();
    const uids = await manager.searchMessages('INBOX', { seen: false });
    expect(uids).toEqual([1, 2, 3]);
  });
});
