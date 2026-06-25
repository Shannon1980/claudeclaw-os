# Phase 4: Activity Feed - Pattern Map

**Mapped:** 2026-06-24
**Files analyzed:** 13 (5 new src, 4 modified src/web, 4 new/extended tests)
**Analogs found:** 13 / 13 (every file has a strong in-codebase analog)

> All paths resolve under the worktree root:
> `/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/friendly-euler-b767ea`
> The planner MUST reference these analogs by file + line. This is an EXTENSION of an established
> system — copy the existing conventions verbatim (ESM `.js` import extensions, JSDoc-on-exports,
> status-guarded transitions, tokens-only styling, weights 400/500, no em dashes).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/undo-executor.ts` (NEW) | service/executor | request-response (MCP stdio) | `src/replay-executor.ts` | exact (mirror/inverse) |
| `src/activity.ts` (NEW) | service (read model) | CRUD-read / transform | `src/approval-queue.ts` (`listPending`/`hydrate`) | role + flow match |
| `src/activity-render.ts` (NEW) | utility (phrase map) | transform | `src/gate.ts` `summarize()` (:135) | role match (extend) |
| `src/activity-summary.ts` (NEW, optional) | service (LLM digest) | request-response | `src/memory-ingest.ts` `extractViaClaude` (:39) | role match |
| `src/approval-queue.ts` (MODIFY: add `getApprovalById`/`listApprovals`) | model/repository | CRUD-read | `src/approval-queue.ts` `listPending` (:139) | self (same file pattern) |
| `src/dashboard.ts` (MODIFY: 3 routes) | controller/route | request-response | `src/dashboard.ts` `/api/approvals*` (:3505-3543) | exact |
| `web/src/pages/Activity.tsx` (NEW) | page (operator surface) | request-response (fetch) | `web/src/pages/Audit.tsx` (structure) + `ApprovalItem.tsx` (row visual) | structure match; **Audit styling = anti-pattern** |
| `web/src/components/ActivityRow.tsx` (NEW, optional) | component | presentation | `web/src/components/ApprovalItem.tsx` | exact |
| `web/src/lib/routes.ts` (MODIFY) | config (route table) | static | `web/src/lib/routes.ts` (self, :37) | self |
| `web/src/lib/vocabulary.ts` (MODIFY) | config (vocab map) | static | `web/src/lib/vocabulary.ts` (self, :56,:70) | self |
| `web/src/App.tsx` (MODIFY: add Route) | config (router) | static | `web/src/App.tsx` (:48-62) | self |
| `web/src/pages/Home.tsx` (MODIFY: entry point) | page | presentation | `web/src/pages/Home.tsx` (:166-177 NeedsYouCard region) | self |
| `src/activity.test.ts` / `src/undo-executor.test.ts` / `src/activity-render.test.ts` (NEW) + `src/dashboard.contract.test.ts` (EXTEND) | test | n/a | `src/approval-queue.test.ts` + `src/dashboard.contract.test.ts` | exact |

---

## Pattern Assignments

### `src/undo-executor.ts` (service/executor, request-response over MCP stdio)

**Analog:** `src/replay-executor.ts` (read in full). The undo executor is the structural INVERSE of replay:
same allowlist + honest-rejection + raw JSON-RPC-over-stdio MCP shape, but maps a forward tool to its
safe inverse instead of replaying it.

**Result type + JSDoc + caps** (`src/replay-executor.ts:39-53`):
```typescript
export interface ReplayResult {
  ok: boolean;       // True iff the captured action actually ran to completion.
  message: string;   // Short operator-readable outcome on success, or honest failure reason.
}
const MCP_CALL_TIMEOUT_MS = 30_000;
const REPLAY_TEXT_CAP = 2000;
function cap(s: string): string { /* flatten + slice to one capped line */ }
```
Mirror this as `UndoResult { ok; message }` with the same `cap()` + timeout constant.

**Allowlist dispatch + honest rejection + never-throws** (`src/replay-executor.ts:60-75`):
```typescript
export async function replayApproval(toolName: string, toolInput: Record<string, unknown>): Promise<ReplayResult> {
  try {
    if (toolName === 'Write') return await replayWrite(toolInput);
    if (toolName === 'Bash') return await replayBash(toolInput);
    if (toolName.startsWith('mcp__')) return await replayMcp(toolName, toolInput);
    return { ok: false, message: `Couldn't replay — ${toolName} is not a replayable action. ...` };
  } catch (err) {
    return { ok: false, message: cap(`Couldn't replay — ${err instanceof Error ? err.message : String(err)}`) };
  }
}
```
Undo signature adds `tier` and **refuses Tier 4 before any dispatch** (D-09): `if (tier >= 4) return { ok:false, message:"This action can't be undone." }`. Dispatch maps forward tool to the inverse MCP tool (draft create -> delete, calendar create -> cancel/decline, label apply -> remove); everything else returns the honest `Undo isn't available for ${toolName}.` **No em dash** in copy — replace the analog's ` — ` with a period or comma.

