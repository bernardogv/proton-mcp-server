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
  attachmentInfo?: AttachmentSummary[];
}

export interface MessageFull extends MessageSummary {
  cc: string[];
  messageId: string;
  inReplyTo: string;
  references: string;
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

export interface FolderStats {
  path: string;
  total: number;
  unseen: number;
}

export interface AttachmentSummary {
  filename: string;
  mimeType: string;
  size: number;
}

export interface SenderSummary {
  sender: string;
  address: string;
  count: number;
  latestDate: string;
  uids: number[];
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  [key: string]: unknown; // Index signature for MCP SDK compatibility
}
