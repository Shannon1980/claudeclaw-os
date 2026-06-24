# Phase 4: Activity Feed - Research

**Researched:** 2026-06-24
**Domain:** Read-side derivation over an existing SQLite event stream + a bespoke Preact operator surface + a bounded inverse-action ("Undo") executor
**Confidence:** HIGH (this is an internal-integration phase; every claim is verified against the codebase, not training data)

## Summary

Phase 4 is almost entirely a **read-side and UI phase over data that Phase 3 already writes**. The two
source tables (`audit_log`, `approval_queue`) exist, are indexed for exactly these reads, and were
explicitly "shaped for Phase 4/5 readers" [VERIFIED: src/db.ts:344-369]. The feed's three tags are
**fully derivable** from data already on those rows — no schema change, no new write path on the gate
side. The one genuinely new write capability is **Undo**, and the codebase already ships its exact
structural template: `src/replay-executor.ts` is an allowlisted, no-eval, honest-rejection executor
that runs *forward* replays; Undo is its mirror that runs *inverse* operations [VERIFIED:
src/replay-executor.ts].

The frontend is a **mature, complete design system** (Tailwind v4 CSS-var tokens, Preact, wouter
routing, bespoke components) — Phase 4 assembles existing primitives (`PageHeader`, `Pill`,
`TeammateTag`, `ConfirmModal`, `PageState`, `ToastStack`) into one new page (`Activity.tsx`) plus a
new read endpoint and an undo endpoint mounted on the existing Hono app behind the same token +
CSRF + mutation-kill-switch chokepoint [VERIFIED: src/dashboard.ts:359-444]. Summarize reuses the
existing `generateContent()` Gemini one-shot [VERIFIED: src/gemini.ts:22].

**Primary recommendation:** Ship a new `GET /api/activity` endpoint that performs the curated join
(audit_log ⨝ approval_queue via the `queueId` carried in audit detail), a new `POST
/api/activity/:id/undo` endpoint backed by a new `src/undo-executor.ts` (sibling of
replay-executor.ts), and a new `Activity.tsx` page wired into `routes.ts`/`App.tsx`. Derive tags
read-side. Extend `gate.ts`'s `summarize()` into a deterministic tool→phrase map. Add ONE missing
helper to `web/src/lib/format.ts` (a clock-time formatter — it does not exist yet). Do NOT touch the
Phase 3 gate write path. Prefer **labels or drafts** as the first guaranteed-working undo (cleanest
inverse), defer meetings to honest "no undo" if its inverse proves hard.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** New `/activity` route with a new `Activity.tsx` page — operator-facing, curated,
  plain-language. Do NOT repurpose `Audit.tsx`/`/audit` (that stays the raw technical view for Phase 5).
  The two surfaces must look unlike each other.
- **D-02:** Re-point `vocabKey: nav.activity` (currently on the `/audit` route in
  `web/src/lib/routes.ts`) to the new `/activity` route. The existing `/audit` route gets its own
  builder/technical label (e.g. an `nav.audit` vocab key). Resolve this naming collision this phase.
- **D-03:** Activity is reachable BOTH from a sidebar nav item AND a one-click entry point from Home.
  Exact Home affordance (card / link / mini-preview) is Claude's discretion.
- **D-04:** Row descriptions via a render-time tool→phrase map — a deterministic mapping from tool
  name + key params to a plain phrase ("Sent follow-up to 3 leads"). Extend `summarize()` in
  `src/gate.ts`. No per-row LLM, no new write path, fully testable.
- **D-05:** Unmapped tools render an honest generic phrase ("Ran <tool>" / "Used Gmail") with
  technical detail behind View. Never fabricate, never hide a real row.
- **D-06:** Derive tags read-side from existing data, no tag column, no re-opening the Phase 3 write
  path:
  - **Needs you** (amber) = `approval_queue.status = 'pending'`.
  - **You approved** (green) = `approval_queue.status = 'approved'`.
  - **Ran on its own** (neutral) = a permission decision in `audit_log` that was allowed and never queued.
  - Denied / expired held items surface as honest states ("Skipped: waiting on your ok" / expired),
    not silently dropped.
- **D-07:** Undo as a bounded allowlist of reversible tool families, mirroring `src/replay-executor.ts`
  allowlist + honest-rejection. Each allowlisted family maps captured `tool_input` to a known safe
  inverse. Anything not on the allowlist shows no undo.
- **D-08:** Target inverses: drafts (delete created draft), meetings (cancel/decline created event),
  labels (remove applied label). **Phase floor / must-have: at least one works end-to-end** (likely
  label or draft); others may ship as honest "no undo" and be captured as deferred follow-ups — not faked.
- **D-09:** Permission tier ↔ undo-ability are the same axis. Tier 4 (irreversible) shows no undo,
  ever. Undo never silently no-ops: real inverse or absent.
- **D-10:** Header Summarize daily-digest action is in scope. LLM summary of a day's activity. The one
  acceptable operator-invoked LLM use on this surface. Exact prompt/model/grouping is Claude's discretion;
  reuse existing agent/LLM plumbing.
- **D-11:** Full spec chip set: All · Ran on its own · Needs you · per-teammate. Per-teammate via
  `agent_id` joined to the team roster for color + name. All filtering read-side.

### Claude's Discretion
- New `/api/activity*` endpoint vs reusing/extending existing audit/approvals endpoints.
- Day-grouping boundaries (timezone), empty-state copy, pagination/infinite-scroll.
- Exact Home entry-point affordance (card vs link vs mini-preview).
- The Summarize prompt, model, and digest format.
- Precise `vocabKey` naming for the demoted `/audit` route.
- Which of drafts/meetings/labels is the "first" guaranteed-working undo.

### Deferred Ideas (OUT OF SCOPE)
- The dense immutable/exportable technical Audit log + richer schema + CSV/JSON export + retention
  window (D10) — Phase 5 (AUD-01, AUD-02).
