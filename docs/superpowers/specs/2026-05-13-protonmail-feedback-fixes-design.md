# ProtonMail MCP — Feedback Fixes (Items 1–10)

**Date:** 2026-05-13
**Status:** Approved, ready for implementation plan
**Source:** User feedback from session 2026-05-13 covering 10 issues observed while triaging 200+ messages

## Goals

Address ten concrete pain points reported from real usage of the ProtonMail MCP server. The two highest-priority items are silent-failure bugs that destroyed trust in batch operation results; the single highest-leverage item is clean snippets, which dominates triage reading time.

## Non-goals

- No breaking changes to existing tool signatures. `route` is added; old tools stay (with updated descriptions).
- No persistent state files. Every new capability derives from the current IMAP mailbox or accepts inputs from the caller.
- No IMAP integration tests this round — those require a live Proton Bridge. Unit-test the pure utilities.

## Architecture

Pure logic lives in utilities; tool handlers are thin. `imap-client.ts` is already at ~750 lines, so new IMAP methods are added carefully and new logic is pushed to utils.

| File | Status | Purpose |
|------|--------|---------|
| `src/utils/snippet.ts` | new | `buildCleanSnippet(source)` — mailparser wrapper returning `{snippet, hasUnsubscribe, unsubscribeMailto, unsubscribeHttp}` |
| `src/utils/clustering.ts` | new | `clusterSubjects(messages, opts)` — normalize and group subjects |
| `src/utils/folder-cache.ts` | new | Single `list()` call per tool invocation; validates destination paths |
| `src/tools/route.ts` | new | `routeHandler`, `batchRouteHandler` — atomic label+move |
| `src/tools/changes.ts` | new | `getChangesSinceHandler` — stateless IMAP `SINCE` search |
| `src/tools/intelligence.ts` | new | `suggestSenderRoutesHandler` — derive routing rules from folder distribution |
| `src/tools/attachments.ts` | extend | `getAttachmentTextHandler` using `pdf-parse` |
| `src/imap-client.ts` | extend | `verifyFolderExists`, post-verify counts in `batchMoveMessages`/`batchCopyMessages`, `List-Unsubscribe` header in snippet fetch |
| `src/tools/organize.ts` | extend | `dryRun` on every batch op |
| `src/index.ts` | extend | Register new tools, add `dryRun` to existing batch tool schemas |
| `src/utils/types.ts` | extend | `unsubscribe`, `RouteResult`, `ChangesSinceResult`, `SenderRoute`, `BatchResult` types |

## A. Silent-failure fixes (Items 1, 2)

### Problem

- `batch_move_messages` returns `{success: true, moved: 14}` even when the destination path is malformed (e.g., HTML-encoded `Orders &amp; Receipts`) and zero messages move.
- `batch_apply_label` returns `{copied: N}` even when UIDs are stale (invalidated by a prior move).

### Solution: pre-validate + post-verify

Apply to every operation that moves or copies messages:
- Single-message: `move_message`, `apply_label`, `remove_label`, `delete_message`, `route`.
- Batch: `batch_move_messages`, `batch_apply_label`, `batch_remove_label`, `batch_delete_messages`, `cross_folder_batch_move`, `move_by_sender`, `move_by_search`, `batch_route`.

**Pre-validation:**

1. Single `client.list()` call at the start of the operation. Cached in a per-call `FolderCache` to avoid repeated lookups when route operations span labels + destination.
2. For every folder path the operation references (source, destination, each label), verify exact-string match in the listed paths. No HTML decode, no case-fold.
3. If any required folder is missing, throw `Error("Folder 'X' not found. Available folders matching 'partial': [...]")`. The error includes up to 5 fuzzy matches so the caller learns the right path.

**Post-verification (MOVE ops):**

1. Before the move: `STATUS sourceFolder messages` → captures source count.
2. Run `messageMove(uids → dest)`.
3. After the move: `STATUS sourceFolder messages` → captures source count.
4. `actualDelta = before - after`. Return `{success: actualDelta === uids.length, moved: actualDelta, requested: uids.length}`.
5. If `actualDelta < uids.length`: re-search the source for UIDs from the requested set that still exist (`SEARCH UID <range>`). Include them as `failedUids: number[]`.

**Post-verification (COPY ops — `batch_apply_label`):**

