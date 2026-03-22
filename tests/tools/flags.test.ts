import { describe, it, expect, vi } from 'vitest';
import { markReadHandler, markUnreadHandler, starMessageHandler, unstarMessageHandler } from '../../src/tools/flags.js';

const mockImapClient = {
  addFlags: vi.fn().mockResolvedValue(undefined),
  removeFlags: vi.fn().mockResolvedValue(undefined),
};

describe('flag tools', () => {
  it('markReadHandler adds \\Seen flag', async () => {
    const result = await markReadHandler(mockImapClient as any, { folder: 'INBOX', uid: 1 });
    expect(mockImapClient.addFlags).toHaveBeenCalledWith('INBOX', 1, ['\\Seen']);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('markUnreadHandler removes \\Seen flag', async () => {
    const result = await markUnreadHandler(mockImapClient as any, { folder: 'INBOX', uid: 1 });
    expect(mockImapClient.removeFlags).toHaveBeenCalledWith('INBOX', 1, ['\\Seen']);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('starMessageHandler adds \\Flagged flag', async () => {
    const result = await starMessageHandler(mockImapClient as any, { folder: 'INBOX', uid: 1 });
    expect(mockImapClient.addFlags).toHaveBeenCalledWith('INBOX', 1, ['\\Flagged']);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('unstarMessageHandler removes \\Flagged flag', async () => {
    const result = await unstarMessageHandler(mockImapClient as any, { folder: 'INBOX', uid: 1 });
    expect(mockImapClient.removeFlags).toHaveBeenCalledWith('INBOX', 1, ['\\Flagged']);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });
});