- A general, registerable reversible-action framework — later; this phase ships a bounded allowlist.
- Any drafts/meetings/labels undo target lacking a clean inverse ships as honest "no undo," logged for follow-up.
- Per-project filtering of Activity — with Projects work.
- Richer Summarize (per-teammate / per-project / scheduled digests).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRUST-01 | A user can see an activity feed of what the team did, each item tagged autonomous vs approved | Both source tables exist & indexed (`audit_log`, `approval_queue` — db.ts:332-369). Tag derivation is data-driven: `audit_log.detail` JSON carries `{tool, tier, mode, outcome, queueId}` (gate.ts:169-177); `approval_queue.status` ∈ pending\|approved\|denied\|expired (approval-queue.ts:34). "Ran on its own" = audit row with `outcome='allow'` and no queueId; "You approved" = approval_queue.status='approved' (or audit `outcome='approved-inline'`); "Needs you" = status='pending'. Render layer reuses `PageHeader`/`Pill`/`TeammateTag`/`PageState`. |
| TRUST-02 | A user can undo a reversible action from the activity feed (D9) | `src/replay-executor.ts` is the structural template: pure name-dispatch, no eval, honest rejection, never-throws. `approval_queue.tool_input` already stores the captured params (db.ts:359) needed to build an inverse. The undo executor maps an allowlisted forward tool to its inverse MCP call; Tier 4 (`tier` column / `classifyTier`) never undoable. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Reverse-chrono feed read (join + tag derivation) | API / Backend (`src/dashboard.ts` route + a query module) | Database (`audit_log`+`approval_queue`) | Tag derivation and the audit⨝queue join are server-side SQL+logic; the client must never re-derive trust state. Mirrors existing `/api/approvals`, `/api/audit`. |
| Plain-language tool→phrase map (D-04) | API / Backend (`src/gate.ts` extension, pure fn) | — | Deterministic, testable, no I/O. Lives next to `summarize()`. Could run server-side (richer) or be shared; keep it server-side so one source of truth feeds both the row and the Summarize prompt. |
| Tag rendering (Pill tones), attribution, filters | Frontend (`Activity.tsx`) | — | Pure presentation over the API payload. Filtering is read-side but applied client-side over the loaded window (matches `Audit.tsx` chip filtering). |
| Undo inverse execution | API / Backend (`src/undo-executor.ts` + route) | MCP servers (gmail/calendar) | The inverse is a real external mutation; it MUST travel the server's scrubbed-env MCP path (same as replay-executor), never the browser. |
| Summarize daily digest (LLM) | API / Backend (`generateContent` one-shot) | — | Operator-invoked LLM call; gated by `LLM_SPAWN_ENABLED` kill switch in `gemini.ts`. Client only triggers + renders. |
| Nav/route/vocab wiring (D-01/D-02/D-03) | Frontend (`routes.ts`, `vocabulary.ts`, `App.tsx`, `Home.tsx`) | — | Single source of truth for sidebar/palette/router is `routes.ts` + `vocabulary.ts`. |

## Standard Stack

This phase introduces **no new dependencies**. Everything is already installed and in active use.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | 4.12.3 | HTTP route for `/api/activity*` + undo endpoint | The dashboard API is Hono; new routes mount on the existing `buildDashboardApp` instance [VERIFIED: src/dashboard.ts, package.json] |
| better-sqlite3 | ^11.8.1 | Synchronous reads of `audit_log` + `approval_queue` | All persistence is this single synchronous driver via `getDb()` [VERIFIED: src/db.ts] |
| Preact | 10.29.1 | `Activity.tsx` rendering | The frontend framework [VERIFIED: web stack] |
| @preact/signals | 2.9.0 | Reactive state (where used) | Already in use across pages |
| wouter-preact | 3.9.0 | `/activity` client route | Routing in `App.tsx` is `<Route path>` blocks [VERIFIED: web/src/App.tsx:48-78] |
| lucide-preact | 1.14.0 | Row/header icons | Icon library; import from `lucide-preact` |
| @google/genai | ^1.44.0 | Summarize daily digest | `generateContent()` one-shot already wraps it, kill-switch-gated [VERIFIED: src/gemini.ts:22] |

### Supporting (existing modules to import, not rebuild)
| Module | Path | Purpose / What to Use |
|--------|------|------------------------|
| `summarize()` | src/gate.ts:135 | Extend into the deterministic tool→phrase map (D-04). Current impl returns `"${tool} (Tier ${tier})"` — params deliberately excluded for queue safety. The phrase map needs richer mapping that DOES read selected non-secret params from the stored `tool_input`. |
| `classifyTier()` / `Tier` | src/gate.ts:79 | Reuse to recompute/validate tier for the undo-ability gate (Tier 4 → no undo). Tier is also stored on `approval_queue.tier`. |
| `replayApproval()` pattern | src/replay-executor.ts:60 | COPY the structure (name-dispatch, no eval, honest reject, never-throws, `ReplayResult {ok,message}`, MCP JSON-RPC handshake) into a new `undo-executor.ts`. |
| `loadMcpServers()` | src/agent.ts (imported by replay-executor) | Used to spawn the stdio MCP server for an inverse call. |
| `listPending()` / `approve()` / `deny()` | src/approval-queue.ts:139/153/171 | Read pending rows; the held-item "Review" reuses approve/deny. |
| `getAuditLog()` / `getAuditLogCount()` | src/db.ts:3135/3146 | Existing audit reads — likely insufficient alone; a new curated query is cleaner (see Open Questions Q1). |
| `generateContent()` | src/gemini.ts:22 | Summarize one-shot. Note: it forces `responseMimeType: 'application/json'` and `temperature: 0.1` — a prose digest needs a model call that returns JSON-wrapped text, or a small change to allow text mime (see Pitfall P-6). |
| `audit()` / `AuditAction` | src/security.ts | Read-only here; do NOT add a new write path through the gate. An undo MAY warrant its own audit row — decide in planning (Open Q3). |

