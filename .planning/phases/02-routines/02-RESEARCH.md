# Phase 2: Routines - Research

**Researched:** 2026-06-23
**Domain:** Multi-step scheduled execution on an existing SQLite-backed cron scheduler; Preact dashboard surface; LLM-assembled draft builder
**Confidence:** HIGH (all claims verified against the actual source files in this repo)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Each step carries a **continue-on-error / stop-on-error flag**, set at creation (default continue-on-error so partial value survives; operator can mark a step as a hard gate).
- **D-02:** Run outcome is **derived** from per-step results:
  - `ok` — every step succeeded.
  - `degraded` — at least one step failed but the run completed remaining steps (failures all on continue-on-error steps AND at least one step produced useful output). Spec example: "calendar not connected, sent partial."
  - `failed` — a **stop-on-error** step failed (halting the run), or no step produced useful output.
- **D-03:** Steps execute **in order, honoring per-step teammate assignment** — each step runs as its assigned teammate. Mechanism (single chained session vs per-teammate invocation passing prior-step context forward) is Claude's discretion, but later steps MUST see earlier steps' output.
- **D-04:** The "New routine" builder is a **conversational panel embedded on the Routines page** (not a hand-off to the main Chat surface).
- **D-05:** **Draft-first.** Assistant proposes schedule (→ cron under the hood) + ordered step list; operator reviews/edits the **plain step list** before save. Nothing persists until confirm.
- **D-06:** Operator never sees/types cron in the standard UI. Plain-language → cron generated under the hood; row/detail shows only plain-language. A **raw-cron escape hatch behind an advanced toggle** is allowed in the builder, never the default surface.
- **D-07:** Build the **at-creation autonomy selector** (unattended: draft/prepare/notify vs queue-for-approval: send/pay/commit) and **store the choice on the routine**. Visible at creation, not a buried default.
- **D-08:** **Enforcement** of that choice is **Phase 3** scope. This phase stores the autonomy field and passes it into the execution context; does not build the tier-enforcement engine.
- **D-09:** Notify over the operator's **active transport** (Slack for this user; reuse the existing notify path), **silent on success**.
- **D-10:** **Alert on state change**, not every run: fire when a routine transitions `ok → degraded` or `ok → failed`. Do NOT re-alert on subsequent failing runs of an already-broken routine. Recovery (`failed/degraded → ok`) notification is Claude's discretion.

### Claude's Discretion
- Concrete multi-step execution model (chained single session vs per-teammate sub-runs) and how earlier-step output threads to later steps.
- Data model details: how steps, per-step teammate, per-step error-flag, autonomy field, run history attach to/extend `scheduled_tasks` (new columns vs companion tables).
- Plain-language → cron translation approach (LLM-driven vs library) and how the advanced raw-cron escape hatch is surfaced.
- Whether recovery-to-ok emits a notification.
- Routine row iconography and the exact "3 on, 1 off" count-line copy.

### Deferred Ideas (OUT OF SCOPE)
- Full autonomy tier **enforcement** engine + Permissions/Settings surface — Phase 3 (PERM-*).
- Activity & audit views ("Ran on its own" feed) — Phase 08; this phase only keeps run records shaped to be readable there.
- Notification preferences / digest batching / multi-channel routing beyond the single state-change alert.
- Routines scoping to Projects — note as future tie-in unless trivially free.
- Recovery-to-ok "back to normal" notification — optional, Claude's discretion.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RTN-01 | Create a routine by describing it in plain language; assistant assembles the steps | §Pattern 5 (draft-first builder), §Pattern 4 (plain-language→cron). Constrained `runAgent` call returns structured step JSON; nothing persists until confirm. |
| RTN-02 | Routine runs multi-step work on a plain-language schedule, no cron in operator UI | §Pattern 4. `describeCron()` (already built, `web/src/lib/cron.ts`) renders cron→plain-language for the row/detail; `ScheduleBuilder` is the picker; cron stored internally in `scheduled_tasks.schedule`. |
| RTN-03 | Review/edit ordered steps, each assigned to a named teammate | §Data Model (`routine_steps` companion table), §Pattern 1 (multi-step runner honoring per-step `agent_id`). Roster from `listAgentIds()` / `teammateColor()`. |
| RTN-04 | Turn on/off and run it now | §Pattern 3. On/off reuses `pauseScheduledTask`/`resumeScheduledTask` (non-destructive). Run-now flips `next_run` to now (dashboard + scheduler share the `main` process). |
| RTN-05 | Run history shows ok/degraded/failed honestly; notify when a routine breaks/degrades | §Data Model (`routine_runs` companion table), §Pattern 2 (outcome derivation), §Pattern 6 (state-change notify via `relayToUser`). |
</phase_requirements>

## Summary

This is **extension work, not greenfield**. ClaudeClaw already ships a battle-tested single-process
cron scheduler (`src/scheduler.ts`, 60s wake loop), a `scheduled_tasks` table with an additive
`PRAGMA table_info`-guarded migration pattern, an atomic cross-process claim
(`claimDueTask`), a teammate roster + `delegateToAgent` runtime, a Hono `/api/*` dashboard that
runs **in the same `main` process** as the scheduler, a fully-built plain-language schedule
component (`ScheduleBuilder` + `describeCron`/`parseSchedule` in `web/src/lib/cron.ts`), and a
`relayToUser` transport sender wired into `startDashboard`. Phase 2 is mostly about composing these
pieces correctly and adding two companion tables.

