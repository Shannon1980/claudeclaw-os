# Phase 4: Activity Feed - Pattern Map

**Mapped:** 2026-06-24
**Files analyzed:** 11 (5 new, 6 modified)
**Analogs found:** 11 / 11

All analogs are first-party files in this codebase, verified by reading. Line numbers below are accurate as of this mapping. No new dependencies; every pattern is copied from an existing, in-use module.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/undo-executor.ts` (NEW) | service/executor | request-response (inverse MCP) | `src/replay-executor.ts` | exact (mirror) |
| `src/activity.ts` (NEW) | service/query | CRUD (read-side join + derive) | `src/approval-queue.ts` (`listPending`) + `src/gate.ts` (`summarize`/`encodeDecision`) | role-match |
| `src/activity.test.ts` (NEW) | test | — | `src/gate.test.ts` / contract test pattern | role-match |
| `src/undo-executor.test.ts` (NEW) | test | — | replay-executor's test (allowlist/honest-reject) | role-match |
| `src/dashboard.ts` (EDIT) | route/controller | request-response | `app.get('/api/approvals')` + `app.post('/api/approvals/:id/approve')` (dashboard.ts:3505-3543) | exact |
| `src/gate.ts` (EDIT) | utility (pure fn) | transform | `summarize()` (gate.ts:135) + `encodeDecision()` (gate.ts:169) | exact (co-located) |
| `web/src/pages/Activity.tsx` (NEW) | component/page | request-response | `web/src/pages/Audit.tsx` (chip filter + PageState + load-more) | role-match (NOT styling) |
| `web/src/components/ApprovalItem.tsx` reuse (held-row Review) | component | request-response | `web/src/components/ApprovalItem.tsx` (reuse verbatim) | exact (do not fork) |
| `web/src/lib/format.ts` (EDIT) | utility | transform | existing formatters in same file (`formatRelativeTime`) | exact (co-located) |
| `web/src/lib/routes.ts` (EDIT) | config | — | the `ROUTES` array (routes.ts:27-42, line 37 is the `/audit` row to re-point) | exact |
| `web/src/lib/vocabulary.ts` (EDIT) | config | — | `nav.activity` term (vocabulary.ts:56) | exact |
| `web/src/App.tsx` (EDIT) | config/router | — | `<Route>` blocks (App.tsx:49-70) | exact |
| `web/src/pages/Home.tsx` (EDIT) | component | — | `NeedsYouCard` host (Home.tsx:53,167) | role-match |

## Pattern Assignments

### `src/undo-executor.ts` (NEW — service/executor, inverse MCP)

**Analog:** `src/replay-executor.ts` (read in full). This is a near-complete blueprint — copy its structure, security header, and MCP handshake; change only the dispatch (inverse instead of forward) and add the Tier-4 lock.

**Return type to reuse verbatim** (replay-executor.ts:39-44):
```typescript
export interface ReplayResult {
  ok: boolean;        // True iff the action actually ran to completion.
  message: string;    // Short operator-readable outcome, or honest failure reason.
}
```
Undo can import `ReplayResult` from replay-executor or declare an identical `UndoResult` — keep the `{ok, message}` shape so `dashboard.ts` surfaces it the same way.

**Core dispatch pattern — copy the never-throws + honest-reject shape** (replay-executor.ts:60-75):
```typescript
export async function replayApproval(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<ReplayResult> {
  try {
    if (toolName === 'Write') return await replayWrite(toolInput);
    if (toolName === 'Bash') return await replayBash(toolInput);
    if (toolName.startsWith('mcp__')) return await replayMcp(toolName, toolInput);
    return {
      ok: false,
      message: `Couldn't replay — ${toolName} is not a replayable action. Re-run it from chat instead.`,
    };
  } catch (err) {
    return { ok: false, message: cap(`Couldn't replay — ${err instanceof Error ? err.message : String(err)}`) };
  }
}
```
**Undo adaptation (D-07/D-09):** add the `tier >= 4` lock BEFORE any dispatch, then name-dispatch to inverse handlers (draft→delete, label→remove, meeting→cancel). Unknown family → honest `{ok:false}`. Per RESEARCH Pattern 3:
```typescript
export async function undoAction(toolName: string, tier: number, toolInput: Record<string, unknown>): Promise<ReplayResult> {
  if (tier >= 4) return { ok: false, message: "This action can't be undone." }; // D-09, before dispatch
  try {
    if (/draft/i.test(toolName)) return await undoDraft(toolInput);
    if (/label/i.test(toolName)) return await undoLabel(toolInput);
    if (/calendar|meeting|event/i.test(toolName)) return await undoMeeting(toolInput);
    return { ok: false, message: `No undo available for ${toolName}.` };
  } catch (err) {
    return { ok: false, message: `Couldn't undo — ${err instanceof Error ? err.message : String(err)}` };
  }
}
```

**MCP JSON-RPC handshake — copy `replayMcp` VERBATIM** (replay-executor.ts:125-212). The inverse handlers build params from the captured `tool_input` and call this with the inverse tool name (e.g. `mcp__gmail__delete_draft`). Critical pieces to preserve:
- `loadMcpServers()` lookup + honest "tool isn't connected" reject (lines 133-140).
- `spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env } })` — scrubbed-env, server-side only, never the browser (lines 146-149). [Pitfall 3]
- The `initialize` → `notifications/initialized` → `tools/call` line-delimited JSON-RPC exchange (lines 167-208). No MCP SDK is installed — speak raw JSON-RPC.
- `MCP_CALL_TIMEOUT_MS = 30_000` + the `settled`/`finish`/`cleanup` guard so it never hangs and never double-resolves.
- `extractMcpText(result)` (lines 215-226) to pull `content[].text` for the result line.

**Security header:** copy replay-executor.ts:8-30 verbatim (the SECURITY block) and adapt for inverse — no eval, no shell metaprogramming, structured JSON params only, env never read from the queue row.

---

### `src/activity.ts` (NEW — service/query, read-side join + tag derivation + phrase map)

**Analogs:** `src/approval-queue.ts` (query + hydrate pattern) and `src/gate.ts` (`summarize`/`encodeDecision` for the phrase map and decision-detail decode).

**Synchronous better-sqlite3 query pattern** (approval-queue.ts:139-146):
```typescript
export function listPending(): ApprovalRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM approval_queue WHERE status = 'pending' ORDER BY created_at DESC, id DESC`)
    .all() as RawApprovalRow[];
  return rows.map(hydrate);
}
```
Copy this shape for `listActivity({limit, before})`: `getDb().prepare(...).all()`, ORDER BY `created_at DESC, id DESC`, then map raw rows → typed rows. `hydrate` is where `tool_input` JSON gets parsed (approval-queue.ts has the `RawApprovalRow` → `ApprovalRow` JSON-parse pattern at lines 40-43).

