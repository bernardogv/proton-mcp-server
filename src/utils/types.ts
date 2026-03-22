export interface BridgeConfig {
  imap: {
    host: string;
    port: number;
  };
  smtp: {
    host: string;
    port: number;
  };
  username: string;
  password: string;
}

export interface FolderInfo {
  name: string;
  path: string;
  delimiter: string;
  flags: string[];
  specialUse?: string;
}

export interface MessageSummary {
  uid: number;
  from: string;
  to: string[];
  subject: string;
  date: string;
  flags: string[];
  hasAttachments: boolean;
}

export interface MessageFull extends MessageSummary {
  cc: string[];
  textBody: string;
  htmlBody: string;
  attachments: AttachmentMeta[];
}

export interface AttachmentMeta {
  partId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
}
