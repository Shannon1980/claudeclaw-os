---
phase: 02-routines
verified: 2026-06-23T14:22:00Z
status: human_needed
score: 5/5
overrides_applied: 0
human_verification:
  - test: "Create a routine by typing a plain-language description in the builder panel, click Build draft, review the proposed steps, and click Save routine."
    expected: "Draft assembles (schedule + ordered steps with teammate tags) without persisting; Save creates the routine row. The routine appears in the list with plain-language schedule text (not a raw cron expression)."
    why_human: "assembleRoutineDraft invokes a live runAgent SDK subprocess; the contract test mocks it. End-to-end round-trip from natural language through the UI to a persisted row requires the running service."
  - test: "Click Run now on a saved routine. Then click it again immediately while the first run is in progress."
    expected: "First click starts the run and shows 'Run started' toast. Second click returns 409 / 'Already running' toast. The routine must not double-fire."
    why_human: "The 409 path is contract-tested, but the timing guarantee (claim-once under concurrent UI clicks) cannot be exercised by a grep check."
  - test: "Create a routine whose first step uses a paused teammate. Run it now and inspect run history."
    expected: "Run history shows 'degraded' outcome (not 'failed'), and the detail line reports the skipped step. No stop-on-error halt should occur."
    why_human: "Requires a live paused teammate row in the DB and a real delegateToAgent execution path; cannot be verified statically."
  - test: "Let a routine whose previous run was 'ok' run again and produce a failure. Check the Slack channel."
    expected: "Exactly one Slack notification fires on the first ok-to-broken transition. Re-running while still broken produces no further notification."
    why_human: "State-change-only notification (D-10) is unit-tested, but the in-process sender wired to the live Slack transport requires the full running service."
  - test: "Open the Routines page; expand a routine's detail; click Change next to the schedule. Verify raw cron is never shown until the Advanced toggle is clicked."
    expected: "The When block shows plain-language text (e.g. 'Every weekday at 8am'). No cron expression appears in the default view. Clicking Advanced (cron) reveals the raw cron input."
    why_human: "RTN-02/D-06 visual compliance. describeCron usage is verified in code, but the actual rendered UI must be eyeballed to confirm no cron string leaks into the default operator path."
deferred: []
gaps: []
---

# Phase 2: Routines Verification Report

