import { describe, it, expect, vi } from 'vitest';
import { getMessagesHandler, readMessageHandler, searchMessagesHandler } from '../../src/tools/messages.js';

const mockImapClient = {
  getMessages: vi.fn().mockResolvedValue([
    { uid: 1, from: 'alice@test.com', to: ['bob@test.com'], subject: 'Hello', date: '2026-03-22T10:00:00Z', flags: ['\\Seen'], hasAttachments: false },
  ]),
  readMessage: vi.fn().mockResolvedValue({
    uid: 1, from: 'alice@test.com', to: ['bob@test.com'], cc: [], subject: 'Hello', date: '2026-03-22T10:00:00Z',
    flags: ['\\Seen'], hasAttachments: false, textBody: 'Hi Bob!', htmlBody: '', attachments: [],
  }),
  searchMessages: vi.fn().mockResolvedValue([1, 2, 3]),
  fetchMessagesByUid: vi.fn().mockResolvedValue([
    { uid: 1, from: 'alice@test.com', to: ['bob@test.com'], subject: 'Hello', date: '2026-03-22T10:00:00Z', flags: [], hasAttachments: false },
  ]),
};

describe('message tools', () => {
  it('getMessagesHandler returns message list', async () => {
    const result = await getMessagesHandler(mockImapClient as any, { folder: 'INBOX', limit: 20, offset: 0, unreadOnly: false });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].subject).toBe('Hello');
  });

  it('readMessageHandler returns full message', async () => {
    const result = await readMessageHandler(mockImapClient as any, { folder: 'INBOX', uid: 1 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.textBody).toBe('Hi Bob!');
  });

  it('searchMessagesHandler builds criteria and returns results', async () => {
    const result = await searchMessagesHandler(mockImapClient as any, {
      folder: 'INBOX', from: 'alice@test.com', limit: 10,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
