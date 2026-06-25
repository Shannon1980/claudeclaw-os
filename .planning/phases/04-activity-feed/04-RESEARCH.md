# Phase 4: Activity Feed - Research

**Researched:** 2026-06-24
**Domain:** Operator-facing transparency surface — curated read over an existing event stream (`audit_log` + `approval_queue`) in a local-first Electron/Node + Hono + Preact app, plus a bounded "inverse-of-action" Undo executor.
**Confidence:** HIGH (every integration point read from source in this worktree; no new packages; design contract spec 08 read verbatim)

## Summary

Phase 4 is overwhelmingly a **read-side + rendering + surface** phase with **one genuinely new write path (Undo)**. Phase 3 already shipped the entire event stream this phase consumes: `audit_log` (permission decisions, encoded JSON detail) and `approval_queue` (pending/approved/denied/expired held items, with the captured `tool_input`). The phase boundary (CONTEXT) and the design contract (`specs/operator-product/08-activity-audit.md`) agree: do not touch the Phase 3 gate/write path, do not repurpose the existing `/audit` page, build a new `/activity` + `Activity.tsx`, and make Undo a real inverse or absent (no theater).

The **single most load-bearing finding** is a data-contract asymmetry that shapes the entire plan: `audit_log.detail` for `action='permission'` rows stores only `{tool, tier, mode, outcome, queueId?}` (see `src/gate.ts` `encodeDecision`) — **it does NOT store `tool_input`**. The captured params live ONLY on `approval_queue` rows. Consequently: (1) the tag derivation D-06 works cleanly because tags come from row presence/status, not params; (2) the plain-language phrase map D-04 can only use params for `approval_queue`-backed rows ("You approved"/"Needs you") — "Ran on its own" rows have only tool name + tier, so their phrasing is necessarily coarser (honest generic phrase per D-05); and (3) **Undo (D-07) can only target `approval_queue` rows**, because those are the only rows carrying the `tool_input` needed to compute an inverse. An "Ran on its own" autonomous action in `audit_log` has no stored params and therefore cannot be undone — which must be surfaced honestly, not hidden.

The Undo executor is a near-perfect mirror of `src/replay-executor.ts` (allowlist + honest-rejection, no eval, MCP via raw JSON-RPC over stdio). Summarize (D-10) should reuse `extractViaClaude` (Haiku via OAuth, no API key) from `src/memory-ingest.ts` rather than the Gemini path, since it needs no extra key and matches the agents' auth. Teammate color comes from `web/src/lib/teammate.ts` `teammateColor(agentId)`; name comes from `/api/agents` (`loadAgentConfig(id).name`). The vocab collision (D-02) is concrete: `nav.activity` is currently attached to the `/audit` route in `web/src/lib/routes.ts:37`.

**Primary recommendation:** Build one new curated read endpoint `GET /api/activity` (a UNION-shaped, day-groupable join over `approval_queue` + permission rows of `audit_log`, attributed by `agent_id`) and one new `POST /api/activity/:id/undo` endpoint backed by a new `src/undo-executor.ts` (sibling of `replay-executor.ts`, allowlist of draft/meeting/label inverses), mount both on the existing token-gated Hono app behind the mutations kill-switch, and render a new `Activity.tsx` (wouter route `/activity`) that deliberately does not inherit the dense monospace `Audit.tsx` styling. Ship label-remove (or draft-delete) undo as the guaranteed-working floor; surface the rest honestly.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Activity feed read (curated join, day-group, tag derivation) | API / Backend (`src/dashboard.ts` + a new query module) | Database (`audit_log`, `approval_queue`) | Tags/phrases are derived server-side from row status; the DB owns the event stream, the API curates it. Keeps the client a thin renderer. |
| Plain-language phrase map (D-04) | API / Backend (extend `gate.ts` `summarize` OR a new render module) | — | Deterministic, testable, no per-row LLM. Belongs server-side so both the feed endpoint and the queue summary share one map. |
| Tag derivation "Ran on its own / You approved / Needs you" (D-06) | API / Backend | Database | Pure function of row source + `approval_queue.status`; no new column. |
| Undo inverse execution (D-07/D-08) | API / Backend (`src/undo-executor.ts`) | Database (read `tool_input`), MCP servers (stdio) | Mirrors `replay-executor.ts`; the inverse must run with the same scrubbed-env/MCP path the gate established. Never client-side. |
| Summarize daily digest (D-10) | API / Backend (reuse `extractViaClaude`) | — | LLM call must run server-side (auth, kill-switch `LLM_SPAWN_ENABLED`). Operator-invoked, not per-row. |
| Teammate attribution (color + name) | Browser / Client (`teammateColor` + `/api/agents` name) | API (agent name source) | Color is a pure client function of `agent_id`; name is fetched once. Matches existing `TeammateTag`/`ApprovalItem`. |
| Activity surface + filters + day grouping render | Browser / Client (`Activity.tsx`) | — | Filter chips and grouping are presentation; all candidate rows come from the API. |
| Nav/route/vocab wiring (D-01/D-02/D-03) | Browser / Client (`routes.ts`, `vocabulary.ts`, `App.tsx`, `Home.tsx`) | — | Single source of truth for nav lives in the web app. |

## Standard Stack

No new packages. This phase is built entirely on the installed stack.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | ^0.2.34 | Summarize LLM call via `query()` (Haiku, OAuth) — reused through `extractViaClaude` | Already the agents' auth path; no API key needed (D-10 "reuse existing plumbing") `[VERIFIED: package.json + src/memory-ingest.ts read]` |
| `hono` | (installed) | `/api/activity*` + undo route mount on the existing token-gated app | Every `/api/*` route already uses it; inherits auth + mutations kill-switch `[VERIFIED: src/dashboard.ts read]` |
| `better-sqlite3` (via `src/db.ts`) | (installed) | Synchronous single-connection reads over `audit_log` + `approval_queue` | The whole data layer; prepared statements, `_initTestDatabase()` for tests `[VERIFIED: src/db.ts read]` |
| `preact` + `wouter-preact` | (installed) | `Activity.tsx` page + `/activity` route | Matches every existing page; routing is plain `<Route path="/activity">` in `App.tsx` `[VERIFIED: web/src/App.tsx read]` |
| `lucide-preact` | (installed) | Icons (Activity icon already imported in `routes.ts`) | Existing icon set `[VERIFIED: web/src/lib/routes.ts read]` |