### Frontend primitives (import, never rebuild) — verified present
| Component | Path | Use |
|-----------|------|-----|
| `PageHeader` + `Tab` | web/src/components/PageHeader.tsx | Title "Activity", subtitle slot, Summarize action in `actions`, filter chips in `tabs` |
| `Pill` + `StatusDot` | web/src/components/Pill.tsx | The tags. Tones available: `neutral`, `done`(green), `medium`(amber), `queued`, `cancelled`. Maps cleanly to the tag contract. Note `Pill` bakes in `font-medium`(500) — acknowledged in UI-SPEC as outside the weight contract. |
| `TeammateTag` + `teammateColor` | web/src/components/TeammateTag.tsx, web/src/lib/teammate.ts | Per-row attribution dot + name. `teammateColor(id)` matches on id substring (research/comms/content/ops). |
| `AgentAvatar` | web/src/components/AgentAvatar.tsx | Identity avatar |
| `PageState` | web/src/components/PageState.tsx | loading / error / empty. Props: `{loading, error, empty, emptyTitle, emptyDescription}`. Extend empty copy per UI-SPEC. |
| `ConfirmModal` | web/src/components/ConfirmModal.tsx | Undo confirm. Props `{open,onClose,onConfirm,title,body,confirmLabel,destructive,detail}`. |
| `ToastStack` / `pushToast` | web/src/lib/toasts.ts | Undo result toast ("Undone." / "Couldn't undo that — {reason}.") |
| `ApprovalItem` | web/src/components/ApprovalItem.tsx | Pattern for the held-item "Review task" flow — DO NOT build a second approval UI; reuse this approve/deny call shape. |
| `useFetch` | web/src/lib/useFetch.ts | `useFetch<T>(path, pollMs)` — SWR cache + polling. Use for `/api/activity`. |
| `apiGet` / `apiPost` | web/src/lib/api.ts | Token auto-appended as `?token=`; throws `ApiError`. |
| `format.ts` | web/src/lib/format.ts | `formatRelativeTime` exists. **Clock format ("9:12am") does NOT exist — must be added** (see Pitfall P-5 / Wave 0). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `/api/activity` curated join | Reuse `/api/audit` + `/api/approvals` and join client-side | Client-side join over two paginated feeds is fragile (the queueId↔audit correlation is server knowledge); a single curated endpoint is cleaner and testable via the contract-test pattern. **Recommend new endpoint.** |
| New `src/undo-executor.ts` | Extend `replay-executor.ts` | Replay = forward; Undo = inverse. Different allowlists, different semantics (D-09 tier lock). Keep them siblings, not merged, to avoid confusing forward-replay with inverse-undo. **Recommend new sibling module.** |
| Gemini for Summarize | Claude Agent SDK | `generateContent()` (Gemini flash) is the established cheap one-shot for classify/extract; the Agent SDK is for full agent turns. **Recommend Gemini one-shot.** |

**Installation:** None. `npm ci` against the existing lockfile.

## Package Legitimacy Audit

> Not applicable — this phase installs **zero** new packages. All modules are first-party
> (`src/*`, `web/src/*`) or already-present dependencies verified in `package.json` and in active
> use across the codebase. slopcheck gate skipped intentionally (no external install surface).

| Package | Disposition |
|---------|-------------|
| (none) | No new dependencies |

## Architecture Patterns

### System Architecture Diagram

```
                          OPERATOR (browser, Mission Control SPA)
                                       │
            ┌──────────────────────────┼───────────────────────────┐
            │ GET /api/activity         │ POST /api/activity/:id/undo │ POST /api/activity/summarize
            ▼ (token + CSRF + mutation kill-switch middleware)        ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │                       Hono dashboard app (src/dashboard.ts)            │
   └───────────────────────────────────────────────────────────────────────┘
       │ read                     │ inverse-execute             │ LLM one-shot
       ▼                          ▼                             ▼
 ┌──────────────┐         ┌──────────────────┐          ┌────────────────┐
 │ activity      │        │ undo-executor.ts  │          │ generateContent │
 │ query module  │        │ (NEW — sibling of │          │ (gemini.ts,     │
 │ (NEW): join   │        │ replay-executor)  │          │ LLM_SPAWN gate) │
 │ audit_log ⨝   │        │ allowlist→inverse │          └────────────────┘
 │ approval_queue│        │ MCP JSON-RPC call │                  │
 │ via queueId,  │        └──────────────────┘                  │ prose digest
 │ derive tags + │                 │                            ▼
 │ phrase map    │                 ▼                     (rendered in header panel)
 └──────────────┘          MCP stdio server
       │                   (gmail / calendar)
       ▼
 ┌─────────────────────────────────────────┐
 │ SQLite store/claudeclaw.db (read-only    │
 │ for feed): audit_log, approval_queue     │
 └─────────────────────────────────────────┘
       │
       ▼
   Activity.tsx (NEW page) — reverse-chrono, day-grouped, tags, filters, Undo/Review/View
       │  one-click entry  ◄──────────  Home.tsx (NEW entry-point affordance, D-03)
       ▼
   routes.ts (re-point nav.activity → /activity; demote /audit to nav.audit)
```

**Data-flow trace (primary use case):** Operator opens `/activity` → `Activity.tsx` calls
`useFetch('/api/activity')` → Hono route runs the curated join, derives a tag + plain phrase per row
→ JSON payload → page groups by local day, renders rows with `TeammateTag` + `Pill` tag → operator
clicks Undo on a label row → `POST /api/activity/:id/undo` → `undo-executor` looks up the captured
`tool_input`, confirms tier ≠ 4 + tool on allowlist, issues the inverse MCP call → `{ok,message}` →
toast "Undone." or honest failure.

### Recommended Project Structure
```
src/
├── activity.ts              # NEW: curated query (audit⨝queue), tag derivation, phrase map glue
├── activity.test.ts         # NEW: unit tests for tag derivation + phrase map (Wave 0)
├── undo-executor.ts         # NEW: allowlisted inverse executor (sibling of replay-executor.ts)
├── undo-executor.test.ts    # NEW: allowlist + honest-rejection + Tier-4-never tests (Wave 0)
├── gate.ts                  # EDIT: extend summarize() into the tool→phrase map (D-04)
├── dashboard.ts             # EDIT: mount GET /api/activity, POST /api/activity/:id/undo, POST .../summarize
└── dashboard.contract.test.ts  # EDIT: pin the new endpoint shapes (Wave 0)

web/src/
├── pages/Activity.tsx       # NEW: the operator feed surface
├── pages/Home.tsx           # EDIT: add one-click Activity entry-point (D-03)
├── App.tsx                  # EDIT: <Route path="/activity"><Activity /></Route>
├── lib/routes.ts            # EDIT: re-point nav.activity → /activity; demote /audit (D-01/D-02)
├── lib/vocabulary.ts        # EDIT: add nav.audit term; nav.activity → /activity
├── lib/format.ts            # EDIT: add formatClock() ("9:12am") — does not exist yet
└── components/ActivityRow.tsx  # OPTIONAL NEW: extract the row if Activity.tsx gets large
```