**Row interface to model on** (`ApprovalRow`, approval-queue.ts:23-38) — `agent_id`, `tool_name`, `tool_input` (parsed object), `tier`, `status: 'pending'|'approved'|'denied'|'expired'`, `created_at`, `result`. The activity row adds derived `tag` + `phrase` + `undoable`.

**Decision-detail decode (for the audit side of the join).** `audit_log.detail` is JSON written by `encodeDecision` (gate.ts:169-177):
```typescript
function encodeDecision(d: {
  tool: string; tier: Tier; mode: Mode; outcome: string; queueId?: number | string;
}): string { return JSON.stringify(d); }
```
So an audit row's `detail` parses to `{tool, tier, mode, outcome, queueId?}`. `outcome` ∈ `allow|queued|approved-inline|denied-inline`. The `queueId` is the implicit join key. [Pitfall 1: dedup — queue row wins, suppress the matching `'queued'` audit row.]

**Tag derivation (D-06)** — pure function over the joined row (RESEARCH Pattern 2): `queue.pending→needs-you`, `queue.approved→you-approved`, `queue.denied→skipped`, `queue.expired→expired`, audit `outcome='allow'` & no queueId → `ran-on-own`, `approved-inline→you-approved`. Default `ran-on-own` (never hide a row, D-05).

**Phrase map (D-04)** — build a NEW `describeAction(toolName, toolInput)` co-located here (or in gate.ts), keeping `summarize()` UNCHANGED. Current `summarize` deliberately drops params (gate.ts:135-137):
```typescript
export function summarize(toolName: string, tier: Tier): string {
  return `${toolName} (Tier ${tier})`;
}
```
The phrase map reads SELECTED non-secret params (subject, count, label name) from `tool_input` → "Sent follow-up to 3 leads". Unmapped → honest "Ran {tool}" (D-05). [Pitfall 2 + ASVS V8: allowlist which params are surfaced.]