### Supporting (reused components/helpers — do not rebuild)
| Asset | Path | Purpose | When to Use |
|-------|------|---------|-------------|
| `Pill` / `StatusDot` | `web/src/components/Pill.tsx` | The tag chips (tone: `done`=green/You approved, `neutral`=Ran on its own, `medium`/amber=Needs you) | Every row tag |
| `teammateColor(id)` | `web/src/lib/teammate.ts` | Per-teammate accent color dot (research purple / comms teal / content coral / ops amber, fallback accent) | The color dot + per-teammate filter chips (D-11) |
| `AgentAvatar` | `web/src/components/AgentAvatar.tsx` | Teammate avatar | Row attribution |
| `ConfirmModal` | `web/src/components/ConfirmModal.tsx` | Destructive-undo confirmation (`destructive` prop) | Undo confirm before running the inverse |
| `PageHeader` / `Tab` | `web/src/components/PageHeader.tsx` | Header + filter-chip tabs + a `Summarize` action slot | Activity header + filter chips |
| `PageState` | `web/src/components/PageState.tsx` | Loading / error / empty states | Feed states + honest empty copy |
| `formatRelativeTime` | `web/src/lib/format.ts` | "9m ago" timestamps | Row "who + when" |
| `extractViaClaude` | `src/memory-ingest.ts` | Haiku-via-OAuth one-shot LLM (15s timeout, scrubbed env, `allowedTools:[]`) | Summarize digest (D-10) |
| `replayApproval` pattern | `src/replay-executor.ts` | Allowlist + honest-rejection + MCP-over-stdio template | The Undo inverse executor mirrors this exactly |
| `listPending/approve/deny` | `src/approval-queue.ts` | The held-item state machine | "Review" on held rows reuses the existing `/api/approvals/:id/approve|deny` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `GET /api/activity` | Reuse `/api/audit` + `/api/approvals` and join client-side | Client-side join over two paginated endpoints is fragile for day-grouping + filters; a single curated server endpoint is the discretion-approved cleaner path (CONTEXT "Claude's Discretion"). **Recommend new endpoint.** |
| `extractViaClaude` (Haiku/OAuth) for Summarize | `generateContent` (Gemini 2.5 Flash) in `src/gemini.ts` | Gemini requires `GOOGLE_API_KEY` and has hit 429 quota errors (see `memory-ingest.ts` backoff comments). Haiku/OAuth needs no extra key. **Recommend `extractViaClaude`.** |
| Extend `gate.ts` `summarize()` in place | New `src/activity-render.ts` phrase map | `summarize()` is also used for queue summaries (`approval-queue.ts` `gateEnqueue`) and is intentionally params-free (L-4). The richer tool→phrase map needs `tool_input`, so it should be a NEW render module that takes `(tool_name, tool_input, tier)`; keep `summarize()` as the params-free fallback. **Recommend new module, keep `summarize` for "Ran on its own" rows.** |

**Installation:** None. `git grep` confirmed all imports resolve to installed deps.

## Package Legitimacy Audit

No external packages are installed in this phase. All work uses dependencies already present and verified in `package.json` (`@anthropic-ai/claude-agent-sdk@^0.2.34`, `hono`, `preact`, `wouter-preact`, `lucide-preact`, `better-sqlite3`). slopcheck/registry verification is **not applicable** — no install step. If the planner introduces any new dependency, gate it behind a `checkpoint:human-verify` and run the legitimacy gate first.

## The Read Data Contract (verified against source)

### `audit_log` table — `src/db.ts:332`
```
id INTEGER PK AUTOINCREMENT
agent_id   TEXT NOT NULL DEFAULT 'main'
chat_id    TEXT NOT NULL DEFAULT ''
action     TEXT NOT NULL              -- AuditAction: 'message'|'command'|'delegation'|'kill'|'blocked'|'permission'
detail     TEXT NOT NULL DEFAULT ''   -- for 'permission': JSON {tool,tier,mode,outcome,queueId?}
blocked    INTEGER NOT NULL DEFAULT 0
created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))   -- UNIX SECONDS
```
Indexes: `idx_audit_time (created_at DESC)`, `idx_audit_agent (agent_id, created_at DESC)`. `[VERIFIED: src/db.ts:332-342]`

**Permission-row `detail` shape** (`src/gate.ts` `encodeDecision` / `recordDecision`):
`JSON.stringify({ tool, tier, mode, outcome, queueId? })` where `outcome ∈ {'allow','approved-inline','denied-inline','queued'}` and `tier ∈ 1..4`. **No `tool_input` is stored.** `[VERIFIED: src/gate.ts:168-191, 229-264]`

### `approval_queue` table — `src/db.ts:352`
```
id INTEGER PK AUTOINCREMENT
agent_id         TEXT NOT NULL DEFAULT 'main'
chat_id          TEXT NOT NULL DEFAULT ''
run_id           TEXT            -- mission/scheduled id (NULL for chat)
routine_id       TEXT            -- forward-compat, NULL today
tool_name        TEXT NOT NULL
tool_input       TEXT NOT NULL   -- JSON of captured params (the ONLY place params live)
tier             INTEGER NOT NULL
mode_at_decision TEXT NOT NULL
summary          TEXT NOT NULL DEFAULT ''   -- current value = "ToolName (Tier N)" from gate.summarize
status           TEXT NOT NULL DEFAULT 'pending'   -- pending|approved|denied|expired
decided_at       INTEGER         -- when approved/denied/expired
result           TEXT            -- replay outcome (success text or honest error)
created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))   -- UNIX SECONDS
```
Indexes: `idx_approval_pending (status, created_at DESC)`, `idx_approval_agent (agent_id, created_at DESC)`. `[VERIFIED: src/db.ts:352-369]`
`tool_input` is `JSON.parse`d defensively on read via `hydrate()` in `approval-queue.ts` — never eval'd. `[VERIFIED: src/approval-queue.ts:121-136]`

