# Phase 2: Routines - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** MVP (vertical slices)

<domain>
## Phase Boundary

Deliver the **Routines** surface: the operator stands up multi-step work that runs on its own by
describing it in plain language, then reviews, controls, and trusts its run history. Concretely:

- Create a routine by describing it in plain language; the assistant proposes a schedule and an
  ordered list of steps, each assigned to a named teammate (RTN-01).
- Routines run on a plain-language schedule with **no cron syntax shown anywhere in the operator UI**
  (RTN-02). Cron is stored internally, generated from the description.
- Review and edit the ordered steps; each step = an action + a teammate assignment (RTN-03).
- Turn a routine on/off (non-destructive pause) and run it now (RTN-04).
- Run history shows ok / degraded / failed honestly, and the operator is notified when a routine
  breaks or degrades (RTN-05).

Built on the **existing scheduler** (`src/scheduler.ts` 60s wake loop, `scheduled_tasks` table,
`src/schedule-cli.ts`). This is where the three internal surfaces (scheduled task / mission task /
workflow) collapse into one operator concept: "make it a routine."

**In scope:** routines list + detail UI, conversational draft-first builder embedded on the page,
plain-language → cron translation with an advanced raw-cron escape hatch, multi-step ordered execution
honoring per-step teammate, per-step continue/stop-on-error semantics, run history with ok/degraded/
failed outcomes + output view, on/off + run-now, the **at-creation autonomy selector stored on the
routine** (D7, choice captured this phase), and **state-change failure notifications** over the active
transport (D8).

**Out of scope this phase:**
- The full Permissions/autonomy **enforcement** tier model — Phase 3 (PERM-*). This phase captures and
  stores the per-routine autonomy choice; Phase 3 builds the gate that enforces it.
- The Activity/audit surface itself — Phase later (08). Routine runs should be *recordable* in a way
  Activity can later read, but building the Activity views is not this phase.
- Multi-channel notification config / digest batching beyond the single state-change alert.
</domain>

<decisions>
## Implementation Decisions

### Step execution & failure semantics
- **D-01:** Each step carries a **continue-on-error / stop-on-error flag**, set at creation (default
  to continue-on-error so partial value survives, but the operator can mark a step as a hard gate).
- **D-02:** Run outcome is **derived** from per-step results:
  - `ok` — every step succeeded.
  - `degraded` — at least one step failed but the run completed remaining steps (i.e., failures were
    all on continue-on-error steps and at least one step produced useful output). Spec example:
    "calendar not connected, sent partial."
  - `failed` — a **stop-on-error** step failed (halting the run), or no step produced useful output.
- **D-03:** Steps execute **in order, honoring the per-step teammate assignment** — each step runs as
  its assigned teammate. The mechanism (single chained session vs per-teammate invocation passing
  prior-step context forward) is Claude's discretion, but later steps MUST be able to see earlier
  steps' output. Planner/researcher decide the concrete execution model.

### Conversational builder
- **D-04:** The "New routine" builder is a **conversational panel embedded on the Routines page**
  (not a hand-off to the main Chat surface). The operator stays on the page.
- **D-05:** **Draft-first.** The assistant proposes the schedule (translated to cron under the hood)
  and the ordered step list; the operator reviews and edits the **plain step list** before it saves.
  Nothing is persisted until the operator confirms the draft.

### Schedule (plain-language, no cron in UI)
- **D-06:** The operator never sees or types cron in the standard UI. Plain-language description →
  cron is generated under the hood; the routine row/detail shows only the plain-language schedule
  ("Every weekday at 8:00am"). A **raw-cron escape hatch behind an advanced toggle** is allowed in the
  builder for power use, but is never the default surface. Editing the schedule uses plain-language
  re-description or a picker — never raw cron in the operator path.

### Per-routine autonomy (D7) — captured now, enforced in Phase 3
- **D-07:** Build the **at-creation autonomy selector** (what the routine may do unattended:
  draft / prepare / notify  vs  queue for approval: send / pay / commit) and **store the choice on the
  routine**. Make the choice **visible at creation**, not a buried default (routines run while the
  operator is asleep — this is when the autonomy question is sharpest).
- **D-08:** **Enforcement** of that choice (the per-action tool-call gate) is **Phase 3** scope. This
  phase stores the autonomy field and passes it into the execution context so Phase 3 can gate on it,
  but does not build the tier-enforcement engine. Avoids rework; keeps Phase 2 honest about its edge.

### Failure notifications (D8)
- **D-09:** Notify over the operator's **active transport** (Slack for this user; reuse the existing
  notify path — `scripts/notify.sh` / transport send), **silent on success**.
- **D-10:** **Alert on state change**, not every run: fire when a routine transitions `ok → degraded`
  or `ok → failed` (the first break / first degrade). Do **not** re-alert on every subsequent failing
  run of an already-broken routine — avoids the week-after-week nagging the spec warns against.
  Recovery (`failed/degraded → ok`) may optionally notify; treat as Claude's discretion.

### Claude's Discretion
- Concrete multi-step execution model (chained single session vs per-teammate sub-runs) and how
  earlier-step output is threaded to later steps.
- Data model details: how steps, per-step teammate, per-step error-flag, autonomy field, and run
  history attach to / extend `scheduled_tasks` (new columns vs companion tables) — respecting the
  existing single-prompt schema and migration patterns in `src/db.ts`.
- Plain-language → cron translation approach (LLM-driven vs a parsing library), and how the advanced
  raw-cron escape hatch is surfaced in the builder.
