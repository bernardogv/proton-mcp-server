import { describe, it, expect, vi } from 'vitest';
import { getAttachmentHandler } from '../../src/tools/attachments.js';

const mockImapClient = {
  getAttachment: vi.fn().mockResolvedValue({
    content: Buffer.from('file content'),
    filename: 'report.pdf',
    mimeType: 'application/pdf',
  }),
};

describe('attachment tool', () => {
  it('returns base64-encoded attachment', async () => {
    const result = await getAttachmentHandler(mockImapClient as any, {
      folder: 'INBOX', uid: 1, attachmentPartId: '0',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.filename).toBe('report.pdf');
    expect(parsed.mimeType).toBe('application/pdf');
    expect(parsed.contentBase64).toBe(Buffer.from('file content').toString('base64'));
  });
});