### Tag derivation (D-06) — read-side feasibility CONFIRMED
| Tag | Source | Exact condition |
|-----|--------|-----------------|
| **Needs you** (amber) | `approval_queue` | `status = 'pending'` `[VERIFIED]` |
| **You approved** (green) | `approval_queue` | `status = 'approved'` (also `audit_log` `outcome='approved-inline'` for live-chat approvals — see note) `[VERIFIED]` |
| **Ran on its own** (neutral) | `audit_log` | `action='permission'` AND `detail.outcome='allow'` (allowed, never queued) `[VERIFIED]` |
| **Skipped / denied** (honest state) | both | `approval_queue.status ∈ {'denied','expired'}`, or `audit_log` `outcome ∈ {'denied-inline','queued'}` | `[VERIFIED]` |

**Join keys / correlation:** Both tables carry `agent_id`, `created_at` (UNIX seconds), `chat_id`, and `run_id` (approval_queue) — sufficient for attribution and day-grouping. There is **no FK** between them; a queued action writes BOTH an `audit_log` row (`outcome='queued'`, with `queueId` in detail) AND an `approval_queue` row. **The `queueId` field in the audit detail is the bridge** from an audit "queued" event to its approval_queue row. To avoid double-display, the feed should treat `approval_queue` as the source of truth for any action that was queued, and only surface `audit_log` permission rows whose `outcome='allow'` (the "Ran on its own" set that never touched the queue). `[VERIFIED: gate.ts encodeDecision includes queueId; approval-queue.enqueueApproval]`

