# ProtonMail MCP — Feedback Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 10 feedback items from the 2026-05-13 spec — silent-failure fixes, clean snippets, List-Unsubscribe surfacing, subject clusters, `get_changes_since`, atomic `route()`, batch dry-run, sender-routing suggestions, and PDF text extraction.

**Architecture:** Pure logic in `src/utils/*`, thin handlers in `src/tools/*`, IMAP wrappers in `src/imap-client.ts`. Add TDD-first unit tests for every utility. No new persistent state — every new capability either accepts inputs or derives from current IMAP mailbox.

**Tech Stack:** TypeScript (Node16 modules, ES2022 target), imapflow, mailparser, nodemailer, vitest 1.0.4 for tests, pdf-parse for PDF text.

**Spec:** `docs/superpowers/specs/2026-05-13-protonmail-feedback-fixes-design.md`

---

## File map

| File | Status | Purpose |
|------|--------|---------|
| `vitest.config.ts` | new | Vitest config, points at `tests/**/*.test.ts` |
| `tests/fixtures/` | exists (empty) | MIME payload fixtures |
| `tests/utils/snippet.test.ts` | new | Tests for snippet/List-Unsubscribe util |
| `tests/utils/clustering.test.ts` | new | Tests for subject clustering |
| `tests/utils/folder-validation.test.ts` | new | Tests for `assertFolderExists`/`fuzzyFolderMatches` |
| `tests/utils/list-unsubscribe.test.ts` | new | Tests for `parseListUnsubscribe` |
| `src/utils/snippet.ts` | new | `buildCleanSnippet` + `parseListUnsubscribe` |
| `src/utils/clustering.ts` | new | `clusterSubjects` + `normalizeSubject` |
| `src/utils/folder-validation.ts` | new | `assertFolderExists` + `fuzzyFolderMatches` |
| `src/utils/types.ts` | extend | New shapes: `BatchResult`, `RouteResult`, `ChangesSinceResult`, `SenderRoute`, `MessageSummaryWithSnippet` |
| `src/imap-client.ts` | extend | `verifyFolderExists`, post-verify counts, source-based snippet fetch |
| `src/tools/route.ts` | new | `routeHandler`, `batchRouteHandler` |
| `src/tools/changes.ts` | new | `getChangesSinceHandler` |
| `src/tools/intelligence.ts` | new | `suggestSenderRoutesHandler` |
| `src/tools/attachments.ts` | extend | `getAttachmentTextHandler` |
| `src/tools/organize.ts` | extend | `dryRun` for all batch ops |
| `src/tools/messages.ts` | extend | Pass through cluster fields in digest |
| `src/index.ts` | extend | Register new tools, add `dryRun` schema fields |
| `package.json` | extend | Add `pdf-parse` dep |

---

## Phase 1 — Vitest setup

### Task 1: Add vitest config and a smoke test

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

Create `tests/smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Run tests to verify pass**

Run: `npm test`
Expected: 1 test passed, "smoke > runs"

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tests/smoke.test.ts
git commit -m "test: add vitest config and smoke test"
```

---

## Phase 2 — Silent-failure fixes (Items 1, 2)

### Task 2: Folder validation helpers — tests first

**Files:**
- Create: `tests/utils/folder-validation.test.ts`
- Create: `src/utils/folder-validation.ts`

These helpers are used by every IMAP method that moves/copies messages (Tasks 4–7, 14). Centralizing them keeps the fuzzy-match logic consistent.

- [ ] **Step 1: Write the failing tests**

Create `tests/utils/folder-validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { fuzzyFolderMatches, assertFolderExists } from '../../src/utils/folder-validation.js';

describe('fuzzyFolderMatches', () => {
  it('returns up to 5 close paths sorted by similarity', () => {
    const paths = [
      'Folders/Orders',
      'Folders/Orders & Receipts',
      'Folders/Order History',
      'Labels/Important',
      'Folders/Drafts',
    ];
    const matches = fuzzyFolderMatches(paths, 'Folders/Order');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(5);
    expect(matches[0]).toMatch(/Folders\/Order/);
  });

  it('returns empty array when no path is close', () => {
    expect(fuzzyFolderMatches(['INBOX'], 'totally/unrelated/xyzzy')).toEqual([]);
  });

  it('is case-insensitive in matching but preserves original casing', () => {
    const paths = ['Folders/Orders & Receipts'];
    const matches = fuzzyFolderMatches(paths, 'folders/orders');
    expect(matches[0]).toBe('Folders/Orders & Receipts');
  });
});

describe('assertFolderExists', () => {
  it('returns silently when path is in the set', () => {
    const paths = new Set(['INBOX', 'Folders/Receipts']);
    expect(() => assertFolderExists(paths, 'INBOX')).not.toThrow();
  });

  it('throws with fuzzy hint when path is missing', () => {
    const paths = new Set(['Folders/Orders & Receipts']);
    expect(() => assertFolderExists(paths, 'Folders/Orders &amp; Receipts')).toThrow(
      /Folder 'Folders\/Orders &amp; Receipts' not found.*Folders\/Orders & Receipts/,
    );
  });

  it('throws without hint when no close match exists', () => {
    const paths = new Set(['INBOX']);
    expect(() => assertFolderExists(paths, 'xyz/qqq')).toThrow(/Folder 'xyz\/qqq' not found\.$/);
  });

  it('is case-sensitive and does not html-decode', () => {
    const paths = new Set(['Folders/Orders & Receipts']);
    expect(() => assertFolderExists(paths, 'folders/orders & receipts')).toThrow();
    expect(() => assertFolderExists(paths, 'Folders/Orders &amp; Receipts')).toThrow();
    expect(() => assertFolderExists(paths, 'Folders/Orders & Receipts')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- folder-validation`
Expected: FAIL — `Cannot find module '../../src/utils/folder-validation.js'`

- [ ] **Step 3: Implement the helpers**

Create `src/utils/folder-validation.ts`:

```typescript
export function fuzzyFolderMatches(paths: string[], target: string): string[] {
  const t = target.toLowerCase();
  const scored = paths
    .map((p) => ({ path: p, score: similarity(t, p.toLowerCase()) }))
    .filter((m) => m.score > 0.3)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map((m) => m.path);
}

export function assertFolderExists(paths: Set<string>, path: string): void {
  if (paths.has(path)) return;
  const matches = fuzzyFolderMatches([...paths], path);
  const hint = matches.length > 0
    ? ` Did you mean one of: ${matches.map((s) => `'${s}'`).join(', ')}?`
    : '';
  throw new Error(`Folder '${path}' not found.${hint}`);
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  // Dice coefficient on bigrams — adequate for folder-name fuzzy matching
  const ba = bigrams(a);
  const bb = bigrams(b);
  let overlap = 0;
  for (const g of ba) if (bb.has(g)) overlap++;
  return (2 * overlap) / (ba.size + bb.size);
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- folder-validation`
Expected: 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/utils/folder-validation.ts tests/utils/folder-validation.test.ts
git commit -m "feat: add folder validation helpers (fuzzyFolderMatches, assertFolderExists)"
```

---

### Task 3: Extend types for batch results

**Files:**
- Modify: `src/utils/types.ts`

- [ ] **Step 1: Add new types**

Append to `src/utils/types.ts`:

```typescript
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
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/types.ts
git commit -m "feat: add types for batch results, route, changes-since, sender routes"
```

---

### Task 4: Pre-validation + post-verify in batch move

**Files:**
- Modify: `src/imap-client.ts`
- Modify: `src/tools/organize.ts`

- [ ] **Step 1: Replace `batchMoveMessages` in `src/imap-client.ts`**

Find the current `batchMoveMessages` method (around line 272) and replace with:

```typescript
async batchMoveMessages(
  sourceFolder: string,
  uids: number[],
  destFolder: string,
): Promise<BatchResult> {
  if (uids.length === 0) {
    return { success: true, requested: 0, moved: 0, destination: destFolder, sourceFolder };
  }
  return this.withConnection(async (client) => {
    const mailboxes = await client.list();
    const paths = new Set(mailboxes.map((m) => m.path));
    assertFolderExists(paths, sourceFolder);
    assertFolderExists(paths, destFolder);

    // Capture source size before
    const beforeStatus = await client.status(sourceFolder, { messages: true });
    const before = beforeStatus.messages ?? 0;

    // Run the move under a lock
    const lock = await client.getMailboxLock(sourceFolder);
    try {
      const range = uids.join(',');
      await client.messageMove(range, destFolder, { uid: true });
    } finally {
      lock.release();
    }

    // Capture source size after
    const afterStatus = await client.status(sourceFolder, { messages: true });
    const after = afterStatus.messages ?? 0;
    const moved = before - after;

    // If under-counted, find which requested UIDs still exist in source
    let failedUids: number[] | undefined;
    if (moved < uids.length) {
      const checkLock = await client.getMailboxLock(sourceFolder);
      try {
        const result = await client.search({ uid: uids.join(',') }, { uid: true });
        failedUids = result === false ? [] : result;
      } finally {
        checkLock.release();
      }
    }

    return {
      success: moved === uids.length,
      requested: uids.length,
      moved,
      destination: destFolder,
      sourceFolder,
      ...(failedUids && { failedUids }),
    };
  });
}
```

Update the imports at the top of `src/imap-client.ts` to add `BatchResult` and the validation helper:

```typescript
import type { BridgeConfig, FolderInfo, FolderStats, MessageSummary, MessageFull, AttachmentMeta, AttachmentSummary, SenderSummary, BatchResult } from './utils/types.js';
import { assertFolderExists } from './utils/folder-validation.js';
```

- [ ] **Step 2: Update `batchMoveHandler` in `src/tools/organize.ts`**

Replace `batchMoveHandler`:

```typescript
export async function batchMoveHandler(
  imap: ImapClientManager,
  params: { sourceFolder: string; uids: number[]; destinationFolder: string; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: params.uids.length,
        uids: params.uids,
        sourceFolder: params.sourceFolder,
        destination: params.destinationFolder,
      }) }],
    };
  }
  const result = await imap.batchMoveMessages(params.sourceFolder, params.uids, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'batch_moved', ...result }) }],
  };
}
```

- [ ] **Step 3: Update `batch_move_messages` schema in `src/index.ts`**

Find the `server.registerTool('batch_move_messages', ...` block and add `dryRun` to its inputSchema:

```typescript
server.registerTool('batch_move_messages', {
  title: 'Batch Move Messages',
  description: 'Move multiple messages to a folder in a single operation. Pre-validates folders exist and post-verifies the move count. Returns {success, requested, moved, failedUids?}. Use dryRun:true to preview.',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Current folder of the messages'),
    uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs to move (max 500)'),
    destinationFolder: z.string().describe('Target folder'),
    dryRun: z.boolean().default(false).describe('If true, preview without mutating. Returns the UIDs that would be moved.'),
  }),
}, async ({ sourceFolder, uids, destinationFolder, dryRun }) => {
  await imap.connect();
  return batchMoveHandler(imap, { sourceFolder, uids, destinationFolder, dryRun });
});
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/imap-client.ts src/tools/organize.ts src/index.ts
git commit -m "fix(batch-move): pre-validate folders, post-verify count, report failedUids"
```

---

### Task 5: Pre-validation + post-verify in batch copy/label

**Files:**
- Modify: `src/imap-client.ts`
- Modify: `src/tools/organize.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Replace `batchCopyMessages` in `src/imap-client.ts`**

```typescript
async batchCopyMessages(
  sourceFolder: string,
  uids: number[],
  destFolder: string,
): Promise<BatchResult> {
  if (uids.length === 0) {
    return { success: true, requested: 0, copied: 0, label: destFolder, sourceFolder };
  }
  return this.withConnection(async (client) => {
    const mailboxes = await client.list();
    const paths = new Set(mailboxes.map((m) => m.path));
    assertFolderExists(paths, sourceFolder);
    assertFolderExists(paths, destFolder);

    // Capture destination size before
    const beforeStatus = await client.status(destFolder, { messages: true });
    const before = beforeStatus.messages ?? 0;

    const lock = await client.getMailboxLock(sourceFolder);
    try {
      const range = uids.join(',');
      await client.messageCopy(range, destFolder, { uid: true });
    } finally {
      lock.release();
    }

    const afterStatus = await client.status(destFolder, { messages: true });
    const after = afterStatus.messages ?? 0;
    const copied = after - before;

    return {
      success: copied === uids.length,
      requested: uids.length,
      copied,
      label: destFolder,
      sourceFolder,
    };
  });
}
```

- [ ] **Step 2: Update `batchApplyLabelHandler` and `batchRemoveLabelHandler` in `src/tools/organize.ts`**

```typescript
export async function batchApplyLabelHandler(
  imap: ImapClientManager,
  params: { sourceFolder: string; uids: number[]; labelFolder: string; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: params.uids.length,
        uids: params.uids,
        sourceFolder: params.sourceFolder,
        label: params.labelFolder,
      }) }],
    };
  }
  const result = await imap.batchCopyMessages(params.sourceFolder, params.uids, params.labelFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'batch_labeled', ...result }) }],
  };
}

export async function batchRemoveLabelHandler(
  imap: ImapClientManager,
  params: { labelFolder: string; uids: number[]; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: params.uids.length,
        uids: params.uids,
        sourceFolder: params.labelFolder,
        destination: 'INBOX',
      }) }],
    };
  }
  const result = await imap.batchMoveMessages(params.labelFolder, params.uids, 'INBOX');
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'batch_label_removed', ...result, removedFrom: params.labelFolder }) }],
  };
}
```

- [ ] **Step 3: Update `batch_apply_label` and `batch_remove_label` schemas in `src/index.ts`**

For `batch_apply_label`:

```typescript
server.registerTool('batch_apply_label', {
  title: 'Batch Apply Label',
  description: 'Apply a label to multiple messages. Pre-validates folders, post-verifies copy count. Returns {success, requested, copied}. Use dryRun:true to preview.',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Current folder of the messages'),
    uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs to label (max 500)'),
    labelFolder: z.string().describe('Label folder to apply'),
    dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
  }),
}, async ({ sourceFolder, uids, labelFolder, dryRun }) => {
  await imap.connect();
  return batchApplyLabelHandler(imap, { sourceFolder, uids, labelFolder, dryRun });
});
```

For `batch_remove_label`:

```typescript
server.registerTool('batch_remove_label', {
  title: 'Batch Remove Label',
  description: 'Remove a label from multiple messages. Moves them back to INBOX. Returns {success, requested, moved}. Use dryRun:true to preview.',
  inputSchema: z.object({
    labelFolder: z.string().describe('Label folder to remove messages from'),
    uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs within the label folder (max 500)'),
    dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
  }),
}, async ({ labelFolder, uids, dryRun }) => {
  await imap.connect();
  return batchRemoveLabelHandler(imap, { labelFolder, uids, dryRun });
});
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/imap-client.ts src/tools/organize.ts src/index.ts
git commit -m "fix(batch-label): pre-validate folders, post-verify copy count"
```

---

### Task 6: Add dryRun + post-verify to remaining batch ops

**Files:**
- Modify: `src/imap-client.ts`
- Modify: `src/tools/organize.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update `moveBySender` and `moveBySearch` in `src/imap-client.ts`**

Replace both to return `BatchResult` shape:

```typescript
async moveBySender(folder: string, senderAddress: string, destFolder: string): Promise<BatchResult & { uids: number[] }> {
  return this.withConnection(async (client) => {
    const mailboxes = await client.list();
    const paths = new Set(mailboxes.map((m) => m.path));
    assertFolderExists(paths, folder);
    assertFolderExists(paths, destFolder);

    const lock = await client.getMailboxLock(folder);
    let uids: number[];
    try {
      const searchResult = await client.search({ from: senderAddress }, { uid: true });
      uids = searchResult === false ? [] : searchResult;
    } finally {
      lock.release();
    }
    if (uids.length === 0) {
      return { success: true, requested: 0, moved: 0, destination: destFolder, sourceFolder: folder, uids: [] };
    }

    const beforeStatus = await client.status(folder, { messages: true });
    const before = beforeStatus.messages ?? 0;

    const moveLock = await client.getMailboxLock(folder);
    try {
      await client.messageMove(uids.join(','), destFolder, { uid: true });
    } finally {
      moveLock.release();
    }

    const afterStatus = await client.status(folder, { messages: true });
    const after = afterStatus.messages ?? 0;
    const moved = before - after;

    return {
      success: moved === uids.length,
      requested: uids.length,
      moved,
      destination: destFolder,
      sourceFolder: folder,
      uids,
    };
  });
}