1. Before COPY: `STATUS labelFolder messages` → captures destination count.
2. Run `messageCopy(uids → labelFolder)`.
3. After COPY: `STATUS labelFolder messages` → captures destination count.
4. `actualDelta = after - before`. Return `{success: actualDelta === uids.length, copied: actualDelta, requested: uids.length}`.
5. If `actualDelta < uids.length`: STATUS won't tell us *which* UIDs failed, but the discrepancy is reported honestly.

**Result shape (every batch op):**

```ts
{
  success: boolean,      // actualDelta === requested
  requested: number,     // uids.length
  moved?: number,        // for move ops
  copied?: number,       // for copy/label ops
  failedUids?: number[], // present only when success: false and ops where we can detect them
  destination?: string,  // for move ops
  label?: string,        // for label ops
}
```

## B. Clean snippets + List-Unsubscribe (Items 3, 4)

### Problem

- Snippets contain MIME junk: `=E2=80=94`, `=CD=8F=C2=A0`, `&zwnj;`, raw CSS like `96 @media...`. The current regex pipeline only triggers on detected HTML and misses many encodings.
- `List-Unsubscribe` header is not surfaced, so the `/auto-unsubscribe` skill can't tell which messages qualify without re-fetching each.

### Solution: mailparser-based snippet + header extraction

In `getMessagesWithSnippets`:

1. Fetch with `{source: true, envelope: true, flags: true, bodyStructure: true}` for the page being snippeted (max `limit` messages, default 50).
2. For each message, call `buildCleanSnippet(source)`:

```ts
async function buildCleanSnippet(source: Buffer, length: number): Promise<{
  snippet: string;
  hasUnsubscribe: boolean;
  unsubscribeMailto?: string;
  unsubscribeHttp?: string;
  unsubscribeOneClick: boolean;
}> {
  const parsed = await simpleParser(source, { skipImageLinks: true });
  const text = (parsed.text || '').replace(/\s+/g, ' ').trim();
  const snippet = text.slice(0, length);

  const listUnsub = parsed.headers.get('list-unsubscribe') as string | undefined;
  const oneClick = parsed.headers.has('list-unsubscribe-post');
  const { mailto, http } = parseListUnsubscribe(listUnsub);
  return {
    snippet,
    hasUnsubscribe: !!(mailto || http),
    unsubscribeMailto: mailto,
    unsubscribeHttp: http,
    unsubscribeOneClick: oneClick && !!mailto,
  };
}
```

3. `parseListUnsubscribe` handles RFC 2369 format `<mailto:...>, <https://...>` — extract each URI, ignoring whitespace and angle brackets.
4. Return shape adds optional fields to each message: `hasUnsubscribe?`, `unsubscribeMailto?`, `unsubscribeHttp?`, `unsubscribeOneClick?`. Existing fields unchanged.

### Performance trade-off

Fetching `source: true` is ~5–20× more bytes than `bodyParts: ['1']` for HTML emails. With `limit: 50` default, this is typically <5 MB per call. Acceptable. If perf walls emerge, add `lightweight: true` opt-out later — but YAGNI for now.

## C. Triage helpers (Items 5, 7)

### #5 — Subject clusters in `get_inbox_digest`

Extend the digest response. For each top sender, include `topClusters`:

```ts
{
  sender: "Chase",
  address: "no-reply@chase.com",
  count: 5,
  topClusters: [
    {
      pattern: "$AMOUNT transaction alert from MERCHANT",
      count: 5,
      sampleUids: [101, 102, 103]
    }
  ]
}
```

**`clusterSubjects(messages, opts)` normalization:**

- Strip `Re:` / `Fwd:` / `Fw:` prefixes (case-insensitive).
- Lowercase.
- Replace `\$[\d,]+(?:\.\d+)?` → `$AMOUNT`.
- Replace dates (`\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b`, `\b(jan|feb|...)\s+\d+`, ISO dates) → `DATE`.
- Replace UUIDs and hex IDs (`[a-f0-9]{8,}`) → `ID`.
- Replace bare integers ≥6 digits (order numbers) → `NUMBER`.
- Collapse whitespace.

**Clustering:** group by canonical form. Return clusters with `count ≥ 2`, sorted desc by count, top 3 per sender (configurable via `clustersPerSender`).

### #7 — `get_changes_since` tool

```ts
get_changes_since({
  since: ISO8601 timestamp,
  folders?: string[],         // default ['INBOX']
  includeFlagChanges?: bool   // default false
})
```

**Implementation (stateless):**