### Pattern 1: Curated read endpoint (mirror `/api/approvals`)
**What:** A single GET that does the audit⨝queue join + tag derivation server-side and returns a flat,
already-tagged, already-phrased row list.
**When to use:** All feed reads.
**Example:**
```typescript
// Source: pattern from src/dashboard.ts:3505 (approvalView + app.get) [VERIFIED]
app.get('/api/activity', (c) => {
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const before = c.req.query('before'); // epoch seconds for "Load older"
  return c.json({ rows: listActivity({ limit, before }) }); // listActivity lives in src/activity.ts
});
```

### Pattern 2: Tag derivation (read-side, D-06)
**What:** Pure function mapping a joined row → one of the five tag states. No tag column.
**Example:**
```typescript
// Source: derived from gate.ts encodeDecision (gate.ts:169) + approval-queue status enum [VERIFIED]
// audit_log.detail is JSON: { tool, tier, mode, outcome: 'allow'|'queued'|'approved-inline'|'denied-inline', queueId? }
type Tag = 'ran-on-own' | 'you-approved' | 'needs-you' | 'skipped' | 'expired';
function deriveTag(row: { source: 'audit'|'queue'; outcome?: string; status?: string }): Tag {
  if (row.source === 'queue') {
    if (row.status === 'pending')  return 'needs-you';
    if (row.status === 'approved') return 'you-approved';
    if (row.status === 'denied')   return 'skipped';   // "Skipped: waiting on your ok"
    if (row.status === 'expired')  return 'expired';
  }
  // audit row
  if (row.outcome === 'approved-inline') return 'you-approved';
  if (row.outcome === 'allow')           return 'ran-on-own';
  return 'ran-on-own'; // safe honest default; never hide a row (D-05)
}
```

