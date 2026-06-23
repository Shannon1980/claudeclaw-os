---
phase: 02-routines
plan: 01
subsystem: testing
tags: [vitest, tdd, routines, scheduler, sqlite, hono, dependency-injection]

# Dependency graph
requires:
  - phase: 01-desktop-shell
    provides: scheduled_tasks table, claimDueTask atomic lock, _initTestDatabase, AosFireDeps DI pattern, dashboard contract harness
provides:
  - Failing (RED) vitest safety net pinning every RTN-01..RTN-05 contract before implementation
  - deriveOutcome D-02 cases (incl. all-continue-fail → failed edge) encoded as assertions
  - claim-once / no-double-fire invariant encoded as an assertion (closes the CONCERNS.md scheduler gap)
  - notify-on-state-change-only (D-10) transition tests
  - draft parse/validation (parseJsonLoose, agent_id roster fallback, cron-valid) tests
  - routine_steps / routine_runs CRUD + autonomy round-trip + /api/routines* contract tests
affects: [02-02-engine, 02-03-api, 02-04-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AosFireDeps-style dependency injection (vi.fn for sender/delegateToAgent/claim/isAgentPaused/runAgent/listAgentIds) — no live DB or SDK subprocess in unit tests"
    - "Pure-function outcome derivation tested like parseTimeout"
    - "Draft-does-not-persist asserted via observable row count, not a stub (T-02-01 mitigation)"

key-files:
  created:
    - src/routine-runner.test.ts
    - src/routine-draft.test.ts
  modified:
    - src/db.test.ts
    - src/dashboard.contract.test.ts
    - src/scheduler.test.ts

key-decisions:
  - "Test import paths use the repo convention './routine-runner.js' / './routine-draft.js' (tests live in src/), not the plan's '../src/...' literal — matches every existing src/*.test.ts."
  - "Injected-deps shape for runRoutineOnce settled as { sender, delegateToAgent, isAgentPaused, getLastRoutineOutcome, claim? } so 02-02 implements against a concrete seam."
  - "Paused-teammate step → recorded skip contributing to a degraded outcome (A4 / RESOLVED open question 2)."

patterns-established:
  - "Wave 0 RED scaffolding: tests import not-yet-existing symbols and are expected to fail with module-not-found / undefined until the implementation wave lands."
  - "VALIDATION.md -t filter substrings (outcome, teammate, notify-transition, cron-valid, routine, routines) are baked into test titles so feedback sampling resolves."

requirements-completed: [RTN-01, RTN-02, RTN-03, RTN-04, RTN-05]

# Metrics
duration: ~6 min
completed: 2026-06-23
---

# Phase 2 Plan 01: Routines Wave 0 Test Scaffolding Summary

**Five RED vitest suites pinning every RTN-01..RTN-05 contract — deriveOutcome (D-02), step threading (D-03), claim-once anti-double-fire, notify-on-state-change-only (D-10), draft parse/validation, and routine_steps/routine_runs/autonomy/`/api/routines*` shapes — so the engine/API/UI waves satisfy a spec, not a vibe.**

## Performance

- **Duration:** ~6 min
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 extended)
- **Test result:** 5 files RED (9 failing for the right reasons), 142 pre-existing tests still green

## Accomplishments

- `src/routine-runner.test.ts` (NEW): deriveOutcome ok/degraded/failed incl. the all-continue-fail → failed edge; runRoutineOnce step_order threading with prior-output forwarding; paused-teammate skip → degraded; claim-once (delegate fires per-step, claim does not); notify-transition fires once on ok→broken and stays silent when already broken.
- `src/routine-draft.test.ts` (NEW): parseJsonLoose fence-strip + prose regex-fallback + null-on-no-JSON; assembleRoutineDraft validates agent_id against a mocked roster (unknown → 'main'); cron-valid rejects un-parseable cron and accepts a valid one. runAgent mocked everywhere.
- `src/db.test.ts` (EXTEND): routine_steps + routine_runs round-trips, autonomy column default 'unattended', getLastRoutineOutcome ordering — all via `_initTestDatabase()` real in-memory SQLite.
- `src/dashboard.contract.test.ts` (EXTEND): GET /api/routines shape + auth gate, POST /api/routines/draft draft-does-not-persist (row count unchanged), POST /api/routines/:id/run 409-when-claimed.
- `src/scheduler.test.ts` (EXTEND): source='routine' claim-once (closes the CONCERNS.md double-claim gap) + paused-owner skip.

## Task Commits

1. **Task 1: Author routine-runner + routine-draft engine tests (RED)** - `cf9e76d` (test)
2. **Task 2: Extend db, dashboard-contract, and scheduler tests (RED)** - `02117c1` (test)

_TDD RED scaffolding plan: only `test(...)` commits exist by design — the GREEN/feat commits land in 02-02/02-03/02-04._

## Files Created/Modified

