---
phase: 02-routines
plan: 03
subsystem: api
tags: [routines, scheduler, hono, dashboard, llm-draft, cron, sqlite]

# Dependency graph
requires:
  - phase: 02-routines (02-01)
    provides: RED contract tests (routine-draft.test.ts, dashboard.contract.test.ts routines block)
  - phase: 02-routines (02-02)
    provides: routine_steps/routine_runs tables, autonomy column, triggerRoutineRun, claimDueTask, computeNextRun, saveRoutineSteps, getRoutineSteps/Runs/LastOutcome
provides:
  - "src/routine-draft.ts: assembleRoutineDraft (NL -> validated {cron, schedule_text, steps[]}) + parseJsonLoose"
  - "/api/routines* HTTP surface: list, detail, draft (no persist), create, edit/reorder, delete, pause, resume, run-now"
  - "Run-now reuses the scheduler's single claim path (no double-fire)"
affects: [02-04 (routines UI / web), phase-3 (autonomy enforcement)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-side LLM structured-output assembly via one constrained runAgent call (browser never calls runAgent)"
    - "parseJsonLoose (fence-strip + first-{...}-block fallback) as the shared loose JSON-from-LLM parser"
    - "Run-now delegates to triggerRoutineRun which owns the single claimDueTask (never a second claim path)"

key-files:
  created:
    - src/routine-draft.ts
  modified:
    - src/dashboard.ts
    - src/db.ts

key-decisions:
  - "Run-now calls triggerRoutineRun (which does the single claimDueTask internally) rather than claiming in the route then calling it, to honor the no-double-fire landmine"
  - "createScheduledTask gained optional source/autonomy params (defaulting to 'user'/'unattended') instead of adding a separate createRoutine helper"
  - "Draft endpoint returns the assembler's JSON verbatim and writes no rows (D-05); an invalid assembled cron maps to a friendly 400, never a 500"

patterns-established:
  - "Pattern: /api/routines* mirrors /api/tasks* behind the same DASHBOARD_TOKEN gate (no new auth surface)"
  - "Pattern: operator-facing routine fields carry schedule_text/plain-language; raw cron is internal only (RTN-02/D-06)"

requirements-completed: [RTN-01, RTN-02, RTN-04]

# Metrics
duration: 11 min
completed: 2026-06-23
---

# Phase 2 Plan 03: Routines Slice B (creation + control over HTTP) Summary

**Server-side NL-to-routine draft assembler (constrained runAgent call) plus the full /api/routines* surface — list, detail, draft (no persist), create/edit/reorder/delete, pause/resume, and run-now sharing the scheduler's one-claim lock.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-06-23T17:51:00Z
- **Completed:** 2026-06-23T18:02:32Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- `assembleRoutineDraft` turns a plain-language description into a validated `{cron, schedule_text, steps[]}` draft via one constrained `runAgent` call: agent_id coerced against the roster (unknown -> 'main'), on_error defaulted to 'continue' (D-01), cron validated by `computeNextRun`, empty steps rejected, action length capped (V5). Unparseable model output returns a friendly `{error}`, never a 500.
- `parseJsonLoose` copied verbatim from `warroom-text-router` (fence-strip + first-`{...}`-block fallback), exported as the shared loose parser.
- Full `/api/routines*` route surface behind the existing token auth gate: list + detail (row + steps + runs), draft (writes nothing — D-05), create (cron + autonomy + on_error enum validation, source='routine', agent_id='main'), PUT/PATCH edit + reorder, DELETE (FK cascade), pause/resume (RTN-04), and run-now (409-guarded).
- Run-now reuses `triggerRoutineRun`'s single `claimDueTask` lock — a manual run and a scheduled tick can never double-fire the same routine.

## Task Commits

1. **Task 1: routine-draft assembler (NL -> cron + steps JSON)** - `aec53d5` (feat) — turns `src/routine-draft.test.ts` GREEN (6/6)
2. **Task 2: /api/routines* routes (CRUD, draft, pause/resume, run-now, history)** - `901a23a` (feat) — turns `src/dashboard.contract.test.ts -t routines` GREEN (3/3)

_Note: the RED tests were authored in 02-01; this plan supplied the GREEN implementations._

## Files Created/Modified
- `src/routine-draft.ts` (created) - `assembleRoutineDraft` + `parseJsonLoose`; the only place the SDK subprocess runs for drafts.
- `src/dashboard.ts` (modified) - `/api/routines*` routes (list, detail, draft, create, edit/reorder, delete, pause, resume, run-now) plus `buildRoutineSteps`/`enrichRoutine`/`listRoutines` helpers, behind the existing `DASHBOARD_TOKEN` gate.
- `src/db.ts` (modified) - `createScheduledTask` extended with optional `source`/`autonomy` params (back-compat defaults `'user'`/`'unattended'`) so a routine row persists `source='routine'` + its autonomy mode.

## Decisions Made
- **Run-now claim path:** the route calls `triggerRoutineRun(task, nextRun)` and 409s when it returns false. `triggerRoutineRun` already performs the single `claimDueTask` + `runningTaskIds` guard, so claiming in the route too would double-claim and break run-now. This honors the load-bearing no-double-fire landmine.
- **createScheduledTask extension** over a new `createRoutine` helper — minimal change, every existing caller is unchanged via defaults.
- **Draft = read-only:** the draft handler returns the assembler JSON and persists nothing (D-05, contract-test-asserted); an invalid assembled cron surfaces as a 400, never a 500.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended `createScheduledTask` to accept `source`/`autonomy`**
- **Found during:** Task 2 (create route)
- **Issue:** The plan said "createScheduledTask with source='routine' ... and the autonomy value", but the existing `createScheduledTask` signature (`id, prompt, schedule, nextRun, agentId`) had no `source`/`autonomy` parameters and its INSERT omitted both columns — a routine row would have persisted as `source='user'`, breaking `listRoutines()` filtering.
- **Fix:** Added optional trailing `source = 'user'` and `autonomy = 'unattended'` params and included both columns in the INSERT. Back-compat: all existing callers keep the prior behavior via defaults.
- **Files modified:** src/db.ts
- **Verification:** `npm run typecheck` clean; routines contract test GREEN; full affected suites (db.test, routine-runner.test, scheduler.test) still 189 passing.
- **Committed in:** 901a23a (Task 2 commit)

**2. [Rule 1 - Bug avoidance] Run-now uses triggerRoutineRun's single claim instead of double-claiming**
- **Found during:** Task 2 (run-now route)
- **Issue:** The plan's literal route sketch (`if (!claimDueTask(id, nextRun)) return 409; else triggerRoutineRun(task, nextRun)`) would claim the task in the route AND again inside `triggerRoutineRun`, so the inner claim would always fail (already 'running') and the routine would never actually fire — a double-claim bug.
- **Fix:** The route computes nextRun, then calls `triggerRoutineRun(task, nextRun)` directly; it returns false (-> 409) when the claim is lost. Single claim path preserved.
- **Files modified:** src/dashboard.ts
- **Verification:** `POST /api/routines/already-running/run` returns 409 (contract test GREEN); the shared claim mechanism is unchanged.
- **Committed in:** 901a23a (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug avoidance).
**Impact on plan:** Both were necessary for correctness — the db extension makes routine rows persist correctly, and the run-now adjustment honors the explicit no-double-fire landmine. No scope creep.

## Issues Encountered
- **Pre-existing contract-test failures (out of scope):** `src/dashboard.contract.test.ts > auth gate > serves SPA shell at /` and `... at /warroom` fail with `expected 401 not to be 401`. Verified these fail identically on commit `aec53d5` (before any dashboard.ts edits in this plan), so they are pre-existing and unrelated to routines. Logged to `.planning/phases/02-routines/deferred-items.md`; not fixed (scope boundary).

## User Setup Required
None - no external service configuration required. The draft endpoint runs the existing Claude Agent SDK path (no new keys); routines mount behind the existing `DASHBOARD_TOKEN`.

## Next Phase Readiness
- All Phase 2 backend tests are GREEN (routine-draft 6/6, routines contract 3/3, plus 02-02 data/runner suites). Only the Wave 4 UI (web/ Routines page + components) remains.
- The `/api/routines*` response shapes (`{ routines: [...] }`, `{ routine, steps, runs }`, draft `{ cron, schedule_text, steps[] }`) are the contract the Wave 4 frontend builds against.

## TDD Gate Compliance
RED tests for both tasks were authored in 02-01 (`test(...)` gate satisfied upstream). This plan supplied the GREEN `feat(...)` commits (`aec53d5`, `901a23a`). No REFACTOR commit was needed.

## Self-Check: PASSED
- `src/routine-draft.ts` exists on disk (created).
- Commits `aec53d5` (Task 1) and `901a23a` (Task 2) present in `git log`.
- `npx vitest run src/routine-draft.test.ts` -> 6/6 GREEN.
- `npx vitest run src/dashboard.contract.test.ts -t routines` -> 3/3 GREEN.
- `npm run typecheck` -> clean.

---
*Phase: 02-routines*
*Completed: 2026-06-23*