The central design decision is the multi-step execution model. **Recommendation: run each step as a
discrete `runAgent`/`delegateToAgent` call inside a single claimed scheduler unit**, threading the
prior steps' outputs forward as text appended to the next step's prompt. This honors per-step
teammate assignment (D-03) cleanly via the existing `delegateToAgent(agentId, prompt, ...)` signature,
keeps the `claimDueTask` lock intact (one claim per routine run, N internal step calls), and makes
per-step outcome + the D-02 derivation natural. A single chained session cannot honor per-step
teammate because each teammate has its own cwd/CLAUDE.md/MCP allowlist.

**Primary recommendation:** Add `routine_steps` + `routine_runs` companion tables (FK to
`scheduled_tasks.id`) plus an `autonomy` column on `scheduled_tasks`; build a `runRoutineOnce(task,
steps)` multi-step runner that the scheduler invokes in place of the single `runAgent` call for
`source='routine'` rows; reuse `claimDueTask` for the one-claim lock; reuse `ScheduleBuilder` /
`describeCron` verbatim for RTN-02; use a constrained `runAgent` JSON call for the draft builder; and
fire state-change notifications via the existing `relayToUser` sender in the dashboard process.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Routine persistence (steps, runs, autonomy) | Database / Storage (`src/db.ts`) | — | All state is in the single SQLite file; follows existing CRUD conventions |
| Multi-step execution + outcome derivation | API / Backend (`src/scheduler.ts` + new runner module) | — | Runs inside the `main` process scheduler loop; not a browser concern |
| Plain-language ↔ cron translation | Browser / Client (`web/src/lib/cron.ts`, already built) | API (validate cron via `computeNextRun`) | Picker + `describeCron` are client-side; server only validates the resulting cron |
| Draft assembly (NL → step JSON) | API / Backend (constrained `runAgent` call) | Browser (renders editable draft) | The LLM call must run server-side (SDK subprocess + scrubbed env); browser only renders/edits |
| Routines CRUD + run-now + history APIs | API / Backend (`src/dashboard.ts` Hono routes) | — | Mirrors existing `/api/tasks*` routes |
| Routines list/detail/builder UI | Browser / Client (`web/src/pages/Routines.tsx`) | — | Preact SPA, registered in `web/src/lib/routes.ts` |
| State-change failure notification | API / Backend (`relayToUser` in dashboard process) | — | Transport send already wired; runner detects the transition |

## Standard Stack

This phase introduces **zero new packages**. Everything is already a dependency.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | ^11.8.1 (installed) | Synchronous SQLite persistence for steps/runs | The single persistence layer; all DB code uses it `[VERIFIED: package.json + src/db.ts]` |
| `cron-parser` | ^5.5.0 (installed) | `computeNextRun()` already wraps `CronExpressionParser` | Scheduler already depends on it `[VERIFIED: src/scheduler.ts:3,455]` |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.34 (installed) | `runAgent` (step execution + draft assembly) | The core intelligence layer `[VERIFIED: src/agent.ts:4]` |
| Hono | 4.12.3 (installed) | `/api/routines*` REST routes | Dashboard HTTP framework `[VERIFIED: .planning/codebase/STACK.md]` |
| Preact + `@preact/signals` | 10.29.1 / 2.9.0 (installed) | `Routines.tsx` + builder panel | Dashboard SPA framework `[VERIFIED: STACK.md]` |
| `lucide-preact` | 1.14.0 (installed) | Icons per UI-SPEC | Already used on every page `[VERIFIED: STACK.md]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `web/src/lib/cron.ts` (in-repo) | n/a | `describeCron`, `parseSchedule`, `buildSchedule` | RTN-02 — render cron as plain-language; never show raw cron `[VERIFIED: web/src/lib/cron.ts]` |
| `web/src/components/ScheduleBuilder.tsx` (in-repo) | n/a | Visual time/day picker + "Advanced (cron)" escape hatch | RTN-02 / D-06 — reuse verbatim; advanced toggle already implements the raw-cron hatch `[VERIFIED: ScheduleBuilder.tsx:226-233]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LLM-driven NL→cron in the builder | A dedicated NL-cron parsing library (e.g. a `chrono`/`cronstrue`-style lib) | A library adds a dependency, increases supply-chain surface, and can't handle the multi-step assembly anyway. The builder already needs an LLM call to assemble *steps*; have the same constrained call also emit the cron. The visual `ScheduleBuilder` covers the deterministic editing path. **Recommend LLM-driven for the draft, `ScheduleBuilder` for edits.** |
| Per-step discrete `runAgent` calls | Single chained Claude session for all steps | A single session cannot switch teammate identity (each teammate has its own cwd/CLAUDE.md/MCP allowlist via `resolveAgentRuntime`); it would violate D-03. **Recommend per-step calls.** |
| Companion tables (`routine_steps`, `routine_runs`) | JSON blob columns on `scheduled_tasks` (`steps_json`, `runs_json`) | JSON blobs are simpler to migrate but make run-history queries, per-step outcome storage, and Phase 08 Activity reads awkward. Companion tables match the relational conventions already in `db.ts` (e.g. `warroom_transcript` FK to `warroom_meetings`). **Recommend companion tables.** |

**Installation:** None. All dependencies already present.

## Package Legitimacy Audit