### Pattern 3: Inverse executor (mirror `replay-executor.ts`, D-07/D-09)
**What:** A new `undo-executor.ts` with the SAME shape as `replayApproval`: name-dispatch, no eval,
honest rejection, never-throws, `{ok,message}` return.
**Example:**
```typescript
// Source: structural mirror of src/replay-executor.ts:60 [VERIFIED]
export async function undoAction(toolName: string, tier: number, toolInput: Record<string, unknown>): Promise<ReplayResult> {
  if (tier >= 4) return { ok: false, message: "This action can't be undone." }; // D-09 lock, before dispatch
  try {
    if (/draft/i.test(toolName))   return await undoDraft(toolInput);   // delete the created draft (MCP)
    if (/label/i.test(toolName))   return await undoLabel(toolInput);   // remove the applied label (MCP)
    if (/calendar|meeting|event/i.test(toolName)) return await undoMeeting(toolInput); // cancel/decline (MCP)
    return { ok: false, message: `No undo available for ${toolName}.` }; // honest absence (D-05/D-09)
  } catch (err) {
    return { ok: false, message: `Couldn't undo — ${err instanceof Error ? err.message : String(err)}` };
  }
}
```
Each inverse uses the SAME MCP JSON-RPC handshake `replayMcp()` uses (initialize → notifications/initialized
→ tools/call). The inverse tool name (e.g. `mcp__gmail__delete_draft`) and the params built from the
captured forward `tool_input` are the only thing executed.

### Anti-Patterns to Avoid
- **Mark-as-undone theater (D-09 violation):** never flip a UI flag and claim "Undone" without a real
  inverse succeeding. The UI button must perform a real inverse or not render at all.
- **Re-deriving trust state client-side:** the tag must be computed server-side from the data; the
  client renders the server's verdict. (Mirrors why `/api/home/summary` groups server-side.)
- **Inheriting Audit's monospace/dense table styling on Activity:** UI-SPEC hard constraint — Activity
  is Inter, generous spacing, color dots. Audit (`Audit.tsx`) uses `font-mono` table rows; do not copy.
- **Calling an LLM per row:** D-04 forbids it. Summarize is the ONE LLM call, operator-invoked.
- **Touching the gate write path:** Activity derives everything read-side. Do not add a tag column or
  change `recordDecision`/`encodeDecision`.
- **Disabled/greyed Undo button:** UI-SPEC — render NO button rather than a disabled one.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP tool invocation for an inverse | A custom MCP client / SDK dependency | The line-delimited JSON-RPC handshake already in `replay-executor.ts:142-211` | No MCP SDK is installed; the codebase deliberately speaks raw JSON-RPC over stdio. Copy it verbatim. |
| Approve/deny on held rows | A second approval UI | `ApprovalItem.tsx` flow + `POST /api/approvals/:id/(approve\|deny)` | UI-SPEC D-06: reuse the Home `NeedsYouCard` one-tap approval; do not fork it. |
| Token / CSRF / kill-switch on new routes | Per-route auth | The global middleware in `dashboard.ts:359-444` | Token (`requireToken`), CSRF origin check, and `DASHBOARD_MUTATIONS_ENABLED` 503 are already applied app-wide. New mutating routes inherit them automatically. |
| Relative timestamps | A date library | `formatRelativeTime()` in `format.ts` | Already exists. (Clock format is the only gap — add a tiny `formatClock`, do NOT pull in dayjs/date-fns.) |
| LLM call plumbing for Summarize | A new Gemini/Anthropic client | `generateContent()` in `gemini.ts` | Already wraps `@google/genai`, gated by `LLM_SPAWN_ENABLED`, logged, error-handled. |
| Teammate colors | A new palette | `teammateColor(id)` in `lib/teammate.ts` | Single source of truth; substring-matched so renames keep color. |

**Key insight:** This phase's risk is *re-implementing* things that exist (MCP calls, approval flow,
auth), not *finding new tech*. The replay-executor is a near-complete blueprint for Undo; the
discipline is to mirror it faithfully (especially the honest-rejection + never-throw + no-eval rules)
rather than invent.

## Runtime State Inventory

> This is NOT a rename/refactor/migration phase — it is additive (new read + new write capability).
> The section is included only for the schema question, since CONTEXT raised it.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `audit_log` and `approval_queue` already populated by Phase 3 runs. **No data migration needed** — the feed reads existing rows; tags derive from existing columns. | None |
| Schema change | CONTEXT D-06 explicitly chooses read-side derivation over a tag column. An "undone" marker column would be the ONLY candidate schema change — and it is **discouraged**: prefer read-side derivation (CONTEXT code_context note db.ts dual-write only "if Undo needs to persist an 'undone' marker"). | None expected. **If** planning decides an undo needs an audit trail, use the `add-migration` skill (versioned `migrations/vX.Y.Z/` + `addColumnIfMissing` dual-write into `createSchema` for the in-memory test DB) — both, never one (P-4 migration drift). |
| Live service config | None — no launchd/n8n/external config carries activity state. | None |
| Secrets/env vars | `GOOGLE_API_KEY` (Gemini, for Summarize) already required & present. `LLM_SPAWN_ENABLED`, `DASHBOARD_MUTATIONS_ENABLED`, `PERMISSION_GATE_ENABLED` kill switches already exist. | None |
| Build artifacts | `dist/web/` (Vite build) and `dist/` (tsc) must be rebuilt for the new page/routes to appear; the production daemon serves `dist/web/index.html`. Per CLAUDE.md: run `npm run migrate` before restart IF any migration was added. | Rebuild + (conditional) migrate before restart |

**Nothing found requiring data migration** — verified: tags derive from existing `audit_log.detail`
+ `approval_queue.status`; undo reads existing `approval_queue.tool_input`.

## Common Pitfalls

### Pitfall 1: The audit↔queue join key is implicit, not a foreign key
**What goes wrong:** Treating `audit_log` and `approval_queue` as independently joinable by agent/time
double-counts a queued action (it appears as a `'queued'` audit row AND a queue row).
**Why it happens:** There is no FK. The link is the `queueId` field embedded in the JSON
`audit_log.detail` of the `'queued'` decision [VERIFIED: gate.ts:257 records `queueId` in encodeDecision].
**How to avoid:** In the curated query, treat the queue as the authoritative source for any action that
was queued, and suppress/merge the corresponding `'queued'` audit row (match on `queueId`). "Ran on its
own" rows are audit rows with `outcome='allow'` and NO queueId. Decide the canonical row per action in `src/activity.ts`.
**Warning signs:** The same action shows up twice in the feed, once neutral and once amber.

### Pitfall 2: `summarize()` deliberately excludes params — the phrase map needs them
**What goes wrong:** Reusing `summarize(tool, tier)` as-is yields "Sent email (Tier 3)", not "Sent
follow-up to 3 leads".
**Why it happens:** `summarize()` was built for the *queue summary* and intentionally carries ONLY
tool+tier, never params, because the queue summary is shown before approval (gate.ts:135 comment, L-4).
**How to avoid:** The render-time phrase map (D-04) reads selected NON-SECRET params from the stored
`tool_input` (e.g. recipient count, label name, draft subject). Build it as a NEW function (e.g.
`describeAction(toolName, toolInput)`) co-located in gate.ts or activity.ts, keeping `summarize()`
unchanged. Be deliberate about which params are safe to surface (subject lines, counts — yes; full
bodies, tokens — no).

### Pitfall 3: Undo must travel the scrubbed-env MCP path, never the browser
**What goes wrong:** Building the inverse as a client-side fetch to Gmail/Calendar, leaking creds or
bypassing the gate's env scrubbing.
**Why it happens:** It feels like "just another API call."
**How to avoid:** Mirror `replayMcp()` exactly — spawn the configured stdio MCP server server-side with
its own env (`loadMcpServers()`), pass params as a structured JSON object, no shell, no interpolation
(replay-executor.ts:142-211). The browser only POSTs the activity row id.
**Warning signs:** Any `fetch()` to a Google domain from `web/src/`.

### Pitfall 4: Migration drift if a schema change sneaks in
**What goes wrong:** Adding a column to `createSchema` but not to a versioned migration (or vice-versa)
— the in-memory test DB and the live store diverge.
**Why it happens:** The project dual-writes schema: `createSchema` (for `_initTestDatabase`) AND
`migrations/vX.Y.Z/` (for the live store) [VERIFIED: db.ts:344-351 comment].
**How to avoid:** Prefer NO schema change (D-06). If unavoidable, use the `add-migration` skill and add
to BOTH places. Run `npm run migrate` before restart (CLAUDE.md / MEMORY: else checkPendingMigrations crash-loops).

### Pitfall 5: `format.ts` has no clock-time formatter
**What goes wrong:** UI-SPEC says use `lib/format.ts` clock format "9:12am" — but only
`formatRelativeTime` exists; there is no `formatClock`/time-of-day function [VERIFIED: format.ts read in full].
**How to avoid:** Add a small `formatClock(unixSeconds)` to `format.ts` (local-tz `toLocaleTimeString`
→ "9:12am") in Wave 0, with a co-located test in `format.test.ts` (an existing, well-covered test file).
Day-grouping uses local-midnight boundaries (CONTEXT discretion → use local machine tz).

### Pitfall 6: `generateContent()` forces JSON mime + low temperature
**What goes wrong:** A prose daily digest comes back as JSON or terse, because `generateContent()`
hardcodes `responseMimeType: 'application/json'` and `temperature: 0.1` [VERIFIED: gemini.ts:35-38].
**How to avoid:** Either (a) prompt Summarize to return JSON like `{"digest": "..."}` and parse with
`parseJsonResponse` (lowest-friction, no shared-fn change), or (b) add an optional config param to
`generateContent`. Recommend (a) to avoid touching a shared LLM helper. Gate the call behind a check
that `GOOGLE_API_KEY` is set and surface an honest empty state ("Nothing to summarize yet today.")
when there's no activity.

### Pitfall 7: GSD subagents running in the wrong worktree (env-specific)
**What goes wrong:** A spawned executor runs in the main checkout, sees no `web/src/pages/Activity.tsx`
(because it was created in the worktree), and falsely reports the file absent.
**Why it happens:** Known issue (MEMORY: gsd-subagents-wrong-cwd-in-worktree); node_modules/.env/store
are symlinked from main.
**How to avoid:** Pin the worktree absolute path
(`/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/thirsty-chatelet-f2d10a`) in every
executor prompt; `pwd` before file ops.

## Code Examples

### Tag → Pill tone mapping (UI, verified tones exist)
```typescript
// Source: web/src/components/Pill.tsx:3 Tone union [VERIFIED]
// Pill tones available: queued|running|done|failed|cancelled|high|medium|low|neutral|accent
const TAG_PILL: Record<Tag, { tone: PillTone; copy: string }> = {
  'ran-on-own':   { tone: 'neutral',   copy: 'Ran on its own' },   // calm, low-key (UI-SPEC)
  'you-approved': { tone: 'done',      copy: 'You approved' },      // green
  'needs-you':    { tone: 'medium',    copy: 'Needs you' },         // amber — the focal point
  'skipped':      { tone: 'queued',    copy: 'Skipped: waiting on your ok' }, // neutral grey, NOT red
  'expired':      { tone: 'cancelled', copy: 'Expired before you saw it' },
};
```

### New route wiring (D-01/D-02)
```typescript
// web/src/App.tsx — add alongside existing <Route> blocks (App.tsx:48-78) [VERIFIED pattern]
<Route path="/activity"><Activity /></Route>
// Optionally: <Route path="/audit"><Audit /></Route> stays as the demoted technical view.

