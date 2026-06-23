---
phase: 02-routines
plan: 02
subsystem: database
tags: [routines, scheduler, sqlite, better-sqlite3, migration, delegateToAgent, cron]

# Dependency graph
requires:
  - phase: 02-routines (02-01)
    provides: failing RED tests for db routine CRUD, routine-runner, scheduler routine branch
  - phase: 07 (aos-cron)
    provides: claimDueTask atomic lock, AosFireDeps DI pattern, messageQueue serialization, versioned-migration dual-write precedent
provides:
  - routine_steps + routine_runs companion tables (FK CASCADE to scheduled_tasks)
  - autonomy column on scheduled_tasks via mandatory dual-write migration (runMigrations + v1.2.2 + version.json)
  - parameterized routine CRUD (getRoutineSteps, saveRoutineSteps, saveRoutineRun, getRoutineRuns, getLastRoutineOutcome)
  - src/routine-runner.ts (deriveOutcome pure fn + runRoutineOnce multi-step engine + StepResult)
  - scheduler source==='routine' firing branch + triggerRoutineRun run-now wrapper
affects: [02-03 (run-now route + dashboard routes reuse triggerRoutineRun), 02-04 (run history UI reads routine_runs), 03-permissions (autonomy enforcement gate)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Companion-table FK CASCADE (warroom_transcript analog) for routine_steps/routine_runs"
    - "Mandatory dual-write migration: addColumnIfMissing in runMigrations AND versioned migrations/vX file + version.json bump"
    - "DI-injectable runner (AosFireDeps shape) with safe-default real DB fns + try/catch persistence"
    - "Pure deriveOutcome fn (parseTimeout-style) for unit-testable outcome derivation"

key-files:
  created:
    - src/routine-runner.ts
    - migrations/v1.2.2/add-routine-tables.ts
  modified:
    - src/db.ts
    - src/scheduler.ts
    - migrations/version.json

key-decisions:
  - "saveRoutineRun signature is (routineId, outcome, stepResults[], detail, output?) — matches the 02-01 RED test contract (output optional, capped 4000 chars)"
  - "getLastRoutineOutcome/getRoutineRuns order by ran_at DESC, id DESC so same-second ties are deterministic"
  - "Runner persistence (saveRoutineRun/updateTaskAfterRun) is injectable and wrapped in try/catch so a history-write failure never crashes an executed run"
  - "triggerRoutineRun exported from scheduler.ts as the shared one-claim+enqueue mechanism for 02-03 run-now"
  - "Recovery (failed/degraded -> ok) notification is silent (D-10 discretion)"

patterns-established:
  - "Routine = scheduled_tasks row (source='routine') + routine_steps/routine_runs companions"
  - "One claimDueTask per routine RUN, never per step (anti-double-fire invariant preserved)"
  - "State-change notify via injected in-process sender, never scripts/notify.sh"

requirements-completed: [RTN-03, RTN-04, RTN-05]

# Metrics
duration: 8min
completed: 2026-06-23
---

# Phase 2 Plan 02: Routines Data Layer + Execution Engine Summary

**routine_steps/routine_runs companion tables + autonomy column via dual-write migration, plus a multi-step routine-runner (pure deriveOutcome + claim-once runRoutineOnce with per-step teammate delegation, prior-output threading, paused-skip→degraded, and ok→broken state-change notify) wired into the scheduler's source='routine' branch**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-23T17:45:00Z
- **Completed:** 2026-06-23T17:53:28Z
- **Tasks:** 2 (both TDD GREEN)
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- Turned the 02-01 RED engine tests GREEN: db routine CRUD (5), routine-runner (11), scheduler routine branch (2) — all passing
- Added routine_steps + routine_runs companion tables (FK CASCADE) to createSchema and parameterized CRUD (no string-concat — SQLi mitigated, T-02-03)
- Shipped the mandatory dual-write autonomy migration: addColumnIfMissing in runMigrations AND migrations/v1.2.2/add-routine-tables.ts + version.json v1.2.2 entry (prevents the checkPendingMigrations crash-loop, T-02-06)
- Built src/routine-runner.ts: pure deriveOutcome (D-02, incl. all-continue-fail→failed edge), runRoutineOnce running ordered steps as their teammates via delegateToAgent with prior-output threading (D-03), paused-step skip→degraded (A4), and a single ok→broken state-change alert via the in-process sender (D-09/D-10)
- Wired the scheduler source==='routine' branch (claims exactly once, runningTaskIds guard, messageQueue.enqueue) and exported triggerRoutineRun for 02-03's run-now path
- Threaded task.autonomy into step exec context (D-07) with NO enforcement gate (D-08)

## Task Commits

1. **Task 1: Schema + dual-write migration + routine CRUD** - `a0d3b3a` (feat)
2. **Task 2: routine-runner (deriveOutcome + runRoutineOnce) + scheduler branch** - `e856c5f` (feat)

_TDD: the RED tests were authored in Wave 1 (02-01, commit cf9e76d); this plan implements them GREEN, so each task is a single feat commit turning its RED suite green._

## Files Created/Modified
- `src/db.ts` - routine_steps/routine_runs tables in createSchema, autonomy column in runMigrations, ScheduledTask.autonomy field, RoutineStep/RoutineRun interfaces, 5 parameterized CRUD fns
- `migrations/v1.2.2/add-routine-tables.ts` - versioned production migration (own Database handle at process.cwd()/store/claudeclaw.db, idempotent CREATE IF NOT EXISTS + PRAGMA-guarded autonomy ALTER, finally db.close())
- `migrations/version.json` - registered "v1.2.2": ["add-routine-tables"]
- `src/routine-runner.ts` - StepResult, deriveOutcome (pure), runRoutineOnce (DI deps, claim-once, threading, paused-skip, state-change notify)
- `src/scheduler.ts` - source==='routine' firing branch + exported triggerRoutineRun wrapper

## Decisions Made
- **saveRoutineRun(routineId, outcome, stepResults[], detail, output?)** — matched the 02-01 RED test's 4-arg call shape (output optional). This differs from the plan prose which listed `(routineId, outcome, detail, output, stepResults)`; the test contract is authoritative.
- **saveRoutineSteps (not replaceRoutineSteps)** — the db test imports `saveRoutineSteps`; implemented as delete-then-insert in a transaction (the plan's "replaceRoutineSteps" intent, under the test's name).
- **ran_at DESC, id DESC tiebreaker** — runs written in the same wall-clock second would tie on ran_at; the id tiebreaker makes "most recent" deterministic (required for getLastRoutineOutcome's D-10 transition check).
- **Injectable persistence + try/catch** — runner accepts optional saveRoutineRun/updateTaskAfterRun deps (defaulting to the real DB fns) and wraps the writes in try/catch, so the pure unit tests run without an initialized DB and a real history-write failure never crashes an already-executed run.
- **Recovery notification silent** — failed/degraded→ok emits nothing (D-10 discretion).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Deterministic ordering for same-second routine runs**
- **Found during:** Task 1 (getLastRoutineOutcome db test)
- **Issue:** `ORDER BY ran_at DESC` alone is non-deterministic when two runs land in the same second (ran_at is second-granularity); the test wrote 'ok' then 'failed' in the same second and expected 'failed', which failed intermittently/by insertion-independent ordering.
- **Fix:** Added `, id DESC` tiebreaker to getLastRoutineOutcome and getRoutineRuns.
- **Files modified:** src/db.ts
- **Verification:** db.test.ts -t routine now 5/5 GREEN.
- **Committed in:** a0d3b3a (Task 1 commit)

**2. [Rule 3 - Blocking] Injectable + crash-safe runner persistence**
- **Found during:** Task 2 (routine-runner.test.ts + scheduler.test.ts paused-owner)
- **Issue:** The 02-01 RED unit tests call runRoutineOnce without initializing the DB (and the scheduler paused-owner test passes a task whose row isn't persisted), so the runner's direct saveRoutineRun/updateTaskAfterRun calls threw (`db undefined` / `FOREIGN KEY constraint failed`).
- **Fix:** Made saveRoutineRun/updateTaskAfterRun injectable deps (default to the real fns) and wrapped the persistence in try/catch — a bookkeeping failure logs and continues rather than crashing the executed run.
- **Files modified:** src/routine-runner.ts
- **Verification:** routine-runner.test.ts 11/11, scheduler.test.ts 29/29 GREEN.
- **Committed in:** e856c5f (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both necessary to satisfy the authoritative 02-01 RED test contracts; the crash-safe persistence is also a correctness improvement for production (a history-write hiccup shouldn't lose an executed run). No scope creep.

## Issues Encountered
- The plan prose and the 02-01 RED tests disagreed on `saveRoutineRun`/`saveRoutineSteps` signatures and names. Resolved in favor of the test contract (tests are the GREEN target). Documented under Decisions Made.

## Threat Flags
None — no security surface beyond the threat_model. Parameterized SQL throughout (T-02-03), claim-once preserved (T-02-04), delegateToAgent carries the existing TASK_TIMEOUT_MS bound (T-02-05), dual-write migration present (T-02-06), autonomy stored-not-enforced (T-02-02, D-08 honesty).

## Known Stubs
None. The autonomy field is stored and threaded into step context but intentionally NOT enforced — enforcement is Phase 3 (D-08). This is a documented forward-compatible carry, not a stub.

## Migration Note
`npm run migrate` is NOT required for this plan (no live restart performed here). The migration files are correct and version.json is registered; the operator must run `npm run migrate` before restarting the live service, per CLAUDE.md.

## Test / Typecheck Status
- `npx vitest run src/db.test.ts src/routine-runner.test.ts src/scheduler.test.ts -t routine` — GREEN
- Full db + scheduler + aos suites: 164/164 passing (no regressions)
- `npm run typecheck` — clean for all plan files. ONE pre-existing error remains: `src/routine-draft.test.ts` cannot find `./routine-draft.js` — that module is Wave 3 (02-03/04) scope and the test is a deliberately-RED 02-01 fixture (commit cf9e76d). Out of scope for this plan per phase context ("draft + dashboard contract tests stay RED until Wave 3").

## Next Phase Readiness
- 02-03 can build the /api/routines* routes and run-now path on top of triggerRoutineRun (shared one-claim+enqueue) and the routine CRUD.
- 02-04 run-history UI can read routine_runs (outcome/detail/output/step_results/ran_at).
- Phase 3 can add the autonomy enforcement gate; the field is already stored and threaded into step context.
- Blocker for live deploy: operator must `npm run migrate` (applies v1.2.2) before restarting the service.

## Self-Check: PASSED
- src/routine-runner.ts — FOUND
- migrations/v1.2.2/add-routine-tables.ts — FOUND
- .planning/phases/02-routines/02-02-SUMMARY.md — FOUND
- Commit a0d3b3a (Task 1) — FOUND
- Commit e856c5f (Task 2) — FOUND
- Routine test suites (db/runner/scheduler) GREEN; 164/164 in db+scheduler+aos; typecheck clean for plan files (only pre-existing Wave 3 routine-draft.test.ts RED remains)

---
*Phase: 02-routines*
*Completed: 2026-06-23*
