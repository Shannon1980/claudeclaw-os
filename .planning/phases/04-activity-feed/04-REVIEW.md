---
phase: 04-activity-feed
reviewed: 2026-06-24T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/activity-render.ts
  - src/activity.ts
  - src/approval-queue.ts
  - src/undo-executor.ts
  - src/activity-summary.ts
  - src/dashboard.ts
  - web/src/pages/Activity.tsx
  - web/src/lib/routes.ts
  - web/src/lib/vocabulary.ts
  - web/src/App.tsx
  - web/src/pages/Home.tsx
  - web/src/pages/Audit.tsx
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
status: resolved
fixed_at: 2026-06-24
resolved:
  - CR-01
  - CR-02
  - WR-01
  - WR-02
  - WR-03
  - WR-04
  - IN-01
  - IN-02
---

# Phase 04: Code Review Report

**Reviewed:** 2026-06-24
**Depth:** standard
**Files Reviewed:** 12
**Status:** resolved (all 8 findings fixed 2026-06-24)

## Summary

This phase implements the curated Activity feed, the undo inverse executor, the Summarize Today LLM digest, three new Hono routes, and the operator-facing Activity surface. The design is well-considered: the allowlist predicate is a single source of truth shared between the feed flag and the executor, the claim-before-dispatch pattern is the right shape for preventing double-fire, and the audit-dedupe strategy is sound.

Two bugs break the guarantees the implementation claims to provide. The most serious is a broken SQL LIKE guard in `claimUndo` that defeats the double-fire protection during the entire async MCP call window. The second is an unbounded DB read in `buildActivityFeed` that fetches every permission audit row into memory before applying the limit, which will crash the Node process in any long-running installation.

Four warnings and two info-level items cover HTTP status correctness, a duplicate sidebar icon, a label undo edge case that silently sends a malformed inverse, and em dash violations in `Home.tsx` user-facing copy.

---

## Critical Issues

### CR-01: `claimUndo` stamps the wrong marker, defeating double-fire protection

**Status:** RESOLVED (commit 7968dbe) — stamped full `UNDONE_MARKER` (trailing space) and added a regression test proving a second `claimUndo` before finalize is refused.

**File:** `src/approval-queue.ts:250`

**Issue:** `UNDONE_MARKER` is defined as `'[undone] '` (with a trailing space). The SQL LIKE guard that prevents double-fire is `result NOT LIKE '[undone] %'`, which requires the space. But `claimUndo` stamps the result column using `UNDONE_MARKER.trim()`, producing `'[undone]'` (no space). The LIKE pattern `'[undone] %'` does not match `'[undone]'`, so the guard evaluates to TRUE (not like = not yet undone) for the in-progress claim. A second concurrent `POST /api/activity/:id/undo` request arriving while `undoAction` is running (up to 30 seconds, `MCP_CALL_TIMEOUT_MS`) will find the row with `result='[undone]'`, pass the SQL guard, succeed with `changes === 1`, and dispatch the inverse MCP call a second time.

`finalizeUndo` correctly uses `UNDONE_MARKER + body` (with the space), so the guard works after finalization. The double-fire window is exactly the duration of the async MCP call.

**Fix:** Remove the `.trim()` call so the initial stamp matches the LIKE guard pattern:

```typescript
// src/approval-queue.ts, inside claimUndo()
.run(UNDONE_MARKER, now, id);  // was: UNDONE_MARKER.trim()
```

After this change, the SQL LIKE guard `result NOT LIKE '[undone] %'` will see `'[undone] '` and evaluate correctly to FALSE on a second claim attempt, making `changes === 0` and returning `false` as intended.

---

### CR-02: `buildActivityFeed` fetches all audit permission rows without a DB-level LIMIT

**Status:** RESOLVED (commit 7837cc8) — pushed the outcome filter into SQL and added `LIMIT limit*2` to the audit read.

**File:** `src/activity.ts:193-199`

**Issue:** The `audit_log` query fetches every row where `action = 'permission'` with no `LIMIT` clause:

```sql
SELECT id, agent_id, detail, created_at FROM audit_log
  WHERE action = 'permission'
  ORDER BY created_at DESC, id DESC
```