async moveBySearch(folder: string, criteria: Record<string, unknown>, destFolder: string): Promise<BatchResult & { uids: number[] }> {
  return this.withConnection(async (client) => {
    const mailboxes = await client.list();
    const paths = new Set(mailboxes.map((m) => m.path));
    assertFolderExists(paths, folder);
    assertFolderExists(paths, destFolder);

    const lock = await client.getMailboxLock(folder);
    let uids: number[];
    try {
      const searchResult = await client.search(criteria, { uid: true });
      uids = searchResult === false ? [] : searchResult;
    } finally {
      lock.release();
    }
    if (uids.length === 0) {
      return { success: true, requested: 0, moved: 0, destination: destFolder, sourceFolder: folder, uids: [] };
    }

    const beforeStatus = await client.status(folder, { messages: true });
    const before = beforeStatus.messages ?? 0;

    const moveLock = await client.getMailboxLock(folder);
    try {
      await client.messageMove(uids.join(','), destFolder, { uid: true });
    } finally {
      moveLock.release();
    }

    const afterStatus = await client.status(folder, { messages: true });
    const after = afterStatus.messages ?? 0;
    const moved = before - after;

    return {
      success: moved === uids.length,
      requested: uids.length,
      moved,
      destination: destFolder,
      sourceFolder: folder,
      uids,
    };
  });
}
```

Also add a new `searchUidsBySender` helper for dryRun previews:

```typescript
async searchUidsBySender(folder: string, senderAddress: string): Promise<number[]> {
  return this.withConnection(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const result = await client.search({ from: senderAddress }, { uid: true });
      return result === false ? [] : result;
    } finally {
      lock.release();
    }
  });
}
```

- [ ] **Step 2: Add `dryRun` to `moveBySenderHandler`, `moveBySearchHandler`, `batchDeleteHandler`, `crossFolderBatchMoveHandler` in `src/tools/organize.ts`**

Replace `moveBySenderHandler`:

```typescript
export async function moveBySenderHandler(
  imap: ImapClientManager,
  params: { sourceFolder: string; senderAddress: string; destinationFolder: string; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    const uids = await imap.searchUidsBySender(params.sourceFolder, params.senderAddress);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: uids.length,
        uids,
        sourceFolder: params.sourceFolder,
        destination: params.destinationFolder,
        sender: params.senderAddress,
      }) }],
    };
  }
  const result = await imap.moveBySender(params.sourceFolder, params.senderAddress, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'moved_by_sender', sender: params.senderAddress, ...result }) }],
  };
}
```

Replace `moveBySearchHandler`:

```typescript
export async function moveBySearchHandler(
  imap: ImapClientManager,
  params: {
    sourceFolder: string;
    destinationFolder: string;
    from?: string;
    to?: string;
    subject?: string;
    keyword?: string;
    since?: string;
    before?: string;
    unreadOnly?: boolean;
    dryRun?: boolean;
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

  if (Object.keys(criteria).length === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'At least one search criterion is required to prevent accidental moves' }) }],
    };
  }

  if (params.dryRun) {
    const uids = await imap.searchMessages(params.sourceFolder, criteria);
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: uids.length,
        uids,
        sourceFolder: params.sourceFolder,
        destination: params.destinationFolder,
        criteria,
      }) }],
    };
  }

  const result = await imap.moveBySearch(params.sourceFolder, criteria, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'moved_by_search', ...result }) }],
  };
}
```

Replace `batchDeleteHandler`:

```typescript
export async function batchDeleteHandler(
  imap: ImapClientManager,
  params: { folder: string; uids: number[]; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: params.uids.length,
        uids: params.uids,
        sourceFolder: params.folder,
        destination: 'Trash',
      }) }],
    };
  }
  const result = await imap.batchMoveMessages(params.folder, params.uids, 'Trash');
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'batch_deleted', ...result }) }],
  };
}
```

Replace `crossFolderBatchMoveHandler`:

```typescript
export async function crossFolderBatchMoveHandler(
  imap: ImapClientManager,
  params: { items: Array<{ uid: number; sourceFolder: string }>; destinationFolder: string; dryRun?: boolean }
): Promise<ToolResult> {
  if (params.dryRun) {
    const grouped: Record<string, number[]> = {};
    for (const item of params.items) {
      (grouped[item.sourceFolder] ||= []).push(item.uid);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: params.items.length,
        byFolder: grouped,
        destination: params.destinationFolder,
      }) }],
    };
  }
  const result = await imap.crossFolderBatchMove(params.items, params.destinationFolder);
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'cross_folder_batch_moved', success: true, ...result, to: params.destinationFolder }) }],
  };
}
```

- [ ] **Step 3: Add `dryRun` to schemas in `src/index.ts`**

For each of `batch_delete_messages`, `cross_folder_batch_move`, `move_by_sender`, `move_by_search`, add `dryRun: z.boolean().default(false).describe('If true, preview without mutating.')` to the `inputSchema`, and pass it through to the handler.

Example for `batch_delete_messages`:

```typescript
server.registerTool('batch_delete_messages', {
  title: 'Batch Delete Messages',
  description: 'Move multiple messages to Trash. Pre-validates Trash exists, post-verifies count. Use dryRun:true to preview.',
  inputSchema: z.object({
    folder: z.string().describe('Current folder of the messages'),
    uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs to delete (max 500)'),
    dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
  }),
}, async ({ folder, uids, dryRun }) => {
  await imap.connect();
  return batchDeleteHandler(imap, { folder, uids, dryRun });
});
```

For `cross_folder_batch_move`:

```typescript
server.registerTool('cross_folder_batch_move', {
  title: 'Cross-Folder Batch Move',
  description: 'Move messages from multiple source folders to one destination. Each item specifies its own sourceFolder. Use dryRun:true to preview.',
  inputSchema: z.object({
    items: z.array(z.object({
      uid: z.number().describe('Message UID'),
      sourceFolder: z.string().describe('Folder this message is currently in'),
    })).min(1).max(500).describe('Array of messages with their source folders (max 500)'),
    destinationFolder: z.string().describe('Target folder for all messages'),
    dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
  }),
}, async ({ items, destinationFolder, dryRun }) => {
  await imap.connect();
  return crossFolderBatchMoveHandler(imap, { items, destinationFolder, dryRun });
});
```

For `move_by_sender`:

```typescript
server.registerTool('move_by_sender', {
  title: 'Move by Sender',
  description: 'Move all messages from a specific sender to a destination folder. Use dryRun:true to preview the UIDs that would be moved.',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Folder to search in'),
    senderAddress: z.string().describe('Sender email address to match'),
    destinationFolder: z.string().describe('Target folder'),
    dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
  }),
}, async ({ sourceFolder, senderAddress, destinationFolder, dryRun }) => {
  await imap.connect();
  return moveBySenderHandler(imap, { sourceFolder, senderAddress, destinationFolder, dryRun });
});
```

For `move_by_search`:

```typescript
server.registerTool('move_by_search', {
  title: 'Move by Search',
  description: 'Search for messages matching criteria and move all matches to a destination folder. Requires at least one search criterion. Use dryRun:true to preview the UIDs that would be moved.',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Folder to search in'),
    destinationFolder: z.string().describe('Target folder for matched messages'),
    from: z.string().optional().describe('Filter by sender'),
    to: z.string().optional().describe('Filter by recipient'),
    subject: z.string().optional().describe('Filter by subject'),
    keyword: z.string().optional().describe('Search body text'),
    since: z.string().optional().describe('Messages since date (ISO 8601)'),
    before: z.string().optional().describe('Messages before date (ISO 8601)'),
    unreadOnly: z.boolean().default(false).describe('Only match unread messages'),
    dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
  }),
}, async (params) => {
  await imap.connect();
  return moveBySearchHandler(imap, params);
});
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/imap-client.ts src/tools/organize.ts src/index.ts
git commit -m "feat: add dryRun and post-verify to all batch organize ops"
```

---

### Task 7: Pre-validate single-message ops

**Files:**
- Modify: `src/imap-client.ts`

- [ ] **Step 1: Add pre-validation to `moveMessage` and `copyMessage`**

Replace `moveMessage`:

```typescript
async moveMessage(sourceFolder: string, uid: number, destFolder: string): Promise<void> {
  return this.withConnection(async (client) => {
    const mailboxes = await client.list();
    const paths = new Set(mailboxes.map((m) => m.path));
    assertFolderExists(paths, sourceFolder);
    assertFolderExists(paths, destFolder);
    const lock = await client.getMailboxLock(sourceFolder);
    try {
      await client.messageMove(String(uid), destFolder, { uid: true });
    } finally {
      lock.release();
    }
  });
}
```

Replace `copyMessage`:

```typescript
async copyMessage(sourceFolder: string, uid: number, destFolder: string): Promise<void> {
  return this.withConnection(async (client) => {
    const mailboxes = await client.list();
    const paths = new Set(mailboxes.map((m) => m.path));
    assertFolderExists(paths, sourceFolder);
    assertFolderExists(paths, destFolder);
    const lock = await client.getMailboxLock(sourceFolder);
    try {
      await client.messageCopy(String(uid), destFolder, { uid: true });
    } finally {
      lock.release();
    }
  });
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/imap-client.ts
git commit -m "fix: pre-validate folders in moveMessage and copyMessage"
```

---

## Phase 3 — Clean snippets + List-Unsubscribe (Items 3, 4)

### Task 8: `parseListUnsubscribe` util — tests first

**Files:**
- Create: `tests/utils/list-unsubscribe.test.ts`
- Create: `src/utils/snippet.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/utils/list-unsubscribe.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseListUnsubscribe } from '../../src/utils/snippet.js';

