import nodemailer from 'nodemailer';
import type { BridgeConfig } from './utils/types.js';
import { isLoopbackHost } from './utils/config.js';

interface SendEmailOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  inReplyTo?: string;
  references?: string;
  attachments?: Array<{ filename: string; contentBase64: string; mimeType?: string }>;
}

export class SmtpClient {
  private transporter: nodemailer.Transporter;
  private username: string;

  constructor(config: BridgeConfig) {
    this.username = config.username;
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      auth: {
        user: config.username,
        pass: config.password,
      },
      tls: {
        // Proton Bridge uses a self-signed cert; only skip verification for local Bridge
        rejectUnauthorized: !isLoopbackHost(config.smtp.host),
      },
    });
  }

  async sendEmail(options: SendEmailOptions): Promise<{ messageId: string }> {
    const mailOptions: nodemailer.SendMailOptions = {
      from: this.username,
      to: options.to.join(', '),
      subject: options.subject,
      ...(options.cc && { cc: options.cc.join(', ') }),
      ...(options.bcc && { bcc: options.bcc.join(', ') }),
      ...(options.isHtml ? { html: options.body } : { text: options.body }),
      ...(options.inReplyTo && {
        inReplyTo: options.inReplyTo,
        references: options.references || options.inReplyTo,
      }),
      ...(options.attachments && options.attachments.length > 0 && {
        attachments: options.attachments.map(att => ({
          filename: att.filename,
          content: Buffer.from(att.contentBase64, 'base64'),
          contentType: att.mimeType || 'application/octet-stream',
        })),
      }),
    };

    const result = await this.transporter.sendMail(mailOptions);
    return { messageId: result.messageId };
  }

  getUsername(): string {
    return this.username;
  }

  close(): void {
    this.transporter.close();
  }
}