**Inline-approved (D-04 attended) edge:** an attended Tier 3/4 action approved in chat writes ONLY an `audit_log` row with `outcome='approved-inline'` and NO `approval_queue` row (the gate's `requestInline` path does not enqueue — see `gate.ts:235-245`). So "You approved" has two sources: `approval_queue.status='approved'` (background, has `tool_input`, **undoable**) and `audit_log outcome='approved-inline'` (chat, **no `tool_input`, not undoable**). Document this honestly. `[VERIFIED: src/gate.ts:235-245]`

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────────┐
   Phase 3 gate (UNCHANGED) │  makeCanUseTool (src/gate.ts)               │
   writes the event stream  │   allow → audit_log{outcome:'allow'}        │
                          │   queued → audit_log{outcome:'queued',qid}  │
                          │            + approval_queue{status:pending}  │
                          │   inline → audit_log{approved/denied-inline} │
                          └───────────────┬─────────────────────────────┘
                                          │ (read-only for Phase 4)
                ┌─────────────────────────▼──────────────────────────┐
  NEW           │  GET /api/activity  (src/dashboard.ts + query mod)  │
  read endpoint │   1. SELECT approval_queue (all statuses, by day)   │
                │   2. SELECT audit_log WHERE action='permission'     │
                │      AND outcome='allow'|'approved-inline'          │
                │   3. merge → derive tag (D-06) → phrase map (D-04)  │
                │   4. attach undoable flag (allowlist ∧ has input)   │
                └─────────────────────────┬──────────────────────────┘
                                          │ JSON rows (curated)
                ┌─────────────────────────▼──────────────────────────┐
  Browser       │  Activity.tsx (wouter /activity)                    │
                │   PageHeader + Summarize action                     │
                │   filter chips: All·Ran on its own·Needs you·@team  │
                │   day-grouped reverse-chron rows:                   │
                │     [color dot] phrase  ·  Comms 9:12am  ·  [tag]   │
                │     [View] | [Review→/api/approvals] | [Undo]       │
                └───┬───────────────────────────┬─────────────────────┘
                    │ Undo click                 │ Review (held)
       ┌────────────▼─────────────┐   ┌──────────▼──────────────────┐
  NEW  │ POST /api/activity/:id/  │   │ POST /api/approvals/:id/     │
       │   undo                   │   │   approve|deny (EXISTING)    │
       │ → src/undo-executor.ts   │   └─────────────────────────────┘
       │   allowlist inverse:     │
       │   draft→delete,          │   ┌─────────────────────────────┐
       │   meeting→cancel,        │   │ Summarize action            │
       │   label→remove           │   │ → extractViaClaude(prompt)  │
       │   else → honest "no undo"│   │   (Haiku/OAuth, server-side)│
       │   Tier 4 → never (D-09)  │   └─────────────────────────────┘
       └──────────────────────────┘
```

### Recommended Project Structure
```
src/
├── activity.ts            # NEW: curated read (join+merge+tag derive), undoability flag
├── activity-render.ts     # NEW: tool→phrase map (D-04), takes (tool_name, tool_input, tier)
├── undo-executor.ts       # NEW: allowlisted inverse executor (sibling of replay-executor.ts)
├── activity-summary.ts    # NEW (optional): Summarize prompt builder around extractViaClaude
├── dashboard.ts           # MODIFY: mount GET /api/activity, POST /api/activity/:id/undo,
│                          #         POST /api/activity/summarize
└── (gate.ts, approval-queue.ts, replay-executor.ts, memory-ingest.ts — READ ONLY)

web/src/
├── pages/Activity.tsx     # NEW: the operator surface (NOT Audit.tsx styling)
├── App.tsx                # MODIFY: <Route path="/activity"><Activity/></Route>
├── lib/routes.ts          # MODIFY: re-point nav.activity to /activity; add /audit row w/ nav.audit
├── lib/vocabulary.ts      # MODIFY: add 'nav.audit' key; keep 'nav.activity' on the new route
├── pages/Home.tsx         # MODIFY: add one-click Activity entry point (D-03)
└── components/ActivityRow.tsx   # NEW (optional): the row anatomy component
```

### Pattern 1: Curated read endpoint on the existing token-gated app
**What:** Add `app.get('/api/activity', ...)` next to the existing `/api/audit` and `/api/approvals` blocks (`src/dashboard.ts:3505-3557`). Reads inherit the token gate (query-param token, `dashboard.ts:342-356`). Mutations (`POST .../undo`, `POST .../summarize`) inherit the `DASHBOARD_MUTATIONS_ENABLED` kill-switch middleware (`dashboard.ts:367-396`).
**When to use:** Always — this is the established chokepoint for every `/api/*` route.
```typescript
// Source: src/dashboard.ts (existing /api/approvals + /api/audit pattern, :3505-3557)
app.get('/api/activity', (c) => {
  const filter = c.req.query('filter');     // all | autonomous | needsyou | <agent_id>
  const limit = parseInt(c.req.query('limit') || '100', 10);
  return c.json({ rows: buildActivityFeed({ filter, limit }) }); // from src/activity.ts
});
```

### Pattern 2: Allowlisted inverse executor (mirror of replay-executor.ts)
**What:** `src/undo-executor.ts` exports `undoAction(toolName, toolInput): Promise<{ok, message}>`. Pure dispatch on tool name; only a small allowlist of inverses runs; everything else returns an honest "not undoable" string. No eval, MCP via the same raw JSON-RPC stdio handshake `replay-executor.ts` uses.
**When to use:** The undo endpoint. Tier 4 is refused before dispatch (D-09).
```typescript
// Source: pattern mirrored from src/replay-executor.ts:60-75 (allowlist + honest rejection)
export async function undoAction(
  toolName: string, toolInput: Record<string, unknown>, tier: number,
): Promise<{ ok: boolean; message: string }> {
  if (tier >= 4) return { ok: false, message: "This action can't be undone." }; // D-09
  // Map forward tool → inverse MCP call. Example shapes (confirm exact MCP tool
  // names against the operator's connected servers at plan time):
  //   gmail draft create  → mcp__gmail__delete_draft { id|draft_id }
  //   calendar create      → mcp__gcal__delete_event  { event_id }  (cancel/decline)
  //   gmail/label apply    → mcp__gmail__remove_label { message_id, label }
  // else:
  return { ok: false, message: `Undo isn't available for ${toolName}.` };
}
```

### Pattern 3: Deterministic tool→phrase map (D-04), NOT per-row LLM
**What:** `src/activity-render.ts` maps `(tool_name, tool_input, tier)` to a plain phrase. Unmapped tools fall to an honest generic ("Used Gmail" / "Ran <tool>") with detail behind View (D-05). Keep `gate.summarize()` (params-free) as the fallback for `audit_log` "Ran on its own" rows that have no `tool_input`.
**When to use:** Render time, both for the feed and reusable by Summarize input.
```typescript
// Source: extends the gate.ts summarize() pattern (src/gate.ts:135-137) with params.
export function phraseFor(toolName: string, input: Record<string, unknown>, tier: number): string {
  if (/gmail__send/i.test(toolName)) {
    const to = String(input.to ?? input.recipients ?? '');
    return to ? `Sent email to ${to}` : 'Sent an email';
  }
  if (/draft/i.test(toolName)) return 'Prepared a draft';
  // ... small explicit map; default: honest generic (D-05)
  return `Ran ${toolName.replace(/^mcp__[^_]+__/, '')}`;
}
```

### Anti-Patterns to Avoid
- **Repurposing `Audit.tsx` / the `/audit` route** — explicitly forbidden (D-01; spec 08 "two screens, deliberately different"). `Audit.tsx` is dense monospace table; Activity must not inherit that.
- **Per-row LLM calls** — D-04 forbids it (cost, latency, non-determinism). LLM is for the operator-invoked Summarize only.
- **Mark-as-undone theater** — D-08/spec 08: Undo runs a real inverse or the button is absent. No no-op "undone" flag.
- **Re-opening the Phase 3 write path** — Activity derives everything read-side. Adding a `tag` column or touching `gate.ts` audit encoding is out of scope.
- **Double-displaying queued actions** — a queued action exists in BOTH tables; dedupe by treating `approval_queue` as source of truth and filtering `audit_log` to `outcome='allow'|'approved-inline'`.
- **Storing secrets in any new row** — `tool_input` is already param-only (L-4/ASVS V8); never copy env/scrubbed-env into the feed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Replaying/running a captured tool call | A new MCP client or `eval` of stored params | Mirror `src/replay-executor.ts` (raw JSON-RPC stdio, `loadMcpServers()`) | Already solved securely; MCP SDK is NOT installed |
| Teammate color | A new palette | `teammateColor(id)` in `web/src/lib/teammate.ts` | Single source of truth shared by Team + Routines |
| Relative timestamps | `Intl`/date math | `formatRelativeTime` in `web/src/lib/format.ts` | Used by every page including Audit |
| Tag chips | New badge component | `Pill` with tones (`done`/`neutral`/`medium`) | Matches `ApprovalItem` tags |
| Held-item approve/deny | A new state machine | Existing `/api/approvals/:id/approve|deny` + `approval-queue.ts` | "Review" reuses Phase 3 exactly |
| LLM digest auth | New API key / client | `extractViaClaude` (Haiku/OAuth) | No key, scrubbed env, kill-switch already wired |
| Token auth on the new endpoint | New middleware | Mount on existing `app` (`dashboard.ts:342`) | Inherits query-token gate + mutations kill-switch automatically |

**Key insight:** This phase's correctness comes from *reusing* the Phase 3 security primitives (allowlist replay, scrubbed env, token gate, kill-switch, status-guarded transitions) rather than reimplementing them. The Undo executor is the one new write and it is a structural copy of `replay-executor.ts` inverted.

## Runtime State Inventory

This is **not** a rename/refactor/migration phase. It adds new read/write paths over existing tables. A migration is needed ONLY if Undo must persist an "undone" marker.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `audit_log` + `approval_queue` already populated by Phase 3 (read sources). No new key/string rename. | None — read only. |
| Live service config | None — no external service config carries an Activity string. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None new. Summarize uses `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` via `readEnvFile` + scrubbed env (same as memory). | None — reuse existing path. |
| Build artifacts | None. | None. |

**New schema decision (the one possible migration):** If Undo records its result on the original `approval_queue` row, **no migration is needed** — reuse the existing `result` column (and optionally add a status value, but the column already exists). If the planner wants a distinct `undone` status or a dedicated `undo_log`, that requires the **dual-write migration pattern**: add to `src/db.ts` `createSchema` (for the in-memory test DB) AND a versioned `migrations/v1.2.4/` directory + `migrations/version.json` entry (live store). **Skipping the versioned file crash-loops the live service** (Phase 2 v1.2.2 precedent; see `.claude/skills/add-migration/SKILL.md`). **Recommendation: avoid a migration — derive undo-ability read-side and store the undo result in the existing `result` column.**

## Common Pitfalls

### Pitfall 1: Assuming `audit_log` permission rows carry `tool_input`
**What goes wrong:** Planning Undo or rich phrasing off `audit_log` rows.
**Why it happens:** Natural assumption that the audit row "has the action."
**How to avoid:** `audit_log.detail` is `{tool,tier,mode,outcome,queueId?}` only (`gate.ts encodeDecision`). Params live ONLY on `approval_queue`. Undo targets `approval_queue` rows; "Ran on its own" rows get a generic phrase and no undo.
**Warning signs:** A plan that says "undo any feed row."

### Pitfall 2: Double-counting queued actions
**What goes wrong:** A queued action shows twice (once from `audit_log outcome='queued'`, once from `approval_queue`).
**How to avoid:** Filter `audit_log` to `outcome IN ('allow','approved-inline')`; let `approval_queue` own everything that was queued. Use `queueId` in audit detail only to confirm the bridge, not to render a second row.
**Warning signs:** Duplicate rows in the feed at the same timestamp.

### Pitfall 3: Migration drift crash-loop
**What goes wrong:** Adding a column/table only in `db.ts` `createSchema` (tests pass) but not in `migrations/` → live service `checkPendingMigrations` crash-loops on restart.
**How to avoid:** Prefer NO migration. If unavoidable, dual-write via the `add-migration` skill (`v1.2.4`) + bump `version.json`. Per MEMORY: run `npm run migrate` before restart.
**Warning signs:** Tests green, live boot fails.

### Pitfall 4: Undo running with the wrong/empty MCP env
**What goes wrong:** The inverse MCP call fails because the server isn't configured, or runs with leaked env.
**How to avoid:** Mirror `replay-executor.ts` `replayMcp` exactly — `loadMcpServers()` for config, `{...process.env, ...cfg.env}`, honest failure if server absent ("Connect it in Settings"). Never read secrets from the queue row.
**Warning signs:** Undo "succeeds" in tests but does nothing live, or a generic error instead of the honest verbatim reason.

### Pitfall 5: Wrong-checkout investigation (worktree)
**What goes wrong:** Subagents read the main checkout and falsely claim code is absent (see MEMORY: "GSD subagents wrong cwd in worktree").
**How to avoid:** All paths resolve under the worktree root. Pin it in executor prompts.
**Warning signs:** "File not found" for a file that exists here.

### Pitfall 6: Forgetting the vocab/route collision is real, not theoretical
**What goes wrong:** Two nav items resolve to "Activity," or the demoted `/audit` still says "Activity."
**How to avoid:** `routes.ts:37` currently maps `/audit` → `vocabKey:'nav.activity'`. Re-point `nav.activity` to the NEW `/activity` route line, add a new `/audit` route line with a new `nav.audit` key, and add `'nav.audit': { operator: 'Audit', builder: 'Audit' }` to `vocabulary.ts`. Both `nav.activity` and `page.activity` currently exist; add `nav.audit` (and optionally `page.audit`).
**Warning signs:** Sidebar shows "Activity" twice.

## Code Examples

### Mount on the existing token-gated app (with mutations kill-switch on writes)
```typescript
// Source: src/dashboard.ts:367-396 (mutation middleware), :342-356 (token gate), :3505 (approvals)
// GET inherits token gate; POST inherits DASHBOARD_MUTATIONS_ENABLED automatically.
app.get('/api/activity', (c) => c.json({ rows: buildActivityFeed(...) }));
app.post('/api/activity/:id/undo', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
  const row = listPending().find(r => r.id === id) /* or a getApprovalById */;
  // ... look up tool_name + tool_input from approval_queue, call undoAction(...)
});
```

### Summarize reusing the Haiku/OAuth path
```typescript
// Source: src/memory-ingest.ts:39-85 (extractViaClaude) + src/gemini.ts parseJsonResponse
import { extractViaClaude } from './memory-ingest.js';
const prompt = `Summarize today's team activity in 3-4 plain sentences...\n${rowsAsText}`;
const text = await extractViaClaude(prompt, 20_000); // Haiku, scrubbed env, no API key
// LLM_SPAWN_ENABLED kill-switch governs Gemini path; extractViaClaude uses the SDK directly.
```

### MCP inverse call (structure copied from replay-executor.ts)
```typescript
// Source: src/replay-executor.ts:125-212 (replayMcp) — reuse verbatim for the inverse tool name.
// initialize → notifications/initialized → tools/call { name: <inverse tool>, arguments: <derived> }
// loadMcpServers()[serverName]; spawn(cfg.command, cfg.args, {env:{...process.env,...cfg.env}})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `permissionMode:'bypassPermissions'` | `canUseTool` gate (Phase 3) writing the event stream | Phase 3 (2026-06-24) | The feed reads what the gate writes; no new write path on the gate side |
| Gemini for extraction | Haiku-via-OAuth `extractViaClaude` as PRIMARY (Gemini 429-prone) | Pre-Phase 4 (memory-ingest) | Summarize should use Haiku, not Gemini |
| `/audit` mislabeled "Activity" via `nav.activity` | Re-point to a real `/activity` surface | This phase (D-02) | Resolves the naming collision |