describe('parseListUnsubscribe', () => {
  it('parses mailto and http together', () => {
    const result = parseListUnsubscribe('<mailto:unsub@example.com>, <https://example.com/u/123>');
    expect(result.mailto).toBe('unsub@example.com');
    expect(result.http).toBe('https://example.com/u/123');
  });

  it('parses mailto only', () => {
    const result = parseListUnsubscribe('<mailto:unsub@example.com>');
    expect(result.mailto).toBe('unsub@example.com');
    expect(result.http).toBeUndefined();
  });

  it('parses http only', () => {
    const result = parseListUnsubscribe('<https://example.com/u/abc>');
    expect(result.http).toBe('https://example.com/u/abc');
    expect(result.mailto).toBeUndefined();
  });

  it('tolerates extra whitespace and lowercase scheme', () => {
    const result = parseListUnsubscribe('  < MAILTO:unsub@example.com > ,  <http://example.com/u> ');
    expect(result.mailto).toBe('unsub@example.com');
    expect(result.http).toBe('http://example.com/u');
  });

  it('returns empty object on undefined input', () => {
    expect(parseListUnsubscribe(undefined)).toEqual({});
  });

  it('returns empty object on malformed input', () => {
    expect(parseListUnsubscribe('garbage no brackets')).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- list-unsubscribe`
Expected: FAIL — `Cannot find module '../../src/utils/snippet.js'`

- [ ] **Step 3: Implement `parseListUnsubscribe`**

Create `src/utils/snippet.ts`:

```typescript
import { simpleParser } from 'mailparser';

export interface ParsedListUnsubscribe {
  mailto?: string;
  http?: string;
}

export function parseListUnsubscribe(header: string | undefined): ParsedListUnsubscribe {
  if (!header) return {};
  const result: ParsedListUnsubscribe = {};
  // Match <...> tokens
  const tokens = header.match(/<[^>]+>/g);
  if (!tokens) return {};
  for (const raw of tokens) {
    const uri = raw.slice(1, -1).trim();
    const lower = uri.toLowerCase();
    if (lower.startsWith('mailto:')) {
      if (!result.mailto) result.mailto = uri.slice(7).trim();
    } else if (lower.startsWith('http://') || lower.startsWith('https://')) {
      if (!result.http) result.http = uri;
    }
  }
  return result;
}

export interface CleanSnippetResult {
  snippet: string;
  hasUnsubscribe: boolean;
  unsubscribeMailto?: string;
  unsubscribeHttp?: string;
  unsubscribeOneClick: boolean;
}

export async function buildCleanSnippet(
  source: Buffer,
  snippetLength: number,
): Promise<CleanSnippetResult> {
  const parsed = await simpleParser(source, { skipImageLinks: true });
  const text = (parsed.text || '').replace(/\s+/g, ' ').trim();
  const snippet = text.slice(0, snippetLength);

  const listUnsubHeader = parsed.headers.get('list-unsubscribe');
  const headerString = typeof listUnsubHeader === 'string'
    ? listUnsubHeader
    : listUnsubHeader && typeof listUnsubHeader === 'object' && 'text' in listUnsubHeader
      ? (listUnsubHeader as { text: string }).text
      : undefined;

  const { mailto, http } = parseListUnsubscribe(headerString);
  const oneClick = parsed.headers.has('list-unsubscribe-post');

  return {
    snippet,
    hasUnsubscribe: !!(mailto || http),
    unsubscribeMailto: mailto,
    unsubscribeHttp: http,
    unsubscribeOneClick: oneClick && !!mailto,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- list-unsubscribe`
Expected: 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/utils/snippet.ts tests/utils/list-unsubscribe.test.ts
git commit -m "feat: add parseListUnsubscribe and buildCleanSnippet utils"
```

---

### Task 9: `buildCleanSnippet` — fixture-based tests

**Files:**
- Create: `tests/fixtures/qp-html.eml`
- Create: `tests/fixtures/plain-with-unsub.eml`
- Create: `tests/utils/snippet.test.ts`

- [ ] **Step 1: Create the QP+HTML fixture**

Create `tests/fixtures/qp-html.eml`:

```
From: Newsletter <news@example.com>
To: user@proton.me
Subject: Weekly digest
Date: Mon, 12 May 2026 10:00:00 +0000
Content-Type: multipart/alternative; boundary="bdy"
List-Unsubscribe: <mailto:unsub@example.com>, <https://example.com/u/123>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
MIME-Version: 1.0

--bdy
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Hello =E2=80=94 here is your weekly digest with =CD=8F=C2=A0special chars.

--bdy
Content-Type: text/html; charset=UTF-8

<html><head><style>@media (max-width:600px){.x{display:none}}</style></head>
<body><p>Hello &mdash; here is your <b>weekly</b> digest with&zwnj;special chars.</p></body></html>
--bdy--
```

- [ ] **Step 2: Create the plain text fixture**

Create `tests/fixtures/plain-with-unsub.eml`:

```
From: Sender <sender@example.com>
To: user@proton.me
Subject: Plain hello
Date: Mon, 12 May 2026 11:00:00 +0000
Content-Type: text/plain; charset=UTF-8
List-Unsubscribe: <mailto:goodbye@example.com>
MIME-Version: 1.0

Just a plain text message. No HTML, no encoding tricks.
```

- [ ] **Step 3: Write failing tests**

Create `tests/utils/snippet.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildCleanSnippet } from '../../src/utils/snippet.js';

const fixturePath = (name: string) => join(__dirname, '..', 'fixtures', name);

describe('buildCleanSnippet', () => {
  it('decodes quoted-printable and yields clean text from multipart/alternative', async () => {
    const source = readFileSync(fixturePath('qp-html.eml'));
    const result = await buildCleanSnippet(source, 200);
    expect(result.snippet).toContain('Hello');
    expect(result.snippet).toContain('special chars');
    expect(result.snippet).not.toContain('=E2=80=94');
    expect(result.snippet).not.toContain('=CD=8F=C2=A0');
    expect(result.snippet).not.toContain('@media');
    expect(result.snippet).not.toContain('&zwnj;');
    expect(result.snippet).not.toContain('<');
    expect(result.snippet).not.toContain('>');
  });

  it('surfaces List-Unsubscribe mailto and http with one-click flag', async () => {
    const source = readFileSync(fixturePath('qp-html.eml'));
    const result = await buildCleanSnippet(source, 200);
    expect(result.hasUnsubscribe).toBe(true);
    expect(result.unsubscribeMailto).toBe('unsub@example.com');
    expect(result.unsubscribeHttp).toBe('https://example.com/u/123');
    expect(result.unsubscribeOneClick).toBe(true);
  });

  it('handles plain text with mailto-only List-Unsubscribe and no one-click', async () => {
    const source = readFileSync(fixturePath('plain-with-unsub.eml'));
    const result = await buildCleanSnippet(source, 200);
    expect(result.snippet).toContain('Just a plain text message');
    expect(result.hasUnsubscribe).toBe(true);
    expect(result.unsubscribeMailto).toBe('goodbye@example.com');
    expect(result.unsubscribeHttp).toBeUndefined();
    expect(result.unsubscribeOneClick).toBe(false);
  });

  it('truncates snippet to requested length', async () => {
    const source = readFileSync(fixturePath('plain-with-unsub.eml'));
    const result = await buildCleanSnippet(source, 10);
    expect(result.snippet.length).toBeLessThanOrEqual(10);
  });

  it('returns hasUnsubscribe=false when no List-Unsubscribe header', async () => {
    const minimal = Buffer.from(
      'From: a@b.com\r\nTo: c@d.com\r\nSubject: hi\r\nContent-Type: text/plain\r\n\r\nBody.\r\n',
    );
    const result = await buildCleanSnippet(minimal, 100);
    expect(result.hasUnsubscribe).toBe(false);
    expect(result.snippet).toBe('Body.');
  });
});
```

- [ ] **Step 4: Run tests — they should pass since `buildCleanSnippet` already exists from Task 8**

Run: `npm test -- snippet`
Expected: 5 tests passed.

If any assertion fails, fix `buildCleanSnippet` so all pass before continuing.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/qp-html.eml tests/fixtures/plain-with-unsub.eml tests/utils/snippet.test.ts
git commit -m "test: add fixture-based tests for buildCleanSnippet"
```

---

### Task 10: Wire `buildCleanSnippet` into `getMessagesWithSnippets`

**Files:**
- Modify: `src/imap-client.ts`

- [ ] **Step 1: Replace `getMessagesWithSnippets` to use the util**

Find the method (around line 478) and replace:

```typescript
async getMessagesWithSnippets(
  folder: string,
  limit: number,
  offset: number,
  unreadOnly: boolean,
  snippetLength: number,
): Promise<{ messages: SnippetMessage[]; total: number }> {
  return this.withConnection(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const mailbox = client.mailbox;
      if (!mailbox || mailbox.exists === 0) return { messages: [], total: 0 };

      let uids: number[];
      if (unreadOnly) {
        const searchResult = await client.search({ seen: false }, { uid: true });
        uids = searchResult === false ? [] : searchResult;
      } else {
        const searchResult = await client.search({ all: true }, { uid: true });
        uids = searchResult === false ? [] : searchResult;
      }

      const total = uids.length;
      uids.sort((a, b) => b - a);
      const sliced = uids.slice(offset, offset + limit);
      if (sliced.length === 0) return { messages: [], total };

      const messages: SnippetMessage[] = [];
      const range = sliced.join(',');

      const { buildCleanSnippet } = await import('./utils/snippet.js');

      for await (const msg of client.fetch(range, {
        envelope: true,
        flags: true,
        bodyStructure: true,
        source: true,
      }, { uid: true })) {
        const summary = this.parseMessageSummary(msg);
        let snippetData = {
          snippet: '',
          hasUnsubscribe: false,
          unsubscribeMailto: undefined as string | undefined,
          unsubscribeHttp: undefined as string | undefined,
          unsubscribeOneClick: false,
        };
        if (msg.source) {
          try {
            snippetData = await buildCleanSnippet(msg.source as Buffer, snippetLength);
          } catch {
            // fall through with empty snippet
          }
        }
        messages.push({
          ...summary,
          snippet: snippetData.snippet,
          ...(snippetData.hasUnsubscribe && { hasUnsubscribe: true }),
          ...(snippetData.unsubscribeMailto && { unsubscribeMailto: snippetData.unsubscribeMailto }),
          ...(snippetData.unsubscribeHttp && { unsubscribeHttp: snippetData.unsubscribeHttp }),
          ...(snippetData.unsubscribeOneClick && { unsubscribeOneClick: true }),
        });
      }

      return { messages, total };
    } finally {
      lock.release();
    }
  });
}
```

Update imports at top of `src/imap-client.ts` to include `SnippetMessage`:

```typescript
import type { BridgeConfig, FolderInfo, FolderStats, MessageSummary, MessageFull, AttachmentMeta, AttachmentSummary, SenderSummary, BatchResult, SnippetMessage } from './utils/types.js';
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All previous tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/imap-client.ts
git commit -m "feat(snippets): use mailparser-based clean snippets with List-Unsubscribe surfacing"
```

---

## Phase 4 — Triage helpers (Items 5, 7)

### Task 11: `clusterSubjects` util — tests first

**Files:**
- Create: `tests/utils/clustering.test.ts`
- Create: `src/utils/clustering.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/utils/clustering.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { clusterSubjects, normalizeSubject } from '../../src/utils/clustering.js';

describe('normalizeSubject', () => {
  it('replaces dollar amounts', () => {
    expect(normalizeSubject('Chase: $92.88 transaction')).toBe('chase: $amount transaction');
    expect(normalizeSubject('You spent $1,234.50 at Amazon')).toBe('you spent $amount at amazon');
  });

  it('replaces order numbers (6+ digits)', () => {
    expect(normalizeSubject('Order #123456 confirmed')).toBe('order #number confirmed');
  });

  it('replaces hex ids (8+ chars)', () => {
    expect(normalizeSubject('Receipt abc123def456')).toBe('receipt id');
  });

  it('replaces dates', () => {
    expect(normalizeSubject('Statement for 5/12/2026')).toBe('statement for date');
  });

  it('strips Re:/Fwd: prefixes', () => {
    expect(normalizeSubject('Re: hello')).toBe('hello');
    expect(normalizeSubject('Fwd: Re: foo')).toBe('foo');
  });

  it('lowercases and collapses whitespace', () => {
    expect(normalizeSubject('  HELLO   WORLD  ')).toBe('hello world');
  });
});

describe('clusterSubjects', () => {
  it('groups identical normalized subjects', () => {
    const msgs = [
      { uid: 1, subject: '$50.00 transaction from Amazon' },
      { uid: 2, subject: '$12.34 transaction from Amazon' },
      { uid: 3, subject: '$999.00 transaction from Amazon' },
      { uid: 4, subject: 'Unrelated subject' },
    ];
    const clusters = clusterSubjects(msgs);
    expect(clusters.length).toBe(1);
    expect(clusters[0].count).toBe(3);
    expect(clusters[0].sampleUids).toEqual([1, 2, 3]);
    expect(clusters[0].pattern).toContain('$amount transaction from amazon');
  });

  it('returns clusters in descending count order', () => {
    const msgs = [
      { uid: 1, subject: 'A' },
      { uid: 2, subject: 'A' },
      { uid: 3, subject: 'B' },
      { uid: 4, subject: 'B' },
      { uid: 5, subject: 'B' },
    ];
    const clusters = clusterSubjects(msgs);
    expect(clusters[0].pattern).toBe('b');
    expect(clusters[0].count).toBe(3);
    expect(clusters[1].pattern).toBe('a');
    expect(clusters[1].count).toBe(2);
  });

  it('respects minClusterSize option', () => {
    const msgs = [
      { uid: 1, subject: 'X' },
      { uid: 2, subject: 'X' },
      { uid: 3, subject: 'Y' },
    ];
    const clusters = clusterSubjects(msgs, { minClusterSize: 2 });
    expect(clusters.length).toBe(1);
    expect(clusters[0].pattern).toBe('x');
  });

  it('respects maxClusters option', () => {
    const msgs = [
      { uid: 1, subject: 'A' }, { uid: 2, subject: 'A' },
      { uid: 3, subject: 'B' }, { uid: 4, subject: 'B' },
      { uid: 5, subject: 'C' }, { uid: 6, subject: 'C' },
      { uid: 7, subject: 'D' }, { uid: 8, subject: 'D' },
    ];
    const clusters = clusterSubjects(msgs, { maxClusters: 2 });
    expect(clusters.length).toBe(2);
  });

  it('caps sampleUids at 3 per cluster', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({ uid: i + 1, subject: 'same' }));
    const clusters = clusterSubjects(msgs);
    expect(clusters[0].sampleUids.length).toBe(3);
    expect(clusters[0].count).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- clustering`
Expected: FAIL — `Cannot find module '../../src/utils/clustering.js'`

- [ ] **Step 3: Implement clustering**

Create `src/utils/clustering.ts`:

```typescript
import type { SubjectCluster } from './types.js';

export function normalizeSubject(subject: string): string {
  let s = subject;
  // Strip Re:/Fwd:/Fw: prefixes (possibly chained)
  while (/^\s*(re|fwd|fw):\s*/i.test(s)) {
    s = s.replace(/^\s*(re|fwd|fw):\s*/i, '');
  }
  // Lowercase
  s = s.toLowerCase();
  // Dollar amounts
  s = s.replace(/\$[\d,]+(?:\.\d+)?/g, '$amount');
  // ISO and slash dates
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, 'date');
  s = s.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, 'date');
  // Month-name dates
  s = s.replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{2,4})?\b/g, 'date');
  // Hex IDs (8+ chars, must contain a-f)
  s = s.replace(/\b(?=[a-z0-9]*[a-f])[a-f0-9]{8,}\b/g, 'id');
  // Bare integers 6+ digits (order numbers)
  s = s.replace(/\b\d{6,}\b/g, 'number');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

interface ClusterOptions {
  minClusterSize?: number;
  maxClusters?: number;
  maxSamplePerCluster?: number;
}

export function clusterSubjects(
  messages: Array<{ uid: number; subject: string }>,
  opts: ClusterOptions = {},
): SubjectCluster[] {
  const minClusterSize = opts.minClusterSize ?? 2;
  const maxClusters = opts.maxClusters ?? 3;
  const maxSamplePerCluster = opts.maxSamplePerCluster ?? 3;

  const groups = new Map<string, number[]>();
  for (const m of messages) {
    const key = normalizeSubject(m.subject);
    if (!key) continue;
    const arr = groups.get(key) || [];
    arr.push(m.uid);
    groups.set(key, arr);
  }

  const clusters: SubjectCluster[] = [];
  for (const [pattern, uids] of groups) {
    if (uids.length < minClusterSize) continue;
    clusters.push({
      pattern,
      count: uids.length,
      sampleUids: uids.slice(0, maxSamplePerCluster),
    });
  }
  clusters.sort((a, b) => b.count - a.count);
  return clusters.slice(0, maxClusters);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- clustering`
Expected: 11 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/utils/clustering.ts tests/utils/clustering.test.ts
git commit -m "feat: add subject clustering util"
```

---

### Task 12: Wire clusters into `get_inbox_digest`

**Files:**
- Modify: `src/imap-client.ts`

- [ ] **Step 1: Replace `getInboxDigest` to include clusters per sender**

Find `getInboxDigest` (around line 413) and replace its body so the `senderMap` also tracks `subjects: Array<{uid, subject}>`, then call `clusterSubjects` per top sender:

```typescript
async getInboxDigest(inboxFolder: string, topSendersLimit: number): Promise<{
  folderStats: FolderStats[];
  inboxTotal: number;
  inboxUnread: number;
  topSenders: SenderSummaryWithClusters[];
}> {
  const { clusterSubjects } = await import('./utils/clustering.js');
  return this.withConnection(async (client) => {
    const mailboxes = await client.list();
    const folderStats: FolderStats[] = [];
    let inboxTotal = 0;
    let inboxUnread = 0;

    for (const mb of mailboxes) {
      try {
        const status = await client.status(mb.path, { messages: true, unseen: true });
        const total = status.messages ?? 0;
        const unseen = status.unseen ?? 0;
        folderStats.push({ path: mb.path, total, unseen });
        if (mb.path === inboxFolder) {
          inboxTotal = total;
          inboxUnread = unseen;
        }
      } catch {
        folderStats.push({ path: mb.path, total: 0, unseen: 0 });
      }
    }

    let topSenders: SenderSummaryWithClusters[] = [];
    if (inboxTotal > 0) {
      const lock = await client.getMailboxLock(inboxFolder);
      try {
        const searchResult = await client.search({ all: true }, { uid: true });
        const uids: number[] = searchResult === false ? [] : searchResult;
        if (uids.length > 0) {
          const range = uids.join(',');
          const senderMap = new Map<string, {
            name: string;
            count: number;
            latestDate: string;
            uids: number[];
            subjects: Array<{ uid: number; subject: string }>;
          }>();
          for await (const msg of client.fetch(range, { envelope: true }, { uid: true })) {
            const from = msg.envelope?.from?.[0];
            if (!from) continue;
            const address = (from.address || '').toLowerCase();
            const name = from.name || address;
            const date = msg.envelope?.date?.toISOString() || '';
            const subject = msg.envelope?.subject || '';
            const existing = senderMap.get(address);
            if (existing) {
              existing.count++;
              existing.uids.push(msg.uid);
              existing.subjects.push({ uid: msg.uid, subject });
              if (date > existing.latestDate) existing.latestDate = date;
            } else {
              senderMap.set(address, {
                name,
                count: 1,
                latestDate: date,
                uids: [msg.uid],
                subjects: [{ uid: msg.uid, subject }],
              });
            }
          }
          const sorted = [...senderMap.entries()]
            .map(([address, data]) => ({
              sender: data.name,
              address,
              count: data.count,
              latestDate: data.latestDate,
              uids: data.uids,
              subjects: data.subjects,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, topSendersLimit);
          topSenders = sorted.map((s) => {
            const clusters = clusterSubjects(s.subjects);
            const { subjects: _drop, ...rest } = s;
            return clusters.length > 0 ? { ...rest, topClusters: clusters } : rest;
          });
        }
      } finally {
        lock.release();
      }
    }

    return { folderStats, inboxTotal, inboxUnread, topSenders };
  });
}
```

Update imports in `src/imap-client.ts`:

```typescript
import type { BridgeConfig, FolderInfo, FolderStats, MessageSummary, MessageFull, AttachmentMeta, AttachmentSummary, SenderSummary, BatchResult, SnippetMessage, SenderSummaryWithClusters } from './utils/types.js';
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/imap-client.ts
git commit -m "feat(digest): include subject clusters per top sender"
```

---

### Task 13: `get_changes_since` tool

**Files:**
- Modify: `src/imap-client.ts`
- Create: `src/tools/changes.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add `getChangesSince` to `ImapClientManager`**

Append to `src/imap-client.ts` (before the closing brace of the class):

```typescript
async getChangesSince(
  since: Date,
  folders: string[],
): Promise<ChangesSinceResult> {
  return this.withConnection(async (client) => {
    const mailboxes = await client.list();
    const known = new Set(mailboxes.map((m) => m.path));
    const byFolder: Record<string, { newMessages: MessageSummary[]; count: number }> = {};
    let totalNew = 0;

    for (const folder of folders) {
      if (!known.has(folder)) {
        byFolder[folder] = { newMessages: [], count: 0 };
        continue;
      }
      const lock = await client.getMailboxLock(folder);
      try {
        // IMAP SINCE has day granularity — fetch then filter to exact timestamp
        const sinceDate = new Date(since);
        sinceDate.setHours(0, 0, 0, 0);
        const searchResult = await client.search({ since: sinceDate }, { uid: true });
        const uids: number[] = searchResult === false ? [] : searchResult;
        if (uids.length === 0) {
          byFolder[folder] = { newMessages: [], count: 0 };
          continue;
        }
        const range = uids.join(',');
        const messages: MessageSummary[] = [];
        for await (const msg of client.fetch(range, {
          envelope: true,
          flags: true,
          bodyStructure: true,
          internalDate: true,
        }, { uid: true })) {
          const internal = (msg as any).internalDate as Date | undefined;
          if (internal && internal.getTime() < since.getTime()) continue;
          messages.push(this.parseMessageSummary(msg));
        }
        messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        byFolder[folder] = { newMessages: messages, count: messages.length };
        totalNew += messages.length;
      } finally {
        lock.release();
      }
    }

    return { since: since.toISOString(), byFolder, totalNew };
  });
}
```

Update imports:

```typescript
import type { BridgeConfig, FolderInfo, FolderStats, MessageSummary, MessageFull, AttachmentMeta, AttachmentSummary, SenderSummary, BatchResult, SnippetMessage, SenderSummaryWithClusters, ChangesSinceResult } from './utils/types.js';
```

- [ ] **Step 2: Create `src/tools/changes.ts`**

```typescript
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function getChangesSinceHandler(
  imap: ImapClientManager,
  params: { since: string; folders?: string[] }
): Promise<ToolResult> {
  const sinceDate = new Date(params.since);
  if (isNaN(sinceDate.getTime())) {
    throw new Error(`Invalid 'since' timestamp: ${params.since}. Expected ISO 8601.`);
  }
  const folders = params.folders && params.folders.length > 0 ? params.folders : ['INBOX'];
  const result = await imap.getChangesSince(sinceDate, folders);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
```

- [ ] **Step 3: Register the tool in `src/index.ts`**

Add this `import`:

```typescript
import { getChangesSinceHandler } from './tools/changes.js';
```

Add this registration (place near `get_inbox_digest`):

```typescript
server.registerTool('get_changes_since', {
  title: 'Changes Since Timestamp',
  description: 'Stateless diff: returns new messages received since the given ISO 8601 timestamp across the specified folders. Default folder is INBOX. Catches new arrivals only (flag changes are not surfaced).',
  inputSchema: z.object({
    since: z.string().describe('ISO 8601 timestamp, e.g. "2026-05-07T00:00:00Z"'),
    folders: z.array(z.string()).max(20).optional().describe('Folders to check (default: ["INBOX"])'),
  }),
}, async ({ since, folders }) => {
  await imap.connect();
  return getChangesSinceHandler(imap, { since, folders });
});
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/imap-client.ts src/tools/changes.ts src/index.ts
git commit -m "feat: add get_changes_since tool (stateless IMAP SEARCH SINCE)"
```

---

## Phase 5 — Workflow ops (Item 6)

### Task 14: `route` and `batch_route` tools

**Files:**
- Modify: `src/imap-client.ts`
- Create: `src/tools/route.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add `routeMessages` to `ImapClientManager`**

Append to `src/imap-client.ts`:

```typescript
async routeMessages(
  sourceFolder: string,
  uids: number[],
  labels: string[],
  destinationFolder: string | undefined,
): Promise<RouteResult> {
  if (uids.length === 0) {
    return { success: true, requested: 0, labeled: [] };
  }
  return this.withConnection(async (client) => {
    const mailboxes = await client.list();
    const paths = new Set(mailboxes.map((m) => m.path));
    assertFolderExists(paths, sourceFolder);
    for (const lbl of labels) {
      assertFolderExists(paths, lbl);
    }
    if (destinationFolder) {
      assertFolderExists(paths, destinationFolder);
    }

    const range = uids.join(',');
    const labeled: Array<{ folder: string; copied: number; success: boolean }> = [];

    // Apply labels first (COPY — UIDs stay valid)
    for (const lbl of labels) {
      const before = (await client.status(lbl, { messages: true })).messages ?? 0;
      const lock = await client.getMailboxLock(sourceFolder);
      try {
        await client.messageCopy(range, lbl, { uid: true });
      } finally {
        lock.release();
      }
      const after = (await client.status(lbl, { messages: true })).messages ?? 0;
      const copied = after - before;
      labeled.push({ folder: lbl, copied, success: copied === uids.length });
    }

    // Move last (MOVE invalidates source UIDs)
    let movedResult: { destination: string; moved: number; success: boolean } | undefined;
    let failedUids: number[] | undefined;
    if (destinationFolder) {
      const before = (await client.status(sourceFolder, { messages: true })).messages ?? 0;
      const lock = await client.getMailboxLock(sourceFolder);
      try {
        await client.messageMove(range, destinationFolder, { uid: true });
      } finally {
        lock.release();
      }
      const after = (await client.status(sourceFolder, { messages: true })).messages ?? 0;
      const moved = before - after;
      movedResult = { destination: destinationFolder, moved, success: moved === uids.length };

      if (moved < uids.length) {
        const checkLock = await client.getMailboxLock(sourceFolder);
        try {
          const result = await client.search({ uid: range }, { uid: true });
          failedUids = result === false ? [] : result;
        } finally {
          checkLock.release();
        }
      }
    }

    const allLabeledOk = labeled.every((l) => l.success);
    const moveOk = movedResult ? movedResult.success : true;
    return {
      success: allLabeledOk && moveOk,
      requested: uids.length,
      labeled,
      ...(movedResult && { moved: movedResult }),
      ...(failedUids && { failedUids }),
    };
  });
}
```

Update imports:

```typescript
import type { BridgeConfig, FolderInfo, FolderStats, MessageSummary, MessageFull, AttachmentMeta, AttachmentSummary, SenderSummary, BatchResult, SnippetMessage, SenderSummaryWithClusters, ChangesSinceResult, RouteResult } from './utils/types.js';
```

- [ ] **Step 2: Create `src/tools/route.ts`**

```typescript
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult } from '../utils/types.js';

export async function routeHandler(
  imap: ImapClientManager,
  params: {
    sourceFolder: string;
    uid: number;
    labels?: string[];
    destinationFolder?: string;
  }
): Promise<ToolResult> {
  if ((!params.labels || params.labels.length === 0) && !params.destinationFolder) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Must provide labels[] or destinationFolder (or both)' }) }],
    };
  }
  const result = await imap.routeMessages(
    params.sourceFolder,
    [params.uid],
    params.labels || [],
    params.destinationFolder,
  );
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'routed', ...result }) }],
  };
}

export async function batchRouteHandler(
  imap: ImapClientManager,
  params: {
    sourceFolder: string;
    uids: number[];
    labels?: string[];
    destinationFolder?: string;
    dryRun?: boolean;
  }
): Promise<ToolResult> {
  if ((!params.labels || params.labels.length === 0) && !params.destinationFolder) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Must provide labels[] or destinationFolder (or both)' }) }],
    };
  }
  if (params.dryRun) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        dryRun: true,
        wouldAffect: params.uids.length,
        uids: params.uids,
        sourceFolder: params.sourceFolder,
        labels: params.labels || [],
        destination: params.destinationFolder,
      }) }],
    };
  }
  const result = await imap.routeMessages(
    params.sourceFolder,
    params.uids,
    params.labels || [],
    params.destinationFolder,
  );
  return {
    content: [{ type: 'text', text: JSON.stringify({ action: 'batch_routed', ...result }) }],
  };
}
```

- [ ] **Step 3: Register the tools in `src/index.ts`**

Add import:

```typescript
import { routeHandler, batchRouteHandler } from './tools/route.js';
```

Register:

```typescript
server.registerTool('route', {
  title: 'Route Message',
  description: 'Atomic label-and-move: copy to each label folder (UIDs stay valid), then optionally move to a destination. Use this instead of separate apply_label + move_message calls to avoid UID invalidation between steps.',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Current folder of the message'),
    uid: z.number().describe('Message UID'),
    labels: z.array(z.string()).optional().describe('Label folder paths to copy the message to (preserves source UID)'),
    destinationFolder: z.string().optional().describe('Destination folder for the move (omit for label-only)'),
  }),
}, async ({ sourceFolder, uid, labels, destinationFolder }) => {
  await imap.connect();
  return routeHandler(imap, { sourceFolder, uid, labels, destinationFolder });
});

server.registerTool('batch_route', {
  title: 'Batch Route Messages',
  description: 'Atomic label-and-move for up to 500 messages. Labels copy first (preserving UIDs), then move. Use dryRun:true to preview.',
  inputSchema: z.object({
    sourceFolder: z.string().describe('Current folder of the messages'),
    uids: z.array(z.number()).min(1).max(500).describe('Array of message UIDs (max 500)'),
    labels: z.array(z.string()).optional().describe('Label folder paths to copy the messages to'),
    destinationFolder: z.string().optional().describe('Destination folder for the move (omit for label-only)'),
    dryRun: z.boolean().default(false).describe('If true, preview without mutating.'),
  }),
}, async ({ sourceFolder, uids, labels, destinationFolder, dryRun }) => {
  await imap.connect();
  return batchRouteHandler(imap, { sourceFolder, uids, labels, destinationFolder, dryRun });
});
```

- [ ] **Step 4: Update descriptions of redundant tools**

In `src/index.ts`, append `' For combined move+label, prefer route/batch_route.'` to the descriptions of: `move_message`, `apply_label`, `batch_move_messages`, `batch_apply_label`, `batch_remove_label`.

Example for `move_message`:

```typescript
server.registerTool('move_message', {
  title: 'Move Message',
  description: 'Move a message to a different folder. For combined move+label, prefer route/batch_route.',
  // ...
```

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: All previous tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/imap-client.ts src/tools/route.ts src/index.ts
git commit -m "feat: add atomic route and batch_route tools"
```

---

## Phase 6 — Sender suggestions (Item 9)

### Task 15: `suggest_sender_routes` tool

**Files:**
- Modify: `src/imap-client.ts`
- Create: `src/tools/intelligence.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add `getSenderDistribution` to `ImapClientManager`**

Append to `src/imap-client.ts`:

```typescript
async getSenderDistribution(
  excludeFolders: Set<string>,
): Promise<Map<string, { name: string; total: number; byFolder: Record<string, number> }>> {
  return this.withConnection(async (client) => {
    const mailboxes = await client.list();
    const senders = new Map<string, { name: string; total: number; byFolder: Record<string, number> }>();

    for (const mb of mailboxes) {
      if (excludeFolders.has(mb.path)) continue;
      if (mb.flags && (mb.flags as Set<string>).has('\\Noselect')) continue;
      let lock;
      try {
        lock = await client.getMailboxLock(mb.path);
      } catch {
        continue;
      }
      try {
        const result = await client.search({ all: true }, { uid: true });
        const uids: number[] = result === false ? [] : result;
        if (uids.length === 0) continue;
        const range = uids.join(',');
        for await (const msg of client.fetch(range, { envelope: true }, { uid: true })) {
          const from = msg.envelope?.from?.[0];
          if (!from || !from.address) continue;
          const address = from.address.toLowerCase();
          const name = from.name || address;
          const entry = senders.get(address) || { name, total: 0, byFolder: {} };
          entry.total++;
          entry.byFolder[mb.path] = (entry.byFolder[mb.path] || 0) + 1;
          if (!senders.has(address)) senders.set(address, entry);
        }
      } finally {
        lock.release();
      }
    }

    return senders;
  });
}
```

- [ ] **Step 2: Create `src/tools/intelligence.ts`**

```typescript
import type { ImapClientManager } from '../imap-client.js';
import type { ToolResult, SenderRoute } from '../utils/types.js';

const DEFAULT_EXCLUDE = ['Trash', 'Spam', 'Drafts', 'Sent', 'Archive', 'All Mail'];

export async function suggestSenderRoutesHandler(
  imap: ImapClientManager,
  params: { minConfidence?: number; minVolume?: number; excludeFolders?: string[] }
): Promise<ToolResult> {
  const minConfidence = params.minConfidence ?? 0.8;
  const minVolume = params.minVolume ?? 3;
  const excludeFolders = new Set(params.excludeFolders || DEFAULT_EXCLUDE);

  const distribution = await imap.getSenderDistribution(excludeFolders);

  const suggestions: SenderRoute[] = [];
  for (const [address, data] of distribution) {
    if (data.total < minVolume) continue;
    let dominantFolder = '';
    let dominantCount = 0;
    for (const [folder, count] of Object.entries(data.byFolder)) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantFolder = folder;
      }
    }
    const confidence = dominantCount / data.total;
    if (confidence < minConfidence) continue;
    if (dominantFolder === 'INBOX') continue;

    const otherFolders: Record<string, number> = {};
    for (const [folder, count] of Object.entries(data.byFolder)) {
      if (folder !== dominantFolder) otherFolders[folder] = count;
    }

    suggestions.push({
      sender: data.name,
      address,
      totalMessages: data.total,
      dominantFolder,
      confidence,
      otherFolders,
      suggestedTool: 'move_by_sender',
      suggestedArgs: {
        sourceFolder: 'INBOX',
        senderAddress: address,
        destinationFolder: dominantFolder,
      },
    });
  }

  suggestions.sort((a, b) => b.totalMessages - a.totalMessages);

  return {
    content: [{ type: 'text', text: JSON.stringify({
      suggestions,
      totalSendersAnalyzed: distribution.size,
      thresholdsUsed: { minConfidence, minVolume },
    }, null, 2) }],
  };
}
```

- [ ] **Step 3: Register the tool in `src/index.ts`**

Add import:

```typescript
import { suggestSenderRoutesHandler } from './tools/intelligence.js';
```

Register:

```typescript
server.registerTool('suggest_sender_routes', {
  title: 'Suggest Sender Routes',
  description: 'Analyze where each sender\'s mail has historically lived (across all folders) and suggest routing rules for senders whose mail consistently belongs in a non-INBOX folder. Stateless — re-derives from current IMAP state each call. Returns suggestions, does not auto-route.',
  inputSchema: z.object({
    minConfidence: z.number().min(0.5).max(1).default(0.8).describe('Minimum dominant-folder ratio (default 0.8)'),
    minVolume: z.number().min(1).default(3).describe('Minimum total messages from sender (default 3)'),
    excludeFolders: z.array(z.string()).optional().describe('Folders to skip during analysis (default: Trash, Spam, Drafts, Sent, Archive, All Mail)'),
  }),
}, async ({ minConfidence, minVolume, excludeFolders }) => {
  await imap.connect();
  return suggestSenderRoutesHandler(imap, { minConfidence, minVolume, excludeFolders });
});
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/imap-client.ts src/tools/intelligence.ts src/index.ts
git commit -m "feat: add suggest_sender_routes tool (derives from IMAP state)"
```

---

## Phase 7 — PDF text extraction (Item 10)

### Task 16: Add `pdf-parse` dependency and `get_attachment_text` tool

**Files:**
- Modify: `package.json`
- Modify: `src/tools/attachments.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Install `pdf-parse`**

Run:

```bash
npm install pdf-parse
npm install --save-dev @types/pdf-parse
```

Expected: package.json now has `pdf-parse` in dependencies and `@types/pdf-parse` in devDependencies.

- [ ] **Step 2: Add `getAttachmentTextHandler` to `src/tools/attachments.ts`**

Replace the file contents:

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

export async function getAttachmentTextHandler(
  imap: ImapClientManager,
  params: { folder: string; uid: number; attachmentPartId: string; maxChars?: number }
): Promise<ToolResult> {
  const maxChars = params.maxChars ?? 20000;
  const attachment = await imap.getAttachment(params.folder, params.uid, params.attachmentPartId);

  let text = '';
  let numPages: number | undefined;

  if (attachment.mimeType === 'application/pdf') {
    // Import the internal module path to skip pdf-parse's self-test on default import
    const pdfParseModule = await import('pdf-parse/lib/pdf-parse.js');
    const pdfParse = (pdfParseModule.default || pdfParseModule) as (b: Buffer) => Promise<{ text: string; numpages: number }>;
    const parsed = await pdfParse(attachment.content);
    text = parsed.text;
    numPages = parsed.numpages;
  } else if (attachment.mimeType.startsWith('text/')) {
    text = attachment.content.toString('utf-8');
  } else {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        error: `Unsupported MIME type for text extraction: ${attachment.mimeType}`,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
      }) }],
    };
  }

  const originalLength = text.length;
  const truncated = originalLength > maxChars;
  if (truncated) text = text.slice(0, maxChars);

  return {
    content: [{ type: 'text', text: JSON.stringify({
      text,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      ...(numPages !== undefined && { numPages }),
      truncated,
      originalLength,
    }) }],
  };
}
```

- [ ] **Step 3: Register the tool in `src/index.ts`**

Update the existing import:

```typescript
import { getAttachmentHandler, getAttachmentTextHandler } from './tools/attachments.js';
```

Add registration (near the existing `get_attachment`):

```typescript
server.registerTool('get_attachment_text', {
  title: 'Get Attachment Text',
  description: 'Extract plain text from an attachment. Supports application/pdf (via pdf-parse) and text/* MIME types. Returns truncated text up to maxChars.',
  inputSchema: z.object({
    folder: z.string().describe('Folder containing the message'),
    uid: z.number().describe('Message UID'),
    attachmentPartId: z.string().describe('Attachment part ID from the message'),
    maxChars: z.number().min(100).max(200000).default(20000).describe('Max characters to return (default 20000)'),
  }),
}, async ({ folder, uid, attachmentPartId, maxChars }) => {
  await imap.connect();
  return getAttachmentTextHandler(imap, { folder, uid, attachmentPartId, maxChars });
});
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 5: Verify tests still pass**

Run: `npm test`
Expected: All tests still pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/tools/attachments.ts src/index.ts
git commit -m "feat: add get_attachment_text tool with pdf-parse support"
```

---

## Phase 8 — Final verification

### Task 17: Update README and run final checks

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the tool tables in README.md**

Add new tools and modify descriptions in the existing tables:

Add to "Reading Messages":

```markdown
| `get_changes_since` | Stateless: returns new messages since an ISO 8601 timestamp |
```

Add to "Organizing Messages":

```markdown
| `route` / `batch_route` | Atomic label-and-move (avoids UID invalidation between separate calls) |
| `suggest_sender_routes` | Suggests routing rules based on historical sender→folder distribution |
```

Add to "Sending & Attachments":

```markdown
| `get_attachment_text` | Extract plain text from PDF or text/* attachments |
```

Add a note at the bottom of the tool listings:

```markdown
> All batch organize tools (`batch_move_messages`, `batch_apply_label`, `batch_remove_label`, `batch_delete_messages`, `cross_folder_batch_move`, `move_by_sender`, `move_by_search`, `batch_route`) accept `dryRun: true` to preview UIDs that would be affected without mutating. All move/copy ops pre-validate folder paths and post-verify counts, returning `{success, requested, moved|copied, failedUids?}`.
>
> Snippets returned by `get_messages_with_snippets` are cleaned via mailparser (quoted-printable decoded, HTML stripped) and include `hasUnsubscribe`, `unsubscribeMailto`, `unsubscribeHttp`, `unsubscribeOneClick` when the `List-Unsubscribe` header is present.
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass. Print test count.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document new tools and batch dryRun/post-verify semantics"
```

---

## Acceptance checklist (run after implementation)

- [ ] `npm test` passes — all unit tests green
- [ ] `npm run build` produces clean `dist/` with no TS errors
- [ ] Manual smoke (requires live Proton Bridge):
  - [ ] `get_messages_with_snippets {limit: 5}` returns snippets free of `=XX`, `&zwnj;`, `@media`, `<...>`
  - [ ] At least one snippet has `hasUnsubscribe: true` with `unsubscribeMailto` and/or `unsubscribeHttp`
  - [ ] `batch_move_messages {sourceFolder: 'INBOX', uids: [<some>], destinationFolder: 'Folders/Nonexistent'}` errors with a fuzzy-match hint
  - [ ] `batch_move_messages {... dryRun: true}` returns UIDs without moving
  - [ ] `get_inbox_digest` returns `topClusters` on at least one repeat-subject sender
  - [ ] `get_changes_since {since: <yesterday>}` returns count > 0 if any mail arrived
  - [ ] `route {sourceFolder, uid, labels: ['Labels/Important'], destinationFolder: 'Folders/X'}` applies the label and moves; subsequent `get_labels_for_message` on the new UID shows the label
  - [ ] `suggest_sender_routes` returns at least one rule (assuming inbox has historical mail in non-INBOX folders)
  - [ ] `get_attachment_text` on a PDF attachment returns extracted text