// web/src/lib/routes.ts — re-point nav.activity to /activity, demote /audit (routes.ts:37) [VERIFIED]
{ path: '/activity', label: 'Activity', vocabKey: 'nav.activity', section: 'intelligence', icon: Activity },
{ path: '/audit',    label: 'Audit',    vocabKey: 'nav.audit',    section: 'intelligence', icon: ShieldCheck },

// web/src/lib/vocabulary.ts — add nav.audit (vocabulary.ts:56 has nav.activity today) [VERIFIED]
'nav.audit': { operator: 'Audit log', builder: 'Audit (raw)' },
```

### Undo result toast (UI-SPEC copy contract)
```typescript
// Source: pattern from ApprovalItem.tsx:52 pushToast [VERIFIED]
if (res.ok) pushToast({ tone: 'success', title: 'Undone.' });
else        pushToast({ tone: 'error',   title: `Couldn't undo that — ${res.result}`, durationMs: 6000 });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Legacy single-file dashboard HTML | Vite-built Preact SPA at `dist/web/` | Pre-Phase-4 (rewrite in progress, PR-by-PR) | Build with `vite`; `DASHBOARD_LEGACY=true` is the rollback ejector. New page lands in the SPA. |
| (n/a) | Read-side trust derivation | This phase | No tag column; tags are computed, not stored. |