**MCP JSON-RPC stdio handshake — copy verbatim, swap the tool name** (`src/replay-executor.ts:125-212`):
```typescript
const servers = loadMcpServers();           // from './agent.js'
const cfg = servers[serverName];
if (!cfg) return { ok:false, message:`... "${serverName}" tool isn't connected. Connect it in Settings ...` };
const child = spawn(cfg.command, cfg.args ?? [], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, ...(cfg.env ?? {}) } });
// initialize (id:1) -> notifications/initialized -> tools/call (id:2) { name: <INVERSE tool>, arguments: <derived> }
// extractMcpText(result) for the success line; honest failure on error/timeout/close.
```
The inverse `arguments` are DERIVED from the captured forward `tool_input` (e.g. the created draft id), not the forward params replayed as-is. Confirm exact MCP inverse tool names against connected servers at plan time (RESEARCH A1 — `[ASSUMED]`: `mcp__gmail__delete_draft`, `mcp__gcal__delete_event`, `mcp__gmail__remove_label`).

---

### `src/activity.ts` (service / read model, CRUD-read + transform)

**Analog:** `src/approval-queue.ts` (read in full) for the read/hydrate idiom; `src/dashboard.ts` `getAuditLog` usage (`dashboard.ts:3545-3551`) for the audit read.

**Defensive parse + hydrate idiom** (`src/approval-queue.ts:121-146`):
```typescript
function parseToolInput(raw: string): Record<string, unknown> {
  try { const p = JSON.parse(raw); if (p && typeof p === 'object' && !Array.isArray(p)) return p; }
  catch { /* corrupt row never crashes a read */ }
  return {};
}
function hydrate(row: RawApprovalRow): ApprovalRow { return { ...row, tool_input: parseToolInput(row.tool_input) }; }
export function listPending(): ApprovalRow[] {
  const rows = getDb().prepare(`SELECT * FROM approval_queue WHERE status='pending' ORDER BY created_at DESC, id DESC`).all() as RawApprovalRow[];
  return rows.map(hydrate);
}
```
`buildActivityFeed({ filter, limit })` does TWO prepared reads and merges:
1. `approval_queue` (all statuses) — source of truth for anything queued; carries `tool_input` (undoable).
2. `audit_log WHERE action='permission'` filtered to `outcome IN ('allow','approved-inline')` — the "Ran on its own" / chat-approved set that never touched the queue. **Dedupe:** never render an audit `outcome='queued'` row; `approval_queue` owns it (RESEARCH Pitfall 2). `detail` is `JSON.parse`d with the same defensive try/catch.

**Tag derivation (D-06)** is a pure function of source + status (RESEARCH read-contract table):
`pending->Needs you (amber)`, `approved->You approved (green)`, audit `outcome='allow'->Ran on its own (neutral)`, `denied/expired->honest state`. **Undoable flag** = `approval_queue` row AND tool on allowlist AND `tier < 4` AND has `tool_input` (audit rows have no params -> never undoable). Order reverse-chron by `created_at DESC, id DESC` (matches `listPending`).

**Security (carry from analog):** surface ONLY param-level fields already stored (L-4 / ASVS V8) — never copy env/secrets into a feed row.

---

### `src/activity-render.ts` (utility, transform — the D-04 tool->phrase map)

**Analog:** `src/gate.ts` `summarize()` (:131-137). Research is explicit: do NOT mutate `summarize()` in place
(it is shared by `approval-queue.ts` `gateEnqueue` and is intentionally params-free, L-4). Build a NEW module
that takes params; keep `summarize()` as the params-free fallback for "Ran on its own" rows.

**Existing params-free helper to keep as fallback** (`src/gate.ts:131-137`):
```typescript
/** Plain-language one-liner. Carries ONLY the tool name and tier — never the input params. */
export function summarize(toolName: string, tier: Tier): string {
  return `${toolName} (Tier ${tier})`;
}
```

**New deterministic phrase map** (extend the pattern WITH params; JSDoc on the export):
```typescript
export function phraseFor(toolName: string, input: Record<string, unknown>, tier: number): string {
  if (/gmail__send/i.test(toolName)) { const to = String(input.to ?? input.recipients ?? ''); return to ? `Sent email to ${to}` : 'Sent an email'; }
  if (/draft/i.test(toolName)) return 'Prepared a draft';
  // ... small explicit map; honest generic for unmapped (D-05):
  return `Ran ${toolName.replace(/^mcp__[^_]+__/, '')}`;   // strip mcp__server__ prefix
}
```
**D-05 honesty:** unmapped -> `Used <server>` / `Ran <tool>`. Never fabricate detail, never hide a row. **No em dashes** in any phrase output (CLAUDE.md hard rule).

---

### `src/activity-summary.ts` (service / LLM digest, request-response — optional, D-10)

**Analog:** `src/memory-ingest.ts` `extractViaClaude` (:39-85). Reuse it directly (Haiku via OAuth, scrubbed env,
no API key, bounded timeout). Do NOT use the Gemini path (`src/gemini.ts` — needs `GOOGLE_API_KEY`, 429-prone).

**Reuse signature** (`src/memory-ingest.ts:39`):
```typescript
export async function extractViaClaude(prompt: string, timeoutMs = 15_000): Promise<string>
// internally: getScrubbedSdkEnv(readEnvFile([...])), query({ model:'claude-haiku-4-5-20251001',
//             allowedTools:[], disallowedTools:['*'], maxTurns:1, abortController }), returns result text.
```
Build a `summarizeDay(rows): Promise<string>` that assembles a plain-text day summary prompt (3-4 sentences, **no em dashes**) and calls `extractViaClaude(prompt, 20_000)`. On failure: honest `"Couldn't summarize right now. The feed below is complete."` (UI-SPEC copy). Governed by `LLM_SPAWN_ENABLED` kill-switch at the route.

---

### `src/approval-queue.ts` (MODIFY — add `getApprovalById` / `listApprovals(statuses)`)

**Analog:** `listPending` in the same file (:139-146). Add read-only siblings, no migration, same `hydrate` pipeline.

```typescript
/** A single row by id, any status (Undo targets approved rows). */
export function getApprovalById(id: number): ApprovalRow | undefined {
  const row = getDb().prepare(`SELECT * FROM approval_queue WHERE id = ?`).get(id) as RawApprovalRow | undefined;
  return row ? hydrate(row) : undefined;
}
/** Rows in any of the given statuses, most recent first. */
export function listApprovals(statuses: ApprovalRow['status'][]): ApprovalRow[] { /* prepared IN (...) + map hydrate */ }
```
**Undo write:** reuse the existing `result` column + a status-guarded UPDATE exactly like `approve()` (:153-165) — `WHERE id=? AND status='approved'`, return `info.changes === 1` (prevents undo double-fire, RESEARCH STRIDE Tampering). **No new column / no migration** (RESEARCH A2 / Pitfall 3).

---

### `src/dashboard.ts` (MODIFY — mount `GET /api/activity`, `POST /api/activity/:id/undo`, `POST /api/activity/summarize`)

**Analog:** the `/api/approvals*` block (:3505-3543). New routes mount on the same `app`, inheriting the
token gate and mutation kill-switch automatically (do NOT add bespoke auth).

**Inherited chokepoints (do not reimplement):**
- Token gate on every `/api/*` (`dashboard.ts:342-354`): GET inherits it by mounting on `app`.
- Mutations kill-switch (`dashboard.ts:376-392`): every non-GET returns 503 when `DASHBOARD_MUTATIONS_ENABLED` is off. `POST .../undo` and `POST .../summarize` inherit it.

**Integer-id validation + status-guarded "act once" + honest result** (`dashboard.ts:3514-3543`):
```typescript
app.post('/api/approvals/:id/approve', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
  const pending = listPending().find((r) => r.id === id);
  if (!pending) return c.json({ ok: false, error: 'not pending ...' });
  const replay = await replayApproval(pending.tool_name, pending.tool_input);
  const changed = approve(id, replay.message);          // STATUS-GUARDED: source of truth for ok
  if (!changed) return c.json({ ok: false, error: 'already decided' });
  return c.json({ ok: true, replayed: replay.ok, result: replay.message });
});
```
The undo route copies this shape exactly: `Number.isInteger` 400 guard -> `getApprovalById(id)` (must be `approved`, undoable, tier<4) -> `undoAction(tool_name, tool_input, tier)` -> status-guarded mark via the `result` column -> return `{ ok, result }` with the verbatim honest message on failure (never a generic error). `GET /api/activity` mirrors the curated-view + `c.json` idiom (the `approvalView` projector at :3490-3503 shows the "no raw secrets in the response" rule).

---

### `web/src/pages/Activity.tsx` (NEW page, request-response fetch)

**Analog (page structure):** `web/src/pages/Audit.tsx` — copy the data-page SHELL only: `useState`/`useEffect`
load, `PageHeader` + `Tab` filter chips, `PageState` loading/error/empty.
**ANTI-PATTERN (do NOT copy):** Audit's dense monospace `<table>` body (`Audit.tsx:94-127`, `font-mono`, `text-[11px]`).
D-01 / UI-SPEC require Activity to look deliberately unlike Audit.
**Analog (row visual):** `web/src/components/ApprovalItem.tsx` — the card row family Activity must echo.

**Page-shell pattern to copy** (`web/src/pages/Audit.tsx:64-90`):
```tsx
<PageHeader
  title={term('page.activity')}
  actions={/* Summarize Today button */}
  tabs={<> <Tab label="All" active={...} onClick={...} /> {/* Ran on its own · Needs you · per-teammate */} </>}