**Deprecated/outdated:** Nothing in the read path is deprecated. The `summarize()` "ToolName (Tier N)" string is intentionally minimal and stays as the params-free fallback.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The operator's connected MCP servers expose deletable-draft / cancel-event / remove-label tools with stable names (e.g. `mcp__gmail__delete_draft`, `mcp__gcal__delete_event`, `mcp__gmail__remove_label`) | Undo executor (D-08) | If a clean inverse tool doesn't exist for a family, that family ships as honest "no undo" (D-08 explicitly allows this — only ONE of the three must work end-to-end). Plan should confirm actual MCP tool names at plan time against the connected servers; until then these names are **[ASSUMED]**. |
| A2 | Storing the Undo result in the existing `approval_queue.result` column (no new migration) is acceptable | Runtime State Inventory | If the team wants a distinct undone status/log, a `v1.2.4` dual-write migration is required (crash-loop risk if half-done). Low risk; derivable read-side. |
| A3 | Day-grouping uses local machine timezone (single-user local-first app) | Discretion (day boundaries) | Wrong tz would misgroup edge-of-midnight rows; low impact, single operator. |
| A4 | Summarize via `extractViaClaude` (Haiku) is the intended "existing plumbing" for D-10 | Summarize | If the team prefers Gemini, swap to `generateContent` — but that needs `GOOGLE_API_KEY`. Confirm at plan time. |
| A5 | "Needs review" (spec 08) and "Needs you" (CONTEXT D-06) are the same chip; CONTEXT D-11 wording "Needs you" governs | Filters | Cosmetic copy; CONTEXT is canonical. |