**Tier-4 undo gate:** reuse `classifyTier()` / the `Tier` type (gate.ts:79, exported) to validate undo-ability; `tier` is also stored on `approval_queue.tier`.

---

### `src/dashboard.ts` (EDIT — route/controller, request-response)

**Analog:** the `/api/approvals` GET + `/api/approvals/:id/approve` POST (dashboard.ts:3505-3543), which already do the read-view + mutation-with-honest-result pattern this phase needs.

**Read endpoint — mirror `approvalView` + `app.get`** (dashboard.ts:3490-3507):
```typescript
function approvalView(row: ApprovalRow) {
  return { id: row.id, agent_id: row.agent_id, tool_name: row.tool_name, tier: row.tier,
           mode_at_decision: row.mode_at_decision, summary: row.summary, status: row.status,
           run_id: row.run_id, routine_id: row.routine_id, created_at: row.created_at };
}
app.get('/api/approvals', (c) => {
  return c.json({ approvals: listPending().map(approvalView) });
});
```
Add `app.get('/api/activity', (c) => { const limit = parseInt(c.req.query('limit')||'100',10); const before = c.req.query('before'); return c.json({ rows: listActivity({limit, before}) }); })`. The curated join + tag + phrase live in `src/activity.ts`; the route is thin.

**Mutation endpoint — mirror the approve route's id-validation + honest-result shape** (dashboard.ts:3514-3535):
```typescript
app.post('/api/approvals/:id/approve', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
  // ... find pending row, run replay, status-guarded transition ...
  const replay = await replayApproval(pending.tool_name, pending.tool_input);
  const changed = approve(id, replay.message);
  if (!changed) return c.json({ ok: false, error: 'already decided' });
  return c.json({ ok: true, replayed: replay.ok, result: replay.message });
});
```
For `POST /api/activity/:id/undo`: same `Number.isInteger(id)` guard, look up the captured `tool_name`+`tool_input`+`tier`, call `undoAction(...)`, return `{ ok, result: res.message }`. [ASVS V5: `:id` integer-validated, structured params only.] No per-route auth needed — token + CSRF + `DASHBOARD_MUTATIONS_ENABLED` are applied app-wide (see Shared Patterns).

**Summarize endpoint:** `POST /api/activity/summarize` calls `generateContent()` (see gemini analog in Shared Patterns).

---

### `src/gate.ts` (EDIT — utility, transform)

**Leave `summarize()` and `encodeDecision()` UNCHANGED.** The new `describeAction(toolName, toolInput)` phrase-map function is co-located ALONGSIDE `summarize()` (gate.ts:135) following the same pure-function, no-I/O, exported style. It MAY live in `activity.ts` instead — RESEARCH recommends one source of truth feeding both the row and the Summarize prompt. Either way, the existing `summarize` stays as-is for queue safety (Pitfall 2).

---

### `web/src/pages/Activity.tsx` (NEW — component/page)

**Structural analog:** `web/src/pages/Audit.tsx` (read in full) — for chip-filter state, `PageState` usage, and load-more. **CRITICAL: copy the STRUCTURE, NOT the styling.** Audit uses `font-mono` dense table rows (Audit.tsx:111,123); Activity must use Inter, generous spacing, color dots, plain language (UI-SPEC hard constraint / Anti-pattern). Do not inherit the monospace table.

**Page scaffold + filter chips** (Audit.tsx:64-84):
```typescript
<div class="flex flex-col h-full">
  <PageHeader
    title={term('page.activity')}
    actions={/* Summarize button here (D-10) */}
    tabs={
      <>
        <Tab label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
        <Tab label="Blocked" active={filter === 'blocked'} onClick={() => setFilter('blocked')} />
        {/* per-agent chips from a sticky knownAgents union */}
      </>
    }
  />
  {error && <PageState error={error} />}
  {loading && items.length === 0 && <PageState loading />}
  {!loading && !error && items.length === 0 && (
    <PageState empty emptyTitle="..." emptyDescription="..." />
  )}
  {/* feed rows */}
</div>
```
Activity's chips are `All · Ran on its own · Needs you · per-teammate` (D-11). Copy Audit's **sticky-knownAgents** trick (Audit.tsx:29-33,53-57) so narrowing to one teammate doesn't make the other chips vanish. Per-teammate chips render `teammateColor(agent_id)` dot + name.

