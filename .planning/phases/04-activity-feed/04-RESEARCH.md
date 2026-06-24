# Phase 4: Activity Feed - Research

**Researched:** 2026-06-24
**Domain:** Operator-facing read surface over the Phase 3 event stream (`audit_log` + `approval_queue`) + a bounded Undo inverse executor + an on-demand LLM daily digest
**Confidence:** HIGH (all integration points verified by reading the actual worktree code; the only ASSUMED items are concrete MCP inverse tool names, because no MCP servers are configured in this environment)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Build a **new `/activity` route with a new `Activity.tsx`** page — operator-facing, curated, plain-language. Do **not** repurpose the existing `Audit.tsx`/`/audit` page (stays raw/technical for Phase 5). The two surfaces must look unlike each other.
- **D-02:** **Re-point `vocabKey: nav.activity`** (currently on the `/audit` route in `web/src/lib/routes.ts`) to the new `/activity` route. Give the existing `/audit` route its own builder/technical label (e.g. `nav.audit`). Resolve the naming collision this phase.
- **D-03:** Activity reachable from **both** a sidebar nav item **and** a one-click entry point from Home. Exact Home affordance is Claude's discretion.
- **D-04:** Row descriptions via a **render-time tool→phrase map** — deterministic tool name + key params → plain phrase. Extend the existing `summarize()` helper pattern in `src/gate.ts`. No per-row LLM call.
- **D-05:** Unmapped tools render an **honest generic phrase** ("Ran <tool>" / "Used Gmail") with technical detail behind View. Never fabricate, never hide a real row.
- **D-06:** Derive tags **read-side**, no tag column: **Needs you** (amber) = `approval_queue.status='pending'`; **You approved** (green) = `approval_queue.status='approved'`; **Ran on its own** (neutral) = an allowed `audit_log` permission decision never queued. Denied/expired surface as their own honest state, not dropped.
- **D-07:** Undo = a **bounded allowlist of reversible tool families**, mirroring `src/replay-executor.ts` allowlist + honest-rejection. Each family maps captured `tool_input` to a known **safe inverse**. Not on the list → no undo.
- **D-08:** Target inverses: **drafts** (delete created draft), **meetings** (cancel/decline created event), **labels** (remove applied label). **Phase floor: at least one works end-to-end**; the others may ship as honest "no undo" and be logged as deferred follow-ups — not faked.
- **D-09:** **Permission tier ↔ undo-ability are the same axis.** Tier 4 shows **no undo, ever**. Undo never silently no-ops: real inverse or absent.
- **D-10:** Header **Summarize** daily-digest action is **in scope** — one operator-invoked LLM summary of a day's activity. Reuse existing agent/LLM plumbing. Prompt/model/grouping is Claude's discretion.
- **D-11:** Ship the full chip set: **All · Ran on its own · Needs you · per-teammate**. Per-teammate chips use `agent_id` joined to the team roster for color + name. All filtering read-side.

### Claude's Discretion
- New `/api/activity*` endpoint vs reusing/extending audit/approvals endpoints (researcher/planner call — **recommendation below: new `/api/activity`**).
- Day-grouping boundaries (timezone), empty-state copy, pagination/infinite-scroll.
- Exact Home entry-point affordance (card vs link vs mini-preview).
- Summarize prompt, model, digest format.
- Precise `vocabKey` naming for the demoted `/audit` route.
- Which of drafts/meetings/labels is the "first" guaranteed-working undo.

### Deferred Ideas (OUT OF SCOPE)
- The dense immutable exportable **technical Audit log** surface + richer schema + CSV/JSON export + retention window (D10) — Phase 5.
- A general/registerable reversible-action framework — later; this phase ships a bounded allowlist only.
- Any drafts/meetings/labels target with no clean inverse ships as honest "no undo" and is logged as a follow-up.
- Per-project filtering of Activity — folds in with Projects work.
- Richer Summarize (per-teammate/per-project, scheduled) — beyond the single on-demand daily digest.
- Any change to the Phase 3 permission gate / audit *write* path — Activity derives everything read-side; the gate stays as shipped.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRUST-01 | A user can see an activity feed of what the team did, each item tagged autonomous vs approved | Curated reverse-chronological read over `audit_log` (permission decisions) + `approval_queue`; tags derived read-side per D-06 (see "Curated Activity Read" + the SQL/derivation section). Plain-language rows via the deterministic tool→phrase map (D-04/D-05). Per-teammate attribution via `teammateColor()` + `listAllAgents()` (D-11). |
| TRUST-02 | A user can undo a reversible action from the activity feed (D9) | Bounded inverse executor sibling of `src/replay-executor.ts` (D-07/D-08/D-09). Phase floor: one family end-to-end. Tier read from the stored record (`approval_queue.tier`, or decoded from `audit_log.detail`); Tier 4 never undoable. |
</phase_requirements>

## Summary

Phase 4 is overwhelmingly a **read + render** phase over data Phase 3 already writes, plus **one genuinely new write path (Undo)** and **one reuse of existing LLM plumbing (Summarize)**. The data contract is solid and verified: every permission decision lands in `audit_log` as `action='permission'` with a JSON `detail` of exactly `{tool, tier, mode, outcome, queueId?}` (encoded by `encodeDecision()` in `src/gate.ts:169`), and every background-gated action lands in `approval_queue` with full `tool_name`, `tool_input` (JSON), `tier`, `status`, `result`, `agent_id`, `run_id`, `routine_id`, timestamps (`src/db.ts:352`). The three read-side tags (D-06) map cleanly onto these two tables with zero schema change.

The **Undo inverse executor** is the only real risk, and the risk is concrete and now well-characterized: `loadMcpServers()` (`src/agent.ts:34`) reads MCP servers from `~/.claude/settings.json` + the project `.claude/settings.json` — and **this environment currently has zero MCP servers configured** (both resolve to empty). The replay executor's MCP path therefore fails honestly today ("the X tool isn't connected"). The cleanest guaranteed-working inverse for the **phase floor** is consequently a family the executor can run **without any MCP server**: a **draft delete** implemented as a `Bash`/`fs` removal of a created draft file, mirroring the existing native `Write`/`Bash` executors in `replay-executor.ts`. The meetings and labels inverses depend on operator-configured Gmail/Calendar MCP servers and so realistically ship as honest "no undo" (logged as deferred follow-ups) unless the operator has those MCPs connected. This is exactly the D-08 escape hatch, not a failure.

