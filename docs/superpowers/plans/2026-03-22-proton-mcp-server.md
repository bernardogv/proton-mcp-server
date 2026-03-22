# Proton Mail MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that gives Claude full read/write access to a ProtonMail inbox via Proton Mail Bridge over IMAP/SMTP.

**Architecture:** TypeScript MCP server using `@modelcontextprotocol/sdk` with stdio transport. Connects to Proton Mail Bridge's local IMAP (port 1143) and SMTP (port 1025) endpoints using `imapflow` and `nodemailer`. All communication stays on localhost.

**Tech Stack:** TypeScript, Node.js 20+, `@modelcontextprotocol/sdk`, `imapflow`, `nodemailer`, `zod`, stdio transport

---

## File Structure

```
proton-mcp-server/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts              # MCP server entry point, tool registration
│   ├── imap-client.ts        # IMAP connection pool & lifecycle
│   ├── smtp-client.ts        # SMTP/nodemailer transport
│   ├── tools/
│   │   ├── folders.ts        # list_folders, create_folder
│   │   ├── messages.ts       # get_messages, read_message, search_messages
│   │   ├── organize.ts       # move_message, apply_label, remove_label, delete_message
│   │   ├── flags.ts          # mark_read, mark_unread, star_message, unstar_message
│   │   ├── send.ts           # send_email
│   │   └── attachments.ts    # get_attachment
│   └── utils/
│       ├── config.ts         # env var loading & validation
│       └── types.ts          # shared TypeScript types/interfaces
├── tests/
│   ├── config.test.ts
│   ├── imap-client.test.ts
│   ├── smtp-client.test.ts
│   └── tools/
│       ├── folders.test.ts
│       ├── messages.test.ts
│       ├── organize.test.ts
│       ├── flags.test.ts
│       ├── send.test.ts
│       └── attachments.test.ts
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Initialize the project**

```bash
cd /Users/Starfam99/projects/Active_Projects/proton-mcp-server
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @modelcontextprotocol/sdk imapflow nodemailer dotenv zod
npm install -D typescript @types/node @types/nodemailer vitest tsx
```

- [ ] **Step 3: Create tsconfig.json**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Update package.json scripts**

Add to `package.json`:
```json
{
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 5: Create .env.example**

Create `.env.example`:
```env
PROTON_BRIDGE_IMAP_HOST=127.0.0.1
PROTON_BRIDGE_IMAP_PORT=1143
PROTON_BRIDGE_SMTP_HOST=127.0.0.1
PROTON_BRIDGE_SMTP_PORT=1025
PROTON_BRIDGE_USERNAME=user@proton.me
PROTON_BRIDGE_PASSWORD=bridge-generated-password
```

- [ ] **Step 6: Create .gitignore**

Create `.gitignore`:
```
node_modules/
dist/
.env
*.js.map
```

- [ ] **Step 7: Create directory structure**

```bash
mkdir -p src/tools src/utils tests/tools
```

- [ ] **Step 8: Commit**

```bash
git init
git add package.json tsconfig.json .env.example .gitignore package-lock.json
git commit -m "chore: scaffold proton-mcp-server project"
```

---

### Task 2: Config & Types

**Files:**
- Create: `src/utils/config.ts`
- Create: `src/utils/types.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test for config**

Create `tests/config.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig } from '../src/utils/config.js';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads valid config from environment variables', () => {
    vi.stubEnv('PROTON_BRIDGE_IMAP_HOST', '127.0.0.1');
    vi.stubEnv('PROTON_BRIDGE_IMAP_PORT', '1143');
    vi.stubEnv('PROTON_BRIDGE_SMTP_HOST', '127.0.0.1');
    vi.stubEnv('PROTON_BRIDGE_SMTP_PORT', '1025');
    vi.stubEnv('PROTON_BRIDGE_USERNAME', 'test@proton.me');
    vi.stubEnv('PROTON_BRIDGE_PASSWORD', 'test-password');

    const config = loadConfig();
    expect(config.imap.host).toBe('127.0.0.1');
    expect(config.imap.port).toBe(1143);
    expect(config.smtp.host).toBe('127.0.0.1');
    expect(config.smtp.port).toBe(1025);
    expect(config.username).toBe('test@proton.me');
    expect(config.password).toBe('test-password');
  });

  it('throws on missing required variables', () => {
    vi.stubEnv('PROTON_BRIDGE_IMAP_HOST', '127.0.0.1');
    // Missing other required vars
    expect(() => loadConfig()).toThrow();
  });

  it('uses default host/port values when not set', () => {
    vi.stubEnv('PROTON_BRIDGE_USERNAME', 'test@proton.me');
    vi.stubEnv('PROTON_BRIDGE_PASSWORD', 'test-password');

    const config = loadConfig();
    expect(config.imap.host).toBe('127.0.0.1');
    expect(config.imap.port).toBe(1143);
    expect(config.smtp.host).toBe('127.0.0.1');
    expect(config.smtp.port).toBe(1025);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/Starfam99/projects/Active_Projects/proton-mcp-server
npx vitest run tests/config.test.ts
```
Expected: FAIL — `loadConfig` not found.

- [ ] **Step 3: Create types**

Create `src/utils/types.ts`:
```typescript
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
```

- [ ] **Step 4: Implement config**

Create `src/utils/config.ts`:
```typescript
import { z } from 'zod';
import type { BridgeConfig } from './types.js';

const configSchema = z.object({
  PROTON_BRIDGE_IMAP_HOST: z.string().default('127.0.0.1'),
  PROTON_BRIDGE_IMAP_PORT: z.coerce.number().default(1143),
  PROTON_BRIDGE_SMTP_HOST: z.string().default('127.0.0.1'),
  PROTON_BRIDGE_SMTP_PORT: z.coerce.number().default(1025),
  PROTON_BRIDGE_USERNAME: z.string().min(1, 'PROTON_BRIDGE_USERNAME is required'),
  PROTON_BRIDGE_PASSWORD: z.string().min(1, 'PROTON_BRIDGE_PASSWORD is required'),
});

export function loadConfig(): BridgeConfig {
  const parsed = configSchema.parse(process.env);
  return {
    imap: {
      host: parsed.PROTON_BRIDGE_IMAP_HOST,
      port: parsed.PROTON_BRIDGE_IMAP_PORT,
    },
    smtp: {
      host: parsed.PROTON_BRIDGE_SMTP_HOST,
      port: parsed.PROTON_BRIDGE_SMTP_PORT,
    },
    username: parsed.PROTON_BRIDGE_USERNAME,
    password: parsed.PROTON_BRIDGE_PASSWORD,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/config.test.ts
```
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/utils/ tests/config.test.ts
git commit -m "feat: add config loading and shared types"
```

---

### Task 3: IMAP Client

**Files:**
- Create: `src/imap-client.ts`
- Create: `tests/imap-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/imap-client.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImapClientManager } from '../src/imap-client.js';
import type { BridgeConfig } from '../src/utils/types.js';

// Mock imapflow
vi.mock('imapflow', () => {
  const mockClient = {
    connect: vi.fn(),
    logout: vi.fn(),
    list: vi.fn().mockResolvedValue([
      { name: 'INBOX', path: 'INBOX', delimiter: '/', flags: new Set(['\\HasNoChildren']), specialUse: '\\Inbox' },
      { name: 'Sent', path: 'Sent', delimiter: '/', flags: new Set([]), specialUse: '\\Sent' },
    ]),
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    fetch: vi.fn(),
    fetchOne: vi.fn(),
    search: vi.fn().mockResolvedValue([1, 2, 3]),
    messageMove: vi.fn().mockResolvedValue(true),
    messageCopy: vi.fn().mockResolvedValue({ uidMap: new Map() }),
    messageFlagsAdd: vi.fn().mockResolvedValue(true),
    messageFlagsRemove: vi.fn().mockResolvedValue(true),
    mailboxCreate: vi.fn().mockResolvedValue({ path: 'TestFolder' }),
    mailbox: { exists: 5 },
    usable: true,
  };
  return {
    ImapFlow: vi.fn(() => mockClient),
  };
});

const testConfig: BridgeConfig = {
  imap: { host: '127.0.0.1', port: 1143 },
  smtp: { host: '127.0.0.1', port: 1025 },
  username: 'test@proton.me',
  password: 'test-pass',
};

describe('ImapClientManager', () => {
  let manager: ImapClientManager;

  beforeEach(() => {
    manager = new ImapClientManager(testConfig);
  });

  it('creates an ImapFlow client with correct config', () => {
    const { ImapFlow } = require('imapflow');
    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '127.0.0.1',
        port: 1143,
        secure: false,
        auth: { user: 'test@proton.me', pass: 'test-pass' },
      })
    );
  });

  it('connects and disconnects', async () => {
    await manager.connect();
    await manager.disconnect();
  });

  it('lists folders', async () => {
    await manager.connect();
    const folders = await manager.listFolders();
    expect(folders).toHaveLength(2);
    expect(folders[0].name).toBe('INBOX');
  });

  it('searches messages', async () => {
    await manager.connect();
    const uids = await manager.searchMessages('INBOX', { seen: false });
    expect(uids).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/imap-client.test.ts
```
Expected: FAIL — `ImapClientManager` not found.

- [ ] **Step 3: Implement IMAP client**

Create `src/imap-client.ts`:
```typescript
import { ImapFlow } from 'imapflow';
import type { BridgeConfig, FolderInfo, MessageSummary, MessageFull, AttachmentMeta } from './utils/types.js';

export class ImapClientManager {
  private client: ImapFlow;

  constructor(config: BridgeConfig) {
    this.client = new ImapFlow({
      host: config.imap.host,
      port: config.imap.port,
      secure: false,
      auth: {
        user: config.username,
        pass: config.password,
      },
      tls: {
        rejectUnauthorized: false,
      },
      logger: false,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.logout();
  }

  async listFolders(): Promise<FolderInfo[]> {
    const mailboxes = await this.client.list();
    return mailboxes.map((mb) => ({
      name: mb.name,
      path: mb.path,
      delimiter: mb.delimiter || '/',
      flags: Array.from(mb.flags || []),
      specialUse: mb.specialUse,
    }));
  }

  async getMessages(folder: string, limit: number, offset: number, unreadOnly: boolean): Promise<MessageSummary[]> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const total = this.client.mailbox?.exists ?? 0;
      if (total === 0) return [];

      let uids: number[];
      if (unreadOnly) {
        uids = await this.client.search({ seen: false }, { uid: true });
      } else {
        uids = await this.client.search({ all: true }, { uid: true });
      }

      // Sort descending (newest first), apply offset and limit
      uids.sort((a, b) => b - a);
      const sliced = uids.slice(offset, offset + limit);
      if (sliced.length === 0) return [];

      const messages: MessageSummary[] = [];
      const range = sliced.join(',');

      for await (const msg of this.client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
      })) {
        messages.push({
          uid: msg.uid,
          from: msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name || ''} <${msg.envelope.from[0].address || ''}>`
            : 'unknown',
          to: (msg.envelope?.to || []).map(
            (t: { name?: string; address?: string }) => `${t.name || ''} <${t.address || ''}>`
          ),
          subject: msg.envelope?.subject || '(no subject)',
          date: msg.envelope?.date?.toISOString() || '',
          flags: Array.from(msg.flags || []),
          hasAttachments: hasAttachmentParts(msg.bodyStructure),
        });
      }

      return messages;
    } finally {
      lock.release();
    }
  }

  async readMessage(folder: string, uid: number): Promise<MessageFull> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const msg = await this.client.fetchOne(String(uid), {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
        source: true,
      }, { uid: true });

      const { simpleParser } = await import('mailparser');
      const parsed = await simpleParser(msg.source);

      return {
        uid: msg.uid,
        from: parsed.from?.text || 'unknown',
        to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(t => t.text) : [parsed.to.text]) : [],
        cc: parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc.map(c => c.text) : [parsed.cc.text]) : [],
        subject: parsed.subject || '(no subject)',
        date: parsed.date?.toISOString() || '',
        flags: Array.from(msg.flags || []),
        hasAttachments: (parsed.attachments?.length || 0) > 0,
        textBody: parsed.text || '',
        htmlBody: parsed.html || '',
        attachments: (parsed.attachments || []).map((att, i) => ({
          partId: att.contentId || String(i),
          filename: att.filename || 'unnamed',
          mimeType: att.contentType || 'application/octet-stream',
          size: att.size || 0,
        })),
      };
    } finally {
      lock.release();
    }
  }

  async searchMessages(folder: string, criteria: Record<string, unknown>): Promise<number[]> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      return await this.client.search(criteria, { uid: true });
    } finally {
      lock.release();
    }
  }

  async moveMessage(sourceFolder: string, uid: number, destFolder: string): Promise<void> {
    const lock = await this.client.getMailboxLock(sourceFolder);
    try {
      await this.client.messageMove(String(uid), destFolder, { uid: true });
    } finally {
      lock.release();
    }
  }

  async copyMessage(sourceFolder: string, uid: number, destFolder: string): Promise<void> {
    const lock = await this.client.getMailboxLock(sourceFolder);
    try {
      await this.client.messageCopy(String(uid), destFolder, { uid: true });
    } finally {
      lock.release();
    }
  }

  async addFlags(folder: string, uid: number, flags: string[]): Promise<void> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      await this.client.messageFlagsAdd(String(uid), flags, { uid: true });
    } finally {
      lock.release();
    }
  }

  async removeFlags(folder: string, uid: number, flags: string[]): Promise<void> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      await this.client.messageFlagsRemove(String(uid), flags, { uid: true });
    } finally {
      lock.release();
    }
  }

  async fetchMessagesByUid(folder: string, uids: number[]): Promise<MessageSummary[]> {
    if (uids.length === 0) return [];
    const lock = await this.client.getMailboxLock(folder);
    try {
      const messages: MessageSummary[] = [];
      const range = uids.join(',');
      for await (const msg of this.client.fetch(range, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
      })) {
        messages.push({
          uid: msg.uid,
          from: msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name || ''} <${msg.envelope.from[0].address || ''}>`
            : 'unknown',
          to: (msg.envelope?.to || []).map(
            (t: { name?: string; address?: string }) => `${t.name || ''} <${t.address || ''}>`
          ),
          subject: msg.envelope?.subject || '(no subject)',
          date: msg.envelope?.date?.toISOString() || '',
          flags: Array.from(msg.flags || []),
          hasAttachments: hasAttachmentParts(msg.bodyStructure),
        });
      }
      return messages;
    } finally {
      lock.release();
    }
  }

  async createFolder(name: string): Promise<string> {
    const result = await this.client.mailboxCreate(name);
    return result.path;
  }

  async getAttachment(folder: string, uid: number, partId: string): Promise<{ content: Buffer; filename: string; mimeType: string }> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      const msg = await this.client.fetchOne(String(uid), {
        uid: true,
        source: true,
      }, { uid: true });

      const { simpleParser } = await import('mailparser');
      const parsed = await simpleParser(msg.source);
      const attachment = parsed.attachments?.find(
        (att, i) => (att.contentId || String(i)) === partId
      );

      if (!attachment) {
        throw new Error(`Attachment with partId "${partId}" not found`);
      }

      return {
        content: attachment.content,
        filename: attachment.filename || 'unnamed',
        mimeType: attachment.contentType || 'application/octet-stream',
      };
    } finally {
      lock.release();
    }
  }
}

function hasAttachmentParts(structure: unknown): boolean {
  if (!structure || typeof structure !== 'object') return false;
  const s = structure as Record<string, unknown>;
  if (s.disposition === 'attachment') return true;
  if (Array.isArray(s.childNodes)) {
    return s.childNodes.some((child: unknown) => hasAttachmentParts(child));
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/imap-client.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/imap-client.ts tests/imap-client.test.ts
git commit -m "feat: add IMAP client manager with connection and mailbox operations"
```

---

### Task 4: SMTP Client

**Files:**
- Create: `src/smtp-client.ts`
- Create: `tests/smtp-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/smtp-client.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/smtp-client.test.ts
```
Expected: FAIL — `SmtpClient` not found.

- [ ] **Step 3: Implement SMTP client**

Create `src/smtp-client.ts`:
```typescript
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
      secure: false, // STARTTLS, not implicit TLS
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/smtp-client.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/smtp-client.ts tests/smtp-client.test.ts
git commit -m "feat: add SMTP client for sending emails via Bridge"
```

---

### Task 5: Folder Tools

**Files:**
- Create: `src/tools/folders.ts`
- Create: `tests/tools/folders.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/folders.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/tools/folders.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement folder tool handlers**

Create `src/tools/folders.ts`:
```typescript
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function listFoldersHandler(imap: ImapClientManager): Promise<ToolResult> {
  const folders = await imap.listFolders();
  return {
    content: [{ type: 'text', text: JSON.stringify(folders, null, 2) }],
  };
}

export async function createFolderHandler(
  imap: ImapClientManager,
  params: { name: string }
): Promise<ToolResult> {
  const path = await imap.createFolder(params.name);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, path }) }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/tools/folders.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/folders.ts tests/tools/folders.test.ts
git commit -m "feat: add list_folders and create_folder tool handlers"
```

---

### Task 6: Message Tools

**Files:**
- Create: `src/tools/messages.ts`
- Create: `tests/tools/messages.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/messages.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { getMessagesHandler, readMessageHandler, searchMessagesHandler } from '../../src/tools/messages.js';

const mockImapClient = {
  getMessages: vi.fn().mockResolvedValue([
    { uid: 1, from: 'alice@test.com', to: ['bob@test.com'], subject: 'Hello', date: '2026-03-22T10:00:00Z', flags: ['\\Seen'], hasAttachments: false },
  ]),
  readMessage: vi.fn().mockResolvedValue({
    uid: 1, from: 'alice@test.com', to: ['bob@test.com'], cc: [], subject: 'Hello', date: '2026-03-22T10:00:00Z',
    flags: ['\\Seen'], hasAttachments: false, textBody: 'Hi Bob!', htmlBody: '', attachments: [],
  }),
  searchMessages: vi.fn().mockResolvedValue([1, 2, 3]),
  fetchMessagesByUid: vi.fn().mockResolvedValue([
    { uid: 1, from: 'alice@test.com', to: ['bob@test.com'], subject: 'Hello', date: '2026-03-22T10:00:00Z', flags: [], hasAttachments: false },
  ]),
};

describe('message tools', () => {
  it('getMessagesHandler returns message list', async () => {
    const result = await getMessagesHandler(mockImapClient as any, { folder: 'INBOX', limit: 20, offset: 0, unreadOnly: false });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].subject).toBe('Hello');
  });

  it('readMessageHandler returns full message', async () => {
    const result = await readMessageHandler(mockImapClient as any, { folder: 'INBOX', uid: 1 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.textBody).toBe('Hi Bob!');
  });

  it('searchMessagesHandler builds criteria and returns results', async () => {
    const result = await searchMessagesHandler(mockImapClient as any, {
      folder: 'INBOX', from: 'alice@test.com', limit: 10,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/tools/messages.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement message tool handlers**

Create `src/tools/messages.ts`:
```typescript
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function getMessagesHandler(
  imap: ImapClientManager,
  params: { folder: string; limit: number; offset: number; unreadOnly: boolean }
): Promise<ToolResult> {
  const messages = await imap.getMessages(params.folder, params.limit, params.offset, params.unreadOnly);
  return {
    content: [{ type: 'text', text: JSON.stringify(messages, null, 2) }],
  };
}

export async function readMessageHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  const message = await imap.readMessage(params.folder, params.uid);
  return {
    content: [{ type: 'text', text: JSON.stringify(message, null, 2) }],
  };
}

export async function searchMessagesHandler(
  imap: ImapClientManager,
  params: {
    folder: string;
    from?: string;
    to?: string;
    subject?: string;
    keyword?: string;
    since?: string;
    before?: string;
    unreadOnly?: boolean;
    limit?: number;
  }
): Promise<ToolResult> {
  const criteria: Record<string, unknown> = {};

  if (params.from) criteria.from = params.from;
  if (params.to) criteria.to = params.to;
  if (params.subject) criteria.subject = params.subject;
  if (params.keyword) criteria.body = params.keyword;
  if (params.since) criteria.since = new Date(params.since);
  if (params.before) criteria.before = new Date(params.before);
  if (params.unreadOnly) criteria.seen = false;

  if (Object.keys(criteria).length === 0) criteria.all = true;

  const uids = await imap.searchMessages(params.folder, criteria);

  // Limit and return matched UIDs with fetch for summaries
  const limited = uids.sort((a, b) => b - a).slice(0, params.limit || 20);
  const messages = await imap.fetchMessagesByUid(params.folder, limited);

  return {
    content: [{ type: 'text', text: JSON.stringify(messages, null, 2) }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/tools/messages.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/messages.ts tests/tools/messages.test.ts
git commit -m "feat: add get_messages, read_message, search_messages tool handlers"
```

---

### Task 7: Organization Tools

**Files:**
- Create: `src/tools/organize.ts`
- Create: `tests/tools/organize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/organize.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/tools/organize.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement organize handlers**

Create `src/tools/organize.ts`:
```typescript
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function moveMessageHandler(
  imap: ImapClientManager,
  params: { sourceFolder: string; uid: number; destinationFolder: string }
): Promise<ToolResult> {
  await imap.moveMessage(params.sourceFolder, params.uid, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'moved', uid: params.uid, to: params.destinationFolder }) }],
  };
}

export async function applyLabelHandler(
  imap: ImapClientManager,
  params: { sourceFolder: string; uid: number; labelFolder: string }
): Promise<ToolResult> {
  await imap.copyMessage(params.sourceFolder, params.uid, params.labelFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'labeled', uid: params.uid, label: params.labelFolder }) }],
  };
}

