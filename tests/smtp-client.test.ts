import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SmtpClient } from '../src/smtp-client.js';
import type { BridgeConfig } from '../src/utils/types.js';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: '<test-id@proton.me>' }),
      verify: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    })),
  },
}));

const testConfig: BridgeConfig = {
  imap: { host: '127.0.0.1', port: 1143 },
  smtp: { host: '127.0.0.1', port: 1025 },
  username: 'test@proton.me',
  password: 'test-pass',
};

describe('SmtpClient', () => {
  let smtp: SmtpClient;

  beforeEach(() => {
    smtp = new SmtpClient(testConfig);
  });

  it('sends an email and returns message ID', async () => {
    const result = await smtp.sendEmail({
      to: ['recipient@example.com'],
      subject: 'Test Subject',
      body: 'Hello world',
    });
    expect(result.messageId).toBe('<test-id@proton.me>');
  });

  it('sends email with cc and bcc', async () => {
    const result = await smtp.sendEmail({
      to: ['to@example.com'],
      cc: ['cc@example.com'],
      bcc: ['bcc@example.com'],
      subject: 'CC Test',
      body: '<h1>HTML</h1>',
      isHtml: true,
    });
    expect(result.messageId).toBeDefined();
  });
});
