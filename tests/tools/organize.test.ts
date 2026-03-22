import { describe, it, expect, vi } from 'vitest';
import { moveMessageHandler, applyLabelHandler, removeLabelHandler, deleteMessageHandler } from '../../src/tools/organize.js';

const mockImapClient = {
  moveMessage: vi.fn().mockResolvedValue(undefined),
  copyMessage: vi.fn().mockResolvedValue(undefined),
};

describe('organize tools', () => {
  it('moveMessageHandler moves message between folders', async () => {
    const result = await moveMessageHandler(mockImapClient as any, {
      sourceFolder: 'INBOX', uid: 42, destinationFolder: 'Archive',
    });
    expect(mockImapClient.moveMessage).toHaveBeenCalledWith('INBOX', 42, 'Archive');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('applyLabelHandler copies message to label folder', async () => {
    const result = await applyLabelHandler(mockImapClient as any, {
      sourceFolder: 'INBOX', uid: 42, labelFolder: 'Projects/Work',
    });
    expect(mockImapClient.copyMessage).toHaveBeenCalledWith('INBOX', 42, 'Projects/Work');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('removeLabelHandler moves message out of label folder', async () => {
    const result = await removeLabelHandler(mockImapClient as any, {
      labelFolder: 'Projects/Work', uid: 42,
    });
    expect(mockImapClient.moveMessage).toHaveBeenCalledWith('Projects/Work', 42, 'INBOX');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('deleteMessageHandler moves message to Trash', async () => {
    const result = await deleteMessageHandler(mockImapClient as any, {
      folder: 'INBOX', uid: 42,
    });
    expect(mockImapClient.moveMessage).toHaveBeenCalledWith('INBOX', 42, 'Trash');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });
});
