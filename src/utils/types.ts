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

export interface BatchResult {
  success: boolean;
  requested: number;
  moved?: number;
  copied?: number;
  failedUids?: number[];
  destination?: string;
  label?: string;
  sourceFolder?: string;
}

export interface SnippetMessage extends MessageSummary {
  snippet: string;
  hasUnsubscribe?: boolean;
  unsubscribeMailto?: string;
  unsubscribeHttp?: string;
  unsubscribeOneClick?: boolean;
}

export interface SubjectCluster {
  pattern: string;
  count: number;
  sampleUids: number[];
}

export interface SenderSummaryWithClusters extends SenderSummary {
  topClusters?: SubjectCluster[];
}

export interface RouteResult {
  success: boolean;
  requested: number;
  labeled: Array<{ folder: string; copied: number; success: boolean }>;
  moved?: { destination: string; moved: number; success: boolean };
  failedUids?: number[];
}

export interface ChangesSinceResult {
  since: string;
  byFolder: Record<string, { newMessages: MessageSummary[]; count: number }>;
  totalNew: number;
}

export interface SenderRoute {
  sender: string;
  address: string;
  totalMessages: number;
  dominantFolder: string;
  confidence: number;
  otherFolders: Record<string, number>;
  suggestedTool: string;
  suggestedArgs: Record<string, unknown>;
}