The query result is then filtered in JS (`detail.outcome !== 'allow' && ...`), and the row cap is applied only after the merge with queue rows. In any installation that has run for weeks or months, this table can contain tens of thousands of rows. The full result set is deserialized into JavaScript objects in a synchronous SQLite `all()` call. This will progressively degrade, and eventually crash, the Node process. The `GET /api/activity` endpoint, called every time the Activity tab is loaded, triggers this path.

**Fix:** Push the outcome filter into the SQL and add a LIMIT that accounts for the worst-case row count needed after merge:

```typescript
const auditRaw = getDb()
  .prepare(
    `SELECT id, agent_id, detail, created_at FROM audit_log
       WHERE action = 'permission'
         AND (detail LIKE '%"outcome":"allow"%' OR detail LIKE '%"outcome":"approved-inline"%')
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
  )
  .all(limit * 2) as Array<{ ... }>;
```

The LIKE pre-filter is a heuristic (a valid outcome JSON string always contains the key), not a replacement for the JS parse-and-check, so the existing `parseDetail` + outcome check remains. `limit * 2` ensures there are enough rows to fill the merged feed after dedup with queue rows.

---

## Warnings

### WR-01: Undo route returns HTTP 200 for all failure cases

**Status:** RESOLVED (commit 9013403) — 404 not-found, 409 wrong-state/already-undone, 400 not-undoable. Honest body and success-path shape unchanged.

**File:** `src/dashboard.ts:3600-3616`

**Issue:** Every failure branch in `POST /api/activity/:id/undo` returns HTTP 200:

- Row not found: `c.json({ ok: false, error: '...' })` -- 200
- Not approved: `c.json({ ok: false, error: '...' })` -- 200
- Not undoable: `c.json({ ok: false, error: '...' })` -- 200
- Race (already undone): `c.json({ ok: false, error: '...' })` -- 200

The Activity.tsx UI checks `res.ok` and handles failures through a dedicated path, so this does not break the current client. However, any monitoring, alerting, or future client code that distinguishes success from failure by HTTP status will treat all of these as successful responses. The `approve` and `deny` routes follow the same pattern, setting this precedent, but the undo route is the highest-risk write path and warrants correct HTTP status codes.

**Fix:** Add HTTP status codes to the failure responses:

```typescript
if (!row) return c.json({ ok: false, error: 'no undoable action for that id' }, 404);
if (row.status !== 'approved') return c.json({ ok: false, error: 'only an approved action can be undone' }, 409);
if (!isUndoableFamily(row.tool_name) || row.tier >= 4 || !hasInput)
  return c.json({ ok: false, error: `Undo isn't available for ${row.tool_name}.` }, 400);