export async function removeLabelHandler(
  imap: ImapClientManager,
  params: { labelFolder: string; uid: number }
): Promise<ToolResult> {
  await imap.moveMessage(params.labelFolder, params.uid, 'INBOX');
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'label_removed', uid: params.uid, removedFrom: params.labelFolder }) }],
  };
}

export async function deleteMessageHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  await imap.moveMessage(params.folder, params.uid, 'Trash');
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'deleted', uid: params.uid }) }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/tools/organize.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/organize.ts tests/tools/organize.test.ts
git commit -m "feat: add move, label, and delete tool handlers"
```

---

### Task 8: Flag Tools

**Files:**
- Create: `src/tools/flags.ts`
- Create: `tests/tools/flags.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/flags.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { markReadHandler, markUnreadHandler, starMessageHandler, unstarMessageHandler } from '../../src/tools/flags.js';

const mockImapClient = {
  addFlags: vi.fn().mockResolvedValue(undefined),
  removeFlags: vi.fn().mockResolvedValue(undefined),
};

describe('flag tools', () => {
  it('markReadHandler adds \\Seen flag', async () => {
    const result = await markReadHandler(mockImapClient as any, { folder: 'INBOX', uid: 1 });
    expect(mockImapClient.addFlags).toHaveBeenCalledWith('INBOX', 1, ['\\Seen']);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('markUnreadHandler removes \\Seen flag', async () => {
    const result = await markUnreadHandler(mockImapClient as any, { folder: 'INBOX', uid: 1 });
    expect(mockImapClient.removeFlags).toHaveBeenCalledWith('INBOX', 1, ['\\Seen']);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('starMessageHandler adds \\Flagged flag', async () => {
    const result = await starMessageHandler(mockImapClient as any, { folder: 'INBOX', uid: 1 });
    expect(mockImapClient.addFlags).toHaveBeenCalledWith('INBOX', 1, ['\\Flagged']);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('unstarMessageHandler removes \\Flagged flag', async () => {
    const result = await unstarMessageHandler(mockImapClient as any, { folder: 'INBOX', uid: 1 });
    expect(mockImapClient.removeFlags).toHaveBeenCalledWith('INBOX', 1, ['\\Flagged']);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/tools/flags.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement flag handlers**

Create `src/tools/flags.ts`:
```typescript
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function markReadHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  await imap.addFlags(params.folder, params.uid, ['\\Seen']);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'marked_read', uid: params.uid }) }],
  };
}

export async function markUnreadHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  await imap.removeFlags(params.folder, params.uid, ['\\Seen']);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'marked_unread', uid: params.uid }) }],
  };
}

export async function starMessageHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  await imap.addFlags(params.folder, params.uid, ['\\Flagged']);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'starred', uid: params.uid }) }],
  };
}

export async function unstarMessageHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number }
): Promise<ToolResult> {
  await imap.removeFlags(params.folder, params.uid, ['\\Flagged']);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, action: 'unstarred', uid: params.uid }) }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/tools/flags.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/flags.ts tests/tools/flags.test.ts
git commit -m "feat: add mark_read, mark_unread, star, unstar tool handlers"
```

---

### Task 9: Send Email Tool

**Files:**
- Create: `src/tools/send.ts`
- Create: `tests/tools/send.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/send.test.ts`:
```typescript
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
    expect(mockSmtpClient.sendEmail).toHaveBeenCalledWith({
      to: ['bob@test.com'],
      subject: 'Hello',
      body: 'Hi Bob',
      cc: undefined,
      bcc: undefined,
      isHtml: false,
      inReplyTo: undefined,
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/tools/send.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement send handler**

Create `src/tools/send.ts`:
```typescript
import type { SmtpClient } from '../smtp-client.js';
import type { ToolResult } from '../utils/types.js';

export async function sendEmailHandler(
  smtp: SmtpClient,
  params: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    isHtml?: boolean;
    inReplyTo?: string;
  }
): Promise<ToolResult> {
  const result = await smtp.sendEmail({
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    isHtml: params.isHtml || false,
    inReplyTo: params.inReplyTo,
  });
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, messageId: result.messageId }) }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/tools/send.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/send.ts tests/tools/send.test.ts
git commit -m "feat: add send_email tool handler"
```

---

### Task 10: Attachment Tool

**Files:**
- Create: `src/tools/attachments.ts`
- Create: `tests/tools/attachments.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/attachments.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/tools/attachments.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement attachment handler**

Create `src/tools/attachments.ts`:
```typescript
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function getAttachmentHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number; attachmentPartId: string }
): Promise<ToolResult> {
  const attachment = await imap.getAttachment(params.folder, params.uid, params.attachmentPartId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        contentBase64: attachment.content.toString('base64'),
      }),
    }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/tools/attachments.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/attachments.ts tests/tools/attachments.test.ts
git commit -m "feat: add get_attachment tool handler"
```

---

### Task 11: MCP Server Entry Point (Wire Everything Together)

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement the MCP server entry point**

Create `src/index.ts`:
```typescript
import 'dotenv/config';
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import { loadConfig } from './utils/config.js';
import { ImapClientManager } from './imap-client.js';
import { SmtpClient } from './smtp-client.js';
import { listFoldersHandler, createFolderHandler } from './tools/folders.js';
import { getMessagesHandler, readMessageHandler, searchMessagesHandler } from './tools/messages.js';
import { moveMessageHandler, applyLabelHandler, removeLabelHandler, deleteMessageHandler } from './tools/organize.js';
import { markReadHandler, markUnreadHandler, starMessageHandler, unstarMessageHandler } from './tools/flags.js';
import { sendEmailHandler } from './tools/send.js';
import { getAttachmentHandler } from './tools/attachments.js';

const config = loadConfig();
const imap = new ImapClientManager(config);
const smtp = new SmtpClient(config);

const server = new McpServer({
  name: 'protonmail',
  version: '1.0.0',
});

// --- Folder tools ---

server.registerTool('list_folders', {
  title: 'List Folders',
  description: 'List all folders and labels in the mailbox',
  inputSchema: z.object({}),
}, async () => {
  await imap.connect();
  return listFoldersHandler(imap);
});

server.registerTool('create_folder', {
  title: 'Create Folder',
  description: 'Create a new folder/label',
  inputSchema: z.object({
    name: z.string().describe('Folder name (use / for subfolders, e.g. "Projects/Work")'),
  }),
}, async ({ name }) => {
  await imap.connect();
  return createFolderHandler(imap, { name });
});

// --- Message tools ---

server.registerTool('get_messages', {
  title: 'Get Messages',
  description: 'Get message list from a folder with metadata',
  inputSchema: z.object({
    folder: z.string().default('INBOX').describe('Folder to fetch from'),
    limit: z.number().default(20).describe('Max messages to return'),
    offset: z.number().default(0).describe('Offset for pagination'),
    unreadOnly: z.boolean().default(false).describe('Only return unread messages'),
  }),
}, async ({ folder, limit, offset, unreadOnly }) => {
  await imap.connect();
  return getMessagesHandler(imap, { folder, limit, offset, unreadOnly });
});

server.registerTool('read_message', {
  title: 'Read Message',
  description: 'Get full message content by UID',
  inputSchema: z.object({
    folder: z.string().default('INBOX').describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return readMessageHandler(imap, { folder, uid });
});

server.registerTool('search_messages', {
  title: 'Search Messages',
  description: 'Search messages with criteria',
  inputSchema: z.object({
    folder: z.string().default('INBOX').describe('Folder to search in'),
    from: z.string().optional().describe('Filter by sender'),
    to: z.string().optional().describe('Filter by recipient'),
    subject: z.string().optional().describe('Filter by subject'),
    keyword: z.string().optional().describe('Search body text'),
    since: z.string().optional().describe('Messages since date (ISO 8601)'),
    before: z.string().optional().describe('Messages before date (ISO 8601)'),
    unreadOnly: z.boolean().default(false).describe('Only unread messages'),
    limit: z.number().default(20).describe('Max results'),
  }),
}, async (params) => {
  await imap.connect();
  return searchMessagesHandler(imap, params);
});

// --- Organization tools ---

server.registerTool('move_message', {
  title: 'Move Message',
  description: 'Move a message to a different folder',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Current folder of the message'),
    uid: z.number().describe('Message UID'),
    destinationFolder: z.string().describe('Target folder'),
  }),
}, async ({ sourceFolder, uid, destinationFolder }) => {
  await imap.connect();
  return moveMessageHandler(imap, { sourceFolder, uid, destinationFolder });
});

server.registerTool('apply_label', {
  title: 'Apply Label',
  description: 'Apply a label to a message (copies to label folder, keeps original)',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Current folder of the message'),
    uid: z.number().describe('Message UID'),
    labelFolder: z.string().describe('Label folder to apply'),
  }),
}, async ({ sourceFolder, uid, labelFolder }) => {
  await imap.connect();
  return applyLabelHandler(imap, { sourceFolder, uid, labelFolder });
});

server.registerTool('remove_label', {
  title: 'Remove Label',
  description: 'Remove a label from a message',
  inputSchema: z.object({
    labelFolder: z.string().describe('Label folder to remove the message from'),
    uid: z.number().describe('Message UID within the label folder'),
  }),
}, async ({ labelFolder, uid }) => {
  await imap.connect();
  return removeLabelHandler(imap, { labelFolder, uid });
});

server.registerTool('delete_message', {
  title: 'Delete Message',
  description: 'Move a message to Trash',
  inputSchema: z.object({
    folder: z.string().describe('Current folder of the message'),
    uid: z.number().describe('Message UID'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return deleteMessageHandler(imap, { folder, uid });
});

// --- Flag tools ---

server.registerTool('mark_read', {
  title: 'Mark Read',
  description: 'Mark a message as read',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return markReadHandler(imap, { folder, uid });
});

server.registerTool('mark_unread', {
  title: 'Mark Unread',
  description: 'Mark a message as unread',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return markUnreadHandler(imap, { folder, uid });
});

server.registerTool('star_message', {
  title: 'Star Message',
  description: 'Star/flag a message',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return starMessageHandler(imap, { folder, uid });
});

server.registerTool('unstar_message', {
  title: 'Unstar Message',
  description: 'Remove star/flag from a message',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
  }),
}, async ({ folder, uid }) => {
  await imap.connect();
  return unstarMessageHandler(imap, { folder, uid });
});

// --- Send tool ---

server.registerTool('send_email', {
  title: 'Send Email',
  description: 'Send an email via SMTP through Proton Bridge',
  inputSchema: z.object({
    to: z.array(z.string()).describe('Recipient email addresses'),
    cc: z.array(z.string()).optional().describe('CC recipients'),
    bcc: z.array(z.string()).optional().describe('BCC recipients'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body (text or HTML)'),
    isHtml: z.boolean().default(false).describe('Whether body is HTML'),
    inReplyTo: z.string().optional().describe('Message-ID to reply to (for threading)'),
  }),
}, async (params) => {
  return sendEmailHandler(smtp, params);
});

// --- Attachment tool ---

server.registerTool('get_attachment', {
  title: 'Get Attachment',
  description: 'Download a specific attachment from a message',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
    attachmentPartId: z.string().describe('Attachment part ID from read_message response'),
  }),
}, async ({ folder, uid, attachmentPartId }) => {
  await imap.connect();
  return getAttachmentHandler(imap, { folder, uid, attachmentPartId });
});

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Proton Mail MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

- [ ] **Step 2: Build the project**

```bash
cd /Users/Starfam99/projects/Active_Projects/proton-mcp-server
npm run build
```
Expected: Compiles without errors, `dist/` directory created.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire up MCP server entry point with all 13 tools"
```

---

### Task 12: Add mailparser Dependency & Integration Fixes

**Files:**
- Modify: `package.json` (add `mailparser`)

- [ ] **Step 1: Install mailparser**

```bash
npm install mailparser
npm install -D @types/mailparser
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```
Expected: All tests pass.

- [ ] **Step 3: Build and verify no type errors**

```bash
npm run build
```
Expected: Clean build, no errors.

- [ ] **Step 4: Fix any remaining issues**

Address any type errors or import issues surfaced by the build/test steps.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add mailparser dependency, fix build"
```

---

### Task 13: Claude Desktop / Claude Code Configuration

**Files:**
- No project files changed — this configures the client side

- [ ] **Step 1: Build the final dist**

```bash
cd /Users/Starfam99/projects/Active_Projects/proton-mcp-server
npm run build
```

- [ ] **Step 2: Add MCP server to Claude Code settings**

Add to `~/.claude/settings.json` under `mcpServers`:
```json
{
  "protonmail": {
    "command": "node",
    "args": ["/Users/Starfam99/projects/Active_Projects/proton-mcp-server/dist/index.js"],
    "env": {
      "PROTON_BRIDGE_IMAP_HOST": "127.0.0.1",
      "PROTON_BRIDGE_IMAP_PORT": "1143",
      "PROTON_BRIDGE_SMTP_HOST": "127.0.0.1",
      "PROTON_BRIDGE_SMTP_PORT": "1025",
      "PROTON_BRIDGE_USERNAME": "<your-proton-email>",
      "PROTON_BRIDGE_PASSWORD": "<bridge-password>"
    }
  }
}
```

- [ ] **Step 3: Test with Claude Code**

Restart Claude Code and verify the `protonmail` MCP server tools appear. Test with:
```
list_folders
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: finalize build and configuration"
```