**Phase Goal:** An operator can stand up multi-step work that runs on its own by describing it in plain language, then review, control, and trust its run history.
**Verified:** 2026-06-23T14:22:00Z
**Status:** human_needed
**Re-verification:** No (initial verification)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Operator creates a routine by describing it in plain language; assistant assembles schedule + steps (RTN-01) | VERIFIED | `src/routine-draft.ts` `assembleRoutineDraft` (line 144): NL description -> constrained runAgent call -> `{cron, schedule_text, steps[]}` draft. POST `/api/routines/draft` wired at `src/dashboard.ts:1656`. `RoutineBuilderPanel.tsx:52-73` sends description to draft endpoint and renders editable proposal. |
| 2 | Routine runs on a plain-language schedule with no cron syntax shown in the operator UI (RTN-02 / D-06) | VERIFIED | `RoutineRow.tsx:50` uses `describeCron(routine.schedule).text` for all visible schedule text. `RoutineDetail.tsx:92` same. Raw cron only surfaces inside `ScheduleBuilder` behind the "Advanced (cron)" toggle (`ScheduleBuilder.tsx:228-232`). No raw cron string is rendered as text in any operator-path component. |
| 3 | Operator can review and edit ordered steps, each assigned to a named teammate (RTN-03) | VERIFIED | `src/db.ts:1490-1554` defines `RoutineStep`, `getRoutineSteps`, `saveRoutineSteps` (transactional delete-then-insert). `StepList.tsx` / `StepRow.tsx` render ordered editable steps with teammate tags. `TeammateTag.tsx` present. PUT `/api/routines/:id` calls `saveRoutineSteps` at `src/dashboard.ts:1779`. |
| 4 | Operator can turn a routine on/off and run it now (RTN-04) | VERIFIED | Pause/resume: `src/dashboard.ts:1796-1805` calls `pauseScheduledTask`/`resumeScheduledTask`. Run-now: `src/dashboard.ts:1673-1689` calls `triggerRoutineRun` with single-claim guard; 409 returned when already claimed. `Routines.tsx:52-82` wires both actions. Toggle in `RoutineRow.tsx:88-94` is non-destructive (no confirm modal). |
| 5 | Run history shows ok/degraded/failed honestly, operator notified on break/degrade (RTN-05 / D-09 / D-10) | VERIFIED | `deriveOutcome` (pure fn, `src/routine-runner.ts:38-48`) derives ok/degraded/failed incl. all-continue-fail -> failed edge. `saveRoutineRun` persists at `src/db.ts:1561`. `RunOutcomeBadge.tsx` maps outcomes to honest labels (ok=green "Ran clean", degraded=amber "Partial", failed=red "Failed"). State-change notify at `src/routine-runner.ts:169-179` fires on `ok->degraded/failed` only (`isFirstBreak` guard, D-10). |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/routine-runner.ts` | Multi-step execution engine: `deriveOutcome` + `runRoutineOnce`, state-change notify | VERIFIED | 202 lines. Pure `deriveOutcome` (line 38), `runRoutineOnce` with DI deps, per-step `delegateToAgent`, paused-skip, prior-output threading, D-10 state-change alert. |
| `src/routine-draft.ts` | NL -> validated `{cron, schedule_text, steps[]}` draft assembler, `parseJsonLoose` | VERIFIED | 222 lines. `assembleRoutineDraft` (line 144), `parseJsonLoose` (line 79), roster validation, `on_error` defaulting, cron validated via `computeNextRun`, D-05 no-persist. |
| `src/db.ts` (routine tables) | `routine_steps`, `routine_runs` tables in schema; `autonomy` column; 5 parameterized CRUD fns | VERIFIED | Tables at lines 89-112. `autonomy` addColumnIfMissing at line 578. CRUD: `getRoutineSteps` (1519), `saveRoutineSteps` (1533), `saveRoutineRun` (1561), `getRoutineRuns` (1583), `getLastRoutineOutcome` (1595). |
| `migrations/v1.2.2/add-routine-tables.ts` | Versioned production migration for routine_steps/routine_runs/autonomy | VERIFIED | File exists, 66 lines. Idempotent CREATE IF NOT EXISTS + PRAGMA-guarded autonomy ALTER. `migrations/version.json` registers `"v1.2.2": ["add-routine-tables"]`. |
| `src/scheduler.ts` (routine branch) | `source==='routine'` branch claims once, runs `runRoutineOnce`; exports `triggerRoutineRun` | VERIFIED | Lines 275-293: routine branch with `claimDueTask` once + `runningTaskIds` guard + `messageQueue.enqueue`. `triggerRoutineRun` exported at line 369. |
| `src/dashboard.ts` (`/api/routines*`) | Full route surface: list, detail, draft, create, edit/reorder, delete, pause, resume, run-now | VERIFIED | Lines 1647-1805: 9 routes. All behind existing `DASHBOARD_TOKEN` gate. D-05 draft writes no rows (line 1660). Run-now delegates entirely to `triggerRoutineRun` (no double-claim). |
| `web/src/pages/Routines.tsx` | Routines list page wired to `/api/routines*` | VERIFIED | 197 lines. `useFetch('/api/routines')` drives list; `RoutineBuilderPanel` opens inline (D-04, no chat handoff); `onCount`/`offCount` stat line; `RoutineRow` per item. |
| `web/src/components/RoutineRow.tsx` | List row: plain-language schedule, step count, last outcome, non-destructive Toggle | VERIFIED | 119 lines. `describeCron(routine.schedule).text` (line 50). `RunOutcomeBadge` at line 83. `Toggle` primary control (line 88), no confirm modal. Off routines dim at `opacity-50`. |
| `web/src/components/RoutineDetail.tsx` | Expanded detail: When (plain-language), Steps (editable), Recent runs (honest history), Actions | VERIFIED | 146 lines. `describeCron(...).text` at line 92. `StepList` editable. `RunHistoryItem` list. Run now + Turn off actions. Autonomy pill read-only display. |
| `web/src/components/RoutineBuilderPanel.tsx` | Draft-first embedded builder; persists nothing until Save; AutonomySelector visible | VERIFIED | 210 lines. Two-phase: description input -> `/api/routines/draft` (no persist); draft rendered as "Draft, not saved yet" Pill. Save POSTs `/api/routines`. `AutonomySelector` at line 177 (above Save). |
| `web/src/components/AutonomySelector.tsx` | At-creation autonomy choice; stores machine values; no enforcement claim | VERIFIED | 62 lines. Two options: `unattended`/`queue_approval`. Explainer text states intended behavior ("Won't send, pay, or commit on its own"), not a guarantee (D-08). |
| `web/src/components/RunOutcomeBadge.tsx` | Honest ok/degraded/failed badge rendering | VERIFIED | 40 lines. All three outcomes explicitly mapped; degraded renders amber AlertTriangle "Partial" (never collapsed to generic error). |
| `web/src/lib/routes.ts` | `/routines` route registered; `/scheduled` redirects | VERIFIED | Line 30 registers `/routines`. `App.tsx:68` redirects `/scheduled` to `/routines`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `RoutineBuilderPanel` -> draft call | `POST /api/routines/draft` | `apiPost('/api/routines/draft', {description})` | WIRED | `RoutineBuilderPanel.tsx:57`. Separate from persist call (`/api/routines`). |
| Draft endpoint -> `assembleRoutineDraft` | `src/routine-draft.ts` | `dashboard.ts:1660` calls `assembleRoutineDraft(description)` | WIRED | Import at `dashboard.ts:90`. |
| Scheduler routine branch -> runner | `runRoutineOnce` | `scheduler.ts:282` calls `runRoutineOnce(task, getRoutineSteps(task.id), nextRun, {deps})` | WIRED | Single claim at line 276; `runningTaskIds` guard at line 277. |
| `triggerRoutineRun` -> scheduler claim | `claimDueTask` + `runningTaskIds` | `scheduler.ts:370-371` | WIRED | Run-now shares the exact same claim path as the tick; no second claim in dashboard route. |
| `runRoutineOnce` -> per-step teammate | `delegateToAgent` | `routine-runner.ts:122` calls `deps.delegateToAgent(step.agent_id, ...)` | WIRED | Prior output threaded at lines 114-119. Paused-step skip at lines 103-112. |
| Run outcome -> state-change notify | In-process `sender` | `routine-runner.ts:169-178` checks `isFirstBreak` then calls `deps.sender(...)` | WIRED | Guard reads `getLastOutcome` BEFORE persisting this run (line 151), so transition uses prior state. |
| `RoutineRow` schedule display | `describeCron(...).text` | `RoutineRow.tsx:50` | WIRED | Raw cron never rendered as text in operator path. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `Routines.tsx` | `routines` | `useFetch('/api/routines', 30_000)` -> `GET /api/routines` -> `getAllScheduledTasks().filter(source==='routine').map(enrichRoutine)` -> `routine_steps` + `getLastRoutineOutcome` DB queries | Yes (real DB queries, not static) | FLOWING |
| `RoutineDetail.tsx` | `runs` | `useFetch('/api/routines/${id}', 30_000)` -> `getRoutineRuns(id)` SQL (`routine_runs` table) | Yes | FLOWING |
| `routine-runner.ts` | `outcome` | `deriveOutcome(results, steps, halted)` from live `delegateToAgent` outputs | Yes (derived from real step outputs) | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `routine-runner` suite (deriveOutcome, runRoutineOnce, paused-skip, state-change notify) | `npx vitest run src/routine-runner.test.ts` | 11/11 tests pass | PASS |
| `routine-draft` suite (parseJsonLoose, assembleRoutineDraft, roster validation, cron-valid) | `npx vitest run src/routine-draft.test.ts` | 6/6 tests pass | PASS |
| DB routine CRUD (round-trips, autonomy column, getLastRoutineOutcome ordering) | `npx vitest run src/db.test.ts -t routine` | 5/5 routine tests pass | PASS |
| Dashboard routines contract (list auth gate, draft-no-persist, 409-run-now) | `npx vitest run src/dashboard.contract.test.ts -t routines` | 3/3 tests pass | PASS |
| Scheduler routine branch (claim-once, paused-owner skip) | `npx vitest run src/scheduler.test.ts -t routine` | 2/2 tests pass | PASS |
| Vite + tsc build | `npm run build && npx tsc --noEmit` | Build green; typecheck clean | PASS |
| `schedule-cli.test.ts` (agent-routing tests) | `npx vitest run src/schedule-cli.test.ts` | 3/3 FAIL — pre-existing environmental, NOT a Phase 2 regression (see note below) | SKIP (pre-existing) |

**Pre-existing test caveat:** The 3 failures in `src/schedule-cli.test.ts` exec `dist/schedule-cli.js` which calls `initDatabase()` requiring `DB_ENCRYPTION_KEY`. This is a git worktree with no `.env` or `store/`. The file was last modified before Phase 2 (commit `3260175`); it is structurally unrelated to routines. These failures appear identically on the pre-Phase-2 commit and must not be treated as Phase 2 regressions. Two additional contract-test failures (`serves SPA shell at /` and `/warroom`) are similarly pre-existing, logged to `.planning/phases/02-routines/deferred-items.md`.

---

### Probe Execution

No phase-declared probes. Step 7c: SKIPPED (no `scripts/*/tests/probe-*.sh` for this phase; no phase-declared probes in PLAN files).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RTN-01 | 02-01, 02-03, 02-04 | Create routine by describing in plain language; assistant assembles steps | SATISFIED | `assembleRoutineDraft` (routine-draft.ts) + `RoutineBuilderPanel` draft flow |
| RTN-02 | 02-03, 02-04 | Runs on plain-language schedule; no cron shown in operator UI | SATISFIED | `describeCron(...).text` in RoutineRow/RoutineDetail; raw cron behind Advanced toggle only |
| RTN-03 | 02-02, 02-04 | Review/edit ordered steps, each assigned to named teammate | SATISFIED | `saveRoutineSteps`, `StepList`, `StepRow`, `TeammateTag`, PUT /api/routines/:id |
| RTN-04 | 02-02, 02-03, 02-04 | Turn on/off + run now | SATISFIED | pause/resume routes, `triggerRoutineRun` single-claim path, Toggle component |
| RTN-05 | 02-02, 02-04 | Run history shows ok/degraded/failed honestly + notify on break/degrade | SATISFIED | `deriveOutcome`, `saveRoutineRun`, `RunOutcomeBadge`, state-change notify in `runRoutineOnce` |

---

### Context Decisions Compliance

| Decision | Requirement | Status | Evidence |
|----------|-------------|--------|----------|
| D-01 | Steps carry continue/stop-on-error; default continue | VERIFIED | `on_error` column in `routine_steps`; `saveRoutineSteps` defaults `'continue'`; runner halts on `step.on_error === 'stop'` at `routine-runner.ts:141` |
| D-02 | ok/degraded/failed derived honestly; all-continue-fail -> failed | VERIFIED | `deriveOutcome` pure fn lines 38-48; `anyUsefulOutput` check |
| D-03 | Steps execute in order, per-teammate; prior output threaded | VERIFIED | `routine-runner.ts:101` loops `steps`; `priorContext` built at lines 114-119; `delegateToAgent(step.agent_id, step.action + priorContext, ...)` |
| D-04 | Builder embedded on Routines page, not Chat handoff | VERIFIED | `RoutineBuilderPanel` rendered inline in `Routines.tsx:159-165`; no chat navigation |
| D-05 | Draft persists nothing | VERIFIED | `POST /api/routines/draft` at `dashboard.ts:1656` calls `assembleRoutineDraft` and returns JSON; zero DB writes. Contract-test asserts row count unchanged (3/3 green). |
| D-06 | No raw cron in operator path | VERIFIED | All operator-facing schedule text via `describeCron(...).text`; Advanced toggle behind `ScheduleBuilder` only |
| D-07 | Autonomy choice stored on routine | VERIFIED | `autonomy` column in `scheduled_tasks` (db.ts:578); `AutonomySelector` in builder; stored in `createScheduledTask` (db.ts:1344) |
| D-08 | Autonomy stored, NOT enforced (Phase 3 gate) | VERIFIED | `execContext = { autonomy: task.autonomy }` passed in routine-runner.ts:96 but no enforcement gate built; `AutonomySelector` copy says "Won't send... on its own" as intent, not guarantee |
| D-09 | Notify via in-process sender (not scripts/notify.sh) | VERIFIED | `deps.sender(...)` at `routine-runner.ts:175`; injected from `scheduler.ts:285` as the same `sender` used elsewhere |
| D-10 | State-change only: alert on first ok->broken; silent on repeat and recovery | VERIFIED | `isFirstBreak` guard at `routine-runner.ts:169`; recovery (failed/degraded->ok) is silent (line 181 comment) |

---

### Anti-Patterns Found

No blockers. Scanned all Phase 2 source files for TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER/stub patterns.

| File | Pattern | Assessment |
|------|---------|------------|
| `RoutineBuilderPanel.tsx:124,156` | HTML `placeholder=` attribute | ℹ️ Info — input placeholder UX copy, not a stub indicator. Appropriate use. |

---

### Human Verification Required

Five items need human testing. All five relate to live service behavior that cannot be verified by static analysis.

#### 1. End-to-end plain-language routine creation (RTN-01)

**Test:** Open the Routines page. Click New routine. Type: "Every weekday at 8am, check my calendar and send me a brief." Click Build draft.
**Expected:** A draft appears showing plain-language schedule ("Every weekday at 8am" or similar), ordered steps with teammate tags, and AutonomySelector. No cron expression visible. Click Save routine — routine appears in the list.
**Why human:** `assembleRoutineDraft` calls `runAgent` (live SDK subprocess). The draft-then-persist split is contract-tested, but the NL->steps quality and the full round-trip require the running service with a real Claude model call.

#### 2. 409 / no-double-fire on run-now (RTN-04)

**Test:** Click Run now on a routine. Immediately click Run now again before the run completes.
**Expected:** First click shows "Run started" toast. Second click shows "Already running" toast (or "Give it a moment"). The routine fires exactly once.
**Why human:** The claim-once invariant is unit-tested, but the timing behavior under real network + UI latency cannot be verified statically.

#### 3. Paused teammate -> degraded outcome (RTN-05 / D-02 / A4)

**Test:** Pause a teammate from the Team page. Create and run a routine whose first step is assigned to that paused teammate.
**Expected:** Run history shows "degraded" (not "failed"). Detail line reports the step was skipped due to paused teammate.
**Why human:** Requires a live paused teammate DB state and real step execution.

#### 4. State-change-only Slack notification (RTN-05 / D-10)

**Test:** Let a routine whose last run was "ok" fail (e.g. break a step's action). Check Slack. Let it fail again on the next scheduled run. Check Slack again.
**Expected:** Exactly one Slack message on the first failure. No second message on the repeat failure.
**Why human:** The `isFirstBreak` guard is unit-tested, but the live Slack transport path requires the running service.

#### 5. No raw cron visible in default operator view (RTN-02 / D-06)

**Test:** Open the Routines page. Expand a routine's detail. Look at the "When" section without clicking Change or Advanced.
**Expected:** A human-readable string like "Every weekday at 8:00am". No cron expression (`* * * *` pattern) visible anywhere in the default view.
**Why human:** `describeCron` usage is verified in code, but rendering correctness requires a visual check in a real browser.

---

### Gaps Summary

No gaps. All five RTN requirements have substantive, wired implementations confirmed at code level. The 5 human verification items are live-service checks, not evidence of missing implementation.

The only open items are:
- **Pre-existing test failures** in `src/schedule-cli.test.ts` (3 agent-routing tests) and `src/dashboard.contract.test.ts` (2 SPA-shell paths `/` and `/warroom`) — both confirmed pre-existing and logged to `deferred-items.md`. Unrelated to routines.
- **Autonomy enforcement** is intentionally deferred to Phase 3 per D-08 — not a gap.
- **Activity/audit views** for routine runs are intentionally deferred per the CONTEXT.md `<deferred>` section — not a gap.

---

_Verified: 2026-06-23T14:22:00Z_
_Verifier: Claude (gsd-verifier)_