**Deprecated/outdated:** The legacy template HTML path (`DASHBOARD_LEGACY`) is kept only as a rollback;
do not add the Activity surface there.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The correct inverse MCP tool names exist (e.g. `mcp__gmail__delete_draft`, a calendar cancel/decline tool, a Gmail label-remove tool) on the operator's configured MCP servers | Undo / D-08 | If a clean inverse tool doesn't exist for a family, that family ships as honest "no undo" (allowed by D-08). The phase floor (≥1 working) is the safety net. **Planner should treat the first undo target as "whichever MCP server exposes a clean inverse," verified at implementation, not assumed.** |
| A2 | The forward `tool_input` captured at gate time contains enough to build the inverse (e.g. a created draft's id, or the label + message ids) | Undo | Some forward calls return an id (draft id) only in their *result*, not their *input*. The stored `tool_input` is the request params, and `approval_queue.result` holds the replay outcome text (capped 4000 chars). If the id needed to undo lives only in the result, the inverse may need to parse `result` or may not be reconstructable — **verify per target during planning; this directly informs which family is the guaranteed-working first undo.** |
| A3 | `'approved-inline'` audit outcomes should map to "You approved" | Tag derivation | If product intends only queue-approved (background) actions to read "You approved" and inline-approved to read differently, the mapping changes. Low risk; both are genuine operator approvals. |
| A4 | Local machine timezone / local-midnight day boundaries are acceptable for day grouping | Feed layout | CONTEXT explicitly grants this as discretion; low risk. |

**This table is non-empty:** A1 and A2 are the load-bearing assumptions — both concern whether a given
undo target has a reconstructable, real inverse. They are exactly why D-08 sets a "≥1 working, rest
honest no-undo" floor. The planner should sequence the undo work as: pick the target whose inverse is
provably reconstructable from stored data first.

## Open Questions

1. **Curated endpoint vs reuse — and the canonical-row rule for queued actions.**
   - What we know: Both source tables + their indexes exist; `/api/audit` and `/api/approvals` exist.
   - What's unclear: The exact dedup rule when an action has both a `'queued'` audit row and a queue row
     (Pitfall 1). Recommendation: NEW `GET /api/activity` that owns the join + dedup (queue row wins),
     pinned by a contract test.
2. **Which undo family ships first (D-08 floor).**
   - What we know: drafts/labels are likely cleanest; meetings notify attendees (destructive confirm).
   - What's unclear: Which family's inverse is reconstructable purely from stored `tool_input` (A2).
   - Recommendation: Planner sequences a Wave to *verify* one target end-to-end before committing to all three.
3. **Does an Undo warrant its own audit row?**
   - What we know: D-06 says no new gate write path; but an undo is a real mutation an operator might
     want trailed in Phase 5's audit.
   - What's unclear: Whether to write an `audit()` row for the undo action itself.
   - Recommendation: Write a minimal `audit({action:'undo', detail:{tool,result}})` row (this uses the
     EXISTING `audit()` write path for a NEW action type, not a change to the gate). Confirm in planning.
4. **Summarize: JSON-wrapped prose vs `generateContent` signature change (Pitfall 6).**
   - Recommendation: JSON-wrapped (`{"digest":"..."}`) to avoid touching a shared helper.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build + server | ✓ | >=20 (dev v25) | — |
| better-sqlite3 (native) | DB reads | ✓ (installed) | ^11.8.1 | If a native rebuild is triggered, MEMORY notes the toolchain is broken on this machine (Python 3.12 no distutils + Node 25) — use `--ignore-scripts` + manual postinstall. **Avoid triggering a rebuild.** |
| Vite | Frontend build | ✓ | 5.4.21 | — |
| vitest | Tests | ✓ | 2.0.0 | — |
| GOOGLE_API_KEY (Gemini) | Summarize (D-10) | ✓ (in .env, required) | — | Summarize shows honest empty/error state if unset/`LLM_SPAWN_ENABLED` off |
| Configured MCP servers (gmail/calendar) | Undo inverse calls (D-08) | unknown per-operator | — | Honest "Couldn't undo — the X tool isn't connected" (matches replay-executor's existing message) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** MCP inverse-tool availability is per-operator and is handled by
the same honest-rejection path the replay executor already uses.

## Validation Architecture

> nyquist_validation is enabled (config.json workflow.nyquist_validation: true).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.0.0 (built-in expect, `@vitest/coverage-v8`) |
| Config file | `vitest.config.ts` (root) + inline `package.json` "vitest" block; glob `src/**/*.test.ts` |
| Quick run command | `npx vitest run src/activity.test.ts src/undo-executor.test.ts` |
| Full suite command | `npm test` (vitest run) |
| Typecheck | `npm run typecheck` (tsc --noEmit) for both `src/` and `web/` |
| Setup file | `src/test-env-setup.ts` (sets DASHBOARD_TOKEN etc. before config.ts import) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRUST-01 | Tag derivation: queue.pending→needs-you, approved→you-approved, audit allow+no-queueId→ran-on-own, denied→skipped, expired→expired | unit | `npx vitest run src/activity.test.ts -t "deriveTag"` | ❌ Wave 0 |
| TRUST-01 | Queued action de-dup: a queued audit row + its queue row collapse to one canonical row (Pitfall 1) | unit | `npx vitest run src/activity.test.ts -t "dedup"` | ❌ Wave 0 |
| TRUST-01 | Phrase map: mapped tool → plain phrase with safe params; unmapped tool → honest "Ran <tool>", never hidden (D-05) | unit | `npx vitest run src/activity.test.ts -t "describeAction"` | ❌ Wave 0 |
| TRUST-01 | `GET /api/activity` response shape (rows: tag, phrase, agent_id, created_at, undoable) | contract | `npx vitest run src/dashboard.contract.test.ts -t "activity"` | ⚠️ extend existing |
| TRUST-02 | Undo allowlist: allowlisted family → inverse attempted; non-allowlisted → `{ok:false}` honest message | unit | `npx vitest run src/undo-executor.test.ts -t "allowlist"` | ❌ Wave 0 |
| TRUST-02 | Tier 4 never undoable: `undoAction(tool, 4, input)` returns `{ok:false}` before any dispatch (D-09) | unit | `npx vitest run src/undo-executor.test.ts -t "tier 4"` | ❌ Wave 0 |
| TRUST-02 | Undo never throws on a bad/unknown shape; returns honest message | unit | `npx vitest run src/undo-executor.test.ts -t "never throws"` | ❌ Wave 0 |
| TRUST-02 | `POST /api/activity/:id/undo` mutation gated by token + CSRF + DASHBOARD_MUTATIONS_ENABLED; returns `{ok, result}` | contract | `npx vitest run src/dashboard.contract.test.ts -t "undo"` | ⚠️ extend existing |
| TRUST-01 | `formatClock` renders local clock time ("9:12am") | unit | `npx vitest run web` (or co-located format.test.ts) | ⚠️ extend `src`/`web` test |
| TRUST-02 | Undo end-to-end for ≥1 family (D-08 floor) against a real/mocked MCP server | integration | `npx vitest run src/undo-executor.integration.test.ts` (mock MCP via spawned stub) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/activity.test.ts src/undo-executor.test.ts` + `npm run typecheck`
- **Per wave merge:** `npm test` (full vitest run)
- **Phase gate:** Full suite green + `npm run typecheck` clean for both projects before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/activity.ts` + `src/activity.test.ts` — tag derivation, dedup, phrase map (TRUST-01)
- [ ] `src/undo-executor.ts` + `src/undo-executor.test.ts` — allowlist, Tier-4 lock, honest reject, never-throw (TRUST-02)
- [ ] `web/src/lib/format.ts` `formatClock()` + test (UI-SPEC clock format; does not exist)
- [ ] Extend `src/dashboard.contract.test.ts` — pin `GET /api/activity`, `POST /api/activity/:id/undo`, `POST /api/activity/summarize` shapes
- [ ] (Optional) `src/undo-executor.integration.test.ts` — one family end-to-end against a stub MCP server (the D-08 floor proof)
- Framework install: none — vitest is present.

## Security Domain

> security_enforcement enabled, ASVS level 1, block_on: high.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Trust state derived server-side; client never authoritative. Undo travels the server-side scrubbed-env MCP path only. |
| V2 Authentication | yes | Dashboard token (`requireToken`, dashboard.ts:359) gates all `/api/*`. No new auth surface. |
| V3 Session Management | partial | Token in URL persisted to `sessionStorage` (never localStorage — api.ts:1-5). New endpoints inherit. |
| V4 Access Control | yes | All mutations (undo, summarize) pass the global mutation kill-switch (`DASHBOARD_MUTATIONS_ENABLED` → 503) + CSRF origin allowlist (dashboard.ts:367-444). The undo route is a mutation and inherits both. |
| V5 Input Validation | yes | `:id` parsed with `Number.isInteger` (mirror approvals route, dashboard.ts:3515). `tool_input` is JSON.parsed defensively, never eval'd (approval-queue.ts:121). Undo executor must NOT interpolate model/operator text into shell or tool args — pass structured params only. |
| V6 Cryptography | no | No crypto introduced. Message-field encryption (existing) untouched. |
| V8 Data Protection | yes | The phrase map (D-04) must surface only NON-SECRET params from `tool_input` (subject/count — yes; tokens/full bodies — no). `tool_input` already excludes env/secrets by construction (L-4, db.ts:351). |
| V12 Files/Resources | partial | If an undo ever touched the filesystem (it should not for drafts/labels/meetings), reuse replay-executor's explicit path handling. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Undo invoked cross-origin via leaked token | Spoofing / Elevation | CSRF origin allowlist + token gate (already app-wide, dashboard.ts:422-444) |
| Replaying/undoing an action twice (double-fire) | Tampering | Status-guarded transitions (`WHERE status=...`, `.changes===1`) — mirror approval-queue.ts:153 for any undo state change |
| Tier 4 (money/sign/delete) undone or "undone-faked" | Tampering / Repudiation | Tier-4 lock BEFORE dispatch in undo-executor (D-09); honest absence of button in UI |
| Secret leakage via the plain-language phrase | Information Disclosure | Phrase map allowlists which params it reads; `tool_input` already excludes secrets (V8) |
| Arbitrary command/tool execution via undo | Elevation | No eval, name-dispatch allowlist, structured JSON params only (mirror replay-executor.ts security header) |
| Mutation during incident lockdown | Tampering | `DASHBOARD_MUTATIONS_ENABLED` 503 middleware covers the undo/summarize POSTs automatically |

## Sources

### Primary (HIGH confidence) — codebase (verified by reading)
- `src/db.ts:332-369` — `audit_log` + `approval_queue` schema, indexes, dual-write comment
- `src/gate.ts` (full) — `classifyTier`, `summarize`, `encodeDecision` (`{tool,tier,mode,outcome,queueId}`), tier model, Tier-4 lock
- `src/replay-executor.ts` (full) — allowlist + honest-rejection + MCP JSON-RPC template for Undo
- `src/approval-queue.ts` (full) — `ApprovalRow`, `listPending/approve/deny`, status enum, status-guarded transitions
- `src/dashboard.ts:359-444, 3490-3557` — token/CSRF/mutation middleware; `/api/approvals*`, `/api/audit*` routes; `approvalView`
- `src/gemini.ts:1-55` — `generateContent` one-shot (JSON mime, temp 0.1, LLM_SPAWN gate)
- `web/src/lib/routes.ts`, `web/src/lib/vocabulary.ts`, `web/src/App.tsx:48-78` — nav/route/vocab single source of truth
- `web/src/pages/Audit.tsx`, `web/src/pages/Home.tsx` — surfaces NOT to repurpose / the Home entry-point host
- `web/src/components/{Pill,PageHeader,ConfirmModal,TeammateTag,PageState,ApprovalItem}.tsx`, `web/src/lib/{api,useFetch,teammate,format,toasts}.ts` — reusable primitives + the `formatClock` gap
- `src/dashboard.contract.test.ts` (head), `.planning/codebase/TESTING.md` — vitest patterns, `_initTestDatabase`, contract tests
- `.planning/REQUIREMENTS.md:39-40` — TRUST-01, TRUST-02 wording
- `migrations/v1.2.3/create-approval-queue.ts`, `.claude/skills/add-migration/SKILL.md` — migration dual-write pattern (only if schema change)
- `.planning/phases/04-activity-feed/04-CONTEXT.md`, `04-UI-SPEC.md` — locked decisions + UI contract

### Secondary (MEDIUM confidence)
- `.planning/codebase/{STACK,CONVENTIONS}.md` — stack versions, conventions (analysis dated 2026-06-14; cross-checked against live files)

### Tertiary (LOW confidence)
- MEMORY.md operational notes (worktree cwd, native toolchain, migrate-before-restart) — env-specific, treated as cautions not facts

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all modules read directly from source
- Architecture: HIGH — both source tables, the route chokepoint, and the replay-executor template all verified in code
- Tag derivation: HIGH — derivable from `audit_log.detail` JSON + `approval_queue.status`, both verified
- Undo reconstructability: MEDIUM — structural template is certain (replay-executor); whether each family's inverse is reconstructable from stored `tool_input` is the load-bearing unknown (A1/A2), which is exactly why D-08 sets a ≥1-working floor
- Pitfalls: HIGH — each tied to a specific verified code location

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (stable internal codebase; re-verify if Phase 3 modules or the web build pipeline change)

## RESEARCH COMPLETE

**Phase:** 04 - activity-feed
**Confidence:** HIGH

### Key Findings
- **Zero new dependencies.** Both source tables (`audit_log`, `approval_queue`) exist, are indexed, and were explicitly shaped for Phase 4 readers. Tags are 100% derivable read-side from `audit_log.detail` JSON (`outcome`) + `approval_queue.status` — no schema change (honors D-06).
- **`src/replay-executor.ts` is a near-complete blueprint for Undo** — copy its allowlist + no-eval + honest-rejection + never-throw + raw MCP JSON-RPC structure into a new `src/undo-executor.ts`. Tier-4 lock goes BEFORE dispatch (D-09).
- **The audit↔queue join is implicit** (via `queueId` embedded in audit `detail` JSON, no FK) — the #1 pitfall is double-counting a queued action; the curated `/api/activity` endpoint must dedup with the queue row winning.
- **Two real gaps to close in Wave 0:** `format.ts` has no clock-time formatter (UI-SPEC assumes one), and `generateContent()` forces JSON mime + low temp (Summarize must return JSON-wrapped prose).
- **The load-bearing unknown is undo reconstructability** (A1/A2): whether each family's inverse is buildable from the stored `tool_input` — sequence the undo work to prove ONE family end-to-end first (the D-08 floor).

### File Created
`/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/thirsty-chatelet-f2d10a/.planning/phases/04-activity-feed/04-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | No new deps; verified against package.json + live source |
| Architecture | HIGH | Source tables, route chokepoint, executor template all verified in code |
| Pitfalls | HIGH | Each tied to a specific verified line |
| Undo reconstructability | MEDIUM | Template certain; per-family inverse-from-stored-input is the open risk (why D-08 sets a ≥1 floor) |

### Open Questions
1. Curated `/api/activity` endpoint dedup rule for queued actions (queue row wins) — recommend new endpoint + contract test.
2. Which undo family ships first — sequence to verify one end-to-end (reconstructable from stored `tool_input`).
3. Whether an undo writes its own `audit()` row (uses existing write path for a new action type — not a gate change).
4. Summarize via JSON-wrapped prose vs changing the shared `generateContent` signature (recommend JSON-wrapped).

### Ready for Planning
Research complete. The planner can map TRUST-01 to the read/tag/render work and TRUST-02 to the undo-executor + endpoint, with Wave 0 closing the test + `formatClock` + `generateContent` gaps before implementation.