- `src/routine-runner.test.ts` - deriveOutcome + runRoutineOnce contract tests (D-02/D-03/D-10, claim-once, paused-teammate)
- `src/routine-draft.test.ts` - parseJsonLoose + assembleRoutineDraft (roster validation, cron-valid)
- `src/db.test.ts` - routine_steps/routine_runs CRUD, autonomy column, getLastRoutineOutcome
- `src/dashboard.contract.test.ts` - /api/routines list/draft/run shapes, auth gate, draft-no-persist
- `src/scheduler.test.ts` - source='routine' claim-once + paused-owner skip

## Decisions Made

- Test import paths follow the repo's actual convention (`'./routine-runner.js'`, sibling in `src/`) rather than the plan's literal `'../src/routine-runner'`, which would not resolve from inside `src/`. Every existing `src/*.test.ts` uses the sibling form. No behavioral change to what is tested.
- Fixed the `runRoutineOnce` injected-deps contract (`{ sender, delegateToAgent, isAgentPaused, getLastRoutineOutcome, claim? }`) so 02-02 has a concrete seam to implement against. This is the natural consequence of encoding D-10 (needs prior outcome) and A4 (needs paused check) as injected, mockable functions.

## Deviations from Plan

### Adjustments

**1. [Rule 3 - Blocking] Test import path corrected to repo convention**
- **Found during:** Task 1
- **Issue:** The plan's `<action>` says import from `'../src/routine-runner'`. Tests live in `src/`, so that path resolves outside the module tree and would be a harness error rather than a clean RED. The acceptance criterion only requires importing the symbols from the routine-runner/routine-draft modules.
- **Fix:** Used `'./routine-runner.js'` / `'./routine-draft.js'`, matching every existing `src/*.test.ts` (e.g. scheduler.aos.test.ts). RED is now a true module-not-found, not a path typo.
- **Files modified:** src/routine-runner.test.ts, src/routine-draft.test.ts
- **Verification:** `npx vitest run` reports `Failed to load url ./routine-runner.js ... Does the file exist?` (clean RED); 142 pre-existing tests unaffected.
- **Committed in:** cf9e76d

---

**Total deviations:** 1 (1 blocking path correction). **Impact:** None on coverage — all required symbols and `-t` filter substrings are present; the change only makes the RED state attributable to absent implementation rather than a test-harness error.

## Issues Encountered

None. The RED state is the intended deliverable for a Wave 0 TDD scaffolding plan.

## TDD Gate Compliance

This is a `type: tdd` RED-only scaffolding plan. The expected end state is **RED** (tests fail because the implementation does not exist yet). Both task commits are `test(...)` commits (the RED gate). The corresponding GREEN gate (`feat(...)`) is intentionally deferred to the implementation waves:
- 02-02 turns the engine + DB tests green (routine-runner.ts, routine-draft.ts, db CRUD, migration).
- 02-03 turns the `/api/routines*` contract tests green.
- 02-04 turns any remaining UI-adjacent assertions green.

No GREEN/feat commit is missing in error — forcing these green now would require writing the production code this plan explicitly forbids.

## Verification Results

- `npx vitest run src/routine-runner.test.ts src/routine-draft.test.ts src/db.test.ts src/dashboard.contract.test.ts src/scheduler.test.ts` → **5 files RED** (9 failing: module-not-found for routine-runner/routine-draft, `getRoutineSteps`/`saveRoutineRun`/`getLastRoutineOutcome` not a function, missing `autonomy` column, missing `/api/routines*` routes). **142 pre-existing tests still pass.**
- VALIDATION.md `-t` filter substrings all resolve to authored titles: `outcome`, `teammate`, `notify-transition`, `cron-valid` (engine), `routine` (db + scheduler), `routines` (contract).
- No production source created or modified (`src/routine-runner.ts`, `src/routine-draft.ts` absent; `src/db.ts`, `src/dashboard.ts`, `src/scheduler.ts` unchanged).

## Next Phase Readiness

- Wave 0 safety net complete and RED. 02-02 (engine + DB + migration) is unblocked: implement `deriveOutcome`, `runRoutineOnce`, the `routine_steps`/`routine_runs` tables + autonomy column + CRUD, and `assembleRoutineDraft`/`parseJsonLoose` to turn these tests green.
- The injected-deps contract for `runRoutineOnce` is fixed by the tests — 02-02 must match `{ sender, delegateToAgent, isAgentPaused, getLastRoutineOutcome }` (plus an optional `claim`).
- Migration landmine reminder (carried from RESEARCH Pitfall 3 / MEMORY.md): 02-02 must dual-write the `autonomy` column (`addColumnIfMissing` in `runMigrations` AND a versioned `migrations/v1.2.2/` file) or the live service crash-loops on restart.

## Self-Check: PASSED

- `src/routine-runner.test.ts` — FOUND
- `src/routine-draft.test.ts` — FOUND
- `src/db.test.ts` / `src/dashboard.contract.test.ts` / `src/scheduler.test.ts` — FOUND (extended)
- Commit `cf9e76d` — FOUND
- Commit `02117c1` — FOUND

---
*Phase: 02-routines*
*Completed: 2026-06-23*