**Empty/loading/error states:** `PageState` props `{loading, error, empty, emptyTitle, emptyDescription}` (Audit.tsx:86-90). Use UI-SPEC copy ("No activity yet" / the 2-line body).

**Load-older affordance:** Audit's bottom button (Audit.tsx:128-137) — adapt to the reverse-chrono `before` window.

**Data fetch:** use `useFetch<T>(path, pollMs)` (web/src/lib/useFetch.ts:24) for `/api/activity` (Audit uses raw `apiGet`+`useState`; RESEARCH recommends `useFetch` for the feed). `apiGet`/`apiPost` (api.ts:37,46) auto-append the token.

**Undo flow:** `ConfirmModal` for confirm (props per UI-SPEC table), then `apiPost('/api/activity/:id/undo')`, then toast. Toast copy contract (RESEARCH / ApprovalItem.tsx:51-60):
```typescript
if (res.ok) pushToast({ tone: 'success', title: 'Undone.' });
else        pushToast({ tone: 'error', title: `Couldn't undo that — ${res.result}`, durationMs: 6000 });
```
Render NO Undo button when not undoable (never a disabled one — UI-SPEC / D-09).

**Tag → Pill tone** (RESEARCH, tones verified in Pill.tsx): `ran-on-own→neutral`, `you-approved→done`, `needs-you→medium`, `skipped→queued`, `expired→cancelled`.

---

### Held-row "Review" — reuse `web/src/components/ApprovalItem.tsx` (do NOT fork)

**Analog (and the thing to import, not rebuild):** `ApprovalItem.tsx` (read in full). A "Needs you" row's Review opens the SAME approve/deny call shape this component already implements (ApprovalItem.tsx:44-78): `apiPost('/api/approvals/:id/approve')`, honest verbatim failure on `replayed === false`, Tier-4 deny through a destructive `ConfirmModal`, success/error toasts. UI-SPEC D-06: do not build a second approval UI.

---

### `web/src/lib/format.ts` (EDIT — utility, transform)

**Analog:** the existing formatters in this same file (read in full). Add `formatClock(unixSeconds)` next to `formatRelativeTime` (format.ts:3-13), same tiny-pure-function style, returning local-tz "9:12am" via `toLocaleTimeString`. [Pitfall 5: this does NOT exist yet; do not pull in date-fns/dayjs.] Co-locate a test in the existing `format.test.ts`.

---

### `web/src/lib/routes.ts` + `vocabulary.ts` + `App.tsx` (EDIT — config/router)

**`routes.ts` (D-01/D-02):** the `/audit` row currently carries `vocabKey: 'nav.activity'` (routes.ts:37). Re-point a NEW `/activity` row to `nav.activity` and demote `/audit` to a new `nav.audit` key. The `ROUTES` array (routes.ts:27-42) is the single source of truth for sidebar + palette + router — edit it there, the `RouteDef` shape (routes.ts:12-22) is the contract.
```typescript
// current — the collision to resolve:
{ path: '/audit', label: 'Audit', vocabKey: 'nav.activity', section: 'intelligence', icon: ShieldCheck },
// target:
{ path: '/activity', label: 'Activity', vocabKey: 'nav.activity', section: 'intelligence', icon: Activity },
{ path: '/audit',    label: 'Audit',    vocabKey: 'nav.audit',    section: 'intelligence', icon: ShieldCheck },
```

**`vocabulary.ts`:** `nav.activity` lives at vocabulary.ts:56 (`{ operator: 'Activity', builder: 'Audit' }`) and `page.activity` at :70. Add a `nav.audit` term (e.g. `{ operator: 'Audit log', builder: 'Audit (raw)' }`) and re-point `page.activity` to the operator surface.

**`App.tsx`:** add `<Route path="/activity"><Activity /></Route>` alongside the existing blocks (App.tsx:49-70). `<Route path="/audit"><Audit /></Route>` (App.tsx:59) stays as the demoted technical view.

---

### `web/src/pages/Home.tsx` (EDIT — component, entry-point)

**Analog:** the existing `NeedsYouCard` host (Home.tsx:53,167) and `useLocation` navigation (Home.tsx:54). Add the one-click Activity entry-point (D-03) matching `NeedsYouCard`'s visual weight so it reads as a peer surface, not a banner. Navigate via the wouter `useLocation` setter already imported.

## Shared Patterns

### Token + CSRF + mutation kill-switch (applies to ALL new routes)
**Source:** `src/dashboard.ts:359-444` (global middleware). `requireToken(c)` checks `?token=`; a CSRF origin allowlist; and `DASHBOARD_MUTATIONS_ENABLED` returns 503 on any mutating method when off.
**Apply to:** `GET /api/activity`, `POST /api/activity/:id/undo`, `POST /api/activity/summarize`. These inherit auth/CSRF/kill-switch automatically — do NOT add per-route auth. [ASVS V2/V4]
```typescript
function requireToken(c: any): Response | null { const token = c.req.query('token'); /* ... */ }
// mutation kill-switch:
if (!killSwitches.isEnabled('DASHBOARD_MUTATIONS_ENABLED')) { /* 503 */ }
```

### Audit write path (read-only here; optional undo trail)
**Source:** `src/security.ts:87-114` — `audit({agentId, chatId, action, detail, blocked})` + the `AuditAction` union.
**Apply to:** Activity NEVER touches the gate write path (D-06). If planning decides an undo should be trailed (Open Q3), use the EXISTING `audit()` with a NEW action type — that requires adding `'undo'` to the `AuditAction` union (security.ts:87-93), NOT a gate change.

### LLM one-shot for Summarize
**Source:** `src/gemini.ts:22-49` — `generateContent(prompt, model)`, kill-switch-gated by `LLM_SPAWN_ENABLED` (gemini.ts:29).
**Apply to:** the Summarize endpoint. NOTE it hardcodes `responseMimeType: 'application/json'` + `temperature: 0.1` (gemini.ts:35-38), so prompt it to return `{"digest":"..."}` and parse with `parseJsonResponse` (gemini.ts:55) rather than changing the shared helper. [Pitfall 6] Honest empty state when no activity / `GOOGLE_API_KEY` unset.

### MCP invocation (inverse calls)
**Source:** `src/replay-executor.ts:125-212` (`replayMcp`). The line-delimited JSON-RPC handshake over stdio. Copy verbatim into undo-executor — no MCP SDK exists. [Don't Hand-Roll]

### Teammate color attribution
**Source:** `web/src/lib/teammate.ts` `teammateColor(id)` (substring-matched) + `web/src/components/TeammateTag.tsx`.
**Apply to:** per-row dot+name and per-teammate filter chips.

### Status-guarded transitions (any undo state change)
**Source:** `src/approval-queue.ts:153-165` (`approve`) — `UPDATE ... WHERE id=? AND status='pending'`, return `info.changes === 1`. Prevents double-fire. Mirror for any undo state change. [Threat: double-undo]

## No Analog Found

None. Every file has a strong first-party analog. The two genuinely-new capabilities (the inverse undo executor and the curated read endpoint) are structural mirrors of `replay-executor.ts` and `/api/approvals` respectively.

## Data Contract Reference

- `audit_log` schema: `src/db.ts:332-342` — `agent_id, chat_id, action, detail (JSON), blocked, created_at`.
- `approval_queue` schema: `src/db.ts:352-369` — `agent_id, tool_name, tool_input (JSON), tier, mode_at_decision, summary, status, decided_at, result, run_id, routine_id, created_at`. Dual-written (createSchema + migrations/v1.2.3); `tool_input` is the captured params for replay/undo, no secrets (L-4). [No schema change expected this phase — D-06 read-side derivation.]

## Metadata

**Analog search scope:** `src/` (replay-executor, activity sources: gate, approval-queue, dashboard, gemini, security, db), `web/src/pages/` (Audit, Home), `web/src/components/` (ApprovalItem), `web/src/lib/` (format, routes, vocabulary, api, useFetch, toasts), `web/src/App.tsx`.
**Files scanned:** ~14 read directly; line numbers verified against live worktree files.
**Pattern extraction date:** 2026-06-24