No external packages are installed in this phase. All code uses existing in-repo modules and
already-installed dependencies. **Package Legitimacy Gate: N/A (no new installs).**

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────── main process ───────────────────────┐
                          │                                                              │
  Operator (Slack)        │   Scheduler 60s loop (scheduler.ts)                          │
        │                 │        │                                                     │
        │ describes       │        │ getDueTasks('main') → for each due routine row      │
        ▼                 │        │   isAgentPaused(step teammate)? skip                │
  Routines.tsx ──HTTP──►  │        │   nextRun = computeNextRun(schedule)                │
  (builder panel)         │        │   claimDueTask(id, nextRun)  ◄── ONE claim/lock     │
        │                 │        │        │ (winner only)                              │
        │ POST            │        │        ▼                                            │
        │ /api/routines/  │        │   messageQueue.enqueue(chatId, async () => {        │
        │   draft         │        │     runRoutineOnce(task, steps):                    │
        ▼                 │        │       for step in ordered steps:                    │
  Hono /api/routines* ────┼───►    │         prompt = step.action + priorOutputs         │
  (dashboard.ts)          │        │         delegateToAgent(step.agent_id, prompt,...)  │
        │ constrained     │        │         record per-step ok/fail in routine_runs     │
        │ runAgent (JSON) │        │         if fail && stop-on-error: halt              │
        ▼                 │        │       derive overall outcome (D-02)                 │
  step JSON draft ───►    │        │       updateTaskAfterRun + insert routine_run       │
  (editable, unsaved)     │        │       if ok→degraded/failed transition:             │
                          │        │           relayToUser(alert)   ◄── D-09/D-10        │
  on confirm: POST        │        │   })                                                │
  /api/routines (persist) │        │                                                     │
        │                 │   Dashboard (startDashboard, relayToUser sender)            │
        ▼                 │        │ run-now: claimDueTask(id, now) + enqueue runner     │
  scheduled_tasks ◄───────┼────────┤ on/off: pause/resumeScheduledTask                  │
  routine_steps   (SQLite)│        │                                                     │
  routine_runs            │        │                                                     │
                          └──────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/
├── db.ts                  # + routine_steps & routine_runs tables, autonomy column, CRUD fns
├── scheduler.ts           # + source==='routine' branch calling runRoutineOnce
├── routine-runner.ts      # NEW: runRoutineOnce(task, steps, deps) + deriveOutcome() (unit-testable)
├── routine-draft.ts       # NEW: assembleRoutineDraft(description) -> { cron, steps[] } via runAgent
├── dashboard.ts           # + /api/routines* routes (CRUD, draft, run-now, history)
└── routine-runner.test.ts # NEW: outcome derivation + step threading + lock-once tests
migrations/
└── v1.2.2/                # NEW versioned migration mirroring the addColumnIfMissing additions
    └── add-routine-tables.ts
web/src/
├── pages/Routines.tsx     # NEW page, registered in lib/routes.ts (path /scheduled OR new /routines)
├── components/            # NEW: RoutineRow, RoutineDetail, StepList/StepRow, TeammateTag,
│                          #      RunHistoryItem, RoutineBuilderPanel, AutonomySelector, RunOutcomeBadge
└── lib/cron.ts            # REUSE verbatim (describeCron / parseSchedule)
```

### Pattern 1: Multi-step runner as one claimed scheduler unit (D-03)

**What:** A new `source='routine'` branch in `runDueTasks()` claims the row exactly once with
`claimDueTask` (preserving the anti-double-fire lock), then enqueues a `runRoutineOnce` call on the
message queue. `runRoutineOnce` iterates the ordered `routine_steps`, running each as its assigned
teammate via `delegateToAgent`, threading prior outputs forward.

**When to use:** Every routine fire. This is the heart of RTN-01/RTN-03/RTN-05.

**Why this and not a chained session:** `delegateToAgent(agentId, ...)` resolves the teammate's cwd,
CLAUDE.md, model, and MCP allowlist via `resolveAgentRuntime` — a single chained session cannot
switch teammate identity mid-run, so it would violate D-03's "each step runs as its assigned
teammate."

**Critical lock invariant:** The routine is **one claimed unit**. Call `claimDueTask(id, nextRun)`
ONCE at the top (advancing `next_run` to prevent re-fire on the next tick), then run N steps inside.
Do NOT call `claimDueTask`/`markTaskRunning` per step. Add `task.id` to `runningTaskIds` and remove it
in a `finally`. This mirrors the existing aos-cron branch exactly.

```typescript
// Source: pattern derived from src/scheduler.ts:244-264 (aos-cron branch) + src/orchestrator.ts:147
// In runDueTasks(), after computing nextRun:
if (task.source === 'routine') {
  if (!claimDueTask(task.id, nextRun)) continue;   // one claim — anti-double-fire intact
  runningTaskIds.add(task.id);
  const chatId = ALLOWED_CHAT_ID || 'scheduler';
  messageQueue.enqueue(chatId, async () => {        // serialize vs live user turns + scrubbed env
    try {
      const steps = getRoutineSteps(task.id);       // ordered by step_order
      await runRoutineOnce(task, steps, nextRun, { sender, delegateToAgent });
    } finally {
      runningTaskIds.delete(task.id);
    }
  });
  continue;
}
```

```typescript
// Source: NEW src/routine-runner.ts — signatures verified against orchestrator/db
export interface StepResult { stepId: number; ok: boolean; output: string; teammate: string; }