For each folder in `folders`:
1. `getMailboxLock(folder)`.
2. IMAP `SEARCH SINCE <date>` — `INTERNALDATE`-based, captures actual receipt time. Date parameter accepts the `since` ISO timestamp truncated to day (IMAP SINCE has day granularity).
3. Fetch message summaries for matched UIDs.
4. Filter by `since` timestamp in-process for sub-day precision (since IMAP `SINCE` rounds to day).

**Return shape:**

```ts
{
  since: "2026-05-07T00:00:00Z",
  byFolder: {
    "INBOX": { newMessages: [MessageSummary...], count: N },
    "Sent":  { newMessages: [...], count: N }
  },
  totalNew: N
}
```

`includeFlagChanges` is out of scope for v1 — IMAP doesn't have a stateless "flag changed since" query without CONDSTORE/MODSEQ tracking. Document as "future enhancement requires server-side MODSEQ support."

## D. Workflow ops (Items 6, 8)

### #6 — `route` and `batch_route` tools

```ts
route({
  sourceFolder: string,
  uid: number,
  labels?: string[],          // label folder paths
  destinationFolder?: string  // if omitted, label-only
})

batch_route({
  sourceFolder: string,
  uids: number[],             // max 500
  labels?: string[],
  destinationFolder?: string,
  dryRun?: boolean
})
```

**Execution order** (matters — IMAP labels are COPY, which keeps UIDs valid; MOVE invalidates them):

1. Validate `sourceFolder`, every `labels[]`, and `destinationFolder` (if provided) all exist (pre-validate from §A).
2. If `labels` non-empty: for each label folder, `messageCopy(uids → label)`. UID in source unchanged.
3. If `destinationFolder` provided: `messageMove(uids → destination)`. Source UIDs now invalid.
4. Use post-verify pattern from §A on each step.

**Return shape:**

```ts
{
  success: boolean,
  requested: number,
  labeled: { folder: string; copied: number; success: boolean }[],
  moved?: { destination: string; moved: number; success: boolean },
  failedUids?: number[]
}
```

**Tool description updates:** Existing `move_message`, `apply_label`, `batch_move_messages`, `batch_apply_label`, `batch_remove_label` add to their descriptions:

> For combined move+label, prefer `route` / `batch_route` to avoid UID invalidation between calls.

### #8 — `dryRun` for all batch ops

Add `dryRun?: boolean` (default `false`) to: `batch_move_messages`, `batch_apply_label`, `batch_remove_label`, `batch_delete_messages`, `cross_folder_batch_move`, `move_by_sender`, `move_by_search`, `batch_route`.

**When `dryRun: true`:**

1. Run pre-validation (folder existence checks).
2. For search-based ops (`move_by_sender`, `move_by_search`): resolve the UID list that *would* be affected.
3. Return without mutating:

```ts
{
  dryRun: true,
  wouldAffect: number,
  uids: number[],
  sourceFolder: string,
  destination?: string,
  labels?: string[]
}
```

## E. Sender-routing suggestions (Item 9)

### New tool: `suggest_sender_routes`

```ts
suggest_sender_routes({
  minConfidence?: number,    // default 0.8 — dominant_folder_count / total_count
  minVolume?: number,        // default 3 — minimum total messages from sender
  excludeFolders?: string[]  // default ['Trash', 'Spam', 'Drafts', 'Sent', 'Archive']
})
```

**Implementation (stateless):**

1. `client.list()` → all folders except those in `excludeFolders` and system folders.
2. For each folder, fetch envelope-only for all messages, accumulate per-sender counts.
3. Aggregate per-sender: `{address, totalMessages, byFolder: {folder: count}}`.
4. For each sender with `totalMessages ≥ minVolume`:
   - `dominantFolder = argmax(byFolder)`.
   - `confidence = byFolder[dominantFolder] / totalMessages`.
   - If `confidence ≥ minConfidence` and `dominantFolder !== 'INBOX'`: emit a suggested rule.

**Return shape:**

```ts
{
  suggestions: [
    {
      sender: "Bonobos",
      address: "no-reply@bonobos.com",
      totalMessages: 47,
      dominantFolder: "Folders/Promotions",
      confidence: 1.0,
      otherFolders: { "INBOX": 0 },
      suggestedTool: "move_by_sender",
      suggestedArgs: {
        sourceFolder: "INBOX",
        senderAddress: "no-reply@bonobos.com",
        destinationFolder: "Folders/Promotions"
      }
    }
  ],
  totalSendersAnalyzed: 142,
  thresholdsUsed: { minConfidence: 0.8, minVolume: 3 }
}
```