## Open Questions

1. **Which undo family is the guaranteed floor?**
   - What we know: D-08 requires at least one of draft/meeting/label working end-to-end; the others may ship honest "no undo."
   - What's unclear: Which connected MCP server + tool names actually support a clean inverse in this operator's setup.
   - Recommendation: Plan a discovery task to enumerate connected MCP tools (`loadMcpServers()` + the server's `tools/list`); pick label-remove or draft-delete as the floor (likely simplest, idempotent). Ship the rest behind honest "no undo."

2. **Does an attended (chat-approved) action need to be undoable?**
   - What we know: `approved-inline` rows live only in `audit_log` with no `tool_input` (gate.ts:235-245).
   - What's unclear: Whether the spec expects undo on chat-approved sends.
   - Recommendation: No — those rows have no captured params and many are Tier 3 sends (irreversible by definition). Surface "You approved" with no Undo, honestly.

3. **Is a `getApprovalById(id)` (any status) helper needed?**
   - What we know: `listPending()` only returns `status='pending'`. Undo targets approved rows.
   - Recommendation: Add a small `getApprovalById` / `listApprovals(statuses[])` read helper to `approval-queue.ts` (read-only addition, no migration) so the feed and undo can fetch non-pending rows.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@anthropic-ai/claude-agent-sdk` | Summarize (Haiku/OAuth) | ✓ | ^0.2.34 | — |
| `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`) | Summarize auth | ✓ (used by memory) | — | Summarize degrades to honest "couldn't summarize"; feed unaffected |
| Connected MCP servers (gmail/calendar) | Undo inverse calls | ⚠ operator-dependent | — | Honest "no undo" / "connect it in Settings" (mirrors replay-executor) |
| `better-sqlite3` / `src/db.ts` | All reads | ✓ | installed | — |
| `vitest` | Tests | ✓ | ^2.0.0 | — |

**Missing dependencies with no fallback:** None — the feed itself depends only on the local DB.
**Missing dependencies with fallback:** MCP servers for undo (graceful honest "no undo" per D-08).

## Validation Architecture

Nyquist validation is enabled (`workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest v2.x |
| Config file | `vitest.config.ts` (precedence) + inline `"vitest"` block in `package.json` |
| Quick run command | `npx vitest run src/activity.test.ts -x` |
| Full suite command | `npm test` (`vitest run`) |
| DB test helper | `_initTestDatabase()` (fresh in-memory SQLite per `beforeEach`) |
| Contract test pattern | `{module}.contract.test.ts` (e.g. extend `dashboard.contract.test.ts`) |
| Setup file | `src/test-env-setup.ts` (sets `DASHBOARD_TOKEN='test-contract-token'`) |

### Phase Requirements → Test Map
| Req / Criterion | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRUST-01 / SC1 | Feed is reverse-chronological, plain-language, attributed by `agent_id` | unit | `npx vitest run src/activity.test.ts -t "reverse-chron"` | ❌ Wave 0 |
| TRUST-01 / SC2 (D-06) | Tag derivation: pending→Needs you, approved→You approved, allow→Ran on its own, denied/expired→honest | unit | `npx vitest run src/activity.test.ts -t "tag derivation"` | ❌ Wave 0 |
| D-04/D-05 | Mapped tool → phrase; unmapped → honest generic, never fabricated | unit | `npx vitest run src/activity-render.test.ts` | ❌ Wave 0 |
| D-06 dedupe | A queued action appears once (approval_queue wins; audit `allow` only) | unit | `npx vitest run src/activity.test.ts -t "no double"` | ❌ Wave 0 |
| TRUST-02 / SC3 (D-07/D-08) | Allowlisted inverse runs for the floor family; non-allowlisted returns honest "no undo" | unit | `npx vitest run src/undo-executor.test.ts` | ❌ Wave 0 |
| TRUST-02 / D-09 | Tier 4 row is never undoable (no undo path, ever) | unit | `npx vitest run src/undo-executor.test.ts -t "tier 4"` | ❌ Wave 0 |
| API contract | `GET /api/activity` token-gated shape; `POST /api/activity/:id/undo` mutation-gated + 400 on bad id; undo-not-twice | contract | `npx vitest run src/dashboard.contract.test.ts -t "activity"` | ⚠ extend existing |
| Summarize | `POST /api/activity/summarize` returns text or honest failure; respects `LLM_SPAWN_ENABLED` | contract | `npx vitest run src/dashboard.contract.test.ts -t "summarize"` | ⚠ extend existing |
| SC (visual) | Activity surface looks unlike Audit (no monospace table); Undo button present only when undoable; per-teammate chips | manual | `checkpoint:human-verify` (matches Phase 3 end-of-phase gate) | manual-only |

### Sampling Rate
- **Per task commit:** `npx vitest run src/activity.test.ts src/undo-executor.test.ts src/activity-render.test.ts -x`
- **Per wave merge:** `npx vitest run src/dashboard.contract.test.ts` (+ the unit files)
- **Phase gate:** `npm test` green + `npm run build` (vite + tsc) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/activity.test.ts` — feed build, tag derivation (D-06), dedupe, attribution (TRUST-01)
- [ ] `src/activity-render.test.ts` — tool→phrase map + honest generic (D-04/D-05)
- [ ] `src/undo-executor.test.ts` — allowlist inverse, honest rejection, Tier 4 never (TRUST-02/D-09)
- [ ] `src/dashboard.contract.test.ts` — ADD `/api/activity*` blocks (token gate, mutation gate, undo-not-twice, summarize)
- [ ] (read helper) `getApprovalById`/`listApprovals(statuses)` in `approval-queue.ts` — covered by `approval-queue.test.ts`
- [ ] Framework install: none — vitest present.

## Security Domain

`security_enforcement: true`, ASVS Level 1, `security_block_on: high`.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Query-param `DASHBOARD_TOKEN` gate on the existing Hono app (`dashboard.ts:342-356`) — new routes inherit it by mounting on `app` |
| V3 Session Management | no | Single-token local app; no sessions |
| V4 Access Control | yes | Mutations (`/undo`, `/summarize`) inherit `DASHBOARD_MUTATIONS_ENABLED` kill-switch (`dashboard.ts:367-396`); read endpoint is GET-only |
| V5 Input Validation | yes | Validate `:id` is an integer (mirror approvals route `Number.isInteger`); validate filter enum; `JSON.parse` `tool_input` defensively (already done in `hydrate`) — never eval |
| V6 Cryptography | no | No new crypto; DB encryption is existing infra |
| V8 Data Protection | yes | `tool_input` is param-only (no env/secrets) — the feed must NOT add secret fields; Summarize prompt must exclude raw params that could carry PII beyond what's needed; scrubbed env on the LLM call |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Undo replays arbitrary/unallowlisted tool | Elevation of Privilege | Allowlist-only dispatch in `undo-executor.ts`; honest rejection of everything else (mirror `replay-executor.ts` T-03-replay-exec) |
| Undo double-fire (click + retry) | Tampering | Status-guarded transition like `approve()` — only act on a row in the expected state; report `changes===1` |
| Tier 4 made undoable | EoP | Hard refuse `tier>=4` before any dispatch (D-09); test pins it |
| Secret/env exfiltration via feed or Summarize | Information Disclosure | Feed surfaces only param-level fields already stored (L-4); Summarize uses scrubbed env (`getScrubbedSdkEnv`), no secret echo |
| Injection via stored `tool_input` into shell/eval | Tampering/EoP | No eval; MCP params travel as a structured JSON object over stdin (no string building) — exactly `replay-executor.ts` |
| Unauthed read of activity | Info Disclosure | Token gate inherited from mounting on `app` |
| LLM cost/abuse via Summarize | DoS | `LLM_SPAWN_ENABLED` kill-switch + operator-invoked only (not per-row) + bounded timeout |

## Project Constraints (from CLAUDE.md)

| Directive | Application to this phase |
|-----------|---------------------------|
| **No em dashes, ever** | All UI copy, phrase map, empty-state, Summarize prompt output must avoid em dashes |
| Plain text over heavy markdown; tight copy | Row phrases and tags terse and legible |
| Deploy: run `npm run migrate` before restart | Only if a migration is added (recommend avoiding); else N/A |
| launchd log paths no spaces | Not relevant (no new launchd work) |
| Worktree has no `.env`/`store` (symlink from main) | Run executors with symlinked `node_modules`/`.env`/`store`; tests use in-memory DB so unaffected |
| Conventions: ESM `.js` import extensions, `export let`+setter for mutable state, JSDoc on exports, tokens-only styling, font weights 400/500 only | New `src/*.ts` use `.js` extensions in imports; `Activity.tsx` uses CSS vars (`var(--color-*)`), weights 400/500 — matches `ApprovalItem.tsx` |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** New `/activity` route with a new `Activity.tsx` page (operator-facing, curated, plain-language). Do NOT repurpose `Audit.tsx`/`/audit`; that stays as the raw technical view for Phase 5. The two surfaces must look unlike each other.
- **D-02:** Re-point `vocabKey: nav.activity` (currently on `/audit` in `web/src/lib/routes.ts`) to the new `/activity` route. The `/audit` route gets its own builder/technical label (e.g. an `nav.audit` vocab key). Resolve this naming collision in this phase.
- **D-03:** Activity reachable BOTH from a sidebar nav item AND a one-click entry point from Home. Exact Home affordance is Claude's discretion.
- **D-04:** Row descriptions via a render-time tool→phrase map (deterministic, from tool name + key params). Extend the `summarize()` helper pattern in `src/gate.ts` rather than per-row LLM. No new write path, no per-row LLM cost, fully testable.
- **D-05:** Unmapped tools render an honest generic phrase ("Ran <tool>" / "Used Gmail") with technical detail behind View. Never fabricate a description, never hide a real row — completeness over polish.
- **D-06:** Derive tags read-side, no tag column, no re-opening the Phase 3 write path. Needs you (amber) = `approval_queue.status='pending'`; You approved (green) = `status='approved'`; Ran on its own (neutral) = a permission decision in `audit_log` allowed and never queued; denied/expired held items surface as their own honest state, not silently dropped.
- **D-07:** Undo as a bounded allowlist of reversible tool families, mirroring `src/replay-executor.ts` allowlist + honest-rejection. Each family maps captured `tool_input` to a known safe inverse. Anything not allowlisted shows no undo.
- **D-08:** Target inverses: drafts (delete created draft), meetings (cancel/decline created event), labels (remove applied label). Phase floor: at least ONE works end-to-end (likely label or draft); the others may ship as honest "no undo" if their inverse proves hard, captured as deferred follow-ups — not faked.
- **D-09:** Permission tier ↔ undo-ability are the same axis. Tier 4 (irreversible) shows NO undo, ever. Undo never silently no-ops: it either performs a real inverse or is absent.
- **D-10:** Header Summarize daily-digest action is in scope. Produces an LLM summary of a day's activity — the one acceptable on-demand LLM use on this surface (operator-invoked, not per-row). Prompt/model/grouping is Claude's discretion; reuse existing agent/LLM plumbing, not a new path.
- **D-11:** Full filter chip set: All · Ran on its own · Needs you · per-teammate. Per-teammate chips use `agent_id` joined to the existing team roster for color + name. All filtering read-side.

### Claude's Discretion
- New `/api/activity*` endpoint vs reusing/extending existing audit/approvals endpoints — researcher/planner call. **Research recommends a new `GET /api/activity` + `POST /api/activity/:id/undo` + `POST /api/activity/summarize`.**
- Day-grouping boundaries (timezone), empty-state copy, pagination/infinite-scroll.
- Exact Home entry-point affordance (card vs link vs mini-preview).
- Summarize prompt, model, digest format. **Research recommends `extractViaClaude` (Haiku/OAuth).**
- Precise `vocabKey` naming for the demoted `/audit` route. **Research suggests `nav.audit`.**
- Which of drafts/meetings/labels is the "first" guaranteed-working undo. **Research suggests label-remove or draft-delete.**

### Deferred Ideas (OUT OF SCOPE)
- The dense, immutable, exportable technical Audit log + richer schema + CSV/JSON export + bounded configurable retention (D10) — Phase 5.
- A general, registerable reversible-action framework — later; this phase ships a bounded allowlist only.
- Any drafts/meetings/labels undo target with no clean inverse ships as honest "no undo" and is logged for follow-up.
- Per-project filtering of Activity — fold in with Projects work; per-teammate is the attribution filter this phase.
- Richer Summarize (per-teammate/per-project digests, scheduled summaries) — beyond the single on-demand daily digest.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRUST-01 | A user can see an activity feed of what the team did, each item tagged autonomous vs approved | New `GET /api/activity` curated join over `audit_log`+`approval_queue` (read contract verified); tag derivation (D-06) confirmed feasible read-side from `approval_queue.status` + `audit_log` permission `outcome`; phrase map (D-04) via new `src/activity-render.ts`; attribution via `agent_id` + `teammateColor` + `/api/agents` name |
| TRUST-02 | A user can undo a reversible action from the activity feed (D9) | New `src/undo-executor.ts` mirroring `replay-executor.ts` allowlist; undo targets `approval_queue` rows (only place `tool_input` lives); Tier 4 refused (D-09); honest "no undo" for non-allowlisted (D-08); a `getApprovalById` read helper needed; `POST /api/activity/:id/undo` mutation-gated |
</phase_requirements>

## Sources

### Primary (HIGH confidence — read from this worktree)
- `src/db.ts:332-369, 3111-3157` — `audit_log` + `approval_queue` schema, `insertAuditLog`, `getAuditLog`, `getTeamRoster:2775`
- `src/gate.ts` (full) — `classifyTier`, `resolveOutcome`, `summarize:135`, `encodeDecision:168`, `recordDecision:179`, `makeCanUseTool:203` (tag/outcome semantics, no `tool_input` in audit detail)
- `src/approval-queue.ts` (full) — `ApprovalRow`, `enqueueApproval`, `listPending`, `approve`/`deny` status-guard, `hydrate`/`parseToolInput`
- `src/replay-executor.ts` (full) — allowlist + honest-rejection + MCP JSON-RPC stdio template for the Undo executor
- `src/dashboard.ts:342-396` (token gate + mutations kill-switch), `:3440-3557` (`/api/permissions`, `/api/approvals`, `/api/audit`, `approvalView`), `:2338-2401` (`/api/agents`, `/api/team/roster`)
- `src/security.ts:85-114` — `AuditAction` enum (`'permission'`), `audit()` pipeline
- `src/memory-ingest.ts:39-85` — `extractViaClaude` (Haiku/OAuth, scrubbed env) for Summarize
- `src/gemini.ts:22-55` — `generateContent`/`parseJsonResponse` (alternative LLM path; needs `GOOGLE_API_KEY`)
- `web/src/lib/routes.ts` (full) — the `nav.activity`-on-`/audit` collision (line 37), wouter route table
- `web/src/lib/vocabulary.ts:50-72` — `nav.activity`/`page.activity` keys; where `nav.audit` lands
- `web/src/lib/teammate.ts` (full) — `teammateColor(id)` palette
- `web/src/components/Pill.tsx`, `ApprovalItem.tsx`, `TeammateTag.tsx`, `web/src/lib/format.ts` — reusable render primitives
- `web/src/pages/Audit.tsx` (full) — the surface NOT to repurpose (dense monospace table)
- `web/src/App.tsx:49-71` — wouter route wiring; `web/src/pages/Home.tsx:155-184` — NeedsYouCard entry point
- `specs/operator-product/08-activity-audit.md` (full) — THE design contract (layout, row anatomy, Undo D9, two-screens-different rule)
- `.planning/phases/03-permissions-autonomy/03-CONTEXT.md` + `03-04-SUMMARY.md` — Phase 3 data contract + replay/inline-ask patterns
- `.planning/codebase/CONVENTIONS.md`, `TESTING.md`, `config.json` — ESM/.js, tokens-only styling, vitest + `_initTestDatabase`, nyquist + security flags
- `.claude/skills/add-migration/SKILL.md` — dual-write migration procedure (if a migration is forced)

### Secondary (MEDIUM)
- None — every claim is sourced from this worktree's code/spec.

### Tertiary (LOW)
- A1 (exact MCP inverse tool names) — `[ASSUMED]`, must be confirmed against connected servers at plan time.

## Metadata

**Confidence breakdown:**
- Read data contract (tables, tag derivation, no-`tool_input`-in-audit asymmetry): HIGH — read verbatim from `db.ts`/`gate.ts`/`approval-queue.ts`
- Architecture / endpoint placement / reuse map: HIGH — every integration point read from source
- Undo executor pattern: HIGH for the structure (mirrors `replay-executor.ts`); MEDIUM-LOW for the specific inverse MCP tool names (A1, depends on operator's connected servers)
- Summarize plumbing: HIGH — `extractViaClaude` confirmed
- Pitfalls: HIGH — derived from real code + project MEMORY (worktree cwd, migration crash-loop)

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (stable local codebase; re-verify MCP tool names at plan time)