if (!claimUndo(id)) return c.json({ ok: false, error: 'already undone' }, 409);
```

---

### WR-02: `/usage` and `/activity` routes share the same sidebar icon

**Status:** RESOLVED (commit 7e4f535) — `/activity` now uses `ListChecks`, distinct from the Usage `Activity` chart icon.

**File:** `web/src/lib/routes.ts:36-37`

**Issue:** Both the `/usage` and `/activity` routes are assigned the `Activity` icon from `lucide-preact`:

```typescript
{ path: '/usage',    label: 'Usage',    vocabKey: 'nav.usage',    ..., icon: Activity, shortcut: 'g u' },
{ path: '/activity', label: 'Activity', vocabKey: 'nav.activity', ..., icon: Activity },
```

The sidebar renders these as two identically-shaped icons side by side. An operator cannot distinguish them by icon alone, and there is no keyboard shortcut for `/activity` to compensate. This creates navigational ambiguity in a surface that is supposed to be distinct from Usage.

**Fix:** Replace the `/activity` route's icon with a more appropriate one. `ListChecks` or `ClipboardList` from lucide would convey "a log of actions" without conflicting with the Activity (line chart) icon used for Usage:

```typescript
import { ..., ListChecks, ... } from 'lucide-preact';
// ...
{ path: '/activity', label: 'Activity', vocabKey: 'nav.activity', section: 'intelligence', icon: ListChecks },
```

---

### WR-03: Label undo dispatches with an empty `label` param when no label key is in `tool_input`

**Status:** RESOLVED (commit db0d033) — added `if (!label) return { args: {}, missing: 'no label id in the captured action' }` so an empty-label inverse is never dispatched; honest failure instead.

**File:** `src/undo-executor.ts:91-95`

**Issue:** The label inverse deriver calls `pick(input, ['label', 'label_id', 'labelId', 'label_name', 'labelName'])` to extract the label identifier, but `pick` returns `''` if none of those keys are present. The deriver only gates on `messageId` being missing, not on `label` being empty:

```typescript
derive: (input) => {
  const messageId = pick(input, ['message_id', 'messageId', 'id', 'thread_id', 'threadId']);
  const label = pick(input, ['label', 'label_id', 'labelId', 'label_name', 'labelName']);
  if (!messageId) return { args: {}, missing: 'no message id in the captured action' };
  return { args: { message_id: messageId, label } };  // label can be ''
},
```

When `label` is `''`, the call proceeds and sends `{ message_id: '<id>', label: '' }` to `mcp__gmail__remove-label`. The MCP server behavior for an empty label is unspecified and may silently no-op (removing no label, returning ok), making Undo appear successful to the operator when it did nothing.

**Fix:** Guard on `label` the same way `messageId` is guarded:

```typescript
if (!messageId) return { args: {}, missing: 'no message id in the captured action' };
if (!label) return { args: {}, missing: 'no label id in the captured action' };
return { args: { message_id: messageId, label } };
```

---

### WR-04: Em dashes in user-facing rendered text in `Home.tsx`

**Status:** RESOLVED (commit 9c3812b) — all em dashes removed from `Home.tsx` (the three user-facing strings plus the file-header comments).

**File:** `web/src/pages/Home.tsx:208,249,287`

**Issue:** CLAUDE.md carries a hard rule: "No em dashes. Ever." Three user-facing strings rendered in the browser violate this:

- Line 208 (textarea placeholder): `"Tell me anything — forward an email, drop a note, hand me a task."`
- Line 249 (JSX text): `"I'm set up and running. I don't know much about your work yet — point me at something below and I'll get going."`
- Line 287 (action body): `"Calendar, email, and the rest — so I can act."`

These strings are rendered directly in the operator-facing UI, not in comments.

**Fix:** Replace each em dash with a comma, period, or rephrasing:

```tsx
// Line 208:
placeholder="Tell me anything. Forward an email, drop a note, hand me a task. (Cmd+Enter to send)"

// Line 249:
I'm set up and running. I don't know much about your work yet. Point me at something below and I'll get going.

// Line 287:
body: 'Calendar, email, and the rest, so I can act.'
```

---

## Info

### IN-01: Em dashes in code comments across multiple files

**Status:** RESOLVED (commit 5ab735d) — em dashes removed from the listed `approval-queue.ts` comments and the new activity-route comments in `dashboard.ts`. Note: dashboard.ts retains ~73 pre-existing em dashes outside the phase-04 surfaces; those belong to earlier phases and were left out of scope.

**File:** `src/approval-queue.ts:2,14,95,129,180,197,228` and `src/dashboard.ts:3581,3589,3628,3634,3635`

**Issue:** The CLAUDE.md hard rule "No em dashes. Ever." is not limited to user-facing copy. These files contain em dashes in JSDoc comments and inline code comments. The Home.tsx violations (WR-04) are higher priority because they surface to the operator; these are lower severity but still a rule violation.

**Fix:** Replace each em dash in comments with a dash pair (`--`) or restructure the sentence. For example: `/* fall through to empty object -- corrupt row never crashes a read */`

---

### IN-02: `buildActivityFeed` applies the `limit` cap after an unfiltered merge

**Status:** RESOLVED (commit 7837cc8) — `listApprovals` now takes a bounded `limit` (default `DEFAULT_LIST_LIMIT=1000`) applied at the DB layer; `buildActivityFeed` passes `limit*2` to both sources so neither read is unbounded.

**File:** `src/activity.ts:209-214`

**Issue:** The `limit` parameter is applied as a final `.slice(0, limit)` after the merge of all queue rows and all audit rows. This means a large queue (1000 approved items) combined with a filtered request (`filter='needsyou'`) fetches all rows from both tables, merges and sorts them, then discards most of them. The intent is clearly to limit the response size, but the limiting happens at the wrong stage. This is a structural quality issue independent of CR-02: even after fixing the DB-level audit LIMIT, the queue read (`listApprovals`) also has no limit and similarly fetches every row.

**Fix:** Pass `limit` to both `listApprovals` and the audit query, accepting a small over-fetch (e.g., `limit * 2` per source) to ensure the merged result can satisfy the requested limit regardless of which source dominates.

---

_Reviewed: 2026-06-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
