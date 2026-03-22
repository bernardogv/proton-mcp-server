import { describe, it, expect, vi } from 'vitest';
import { sendEmailHandler } from '../../src/tools/send.js';

const mockSmtpClient = {
  sendEmail: vi.fn().mockResolvedValue({ messageId: '<abc@proton.me>' }),
};

describe('send tool', () => {
  it('sends plain text email', async () => {
    const result = await sendEmailHandler(mockSmtpClient as any, {
      to: ['bob@test.com'],
      subject: 'Hello',
      body: 'Hi Bob',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.messageId).toBe('<abc@proton.me>');
  });

  it('sends HTML email with cc and inReplyTo', async () => {
    const result = await sendEmailHandler(mockSmtpClient as any, {
      to: ['bob@test.com'],
      cc: ['carol@test.com'],
      subject: 'Re: Hello',
      body: '<p>Reply</p>',
      isHtml: true,
      inReplyTo: '<original@proton.me>',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });
});