**Primary recommendation:** Add a new `/api/activity` read endpoint (curated join over both tables) + a new `/api/activity/:id/undo` mutation backed by a new `src/undo-executor.ts` (sibling of `replay-executor.ts`); extend `gate.ts summarize()` into a pure, testable `describeAction(toolName, toolInput)` phrase map; build `Activity.tsx` reusing `Pill`/`ConfirmModal`/`PageHeader`/`PageState`; re-point `nav.activity` → `/activity` and add `nav.audit` for the demoted `/audit`; pick **draft-delete as the guaranteed first undo**. No new packages.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Curated activity feed read (join + tag derivation) | API / Backend (`src/dashboard.ts` + a query helper in `src/db.ts` or new `src/activity.ts`) | Database (`audit_log` + `approval_queue` read) | Tag derivation and the join are deterministic server logic; the DB owns the rows. The browser must not re-implement tag rules. |
| Plain-language phrase map (D-04) | API / Backend (pure function, extend `gate.ts` pattern) | Browser (renders the returned phrase) | Deterministic, no LLM, must be unit-testable server-side. Keeping it server-side means one source of truth and lets Summarize reuse it. |
| Per-teammate attribution color + name (D-11) | Browser (`web/src/lib/teammate.ts teammateColor()` + roster) | API (supplies `agent_id`) | Color palette already lives client-side; the API just passes `agent_id`. Name resolves via the roster API already in use. |
| Tag computation (Needs you / You approved / Ran on its own) | API / Backend | — | Pure read-side derivation from `approval_queue.status` + `audit_log` outcome. Single source of truth (D-06). |
| Undo inverse execution (TRUST-02) | API / Backend (new `src/undo-executor.ts`) | Database (`approval_queue` lookup + optional undone marker) + MCP/stdio (the inverse tool call) | Re-invoking a tool must travel the same per-turn/scrubbed-env, allowlisted, honest-rejection path the gate/replay established — never the browser. |
| Summarize daily digest (D-10) | API / Backend (reuse `extractViaClaude` → Gemini fallback) | Browser (button + render) | One operator-invoked LLM call; reuse the existing one-shot Haiku/Gemini helpers, not a new agent run. |
| Surface, nav, routing, vocab (D-01/D-02/D-03) | Frontend Server / Browser (`web/`) | — | Pure view-layer: routes table, vocabulary, `App.tsx` route, `Activity.tsx`, Home entry point. |

## Standard Stack

No new packages. Everything is already present and verified in this worktree.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | 4.12.3 | `/api/activity*` + undo routes on the existing token-gated `app` | All dashboard routes already live here; new routes inherit the token gate + mutations kill-switch [VERIFIED: src/dashboard.ts] |
| better-sqlite3 | ^11.8.1 | Synchronous read join over `audit_log` + `approval_queue` | All persistence; single-connection synchronous reads [VERIFIED: src/db.ts, codebase/STACK.md] |
| Preact | 10.29.1 | `Activity.tsx` page + components | All dashboard pages are Preact [VERIFIED: codebase/STACK.md] |
| wouter-preact | 3.9.0 | `/activity` client route | Existing router in `web/src/App.tsx` [VERIFIED] |
| lucide-preact | 1.14.0 | Activity icon (the routes table already imports `Activity` from lucide-preact) | Icon set in use [VERIFIED: web/src/lib/routes.ts:3] |
| @anthropic-ai/claude-agent-sdk | ^0.2.34 | (Summarize) via the existing `extractViaClaude` Haiku helper | Already the one-shot LLM path for chat-task classification [VERIFIED: src/memory-ingest.ts:39] |
| @google/genai | ^1.44.0 | (Summarize) Gemini `gemini-2.5-flash` fallback | Existing `generateContent()` fallback pattern [VERIFIED: src/gemini.ts:22] |

