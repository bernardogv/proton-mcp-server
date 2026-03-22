import nodemailer from 'nodemailer';
import type { BridgeConfig } from './utils/types.js';

interface SendEmailOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  inReplyTo?: string;
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
        rejectUnauthorized: false,
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
        references: options.inReplyTo,
      }),
    };

    const result = await this.transporter.sendMail(mailOptions);
    return { messageId: result.messageId };
  }

  close(): void {
    this.transporter.close();
  }
}