/>
{error && <PageState error={error} />}
{loading && items.length === 0 && <PageState loading />}
{!loading && !error && items.length === 0 && <PageState empty emptyTitle="Nothing yet today" emptyDescription="When your team does something, it shows up here. ..." />}
```

**Row card visual to copy** (`web/src/components/ApprovalItem.tsx:84-123`) — card on `--color-elevated`,
`border-[var(--color-border)] rounded-md p-3`, phrase at `text-[12.5px] leading-snug line-clamp-2`, meta line
with `AgentAvatar size={16}` + `formatRelativeTime(created_at)` (tabular-nums), `Pill` tag right-aligned, action
buttons (accent filled for Summarize/Review-approve; muted text for secondary). Honest failure line idiom
(`ApprovalItem.tsx:102-104`): `text-[10.5px] text-[var(--color-status-failed)] font-mono line-clamp-2`.

**Teammate dot** (`web/src/lib/teammate.ts:8`): `teammateColor(agent_id)` -> 6px dot via `style={{ backgroundColor }}` (StatusDot pattern, `Pill.tsx:44-49`). Teammate name from `/api/agents` (`loadAgentConfig(id).name`, see `dashboard.ts:2338`).

**Undo flow:** `ConfirmModal` (`destructive`) -> `apiPost('/api/activity/:id/undo')` -> `pushToast` success/honest-failure
(mirror `ApprovalItem.tsx:44-82`). Undo button renders ONLY when undoable; otherwise absent (no dead button — UI-SPEC interaction table). **Review** on pending held items reuses `/api/approvals/:id/approve|deny` verbatim.

**Styling constraints (UI-SPEC + CONVENTIONS):** tokens-only (`var(--color-*)`); weights 400/500 only; Inter, NO monospace (the `font-mono` failure line from `ApprovalItem` is the single inherited exception); no em dashes in any copy.

---

### `web/src/components/ActivityRow.tsx` (NEW component, optional)

**Analog:** `web/src/components/ApprovalItem.tsx` (read in full) — copy the card anatomy and the
busy/failure/confirm `useState` + `apiPost` + `pushToast` interaction model verbatim, adapting the tag tone
to the D-06 derivation and conditionally rendering Undo/Review/View per the UI-SPEC interaction table.

---

### `web/src/lib/routes.ts` (MODIFY — resolve the nav collision, D-01/D-02)

**Analog:** the route table itself (`routes.ts:27-42`). The collision is concrete at **line 37**:
```typescript
{ path: '/audit', label: 'Audit', vocabKey: 'nav.activity', section: 'intelligence', icon: ShieldCheck },
```
Re-point `nav.activity` onto a NEW `/activity` row (icon `Activity`, already imported at `routes.ts:3`); give the
existing `/audit` row a new `vocabKey: 'nav.audit'`. Keep both in the `intelligence` section.

### `web/src/lib/vocabulary.ts` (MODIFY)

**Analog:** the `TERMS` map (`vocabulary.ts:46-87`). `nav.activity` exists at :56 (`operator:'Activity', builder:'Audit'`)
and `page.activity` at :70. Add a `nav.audit` pair (e.g. `{ operator:'Audit', builder:'Audit' }`) and optionally
`page.audit`. Keep `nav.activity`/`page.activity` operator label "Activity" pointing at the new surface.

### `web/src/App.tsx` (MODIFY — add the route)

**Analog:** the `<Switch>` block (`App.tsx:48-62`). Add `<Route path="/activity"><Activity /></Route>` next to the
existing `<Route path="/audit"><Audit /></Route>` (:59). Import `Activity` from `./pages/Activity`.

### `web/src/pages/Home.tsx` (MODIFY — one-click entry point, D-03)

**Analog:** the `NeedsYouCard` region (`Home.tsx:166-177`) and the existing `navigate('/...')` usage (:162).
Add a quiet "What your team did" link/row beneath the NeedsYou region (UI-SPEC: understated, `--color-text-muted`
with accent hover, NOT a second loud card) that `navigate('/activity')`. Exact affordance is Claude's discretion.

---

## Shared Patterns

### Allowlist + honest-rejection executor
**Source:** `src/replay-executor.ts:60-75` (dispatch) + `:125-212` (MCP stdio).
**Apply to:** `src/undo-executor.ts`.
Pure name-based dispatch; only allowlisted inverses run; everything else returns an honest string; never throws;
Tier 4 refused before dispatch (D-09). MCP via raw JSON-RPC over stdio (no SDK installed) with `loadMcpServers()`
config and `{ ...process.env, ...cfg.env }`.

### Status-guarded "act once" transition
**Source:** `src/approval-queue.ts:153-165` (`approve`) and `src/dashboard.ts:3514-3535`.
**Apply to:** the undo write in `approval-queue.ts` + the `POST /api/activity/:id/undo` route.
UPDATE `WHERE id=? AND status=<expected>`, return `info.changes === 1`; the route treats that boolean as the
source of truth for `ok` so a double-click / retry can't double-fire the inverse (STRIDE Tampering).

### Defensive JSON parse on read (never eval)
**Source:** `src/approval-queue.ts:121-136` (`parseToolInput`/`hydrate`).
**Apply to:** `src/activity.ts` for both `approval_queue.tool_input` and `audit_log.detail`.
A corrupt row returns `{}` and never crashes a read (ASVS V5).

### Token gate + mutation kill-switch by mounting on `app`
**Source:** `src/dashboard.ts:342-354` (token) + `:376-392` (kill-switch).
**Apply to:** all three new routes. Inherited automatically — do NOT add bespoke auth. GET reads are token-gated;
POST mutations inherit `DASHBOARD_MUTATIONS_ENABLED`.

### Integer-id validation
**Source:** `src/dashboard.ts:3515-3516`, `:3538-3539`.
**Apply to:** `POST /api/activity/:id/undo` — `parseInt(...,10)` + `Number.isInteger` -> 400.

### Scrubbed-env LLM (Haiku/OAuth, no API key)
**Source:** `src/memory-ingest.ts:39-85` (`extractViaClaude`).
**Apply to:** `src/activity-summary.ts` Summarize digest. Scrubbed env, bounded timeout, honest degrade on failure.

### Tokens-only card row (the trust-chain visual family)
**Source:** `web/src/components/ApprovalItem.tsx:84-123`, `web/src/components/Pill.tsx`, `web/src/lib/teammate.ts:8`,
`web/src/lib/format.ts` `formatRelativeTime`.
**Apply to:** `Activity.tsx` / `ActivityRow.tsx`. `--color-*` tokens only, weights 400/500, `AgentAvatar`,
`teammateColor` dot, `Pill` tag. No monospace except the inherited `font-mono` honest-failure line. No em dashes.

### Vitest contract/unit harness
**Source:** `src/dashboard.contract.test.ts:16-34` (`buildDashboardApp(undefined)`, `TOKEN='test-contract-token'`,
`_initTestDatabase()` in `beforeEach`) and `src/approval-queue.test.ts:12-23` (`_initTestDatabase()` per `beforeEach`).
**Apply to:** all new tests below.

---

## Test File Assignments

| Test File | Status | Analog | Covers |
|-----------|--------|--------|--------|
| `src/activity.test.ts` | NEW | `src/approval-queue.test.ts` (`_initTestDatabase` + `beforeEach`) | reverse-chron, tag derivation (D-06), dedupe (no double-display), attribution (TRUST-01) |
| `src/activity-render.test.ts` | NEW | same harness | mapped tool -> phrase; unmapped -> honest generic, never fabricated (D-04/D-05) |
| `src/undo-executor.test.ts` | NEW | `src/replay-executor.test.ts` (sibling, mirror its allowlist tests) | allowlisted inverse runs; non-allowlisted honest "no undo"; Tier 4 never (TRUST-02/D-09) |
| `src/dashboard.contract.test.ts` | EXTEND | the `/api/approvals*` describe blocks in-file | `GET /api/activity` token-gated shape; `POST .../undo` mutation-gated + 400 bad id + undo-not-twice; `POST .../summarize` text-or-honest-failure + `LLM_SPAWN_ENABLED` |

Add new `describe('...activity...')` blocks in `src/dashboard.contract.test.ts` using the existing `app`/`TOKEN`
fixtures (`:24-34`). Quick run: `npx vitest run src/activity.test.ts src/undo-executor.test.ts src/activity-render.test.ts -x`.

---

## No Analog Found

None. Every new/modified file maps to a strong in-codebase analog. The one MEDIUM-confidence area is not a
missing-pattern problem but a runtime fact: the exact MCP inverse tool names for `undo-executor.ts` (RESEARCH A1,
`[ASSUMED]`) must be confirmed against the operator's connected servers at plan time. The executor STRUCTURE is
fully specified by `src/replay-executor.ts`.

## Metadata

**Analog search scope:** `src/` (executors, queue, gate, dashboard routes, LLM plumbing, tests),
`web/src/pages/`, `web/src/components/`, `web/src/lib/`.
**Files read for extraction:** `src/replay-executor.ts`, `src/approval-queue.ts`, `src/gate.ts` (summarize/encode),
`src/dashboard.ts` (token gate, kill-switch, approvals/audit routes, agents/roster lines), `src/memory-ingest.ts`,
`web/src/lib/routes.ts`, `web/src/lib/vocabulary.ts`, `web/src/lib/teammate.ts`, `web/src/components/ApprovalItem.tsx`,
`web/src/components/Pill.tsx`, `web/src/components/PageHeader.tsx`, `web/src/components/PageState.tsx`,
`web/src/pages/Audit.tsx`, `web/src/pages/Home.tsx`, `web/src/App.tsx`, `src/dashboard.contract.test.ts`,
`src/approval-queue.test.ts`.
**Pattern extraction date:** 2026-06-24
</content>
</invoke>