export async function runRoutineOnce(
  task: ScheduledTask,
  steps: RoutineStep[],
  nextRun: number,
  deps: { sender: (t: string) => Promise<void>; delegateToAgent: typeof delegateToAgentFn },
): Promise<void> {
  const results: StepResult[] = [];
  let halted = false;
  for (const step of steps) {                          // ordered by step_order
    // Thread earlier outputs forward (D-03: later steps see earlier output)
    const priorContext = results.length
      ? `\n\n[Earlier steps' output]\n${results.map(r => `• ${r.output}`).join('\n')}`
      : '';
    try {
      const r = await deps.delegateToAgent(
        step.agent_id, step.action + priorContext,
        ALLOWED_CHAT_ID || 'routine', 'main', undefined, TASK_TIMEOUT_MS,
      );
      const output = (r.text ?? '').trim();
      results.push({ stepId: step.id, ok: output.length > 0, output, teammate: step.agent_id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ stepId: step.id, ok: false, output: msg, teammate: step.agent_id });
      if (step.on_error === 'stop') { halted = true; break; }  // D-01 hard gate
    }
  }
  const outcome = deriveOutcome(results, steps, halted);       // D-02
  saveRoutineRun(task.id, outcome, results);                  // RTN-05 history
  updateTaskAfterRun(task.id, nextRun, summarize(results), outcome === 'failed' ? 'failed' : 'success');
  // notification handled by caller comparing prior outcome — see Pattern 6
}
```

### Pattern 2: Outcome derivation (D-02)

**What:** A pure function `deriveOutcome(results, steps, halted)` computes ok/degraded/failed. Pure =
trivially unit-testable (matches the codebase's preference for pure, directly-tested functions like
`parseTimeout` and `errors.ts`).

```typescript
// Source: NEW — encodes D-02 verbatim
export function deriveOutcome(
  results: StepResult[], steps: RoutineStep[], halted: boolean,
): 'ok' | 'degraded' | 'failed' {
  const anyUsefulOutput = results.some(r => r.ok);
  if (halted) return 'failed';                       // a stop-on-error step failed
  if (!anyUsefulOutput) return 'failed';             // no step produced useful output
  if (results.every(r => r.ok)) return 'ok';         // every step succeeded
  return 'degraded';                                 // some continue-on-error failures, but completed + useful output
}
```

**Edge case to test:** all steps `continue-on-error`, all fail → `failed` (no useful output), NOT
degraded. Degraded requires `anyUsefulOutput === true`.

### Pattern 3: On/off + run-now reuse (RTN-04)

**What:** On/off maps directly onto the existing non-destructive `pauseScheduledTask` /
`resumeScheduledTask` (sets `status='paused'`/`'active'`). Run-now: because the dashboard runs
**in the same `main` process** as the scheduler (`startDashboard` is called only when
`AGENT_ID === 'main'`, `src/index.ts:243`), the run-now endpoint can `claimDueTask(id, computeNextRun(schedule))`
then enqueue `runRoutineOnce` directly, OR simply set `next_run = now` and let the 60s loop pick it
up. **Recommend the direct claim+enqueue path** for immediate feedback (the UI-SPEC fires a "Run
started" toast on success).

**Pitfall:** run-now must respect the same one-claim lock and `runningTaskIds` guard so a manual run
and a scheduled tick can't double-fire the same routine.

### Pattern 4: Plain-language ↔ cron (RTN-02 / D-06)

**What:** Two directions, both already solved in-repo:
- **cron → plain-language (display):** `describeCron(cron).text` from `web/src/lib/cron.ts` —
  "Every day at 7:30 AM", "on weekdays", etc. Use for every row/detail. **Never render raw cron in the
  operator path.** `[VERIFIED: web/src/lib/cron.ts:195-257]`
- **edit schedule (deterministic):** `ScheduleBuilder` component (times + day picker) with its
  built-in **"Advanced (cron)"** toggle that *is* the raw-cron escape hatch D-06 asks for.
  `[VERIFIED: ScheduleBuilder.tsx:226-233]`
- **NL → cron (draft assembly):** the constrained `runAgent` draft call (Pattern 5) emits a cron
  string alongside the steps. The server validates it with `computeNextRun(cron)` (throws on invalid),
  exactly as the existing `PATCH /api/tasks/:id` does. `[VERIFIED: dashboard.ts:1539-1547]`

### Pattern 5: Draft-first conversational builder (D-04 / D-05)

**What:** A constrained server-side `runAgent` call takes the operator's plain-language description and
returns **structured step JSON + a cron string**, which the panel renders as an editable draft.
Nothing is written to `scheduled_tasks`/`routine_steps` until the operator hits "Save routine".

**Seam:** `POST /api/routines/draft { description }` → `assembleRoutineDraft(description)` calls
`runAgent` with a prompt instructing JSON-only output, then parses it. The codebase already has a
**structured-output-from-agent parsing pattern** to copy: `src/warroom-text-router.ts:151-156` strips
fences and `JSON.parse`s, with a regex fallback (`m[0]`). Reuse that exact approach.

```typescript
// Source: parse pattern verified at src/warroom-text-router.ts:151-156
function parseJsonLoose<T>(raw: string): T {
  const stripped = raw.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  try { return JSON.parse(stripped) as T; }
  catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;   // regex fallback
    throw new Error('draft assembly returned no parseable JSON');
  }
}
```

**Draft shape:** `{ cron: string, schedule_text: string, steps: { action: string, agent_id: string,
on_error: 'continue'|'stop' }[] }`. Default `on_error: 'continue'` (D-01). Validate `agent_id` against
`listAgentIds()`; fall back to `'main'` if the model names an unknown teammate.

**Why server-side:** the SDK subprocess must run with the scrubbed env (`getScrubbedSdkEnv`,
`src/agent.ts:206`) — the browser cannot run `runAgent`. The panel is a thin renderer over the
returned draft.

### Pattern 6: State-change notification (D-09 / D-10)

**What:** Notify only on the *transition* `ok → degraded` or `ok → failed`, silent on success, and do
NOT re-alert while already broken. The runner knows the **prior** outcome (the most recent
`routine_runs` row, or `scheduled_tasks.last_status`) and the **new** outcome.

```typescript
// Source: derived from D-10 + relayToUser sender (src/index.ts:230, dashboard.ts:3357)
const prior = getLastRoutineOutcome(task.id);   // 'ok'|'degraded'|'failed'|null
const now = outcome;
const isFirstBreak =
  (prior === 'ok' || prior === null) && (now === 'degraded' || now === 'failed');