- Whether recovery-to-ok emits a notification.
- Routine row iconography and the exact "3 on, 1 off" count-line copy.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Operator-product design contract
- `specs/operator-product/06-routines.md` — THE design contract for this phase: two reframes
  (routines-not-cron, build-by-describing), list view, expanded detail, conversational builder,
  data/engine reuse, states (on/off, ok/degraded/failed), and open decisions D7 (per-routine autonomy)
  + D8 (failure notifications).
- `specs/operator-product/05-team.md` — Team roster; steps assign teammates (colored tag), and paused
  teammates block their steps. Routines ↔ Team connection.
- `specs/operator-product/01-foundations.md` — autonomy tiers by reversibility (D4 family, feeds D7),
  vocabulary, distribution. Read for the autonomy model the selector must align to.
- `specs/operator-product/07-permissions-settings.md` — Phase 3 surface that will *enforce* the
  per-routine autonomy choice this phase stores. Read to keep the stored autonomy shape forward-compatible.
- `specs/operator-product/08-activity-audit.md` — routine actions appear in Activity tagged "Ran on
  its own". Keep run records shaped so Activity can later read them.
- `specs/operator-product/README.md` — build sequence, vocabulary, the "ask it now vs make it a
  routine" two-ways-to-work framing.

### Existing engine to reuse (read for integration points)
- `src/scheduler.ts` — 60s wake loop, `getDueTasks`/`markTaskRunning` DB-lock anti-double-fire, mission
  worker. Routines are multi-step scheduled tasks running through this loop.
- `src/schedule-cli.ts` — current CRUD on `scheduled_tasks`; the routine model extends this surface.
- `src/db.ts` §`scheduled_tasks` (lines ~72-84) — current single-prompt schema (id, prompt, schedule,
  next_run, last_run, last_result, status, created_at) + migration helper patterns. The routine data
  model (steps, per-step teammate, error-flag, autonomy, run history) extends this.
- `src/agent-config.ts` — teammate/agent roster resolution (`listAgentIds`, roster) for step assignment.
- `src/orchestrator.ts` — `delegateToAgent` / per-agent runtime, for running a step as its teammate.
- `scripts/notify.sh` — active-transport notify path (Slack/Telegram) for D9/D10 failure alerts.
- `web/src/pages/Scheduled.tsx`, `web/src/pages/Team.tsx` — existing dashboard pages to align with /
  extend for the Routines surface; `web/src/lib/vocabulary.ts` (operator reframing) and
  `web/src/lib/routes.ts` (route registration).
- `src/dashboard.ts` — Hono `/api/*` route patterns + SSE; routines need CRUD + run-now + history APIs.
- `.planning/codebase/` — STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/scheduler.ts` + `scheduled_tasks` table + `src/schedule-cli.ts`: the routine engine. Routines
  are a multi-step generalization of an existing scheduled task — reuse the wake loop and the
  next_run/markTaskRunning locking; do not build a second scheduler.
- `scripts/notify.sh`: ready-made active-transport (Slack) notify for D8 alerts.
- `web/src/pages/Scheduled.tsx` + `Team.tsx`: existing Preact pages and patterns to model the Routines
  list/detail on; `vocabulary.ts` already carries operator reframing.
- `src/orchestrator.ts` `delegateToAgent` + `src/agent-config.ts` roster: run each step as its
  assigned teammate.

### Established Patterns
- Single `better-sqlite3` connection in `src/db.ts`, synchronous queries, `CREATE TABLE IF NOT EXISTS`
  + `PRAGMA table_info` ALTER-based migrations. Extend the routine model this way.
- DB-lock anti-double-fire in the scheduler (`markTaskRunning`) — multi-step runs must not break this;
  a routine run is one claimed unit even though it executes N steps.
- Dashboard: Hono `/api/*` REST + SSE (`src/dashboard.ts`); Preact SPA pages registered in
  `web/src/lib/routes.ts`.
- Agent runs route through `messageQueue` per-chat; scheduled runs use a fresh session. Per-step
  teammate execution should respect the existing no-bypass-of-messageQueue / scrubbed-env rules.

### Integration Points
- New routine data model extends / companions `scheduled_tasks` in `src/db.ts`.
- Scheduler `runAgent` call site becomes a multi-step runner that iterates steps honoring teammate +
  error-flag and records per-step + overall outcome.
- New `/api/routines*` routes in `src/dashboard.ts`; new `web/src/pages/Routines.tsx` + route entry.
- Notify path (`scripts/notify.sh` / transport send) invoked on ok→failed/degraded transition.
- Stored autonomy field is the seam Phase 3 (Permissions) will read to gate tool calls.

</code_context>

<specifics>
## Specific Ideas

- Routine row anatomy (from spec): icon + name, plain-language schedule, "N steps · ran today, 8:00am",
  on/off toggle as primary non-destructive control, expand for detail.
- Detail: When (plain-language + Change), Steps (ordered, action + teammate colored tag, add/reorder),
  Recent runs (ok/degraded/failed + timestamp + View output), Run now / Turn off.
- Builder seed prompt direction: "Help me build a new routine. Ask me what should happen and when,
  then turn it into steps I can review."
- Show failures honestly in history (e.g., "calendar not connected, sent partial") — degraded ≠ hidden.
- Off routines are visually dimmed.

</specifics>

<deferred>
## Deferred Ideas

- Full autonomy tier **enforcement** engine + Permissions/Settings surface — Phase 3 (PERM-*).
- The Activity & audit views ("Ran on its own" feed) — later phase (08); this phase only keeps run
  records shaped to be readable there.
- Notification preferences / digest batching / multi-channel routing beyond the single state-change
  alert — future.
- Routines scoping to Projects (cross-ref in spec) — note as a future tie-in unless trivially free.
- Recovery-to-ok "back to normal" notification — optional, Claude's discretion this phase.

</deferred>

---

*Phase: 02-routines*
*Context gathered: 2026-06-23*
