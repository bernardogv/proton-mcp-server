import { describe, it, expect, vi } from 'vitest';
import { listFoldersHandler, createFolderHandler } from '../../src/tools/folders.js';

const mockImapClient = {
  listFolders: vi.fn().mockResolvedValue([
    { name: 'INBOX', path: 'INBOX', delimiter: '/', flags: ['\\HasNoChildren'], specialUse: '\\Inbox' },
    { name: 'Sent', path: 'Sent', delimiter: '/', flags: [], specialUse: '\\Sent' },
  ]),
  createFolder: vi.fn().mockResolvedValue('Projects/Work'),
};

describe('folder tools', () => {
  it('listFoldersHandler returns formatted folder list', async () => {
    const result = await listFoldersHandler(mockImapClient as any);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('INBOX');
  });

  it('createFolderHandler creates a folder and returns path', async () => {
    const result = await createFolderHandler(mockImapClient as any, { name: 'Projects/Work' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.path).toBe('Projects/Work');
    expect(parsed.success).toBe(true);
  });
});