if (isFirstBreak) {
  await deps.sender(`"${routineName}" ${now === 'failed' ? 'failed' : 'ran partial'}: ${reason}`);
}
// recovery (failed/degraded -> ok): Claude's discretion; recommend a single quiet "back to normal" line.
```

**Transport:** in the scheduler/runner path, the module-level `sender` (set by `initScheduler`) is the
active transport (Slack via `slack.postToUser` or Telegram). The dashboard path has `relayToUser`. Both
resolve to the same Slack send for this user. **Do NOT shell out to `scripts/notify.sh` from inside the
Node process** — that script re-parses `.env` and is for Bash-tool/skill use; the in-process `sender`
is the correct seam and avoids spawning curl. `[VERIFIED: src/scheduler.ts:281, src/index.ts:230-239]`

### Anti-Patterns to Avoid
- **Building a second scheduler.** Reuse the 60s loop + `claimDueTask`. The CONTEXT explicitly forbids
  a second scheduler.
- **Per-step `claimDueTask`/`markTaskRunning`.** Breaks the one-claim invariant and re-enables
  double-fire. Claim once per routine run.
- **Bypassing `messageQueue.enqueue`.** Scheduled/routine runs MUST go through the per-chat queue so
  they wait for in-flight user turns (prevents two Claude processes on one session) — verified at
  `scheduler.ts:252,276`.
- **Rendering raw cron in the operator path.** Violates D-06/RTN-02. Always `describeCron`.
- **Persisting the draft before confirm.** Violates D-05. The `/api/routines/draft` endpoint returns
  JSON; only `POST /api/routines` writes.
- **Re-alerting every failing run.** Violates D-10. Gate on the prior→new transition.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron → human text | A new describer | `describeCron()` in `web/src/lib/cron.ts` | Already handles fixed times, lists, steps, weekday ranges, falls back honestly `[VERIFIED]` |
| Visual schedule editing + raw-cron hatch | A new picker | `ScheduleBuilder.tsx` (verbatim) | The "Advanced (cron)" toggle IS the D-06 escape hatch `[VERIFIED]` |
| Anti-double-fire lock | New locking scheme | `claimDueTask(id, nextRun)` | Atomic `UPDATE ... WHERE status='active'`; SQLite serializes writes `[VERIFIED: db.ts:1376-1384]` |
| Running a step as a teammate | Spawning claude yourself | `delegateToAgent(agentId, prompt, chatId, 'main', ...)` | Resolves cwd/CLAUDE.md/model/MCP allowlist + logs to hive_mind/inter_agent_tasks `[VERIFIED: orchestrator.ts:147]` |
| Scrubbed-env SDK invocation | Calling `query()` directly | `runAgent` / `delegateToAgent` | `getScrubbedSdkEnv` strips secrets from the subprocess `[VERIFIED: agent.ts:206]` |
| Schema migration | Inline schema edit | `addColumnIfMissing` in `createSchema`/`runMigrations` + a versioned `migrations/vX/` file | Matches the dual-write pattern (in-memory test DB parity + production migration) `[VERIFIED: db.ts:535-540 + migrations/v1.2.1]` |
| Teammate tag color | New color map | `teammateColor(id)` in `Team.tsx` | Fixed spec colors, id-substring matched `[VERIFIED: Team.tsx:58-65]` |
| JSON-from-LLM parsing | New parser | `parseJsonLoose` pattern from `warroom-text-router.ts:151-156` | Handles fences + regex fallback `[VERIFIED]` |
| Transport send | `scripts/notify.sh` from Node | the in-process `sender` / `relayToUser` | Avoids spawning curl + re-parsing .env inside the daemon `[VERIFIED: scheduler.ts:281]` |

**Key insight:** ~80% of this phase is wiring existing, verified primitives. The genuinely new code is
two companion tables, a ~120-line `routine-runner.ts`, a ~40-line `routine-draft.ts`, the `/api/routines*`
routes, and the Preact page/components.

## Runtime State Inventory

This is a **feature-addition phase, not a rename/refactor**, but it touches a **live, in-production
`scheduled_tasks` table** that the operator's running service writes to. Migration safety matters.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `scheduled_tasks` is live in `store/claudeclaw.db` with real `source='user'` and `source='aos-cron'` rows. New `autonomy` column + new `source='routine'` value must not disturb them. | Additive `ALTER TABLE ... ADD COLUMN autonomy TEXT` with a safe default; new tables are `CREATE TABLE IF NOT EXISTS`. Existing rows keep `source='user'` and are untouched. |
| Live service config | The scheduler runs in the live `main` process; `npm run migrate` MUST run before restart or `initDatabase` column-parity drifts. Per MEMORY.md: "run `npm run migrate` before restart (else checkPendingMigrations crash-loops)". | Ship BOTH the `addColumnIfMissing` calls in `runMigrations` (for the in-memory test DB + fresh installs) AND a versioned `migrations/v1.2.2/add-routine-tables.ts` (for the production DB). Bump `migrations/version.json`. |
| OS-registered state | None — routines are DB rows fired by the existing in-process loop; no launchd/Task Scheduler entries per routine. | None — verified: scheduler is a single `setInterval`, `scheduler.ts:105`. |
| Secrets/env vars | None new. Notifications reuse existing `SLACK_BOT_TOKEN`/`ALLOWED_SLACK_USER_ID` via the in-process sender. | None. |
| Build artifacts | `dist/` must be rebuilt (tsc) for the new `src/routine-runner.ts`, `routine-draft.ts`; `dist/web/` rebuilt (vite) for `Routines.tsx`. `schedule-cli.test.ts` runs the compiled `dist/schedule-cli.js`. | Standard `npm run build` before service restart; no stale-artifact rename hazard. |

**The canonical question — after code lands, what runtime state still has stale data?** Nothing
structurally, but: the production `claudeclaw.db` needs the versioned migration applied
(`npm run migrate`) before the rebuilt service starts, or `getDueTasks`/new CRUD will hit missing
columns. This is the single migration landmine and is handled by the dual-write migration pattern.

## Common Pitfalls

### Pitfall 1: Double-fire under multi-step runs
**What goes wrong:** Calling `claimDueTask` or `markTaskRunning` per step, or forgetting the
`runningTaskIds` guard, lets a routine fire twice (a scheduler tick during a long multi-step run, or a
run-now overlapping a scheduled tick).
**Why it happens:** The single-prompt path claims once; a naive multi-step adaptation re-claims per
step.
**How to avoid:** Claim exactly once per routine run (advancing `next_run`), add `task.id` to
`runningTaskIds`, remove in `finally`. Mirror `scheduler.ts:244-264`.
**Warning signs:** Duplicate `routine_runs` rows for one scheduled time; the existing concern
"scheduler.test.ts Does Not Test Double-Claim Scenario" (CONCERNS.md) — add that test.

### Pitfall 2: Paused-teammate semantics colliding with routine run
**What goes wrong:** `runDueTasks` already skips a task whose *owning* `agent_id` is paused
(`isAgentPaused(task.agent_id)`, `scheduler.ts:235`). But a routine's *steps* can be assigned to
different teammates. A step's teammate may be paused even if the routine owner isn't.
**Why it happens:** The owner-level pause check predates per-step teammates.
**How to avoid:** Decide per-step behavior: skip the paused step (degraded), or surface "teammate
paused" (UI-SPEC §Steps shows a muted note). Recommend: a paused step's `delegateToAgent` should be
short-circuited to a recorded skip → contributes to degraded outcome. Check `isAgentPaused(step.agent_id)`
inside `runRoutineOnce`.
**Warning signs:** A routine silently "succeeds" while a paused teammate's step never ran.

### Pitfall 3: Migration column-parity drift (crash-loop)
**What goes wrong:** Adding columns only in `runMigrations` (in-memory) but not as a versioned
migration → production DB lacks them → `checkPendingMigrations` crash-loops on restart (MEMORY.md).
**How to avoid:** Dual-write: `addColumnIfMissing` in `runMigrations` AND a `migrations/v1.2.2/` file,
bump `version.json`. Run `npm run migrate` before restart.
**Warning signs:** Service exits on boot; "pending migrations" log.

### Pitfall 4: `runAgent` draft returning prose instead of JSON
**What goes wrong:** The model wraps JSON in commentary or fences; naive `JSON.parse` throws.
**How to avoid:** Use the `parseJsonLoose` fence-strip + regex-fallback pattern
(`warroom-text-router.ts:151-156`). Validate the parsed shape; on failure, return a friendly
"couldn't assemble — try rephrasing" rather than 500.
**Warning signs:** 500s on the draft endpoint; empty step lists.

### Pitfall 5: Storing autonomy in a Phase-3-incompatible shape
**What goes wrong:** Storing autonomy as a free-text label that Phase 3's four-tier model
(D4: tiers by reversibility) can't read → rework.
**How to avoid:** Store a structured, forward-compatible value (see §Autonomy Field). The UI-SPEC's
two-option selector ("unattended" / "queue for approval") maps onto the Phase-3 tiers; store the
machine value, not the display label.

## Code Examples

### Companion-table schema (add to `createSchema` in db.ts)
```sql
-- Source: pattern from warroom_meetings/warroom_transcript FK (db.ts:272-291)
CREATE TABLE IF NOT EXISTS routine_steps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id  TEXT NOT NULL,
  step_order  INTEGER NOT NULL,
  action      TEXT NOT NULL,
  agent_id    TEXT NOT NULL DEFAULT 'main',
  on_error    TEXT NOT NULL DEFAULT 'continue',   -- 'continue' | 'stop' (D-01)
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (routine_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_routine_steps ON routine_steps(routine_id, step_order);

CREATE TABLE IF NOT EXISTS routine_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id  TEXT NOT NULL,
  outcome     TEXT NOT NULL,                       -- 'ok' | 'degraded' | 'failed' (D-02)
  detail      TEXT NOT NULL DEFAULT '',            -- honest reason for RTN-05 history
  output      TEXT,                                -- per-run combined output / link target
  step_results TEXT NOT NULL DEFAULT '[]',         -- JSON [{stepId, ok, output, teammate}]
  ran_at      INTEGER NOT NULL,
  FOREIGN KEY (routine_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_routine_runs ON routine_runs(routine_id, ran_at DESC);
```
**Autonomy column on the existing table:**
```typescript
// in runMigrations (db.ts) — additive, safe default
addColumnIfMissing(database, 'scheduled_tasks', 'autonomy', `TEXT NOT NULL DEFAULT 'unattended'`);
```

### Run-now endpoint (dashboard.ts)
```typescript
// Source: mirrors /api/tasks/:id/pause (dashboard.ts:1560) + scheduler claim pattern
app.post('/api/routines/:id/run', (c) => {
  const id = c.req.param('id');
  const task = getAllScheduledTasks().find(t => t.id === id && t.source === 'routine');
  if (!task) return c.json({ ok: false, error: 'routine not found' }, 404);
  const nextRun = computeNextRun(task.schedule);
  if (!claimDueTask(id, nextRun)) return c.json({ ok: false, error: 'already running' }, 409);
  // enqueue runRoutineOnce on the same messageQueue the scheduler uses
  triggerRoutineRun(task, nextRun);    // thin wrapper exported from scheduler/runner
  return c.json({ ok: true });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Three internal surfaces (scheduled task / mission task / workflow) | One operator concept: "routine" (multi-step scheduled task) | This phase | UI collapses them; plumbing stays distinct |
| Single-prompt scheduled tasks | Ordered multi-step routines with per-step teammate | This phase | Adds companion tables; reuses the same loop |
| Read-then-write fire (double-fire risk) | `claimDueTask` atomic claim | Phase 7 (already landed) | Reuse — no change needed |

**Deprecated/outdated:** Nothing. The aos-cron columns added in v1.2.1 set the exact precedent this
phase follows.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `main` process is the only scheduler that fires `source='routine'` rows (routines owned by `agent_id='main'` or the assigned owner), so dashboard run-now and scheduler tick share one process and the in-memory `runningTaskIds` guard is sufficient alongside `claimDueTask`. | Pattern 1/3 | If routines are owned by non-main agents running as separate processes, the cross-process double-claim concern (CONCERNS.md) applies — but `claimDueTask` already covers it atomically, so risk is low. Confirm routine ownership model with planner. |
| A2 | The autonomy machine value `'unattended'` / `'queue_approval'` is forward-compatible with Phase 3's four-tier (D4) model as a coarse mode that Phase 3 refines. | Autonomy Field | If Phase 3 needs per-action granularity stored now, schema would need extending — but D-08 explicitly defers enforcement, so storing the coarse choice is the stated intent. Confirm shape against `specs/.../07-permissions-settings.md` during planning. |
| A3 | Recovery-to-ok notification is desired as a single quiet line (Claude's discretion per D-10). | Pattern 6 | Operator may prefer total silence on recovery; cheap to toggle. |
| A4 | A paused step's teammate should record a skip and contribute to a `degraded` outcome rather than block the whole run. | Pitfall 2 | Operator may expect a paused teammate to block (fail) the routine. Surface as an open question. |

## Open Questions (RESOLVED)

1. **Routine ownership / which `agent_id` owns the `scheduled_tasks` row.**
   - What we know: `getDueTasks(agentId)` filters by owner `agent_id`; steps carry their own teammate.
   - RESOLVED: Own the routine row as `agent_id='main'` so the main scheduler always fires it; per-step
     `delegateToAgent` handles teammate execution. Simplest, avoids the cross-process race entirely.
     (Planned in 02-02.)

2. **Paused-teammate behavior for a step (Pitfall 2 / A4).**
   - RESOLVED: skip the step (record `ok:false`/`skipped:true` with a "teammate paused" note) and let it
     contribute to a `degraded` outcome rather than hard-fail the run. Matches UI-SPEC. (Planned in 02-02.)

3. **Where does "View output" point (RTN-05)?**
   - What we know: `routine_runs.output` / `step_results` hold the text.
   - RESOLVED: store combined output inline in `routine_runs` (capped, like `updateTaskAfterRun`'s
     4000-char slice); "View output" opens it in a panel. Phase 08 Activity can read the same rows.
     (Planned in 02-02 / 02-04.)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build + runtime | ✓ | >=20 (dev v25) | — `[VERIFIED: STACK.md]` |
| better-sqlite3 | Persistence | ✓ | ^11.8.1 installed | — |
| Claude Code CLI (`claude`) | step execution + draft | ✓ (assumed authed) | — | Tests mock the SDK; runtime requires `claude login` (Phase 1 owns this) |
| vitest | Tests | ✓ | 2.x | — |
| Slack transport | D-09 notifications | ✓ | per `.env` | Telegram path also supported by `sender` |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None — all required tooling present.

## Validation Architecture

> nyquist_validation is enabled (no `.planning/config.json` override found disabling it).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.x `[VERIFIED: TESTING.md, STACK.md]` |
| Config file | `vitest.config.ts` (project root) + inline `vitest` block in `package.json` |
| Quick run command | `npx vitest run src/routine-runner.test.ts` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RTN-01 | Draft assembly parses NL → {cron, steps[]}; nothing persists until confirm | unit | `npx vitest run src/routine-draft.test.ts` | ❌ Wave 0 |
| RTN-01 | Draft endpoint returns JSON without writing rows | contract | `npx vitest run src/dashboard.contract.test.ts -t routines` | ❌ Wave 0 (extend existing) |
| RTN-02 | `describeCron` renders stored cron as plain-language; no raw cron leaks | unit | `npx vitest run web/.../cron.test.ts` (existing lib) + new row-render assertion | partial — `cron.ts` covered |
| RTN-02 | `computeNextRun` validates assembled cron | unit | `npx vitest run src/routine-draft.test.ts -t cron-valid` | ❌ Wave 0 |
| RTN-03 | Steps stored ordered; per-step teammate honored; runner threads prior output | unit | `npx vitest run src/routine-runner.test.ts -t teammate` | ❌ Wave 0 |
| RTN-04 | On/off via pause/resume; run-now claims once (no double-fire) | unit + contract | `npx vitest run src/scheduler.test.ts -t routine` | ❌ Wave 0 (extend) |
| RTN-05 | `deriveOutcome` ok/degraded/failed matches D-02 incl. all-fail→failed edge | unit | `npx vitest run src/routine-runner.test.ts -t outcome` | ❌ Wave 0 |
| RTN-05 | State-change notify fires once on ok→broken, not on subsequent breaks (D-10) | unit | `npx vitest run src/routine-runner.test.ts -t notify-transition` | ❌ Wave 0 |
| RTN-05 | `routine_runs` CRUD round-trips outcome + step_results | unit (in-mem DB) | `npx vitest run src/db.test.ts -t routine` | ❌ Wave 0 (extend) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/routine-runner.test.ts src/routine-draft.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + `npm run typecheck` before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/routine-runner.test.ts` — `deriveOutcome` (D-02, incl. all-continue-fail edge), step
  threading, paused-teammate skip, one-claim/no-double-fire, notify-transition (D-10). Covers RTN-03/04/05.
- [ ] `src/routine-draft.test.ts` — `parseJsonLoose` against fenced/prose model output, agent_id
  validation against roster, cron validity via `computeNextRun`. Covers RTN-01/02. Mock `runAgent`.
- [ ] Extend `src/db.test.ts` — `routine_steps`/`routine_runs` CRUD + `autonomy` column round-trip,
  using `_initTestDatabase()` (real in-memory SQLite).
- [ ] Extend `src/dashboard.contract.test.ts` — `/api/routines*` route shapes (CRUD, draft, run-now,
  history), auth gate, draft-does-not-persist assertion.
- [ ] Extend `src/scheduler.test.ts` — `source='routine'` branch fires the runner, claim-once, paused
  owner skip. (Closes the existing CONCERNS.md gap "scheduler.test.ts does not test double-claim.")
- [ ] Framework install: none needed — vitest present.

## Security Domain

> `security_enforcement` not found disabled in config — included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Dashboard auth is the existing `DASHBOARD_TOKEN` bearer gate; no new auth surface |
| V3 Session Management | no | Reuses existing dashboard session/token boundary |
| V4 Access Control | yes | The `autonomy` field is stored but NOT enforced this phase (D-08). Phase 3 builds the gate. Do not let stored autonomy read as "enforced" anywhere. |
| V5 Input Validation | yes | Validate `cron` via `computeNextRun` (already done for tasks); validate `agent_id` against `listAgentIds()`; validate `on_error ∈ {continue,stop}`, `autonomy ∈ {unattended,queue_approval}`; cap step `action` length; reject empty step lists. |
| V6 Cryptography | no | Routine tables store no secrets; `scheduled_tasks` is plaintext by design (CONCERNS.md: only wa/slack message bodies are encrypted). Do not store credentials in step actions. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via step action text running under a teammate's tools | Elevation of Privilege | `runAgent`/`delegateToAgent` already scrub secret env (`getScrubbedSdkEnv`); autonomy enforcement is Phase 3 — until then, the stored `autonomy` MUST NOT be presented as a security guarantee (honesty per D-08). |
| Malformed draft JSON → unhandled 500 / injected control chars | Tampering / DoS | `parseJsonLoose` + shape validation; reject and return a friendly error, never persist unvalidated draft. |
| SQL injection via step action / routine name | Tampering | Use parameterized `better-sqlite3` prepared statements everywhere (the codebase's universal pattern). Never string-concat user text into SQL. |
| Run-now flooding / overlapping runs | DoS | `claimDueTask` 409 + `runningTaskIds` guard prevents concurrent runs of one routine. |
| Cross-process double-execution | Tampering | `claimDueTask` atomic `UPDATE ... WHERE status='active'` (SQLite serializes writes). |

## Sources

### Primary (HIGH confidence — read directly this session)
- `src/scheduler.ts` — 60s loop, `claimDueTask` branch, `messageQueue.enqueue`, `runAosCronTaskOnce`, `parseTimeout`, paused-agent skip, `computeNextRun`.
- `src/db.ts` — `scheduled_tasks` schema, `addColumnIfMissing`, `runMigrations`, `claimDueTask`/`markTaskRunning`/`updateTaskAfterRun`/`pause`/`resume`, `createMissionTask`, FK example (`warroom_transcript`).
- `src/orchestrator.ts` — `delegateToAgent` signature + teammate runtime resolution.
- `src/agent.ts` — `runAgent` signature, `getScrubbedSdkEnv` scrub boundary, `loadMcpServers`.
- `src/dashboard.ts` — `/api/tasks*` route patterns, `startDashboard(relayToUser)`, cron validation in PATCH.
- `src/index.ts` — dashboard runs only in `main` process; `dashboardRelay`/`relayToUser` definition.
- `src/schedule-cli.ts` — current CRUD surface + `computeNextRun` usage.
- `web/src/lib/cron.ts` — `describeCron`, `parseSchedule`, `buildSchedule`.
- `web/src/components/ScheduleBuilder.tsx` — visual picker + "Advanced (cron)" escape hatch.
- `web/src/lib/routes.ts`, `web/src/lib/vocabulary.ts` — route registration + operator vocab (`nav.routines`).
- `web/src/pages/Team.tsx` — `teammateColor()`.
- `scripts/notify.sh` — transport send (and why to prefer in-process sender instead).
- `migrations/v1.2.1/add-aos-cron-scheduled-task-columns.ts`, `scripts/migrate.ts` — versioned migration precedent + dual-write pattern.
- `src/warroom-text-router.ts` — JSON-from-LLM parse pattern.
- `.planning/codebase/{TESTING,CONCERNS,STACK}.md`, `specs/operator-product/06-routines.md`, `02-CONTEXT.md`, `02-UI-SPEC.md`.

### Secondary (MEDIUM confidence)
- MEMORY.md notes (migrations-before-restart crash-loop; Slack transport; single-scheduler `CRON_IN_PROCESS`).

### Tertiary (LOW confidence)
- None — all claims verified against source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all primitives read directly in source.
- Architecture: HIGH — execution model, lock invariant, and seams verified against `scheduler.ts`/`orchestrator.ts`/`db.ts`.
- Pitfalls: HIGH — each maps to a verified code location or a documented CONCERNS.md/MEMORY.md item.
- Open questions: routine ownership model (A1) and paused-step semantics (A4) are the two items to confirm with the planner/operator.

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stable internal codebase; re-verify if `scheduler.ts`/`db.ts` change materially)