### Supporting (reusable UI primitives — verified present)
| Component | Path | Purpose |
|-----------|------|---------|
| `Pill` + `StatusDot` | `web/src/components/Pill.tsx` | Tag rendering. Existing tones include `done`(green), `neutral`, and a `queued`/`accent` set — map: You approved→`done`, Ran on its own→`neutral`, Needs you→`accent`/amber (add an `amber`/`held` tone if needed). |
| `ConfirmModal` | `web/src/components/ConfirmModal.tsx` | Destructive Undo confirmation. |
| `PageHeader` (+ `Tab`) | `web/src/components/PageHeader.tsx` | Header "Activity" + "What your team did" subtitle + Summarize action slot (matches Audit.tsx usage). |
| `PageState` | `web/src/components/PageState.tsx` | Loading / error / empty states. |
| `formatRelativeTime` | `web/src/lib/format.ts:3` | Relative time. NOTE: spec wants clock time ("9:12am") + day grouping — a small new helper is needed (see Don't Hand-Roll / Code Examples). |
| `teammateColor(id)` | `web/src/lib/teammate.ts:8` | Per-teammate color dot (D-11). Research purple / Comms teal / Content coral / Ops amber, substring-matched, falls back to `--color-accent`. |
| `apiGet` / `apiPost` | `web/src/lib/api.ts:37,46` | Token-aware fetch helpers (token read from URL/SPA shell). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `/api/activity` endpoint | Extend `/api/audit` + `/api/approvals` client-side join | REJECTED for the planner's default. The two tables have different shapes; the tag derivation (D-06) and the curated join are non-trivial deterministic logic that belongs server-side as one source of truth. A client-side join would duplicate tag rules in TypeScript-on-the-browser and re-fetch both endpoints. A single `/api/activity` that returns pre-tagged, pre-described rows is cleaner and unit-testable. |
| New `src/undo-executor.ts` | Add an `undo` mode to `replay-executor.ts` | Keep them siblings, not merged. Replay runs the *forward* captured action; Undo runs a *computed inverse*. Conflating them risks an Undo accidentally re-running the forward action. A dedicated file isolates the inverse allowlist + honest rejection (same precedent the Phase 3 summary records for why replay-executor.ts was split out). |
| LLM per-row description | Deterministic `describeAction()` map (D-04) | LOCKED by D-04/D-05 — no per-row LLM. Cheaper, deterministic, testable. |

**Installation:** None. `npm install` adds nothing this phase.

## Package Legitimacy Audit

> Not applicable — this phase installs **no external packages**. All dependencies (Hono, better-sqlite3, Preact, wouter-preact, lucide-preact, claude-agent-sdk, @google/genai) are already in `package.json` and verified present by reading the worktree source. No registry lookups or slopcheck run required.

## Architecture Patterns

### System Architecture Diagram

```
                    Phase 3 WRITES (unchanged)                         Phase 4 READS + 1 WRITE
                    ─────────────────────────                          ───────────────────────

  agent tool call ──► gate.makeCanUseTool(ctx)
                         │
            allow ───────┤── audit() ──────────────► audit_log
                         │   detail={tool,tier,            │  (action='permission',
                         │           mode,outcome}         │   detail JSON, blocked, agent_id, created_at)
            ask(bg) ─────┤── enqueue() ─────────────► approval_queue ◄── operator approve/deny
                         │                                 │  (tool_name, tool_input JSON, tier,
                         │                                 │   status, result, run_id, routine_id)
                         └── (Phase 3 boundary) ───────────┴───────────┐
                                                                        │
                                                          GET /api/activity  (NEW, src/dashboard.ts)
                                                                        │
                                                          buildActivityFeed()  (NEW query helper)
                                                            • UNION/curated join both tables
                                                            • derive tag per D-06
                                                            • describeAction() phrase map per D-04/D-05
                                                            • join agent_id → roster (name; color client-side)
                                                                        │
                                                          ┌─────────────┴───────────────┐
                                                          ▼                              ▼
                                                  Activity.tsx (NEW /activity)   POST /api/activity/:id/undo (NEW)
                                                    • day-grouped feed                  │
                                                    • teammate dot + phrase     src/undo-executor.ts (NEW)
                                                    • Pill tag                    • allowlist inverse families
                                                    • View / Review / Undo        • Tier 4 → no undo (D-09)
                                                    • filter chips (D-11)         • honest rejection (D-07)
                                                    • Summarize → POST            • real inverse or absent (D-09)
                                                          │                              │
                                                          ▼                       loadMcpServers()/fs
                                                  POST /api/activity/summarize    (per-turn scrubbed env path)
                                                    → extractViaClaude (Haiku)
                                                    → generateContent (Gemini fallback)

  Home.tsx ──(D-03 one-click)──► /activity
```

### Recommended Project Structure
```
src/
├── activity.ts            # NEW — buildActivityFeed() curated join + tag derivation + describeAction()
│                          #        (or fold the query into db.ts and the phrase map into gate.ts —
│                          #         see "describeAction placement" note below)
├── undo-executor.ts       # NEW — sibling of replay-executor.ts: inverse allowlist + honest rejection
├── dashboard.ts           # EDIT — add GET /api/activity, POST /api/activity/:id/undo, POST /api/activity/summarize
├── gate.ts                # EDIT (optional) — extend summarize() into describeAction() phrase map
└── db.ts                  # EDIT (optional) — add the curated-join query helper near getAuditLog (:3135)

web/src/
├── pages/Activity.tsx     # NEW — the operator surface (visually distinct from Audit.tsx)
├── pages/Home.tsx         # EDIT — D-03 one-click entry point (NeedsYouCard region ~:167)
├── lib/routes.ts          # EDIT — add /activity route, re-point nav.activity, fix /audit vocabKey (D-02)
├── lib/vocabulary.ts      # EDIT — add nav.audit term; nav.activity stays for /activity
├── App.tsx                # EDIT — add <Route path="/activity"><Activity/></Route> (:49-62)
└── lib/format.ts          # EDIT — add formatClockTime() + dayGroupKey() helpers
```

**describeAction placement:** D-04 says "extend the existing `summarize()` helper pattern in `src/gate.ts`." `summarize()` currently returns only `"${toolName} (Tier ${tier})"` and deliberately carries no params (L-4 secret hygiene at *write* time). The render-time phrase map is a *read*-time concern and may include params (the feed shows what happened). Recommendation: add a new pure exported function (e.g. `describeAction(toolName, toolInput)`) — either alongside `summarize()` in `gate.ts` or in a new `src/activity.ts` — and keep `summarize()` untouched so the gate's write-path secret hygiene is unchanged. Either satisfies D-04 ("extend the pattern"). Plan should state which.

### Pattern 1: Curated read-side tag derivation (D-06)
**What:** Derive the three tags from existing rows with no tag column.
**When to use:** In `buildActivityFeed()` server-side.
**Mapping (verified against the actual `detail`/`status` shapes):**
```
You approved  (green/done)   ← approval_queue.status = 'approved'
Needs you     (amber/held)   ← approval_queue.status = 'pending'
Ran on its own(neutral)      ← audit_log where action='permission'
                                AND JSON_EXTRACT(detail,'$.outcome') = 'allow'
                                (an allowed decision never queued)
Skipped/held  (honest state) ← approval_queue.status IN ('denied','expired')
                                "Skipped: waiting on your ok" / "Expired"
Approved inline(green)       ← audit_log outcome = 'approved-inline'
Declined inline(honest)      ← audit_log outcome = 'denied-inline'
Queued        (amber)        ← audit_log outcome = 'queued' (mirror of a pending queue row)
```
Source of truth for `outcome` values: `encodeDecision()` + `makeCanUseTool()` in `src/gate.ts` emit exactly `'allow' | 'approved-inline' | 'denied-inline' | 'queued'`. `approval_queue.status` is `'pending' | 'approved' | 'denied' | 'expired'` (`src/db.ts:363`, `src/approval-queue.ts:34`). [VERIFIED: src/gate.ts:169-265, src/approval-queue.ts]

**Curated join shape (recommendation):** The two tables are NOT 1:1 — a queued action produces both an `audit_log` `outcome='queued'` row AND an `approval_queue` `pending` row; a same-instance audit row exists for inline asks too. To avoid double-counting, recommend the feed be primarily an **`approval_queue`-driven** view for gated/approved/queued items, **unioned with** `audit_log` `action='permission'` rows whose `outcome='allow'` (the "Ran on its own" items that never queued). Concretely:
```sql
-- "Ran on its own": allowed permission decisions (silent auto-runs)
SELECT 'audit' AS src, id, agent_id, created_at,
       json_extract(detail,'$.tool')  AS tool_name,
       json_extract(detail,'$.tier')  AS tier,
       json_extract(detail,'$.outcome') AS outcome,
       NULL AS tool_input, NULL AS status, NULL AS result, NULL AS run_id, NULL AS routine_id
  FROM audit_log
 WHERE action = 'permission'
   AND json_extract(detail,'$.outcome') = 'allow'

UNION ALL

-- gated items (Needs you / You approved / Skipped) — carry full input for Undo/View
SELECT 'queue' AS src, id, agent_id, created_at,
       tool_name, tier, status AS outcome,
       tool_input, status, result, run_id, routine_id
  FROM approval_queue

ORDER BY created_at DESC, id DESC
LIMIT ? OFFSET ?;
```
SQLite `json_extract` is available (better-sqlite3 bundles a current SQLite with JSON1). [VERIFIED: detail is JSON via encodeDecision; CITED: better-sqlite3 bundles JSON1] Per-teammate filter = add `AND agent_id = ?`. "Ran on its own" filter = the `audit`/`allow` branch only; "Needs you" filter = `status='pending'`.

### Pattern 2: Undo inverse executor (D-07/D-08/D-09) — sibling of replay-executor.ts
**What:** A new `src/undo-executor.ts` that takes a stored `{tool_name, tool_input, tier}` and runs the **computed inverse**, returning the same honest `{ok, message}` shape as `replayApproval()`.
**Key structural facts inherited from `src/replay-executor.ts` (read closely):**
- The executor dispatches purely on tool name; anything not on the allowlist returns an honest `ok:false` string ("not a replayable action"). Undo mirrors this: not-on-the-inverse-allowlist → honest "no undo available." [VERIFIED: src/replay-executor.ts:60-75]
- It has **native, MCP-free executors** for `Write` (`fs.writeFile`) and `Bash` (`spawn('/bin/sh',['-c',command])`), and an `mcp__server__tool` path that spawns the operator's configured stdio MCP server and does a JSON-RPC `initialize`→`tools/call`. [VERIFIED: src/replay-executor.ts:78-212]
- The MCP path resolves servers via `loadMcpServers()`; if the server isn't configured it fails honestly ("the X tool isn't connected"). [VERIFIED: replay-executor.ts:133-140, agent.ts:34]
- It never reads env/secrets from the queue row; MCP servers get their own configured env (L-4). [VERIFIED: replay-executor.ts comment + :146-149]

**Concrete inverse mapping per target family (D-08):**

| Family | Forward (what was captured) | Inverse operation | Underlying call in THIS codebase | Cleanliness |
|--------|------------------------------|-------------------|----------------------------------|-------------|
| **drafts** | A draft created (often a `Write` of a draft file, or an MCP `gmail` create-draft) | Delete the created draft | If the forward was `Write {file_path}` → `fs.unlink(file_path)` (native, no MCP). If MCP `mcp__gmail__*_draft` → `mcp__gmail__delete_draft` with the captured/returned draft id. | **CLEANEST. Recommended phase-floor winner** when the draft was a native `Write` — fully self-contained, no MCP dependency, testable with a temp file. [VERIFIED native path exists; ASSUMED gmail tool names] |
| **labels** | A label applied (MCP `mcp__gmail__*label*` / `add_label`) | Remove the applied label | `mcp__gmail__remove_label` / `modify_labels(removeLabelIds:[...])` with the captured message id + label id | Clean IF a Gmail MCP is connected. Inverse is symmetric and idempotent-ish (removing an absent label is harmless). [ASSUMED: gmail MCP tool names — no MCP configured in this env] |
| **meetings** | A calendar event created (MCP `mcp__*calendar*__create*`) | Cancel/decline/delete the created event | `mcp__*calendar*__delete_event` / `cancel_event` with the captured event id | Hardest: requires the created event's **id**, which the captured `tool_input` (the create *request*) does NOT contain — the id is in the create *response*, which Phase 3 did not persist. Likely ships as honest "no undo" this phase. [VERIFIED gap: approval_queue stores tool_input only, not the tool result id] |

**Phase-floor recommendation:** make **draft-delete via the native `Write`→`fs.unlink` inverse** the guaranteed end-to-end family. It needs no MCP server (which this environment lacks), it has a captured `file_path` in `tool_input`, and it's trivially unit-testable. Labels ships next-best *if* a Gmail MCP is connected. Meetings ships as honest "no undo" (logged deferred) because the event id isn't captured.

**Tier read for the Tier-4 lock (D-09):** For a queue-sourced row, `tier` is a real column (`approval_queue.tier`, `src/db.ts:360`). For an audit-sourced ("Ran on its own") row, tier is `json_extract(detail,'$.tier')`. The undo endpoint must read tier from the stored record and refuse undo when `tier === 4` BEFORE consulting the family allowlist (mirror the gate's "Tier 4 lock precedes everything" ordering in `resolveOutcome`). [VERIFIED: src/gate.ts:124]

### Pattern 3: Undo "real inverse or absent" — no mark-as-undone theater (D-09)
**What:** The UI shows an Undo affordance ONLY when the server says the row is undoable. The server computes undoability from (tier !== 4) AND (family on the inverse allowlist) AND (the inverse has everything it needs, e.g. a captured `file_path` / id). The feed row payload should carry a boolean `undoable` so the UI never renders a button that would no-op. On undo success, store an honest result (and optionally a lightweight "undone" marker — see migration note) so the row reflects reality.
**Verified honesty precedent:** `replayApproval` never throws and always returns a verbatim honest message; the dashboard surfaces it directly (`{ok, replayed, result}`). Undo follows the same contract. [VERIFIED: src/replay-executor.ts:60-75, src/dashboard.ts:3514-3535]

### Pattern 4: Summarize daily digest (D-10) — reuse the one-shot LLM helpers
**What:** An operator-invoked `POST /api/activity/summarize?day=YYYY-MM-DD` that gathers that day's feed rows (already-described phrases), builds a prompt, and calls the **existing** one-shot helpers — NOT a new agent run.
**Existing plumbing (verified):**
- Primary: `extractViaClaude(prompt, timeoutMs=15000)` → Claude Haiku `claude-haiku-4-5-20251001` via the same OAuth the agents use, returns raw string. [VERIFIED: src/memory-ingest.ts:39,62]
- Fallback: `generateContent(prompt, model='gemini-2.5-flash')` from `src/gemini.ts:22`; `parseJsonResponse<T>` for structured output. [VERIFIED]
- Precedent for exactly this pattern (Haiku-primary, Gemini-fallback, free local pre-filter): `src/chat-task-tracker.ts classifyChatTask()`. Copy its shape. [VERIFIED]
**Model/prompt shape recommendation:** Feed the day's plain-language phrases (already produced by `describeAction`) — never raw tool_input — to keep it cheap and avoid leaking params. Ask for a 3-5 sentence operator-readable digest. Use Haiku (cheap, fast, OAuth) with the Gemini fallback. Gate behind the mutations kill-switch only if it's a POST; a GET is fine since it's read-only LLM work (but it does cost a token, so a POST is more honest about the side effect).

### Anti-Patterns to Avoid
- **Re-implementing tag rules in the browser.** Tag derivation (D-06) must be one server-side source of truth, returned pre-computed.
- **Inheriting Audit.tsx's dense/monospace styling.** Spec 08 + D-01 require Activity to look *unlike* the technical Audit page. `Audit.tsx` uses tabular-nums entry counts, agent-filter chips, dense rows — Activity must be airy, plain-language, day-grouped.
- **A per-row LLM call.** Forbidden by D-04. Only the header Summarize action calls an LLM.
- **A mark-as-undone-without-inverse button (D-09).** If there is no real inverse, there is no Undo button.
- **Merging undo into replay-executor.ts.** Keep them siblings (forward vs inverse).
- **Touching the gate write path.** Out of scope; Activity is read-only over what Phase 3 writes (plus the Undo write).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token auth on new routes | A new auth check | Mount on the existing `app` in `src/dashboard.ts` | All `/api/*` routes inherit the token gate + the `DASHBOARD_MUTATIONS_ENABLED` kill-switch middleware [VERIFIED: dashboard.ts:349-396] |
| Replay/inverse tool invocation | A new tool dispatcher | Mirror `src/replay-executor.ts` (allowlist + honest rejection + JSON-RPC MCP path) | The secure, no-eval, scrubbed-env pattern already exists and is threat-modeled (T-03-replay-exec) |
| MCP server resolution | Re-reading settings.json | `loadMcpServers()` from `src/agent.ts:34` | Already merges user + project settings; the executor must use it (and inherits the "not connected" honest failure) |
| Per-teammate color | A new palette | `teammateColor(id)` from `web/src/lib/teammate.ts:8` | One source of truth (Research purple / Comms teal / Content coral / Ops amber) |
| Teammate name/roster | A new roster fetch | `listAllAgents()` (`src/agent-config.ts:419`) server-side, or the existing roster API the Team page uses | Avoids a parallel roster source |
| One-shot LLM call (Summarize) | A new agent `query()` run | `extractViaClaude()` (Haiku) → `generateContent()` (Gemini) fallback | The established cheap one-shot pattern (chat-task-tracker.ts) |
| Status tags | New tag chips | `Pill` + `StatusDot` (`web/src/components/Pill.tsx`) | Tone tokens already cover green/neutral; add an amber tone if missing |
| Destructive confirm | A custom modal | `ConfirmModal` (`web/src/components/ConfirmModal.tsx`) | Already used for Tier 4 deny in Phase 3 |
| Loading/error/empty | Custom states | `PageState` (`web/src/components/PageState.tsx`) | Used by every page incl. Audit.tsx |

**Key insight:** Almost nothing here is genuinely new. The single new *capability* is the inverse executor, and even that is a structural clone of an existing, threat-modeled module. The temptation is to over-build (a general reversible-action framework) — D-07 explicitly forbids that; ship a bounded allowlist.

## Runtime State Inventory

> This is NOT a rename/refactor/migration phase. It is additive (new route, new endpoints, new files). Included briefly for completeness because Undo writes.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | The feed reads existing `audit_log` + `approval_queue` rows — no migration of existing data needed for the read. Undo may want a lightweight "undone" marker. | If an undone marker is desired: a versioned migration (`migrations/v1.2.4/`) + dual-write in `db.ts createSchema` adding an `undone_at INTEGER` column (or store it in `result`). **Skipping the versioned-migration dual-write crash-loops the live service** (Phase 3 P-4/L-6 precedent). Prefer read-side derivation if feasible; if not, follow the migration pattern in `migrations/v1.2.3/create-approval-queue.ts`. |
| Live service config | None — no external service config carries Activity state. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None new. The undo executor must NOT read secrets from the queue row (L-4); MCP servers get their own configured env via `loadMcpServers()`. | None — reuse the scrubbed pattern. |
| Build artifacts | New `Activity.tsx` is bundled by Vite into `dist/web/` on `npm run build`; new server files compile via `tsc` to `dist/`. | Standard `npm run build`. No stale-artifact risk. |

**Note (deploy):** Per project memory, the live service runs from the main checkout and worktrees lack `.env`/`store`. If an undo migration is added, the operator must run `npm run migrate` from the main checkout before the next restart (else `checkPendingMigrations` crash-loops).

## Common Pitfalls

### Pitfall 1: Double-counting queued actions in the feed
**What goes wrong:** A background-gated action writes BOTH an `audit_log` `outcome='queued'` row AND an `approval_queue` `pending` row. A naive `UNION` of "all audit permission rows" + "all queue rows" shows the same action twice.
**Why it happens:** The two tables overlap by design (audit = decision log, queue = actionable item).
**How to avoid:** Drive the gated/approved/queued items from `approval_queue` only, and from `audit_log` take ONLY `outcome='allow'` (the silent auto-runs that never queued). See the SQL in Pattern 1.
**Warning signs:** A "Needs you" item also appearing as a neutral "Ran on its own" row.

### Pitfall 2: Meetings undo has no captured event id
**What goes wrong:** You map "meetings" to a calendar delete, but the stored `tool_input` is the *create request* (title, time, attendees) — not the created event's id, which only exists in the tool *response* Phase 3 didn't persist.
**Why it happens:** `approval_queue.tool_input` stores model-supplied params only (D-08/L-4), not the tool result.
**How to avoid:** Treat meetings as honest "no undo" this phase (D-08 escape hatch) unless a clean id-free inverse exists; log it deferred. Pick draft-delete (which has `file_path` in the input) as the guaranteed family.
**Warning signs:** An undo handler trying to read `event_id` that isn't in `tool_input`.

### Pitfall 3: MCP-dependent inverse fails because no MCP server is connected
**What goes wrong:** Labels/meetings inverses call `mcp__gmail__*` / `mcp__*calendar*__*`, but `loadMcpServers()` returns empty in this environment, so the executor honestly returns "the gmail tool isn't connected" — and a naive UI showed an Undo button anyway.
**Why it happens:** MCP servers are operator-configured in `~/.claude/settings.json` / project `.claude/settings.json`; this worktree has none. [VERIFIED: both resolve empty]
**How to avoid:** Compute `undoable` server-side and only show the button when the inverse can actually run. Make the phase-floor family (draft-delete) MCP-free. For MCP families, the honest fallback is "no undo (gmail not connected)."
**Warning signs:** Undo button visible but every click returns "isn't connected."

### Pitfall 4: The vocab/route collision (D-02) left half-done
**What goes wrong:** Re-pointing `nav.activity` to `/activity` but leaving `/audit` also claiming `nav.activity` (or `Audit.tsx` rendering `term('page.activity')`) makes two nav items both say "Activity."
**Why it happens:** Today `/audit` literally has `vocabKey: 'nav.activity'` (`routes.ts:37`) and `Audit.tsx` titles itself `term('page.activity')`.
**How to avoid:** In one change: add the `/activity` route with `vocabKey: 'nav.activity'`, change `/audit` to a new `vocabKey: 'nav.audit'` (add the term to `vocabulary.ts`, e.g. `{operator:'Audit log', builder:'Audit'}`), and update `Audit.tsx`'s `PageHeader title` to the new term/key. Per spec 08, Audit is "not in the operator's main nav" (lives under Settings/admin) — consider whether `/audit` should even remain a top-level sidebar item or move under Settings. (Demotion of its *placement* can be left minimal this phase; the vocab fix is the locked part.)
**Warning signs:** Two "Activity" entries in the sidebar; `grep nav.activity routes.ts` returns two hits.

### Pitfall 5: Undo replays the forward action instead of the inverse
**What goes wrong:** Copying `replay-executor.ts` too literally makes Undo re-run the captured tool (sending the email again) instead of its inverse.
**How to avoid:** The undo executor's dispatch must map family→*inverse* (Write→`fs.unlink`, gmail add-label→remove-label), never call the stored tool name directly. Unit-test that undoing a draft *deletes* and does not *write*.

## Code Examples

### Clock-time + day-group helpers (new in web/src/lib/format.ts)
```typescript
// Source: pattern extends existing web/src/lib/format.ts formatRelativeTime (verified present)
// Spec 08 wants "9:12am" + day grouping ("Today" / "Yesterday" / date).
export function formatClockTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
          .toLowerCase().replace(' ', '');
}
export function dayGroupKey(unixSeconds: number): string {
  // local-day boundary; planner decides tz — local is the operator's machine (local-first)
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
```

### Tag derivation (server-side, pure)
```typescript
// Source: derived from verified gate.ts outcomes + approval_queue statuses
type ActivityTag =
  | { kind: 'approved'; label: 'You approved' }      // green
  | { kind: 'autonomous'; label: 'Ran on its own' }  // neutral
  | { kind: 'needs'; label: 'Needs you' }            // amber
  | { kind: 'skipped'; label: string };              // honest held/expired/declined

function deriveTag(row: {
  src: 'audit' | 'queue';
  outcome: string;        // audit: allow|approved-inline|denied-inline|queued ; queue: status
}): ActivityTag {
  if (row.src === 'queue') {
    switch (row.outcome) {
      case 'approved': return { kind: 'approved', label: 'You approved' };
      case 'pending':  return { kind: 'needs', label: 'Needs you' };
      case 'denied':   return { kind: 'skipped', label: 'Skipped: you declined' };
      case 'expired':  return { kind: 'skipped', label: 'Skipped: expired' };
    }
  }
  // src === 'audit'
  switch (row.outcome) {
    case 'allow':           return { kind: 'autonomous', label: 'Ran on its own' };
    case 'approved-inline': return { kind: 'approved', label: 'You approved' };
    case 'denied-inline':   return { kind: 'skipped', label: 'Skipped: you declined' };
    case 'queued':          return { kind: 'needs', label: 'Needs you' };
  }
  return { kind: 'skipped', label: 'Skipped: waiting on your ok' };
}
```

### describeAction phrase map (D-04/D-05) — deterministic, no LLM
```typescript
// Source: extends the gate.ts summarize() pattern (verified). Read-time; may use params.
export function describeAction(toolName: string, input: Record<string, unknown> = {}): string {
  // Mapped families → plain phrase. Add entries as the tool enumeration grows.
  if (/draft/i.test(toolName)) return 'Drafted a message';
  if (/^mcp__gmail__send/i.test(toolName) || /send.*mail/i.test(toolName)) return 'Sent an email';
  if (/label/i.test(toolName)) return 'Applied a label';
  if (/calendar.*(create|book)/i.test(toolName)) return 'Booked a meeting';
  if (/^mcp__slack__/i.test(toolName)) return 'Posted to Slack';
  if (toolName === 'Write' && typeof input.file_path === 'string')
    return `Saved ${String(input.file_path).split('/').pop()}`;
  // D-05 honest generic fallback — never fabricate, never hide.
  if (toolName.startsWith('mcp__')) {
    const server = toolName.split('__')[1];
    return `Used ${server.charAt(0).toUpperCase() + server.slice(1)}`;
  }
  return `Ran ${toolName}`;
}
```

### Undo executor skeleton (sibling of replay-executor.ts)
```typescript
// Source: structural mirror of src/replay-executor.ts (verified). Inverse, not forward.
import fs from 'fs';
export interface UndoResult { ok: boolean; message: string }

export async function undoAction(
  toolName: string,
  toolInput: Record<string, unknown>,
  tier: number,
): Promise<UndoResult> {
  if (tier === 4)  // D-09 lock precedes the allowlist
    return { ok: false, message: 'This action can\'t be undone.' };
  try {
    // drafts (native, MCP-free) — the guaranteed phase-floor family
    if (toolName === 'Write' && typeof toolInput.file_path === 'string') {
      await fs.promises.unlink(toolInput.file_path as string);
      return { ok: true, message: `Deleted the draft (${(toolInput.file_path as string).split('/').pop()}).` };
    }
    // labels (needs a connected Gmail MCP — honest fallback otherwise) [ASSUMED tool names]
    // if (/add.?label/i.test(toolName)) return invokeMcpInverse('remove_label', ...);
    return { ok: false, message: 'No undo available for this action.' };
  } catch (err) {
    return { ok: false, message: `Couldn't undo — ${err instanceof Error ? err.message : String(err)}` };
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `/audit` route doubling as "Activity" (`vocabKey: nav.activity`) | A dedicated `/activity` operator surface; `/audit` demoted to a technical label | This phase (D-01/D-02) | Resolves the collision; two deliberately different surfaces |
| Forward-only replay (Phase 3) | Forward replay (Phase 3) + computed inverse (Phase 4 Undo) | This phase | First inverse-execution capability |

**Deprecated/outdated:** Nothing. All referenced modules are current as of the Phase 3 completion (2026-06-24).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Concrete Gmail MCP tool names for label add/remove and draft create/delete (`mcp__gmail__remove_label`, `delete_draft`, etc.) | Undo Pattern 2 / labels & drafts | LOW for the phase floor (the floor uses the native Write→unlink path, no MCP). For MCP families the exact tool names must be confirmed against the operator's actual connected Gmail MCP at implementation time; until then they ship as honest "no undo." No MCP server is configured in this environment to verify against. |
| A2 | Calendar create tools do not persist the created event id into `approval_queue.tool_input` | Pitfall 2 | LOW — verified that `tool_input` stores only model-supplied params, not tool results; the id genuinely isn't there. Meetings inverse is therefore correctly scoped as deferred/honest-no-undo. |
| A3 | A draft "created" by the team is typically a `Write` of a draft file (giving a native, MCP-free inverse) | Undo phase-floor recommendation | MEDIUM — if in practice drafts are always created via an MCP (e.g. Gmail draft) and never a `Write`, the MCP-free floor evaporates and the floor must instead be the labels family (requiring a connected Gmail MCP). Planner should confirm how drafts are actually produced in this product, or pick whichever family has a verifiable MCP-free or connected-MCP inverse. |
| A4 | `gemini-2.5-flash` / `claude-haiku-4-5-20251001` remain the configured one-shot models | Summarize | LOW — read directly from current source; reuse as-is. |

## Open Questions

1. **Which Undo family is guaranteed end-to-end?**
   - What we know: draft-delete via native `Write`→`fs.unlink` is MCP-free and has `file_path` in `tool_input`; labels needs a connected Gmail MCP; meetings lacks a captured event id.
   - What's unclear: whether this product actually creates drafts as `Write` files or via an MCP (A3).
   - Recommendation: planner confirms how drafts are created; if MCP-only, fall back to labels as the floor and require/verify a connected Gmail MCP, else ship one MCP-free family. Keep meetings as honest "no undo," logged deferred.

2. **Does Audit (`/audit`) stay a top-level sidebar item or move under Settings?**
   - What we know: spec 08 says Audit is "not in the operator's main nav … lives under Settings > Security/admin."
   - What's unclear: whether moving it is in scope this phase or deferred to Phase 5 (which formalizes Audit).
   - Recommendation: do the locked vocab fix (D-02) now; treat the *placement* move as Phase 5's job unless trivial. State the choice in the plan.

3. **Persist an "undone" marker, or derive read-side?**
   - What we know: a migration is possible (v1.2.4 pattern) but adds a dual-write + `npm run migrate` step.
   - Recommendation: prefer storing the undo outcome in the existing `approval_queue.result` (no schema change) and/or an `audit_log` row for the undo action; only add a column if the feed must visibly mark a row "Undone" and that can't be derived. Keep schema changes off the table if avoidable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Hono / better-sqlite3 / Preact (existing stack) | Feed read, routes, page | ✓ | 4.12.3 / ^11.8.1 / 10.29.1 | — |
| Claude Agent SDK (Haiku one-shot) | Summarize | ✓ | ^0.2.34 | Gemini |
| @google/genai (Gemini) | Summarize fallback | ✓ | ^1.44.0 | — |
| Configured Gmail MCP server | Labels/drafts MCP inverse (D-08) | ✗ | — | Native `Write`→unlink draft inverse; else honest "no undo (not connected)" |
| Configured Calendar MCP server | Meetings inverse (D-08) | ✗ | — | Honest "no undo" (also blocked by missing event id, A2) |

**Missing dependencies with no fallback:** None that block the phase floor.
**Missing dependencies with fallback:** Gmail/Calendar MCP servers are not configured in this environment — MCP-backed inverses degrade to honest "no undo." The phase floor (draft-delete native path) is unaffected. This is the intended D-08 behavior.

## Validation Architecture

> nyquist_validation = true (config.json). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.x [VERIFIED: codebase/TESTING.md, package.json] |
| Config file | `vitest.config.ts` (root) + inline `"vitest"` in package.json; glob `src/**/*.test.ts` |
| Quick run command | `npx vitest run src/undo-executor.test.ts -x` (and `src/activity.test.ts`) |
| Full suite command | `npm test` (`vitest run`) then `npm run build` (web + tsc) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRUST-01 | Feed join doesn't double-count a queued action (audit `queued` + queue `pending`) | unit | `npx vitest run src/activity.test.ts -t "no double-count"` | ❌ Wave 0 |
| TRUST-01 | Tag derivation: each (src,outcome) → correct tag incl. honest skipped/expired | unit | `npx vitest run src/activity.test.ts -t "deriveTag"` | ❌ Wave 0 |
| TRUST-01 | `describeAction`: mapped tools → phrase; unmapped → honest "Ran <tool>"/"Used X", never empty/fabricated | unit | `npx vitest run src/activity.test.ts -t "describeAction"` | ❌ Wave 0 |
| TRUST-01 | `GET /api/activity` shape + token gate + per-teammate/agent filter | contract | `npx vitest run src/dashboard.contract.test.ts -t "activity"` | ❌ Wave 0 (extend existing file) |
| TRUST-02 | Undo of a `Write` draft deletes the file (does NOT re-write it) | unit | `npx vitest run src/undo-executor.test.ts -t "draft delete"` | ❌ Wave 0 |
| TRUST-02 | Tier 4 → undo refused before allowlist (D-09) | unit | `npx vitest run src/undo-executor.test.ts -t "tier 4"` | ❌ Wave 0 |
| TRUST-02 | Non-allowlisted / MCP-not-connected → honest message, no no-op theater | unit | `npx vitest run src/undo-executor.test.ts -t "honest"` | ❌ Wave 0 |
| TRUST-02 | `POST /api/activity/:id/undo` shape + mutations kill-switch + `undoable` flag | contract | `npx vitest run src/dashboard.contract.test.ts -t "undo"` | ❌ Wave 0 (extend existing) |
| D-10 | Summarize endpoint returns a digest; LLM helper is mocked (no real call) | contract/unit | `npx vitest run src/dashboard.contract.test.ts -t "summarize"` | ❌ Wave 0 (mock `extractViaClaude`) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/undo-executor.test.ts src/activity.test.ts -x`
- **Per wave merge:** `npm test` (full vitest) + `npx tsc --noEmit`
- **Phase gate:** `npm test` green + `npm run build` succeeds before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/undo-executor.test.ts` — covers TRUST-02 (draft delete, tier-4 refusal, honest rejection, no-MCP path). Use `os.tmpdir()`+`mkdtempSync` fixtures per TESTING.md.
- [ ] `src/activity.test.ts` — covers TRUST-01 (no double-count, deriveTag, describeAction). Use `_initTestDatabase()` for the join query.
- [ ] Extend `src/dashboard.contract.test.ts` — `/api/activity`, `/api/activity/:id/undo`, `/api/activity/summarize` shapes + token/kill-switch (mock `extractViaClaude`/`generateContent`).
- [ ] Manual-only (checkpoint:human-verify): a real draft-undo against a live draft, and (if a Gmail MCP is connected) a real label-undo — the automated suite mocks I/O.

## Security Domain

> security_enforcement = true. Section included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | The existing dashboard token gate on `/api/*` (`requireToken` / global token middleware, dashboard.ts:349-365). New routes inherit it. |
| V3 Session Management | no | No new sessions; token-in-URL boundary unchanged. |
| V4 Access Control | yes | Mutations (undo, summarize POST) inherit `DASHBOARD_MUTATIONS_ENABLED` kill-switch middleware (dashboard.ts:367-394). |
| V5 Input Validation | yes | Validate the activity `:id` is an integer (mirror approvals route, dashboard.ts:3515). `tool_input` is JSON.parsed defensively, never eval'd (approval-queue.ts:122). |
| V6 Cryptography | no | No new crypto; `audit_log` reads go through the existing layer (no encrypted columns in audit_log per Phase 3). |
| V8 Data Protection / Secret hygiene | yes | The feed and Summarize must surface plain-language phrases, never raw `tool_input` secrets to the LLM or UI by default (carry detail behind View). Undo executor never reads env/secrets from the row; MCP env comes from `loadMcpServers()` (L-4). |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Undo re-runs the forward action (e.g. re-sends an email) | Tampering / Elevation | Inverse-only dispatch; unit test that draft-undo deletes (never writes); Tier 4 lock refuses undo before the allowlist (D-09). |
| Undo "no-op theater" (button claims success without a real inverse) | Repudiation | `undoable` computed server-side; real inverse or absent (D-09); honest `{ok,message}` surfaced verbatim. |
| Command/JSON injection via stored `tool_input` | Tampering | Defensive `JSON.parse`, no eval, no shell interpolation beyond the already-gated literal (inherited from replay-executor P-3). |
| Secret leakage to the Summarize LLM | Information Disclosure | Feed only plain-language phrases (describeAction output) to the LLM, never raw params/env. |
| Unauthorized undo/summarize via missing auth | Spoofing / Elevation | New routes mount on the token-gated `app`; mutations also behind the kill-switch. |
| MCP inverse against an unconfigured server | Denial / honesty | `loadMcpServers()` returns empty → honest "not connected"; `undoable=false` so no button shown. |

## Sources

### Primary (HIGH confidence — read directly in this worktree)
- `src/replay-executor.ts` — allowlist + honest-rejection + native Write/Bash + JSON-RPC MCP path (Undo template)
- `src/gate.ts` — `summarize()`, `encodeDecision()` (`{tool,tier,mode,outcome}`), outcome values, Tier-4 lock ordering
- `src/db.ts` — `audit_log` (:332), `approval_queue` (:352), `getAuditLog` (:3135), JSON detail write
- `src/approval-queue.ts` — `ApprovalRow`, statuses, `listPending/approve/deny/expireOlderThan`, defensive parse
- `src/security.ts` — `AuditAction` ('permission'), `audit()` pipeline, scrubbed-env model
- `src/dashboard.ts` — `/api/approvals*` + `/api/audit*` routes, token gate (:349-365), mutations kill-switch (:367-394), `approvalView`
- `src/agent.ts` — `loadMcpServers()` (:34, operator-configured, empty here)
- `src/memory-ingest.ts` (:39,62) + `src/gemini.ts` (:22) + `src/chat-task-tracker.ts` — one-shot LLM plumbing (Summarize)
- `src/agent-config.ts` (:419) — `listAllAgents()` roster
- `web/src/lib/routes.ts` (:37 collision), `vocabulary.ts` (:56), `App.tsx` (:49-62), `teammate.ts` (:8), `format.ts`, `api.ts`, `Pill.tsx`, `Audit.tsx`, `Home.tsx`
- `specs/operator-product/08-activity-audit.md` — THE design contract
- `.planning/phases/03-*/03-CONTEXT.md`, `03-04-SUMMARY.md` — data contract + shipped slice
- `.planning/codebase/STACK.md`, `TESTING.md` — stack + test conventions
- `migrations/v1.2.3/create-approval-queue.ts` — migration dual-write pattern

### Secondary (MEDIUM)
- better-sqlite3 JSON1 (`json_extract`) availability — bundled in current SQLite [CITED: better-sqlite3 ships a recent SQLite with JSON1 enabled]

### Tertiary (LOW / ASSUMED — flagged)
- Concrete Gmail/Calendar MCP tool names (A1) — no MCP server configured to verify; phase floor avoids dependence on them.

## Metadata

**Confidence breakdown:**
- Curated read / tags / phrase map: HIGH — exact `detail`/`status` shapes read from source.
- Undo executor structure: HIGH — direct clone of a verified module; inverse mapping per-family characterized.
- Undo MCP family tool names: LOW (A1) — unverifiable here; floor designed to not depend on them.
- Summarize plumbing: HIGH — exact helpers + models read from source.
- UI/nav/vocab: HIGH — collision and components verified.

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (stable internal codebase; re-confirm MCP tool names against the operator's connected servers at implementation time)