The tool only *suggests* — it does not auto-route. Caller decides whether to invoke each suggested `move_by_sender` call.

## F. PDF text extraction (Item 10)

### Dependency

Add `pdf-parse` to `dependencies`. Import via `import pdfParse from 'pdf-parse/lib/pdf-parse.js'` to bypass the package's self-test runner that fires on the default import path.

### New tool: `get_attachment_text`

```ts
get_attachment_text({
  folder: string,
  uid: number,
  partId: string,
  maxChars?: number  // default 20000
})
```

**Implementation:**

1. Use existing `getAttachment(folder, uid, partId)` to fetch `{content: Buffer, filename, mimeType}`.
2. Dispatch on `mimeType`:
   - `application/pdf` → `pdfParse(content)` → `{text, numpages}`.
   - `text/*` → `content.toString('utf-8')`.
   - Anything else → return `{error: "Unsupported MIME type for text extraction: <mimeType>"}`.
3. Truncate at `maxChars` boundary, emit `{truncated: true, originalLength: N}` flag.

**Return shape:**

```ts
{
  text: string,
  filename: string,
  mimeType: string,
  numPages?: number,         // PDFs only
  truncated: boolean,
  originalLength: number
}
```

## Testing

Vitest is already a dev dep (1.0.4). Unit tests only this round — no IMAP integration tests because they require a running Proton Bridge.

### Test targets

- `buildCleanSnippet` — fixtures with quoted-printable, HTML-only, multipart/alternative, `List-Unsubscribe` present/absent, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, charset-encoded (ISO-8859-1, UTF-8 BOM).
- `parseListUnsubscribe` — `<mailto:...>, <https://...>` variants, malformed input, missing brackets.
- `clusterSubjects` — Chase-style transaction alerts (varying amounts), LinkedIn InMail variants, identical subjects, edge cases (empty subject, Re: chains).
- `FolderCache` — repeated lookups don't re-list; missing folders produce fuzzy-match suggestions.
- Route ordering — given mocked `messageCopy`/`messageMove` calls, verify labels execute before move.
- `pdf-parse` import path — assert `dist/index.js` import works without firing the package's self-test.

### Files

Tests in `tests/` directory (greenfield — none exist today). Fixture MIME payloads in `tests/fixtures/`.

## Open considerations

- **Snippet fetch cost:** addressed above (§B trade-off). Defer opt-out flag.
- **`pdf-parse` landmine:** the package runs `test/data/05-versions-space.pdf` on default import. We import the internal module path to skip. This is the conventional workaround and is documented in pdf-parse issues.
- **Existing tool deprecation:** none this round. The redundant tools after `route` lands (e.g., separate `batch_move_messages` + `batch_apply_label`) get description hints to prefer `route`, but stay functional. A follow-up cleanup commit can remove them once usage migrates.
- **`get_changes_since` flag changes:** v1 covers new arrivals only. Read/star changes require CONDSTORE; Proton Bridge support is unverified. Document as v2.
- **`suggest_sender_routes` perf:** scanning every folder's envelopes can be slow on large mailboxes. Default folder exclusions help; user can narrow further with `excludeFolders`.

## Out of scope (deferred)

- Persistent state files for any feature.
- CONDSTORE/MODSEQ tracking for incremental sync.
- OCR / image-based PDFs.
- Automatic rule application from `suggest_sender_routes`.
- Server-side IMAP filters via Sieve.

## Acceptance criteria

- Every batch op reports `requested` and `moved`/`copied` counts; `success: false` when they differ.
- Bad destination paths raise informative errors with fuzzy matches, not silent zero-moves.
- `getMessagesWithSnippets` snippets contain no `=XX`, `&zwnj;`, `@media`, or raw CSS in spot-checks of HTML newsletters.
- `hasUnsubscribe`, `unsubscribeMailto`, `unsubscribeHttp` surfaced when present.
- `get_inbox_digest` returns subject clusters per top sender.
- `get_changes_since` returns new messages from a timestamp without state files.
- `route` and `batch_route` work atomically (labels copy successfully even when the subsequent move fails).
- Every batch op accepts `dryRun: true` and returns affected UIDs without mutating.
- `suggest_sender_routes` returns sender→folder rules with confidence scores.
- `get_attachment_text` returns plain text for PDF and `text/*` attachments.
- All new utility functions have unit tests.
