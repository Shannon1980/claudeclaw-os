---
phase: 07-single-scheduler
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, migrations, scheduler, atomic-claim, aos-cron]

# Dependency graph
requires:
  - phase: 06-memory-bridge
    provides: agent_id-scoped scheduled_tasks (getDueTasks/resetStuckTasks already filter by agent_id)
provides:
  - Versioned migration v1.1.1 adding aos-cron columns (source, job_path, model, timeout, notify, retry) to scheduled_tasks
  - claimDueTask(id, nextRun) atomic cross-process claim (SCH-04 single-winner backstop)
  - Extended ScheduledTask type with the six aos-cron columns
  - aos-scoped row helpers: upsertAosCronTask, deactivateAosCronTask, getAosCronTaskIds
affects: [07-02-aos-cron-sync, 07-scheduler-firing-loop, aos-launchd-service]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic claim = UPDATE ... WHERE id=? AND status='active' + changes===1 check (cross-process single-winner)"
    - "aos-cron rows scoped agent_id='aos', source='aos-cron' so main/aos loops never contend"
    - "Columns ship as versioned migration (production DB) AND mirrored in runMigrations via addColumnIfMissing (test/runtime parity); createSchema left untouched per D-09"
    - "Orphan handling pauses, never DELETEs, to preserve last_result history (D-07)"

key-files:
  created:
    - migrations/v1.1.1/add-aos-cron-scheduled-task-columns.ts
  modified:
    - src/db.ts
    - src/db.test.ts
    - migrations/version.json
    - package.json
    - CHANGELOG.md

key-decisions:
  - "Migration version v1.1.1 (patch bump from package.json 1.1.0; version.json was empty, so this is the first registered migration)"
  - "source defaults to 'user' so pre-existing user-created tasks stay distinct from 'aos-cron' rows"
  - "Mirror the six columns in runMigrations (not createSchema) so the in-memory test DB reaches column parity without running the versioned migration — consistent with how agent_id/started_at already work"
  - "upsertAosCronTask uses INSERT ... ON CONFLICT(id) DO UPDATE for idempotent one-row-per-job upsert"

patterns-established:
  - "Atomic claim with status predicate + changes check (claimDueTask) — the SCH-04 cross-process backstop"
  - "aos-cron row helpers all scoped to agent_id='aos' AND source='aos-cron'"

requirements-completed: [SCH-02, SCH-03, SCH-04]

# Metrics
duration: 5min
completed: 2026-06-17
---

# Phase 7 Plan 01: aos-cron DB Foundation Summary

**Versioned migration adding six aos-cron columns to scheduled_tasks plus the db.ts primitives the firing loop depends on: an atomic cross-process claim (claimDueTask), an extended ScheduledTask type, and aos-scoped upsert/deactivate/id-list helpers.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-17T21:12:33Z
- **Completed:** 2026-06-17T21:17:09Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 6

## Accomplishments
- Registered + applied migration `v1.1.1` adding `source`, `job_path`, `model`, `timeout`, `notify`, `retry` to `scheduled_tasks`; each ADD COLUMN guarded by `PRAGMA table_info` (idempotent re-run proven), pre-existing rows preserved with `source='user'`.
- `claimDueTask(id, tentativeNextRun)`: `UPDATE ... WHERE id=? AND status='active'` returning `changes === 1` — the SCH-04 cross-process single-winner backstop, proven by a unit test (true once, false on second claim). `markTaskRunning` kept intact for existing callers.
- Extended `ScheduledTask` type with the six new fields; `npx tsc --noEmit` clean.
- aos-scoped helpers: `upsertAosCronTask` (idempotent one-row-per-job upsert, dormant `active:false` → paused), `deactivateAosCronTask` (pauses, never DELETEs — D-07), `getAosCronTaskIds` (orphan-set computation).

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **RED — failing tests for columns, claim, helpers** - `fa74d10` (test)
2. **Task 1: Versioned migration adding aos-cron columns** - `6eb78a0` (feat)
3. **Task 2: claimDueTask, extended type, aos-cron row helpers** - `ace0a6a` (feat)

_REFACTOR phase: not needed (code clean as written)._

## Files Created/Modified
- `migrations/v1.1.1/add-aos-cron-scheduled-task-columns.ts` - Migration opening its own better-sqlite3 handle (`process.cwd()/store/claudeclaw.db`), adding the six columns each guarded by a `PRAGMA table_info` existence check.
- `migrations/version.json` - First registered migration under key `v1.1.1`.
- `package.json` - version bumped 1.1.0 → 1.1.1 to match migration key.
- `CHANGELOG.md` - v1.1.1 entry (per add-migration skill step 8).
- `src/db.ts` - Extended `ScheduledTask`; added `claimDueTask`, `upsertAosCronTask`, `deactivateAosCronTask`, `getAosCronTaskIds`, test-only `_getScheduledTaskColumns`; mirrored the six columns in `runMigrations` via `addColumnIfMissing`.
- `src/db.test.ts` - 8 new tests (columns present, source default, claim single-winner, idempotent upsert, dormant=paused, deactivate=paused, id scoping).

## Decisions Made
- **Migration version `v1.1.1`**: patch bump from `package.json` 1.1.0 per the add-migration skill; `version.json` was empty so this is the first registered migration.
- **`source` default `'user'`**: keeps existing user tasks distinct from `'aos-cron'` rows (T-07-01 safe additive default).
- **Mirror columns in `runMigrations`, not `createSchema`**: D-09 forbids inline ALTER in `createSchema`. The in-memory test DB runs `createSchema` + `runMigrations(db)` but NOT the versioned `migrations/` files, so the six columns are mirrored in `runMigrations` via the existing `addColumnIfMissing` helper for test/runtime parity — exactly how `agent_id`/`started_at`/`last_status` already work. The versioned migration remains the source of truth for the production DB. `createSchema` (the bare CREATE TABLE) is untouched, satisfying the acceptance criterion.

## Deviations from Plan

None - plan executed exactly as written. The `runMigrations` mirroring is the existing in-repo convention for test-DB column parity (and the proven approach from reference commit 227ce90), not a deviation from `createSchema` (which D-09 specifically names and which stays untouched).

## Issues Encountered
- **No `store/claudeclaw.db` / `.env` in the worktree.** `npm run migrate` treated the worktree as a fresh install (auto-init `.applied.json`). To genuinely exercise the migration `run()` body and prove idempotency, a throwaway `store/claudeclaw.db` was seeded with a `scheduled_tasks` table + one pre-existing row, the migration was applied (confirmed via the plan's exact `PRAGMA table_info` verify), re-run for idempotency (no-op), and the throwaway DB/backup were removed afterward (`store/` is gitignored). Resolved within the task.

## Out-of-Scope Discoveries
- `src/schedule-cli.test.ts` has 3 pre-existing failing integration tests that shell out to `node dist/schedule-cli.js` and require `DB_ENCRYPTION_KEY` from a `.env` (absent in this worktree). Unrelated to the db.ts changes here (`src/db.test.ts` 58/58 pass; `src/scheduler.test.ts` 27/27 pass). Logged to `deferred-items.md`; not fixed (scope boundary).

## TDD Gate Compliance
Both tasks followed RED → GREEN. RED commit `fa74d10` (8 failing tests). GREEN commits `6eb78a0` (migration) and `ace0a6a` (db.ts). REFACTOR not required.

## User Setup Required
None - no external service configuration. The migration applies via `npm run migrate` against the live `store/claudeclaw.db` (must run before bot restart per D-09, since `checkPendingMigrations` exits the bot if a registered migration is unapplied).

## Next Phase Readiness
- DB foundation ready for the aos-cron sync service (07-02): `upsertAosCronTask` / `deactivateAosCronTask` / `getAosCronTaskIds` are the CRUD projection surface; `getDueTasks('aos')` is the aos read path.
- `claimDueTask` ready for the aos firing loop as the SCH-04 cross-process backstop.
- **Deploy note:** run `npm run migrate` on the live DB before restarting the service (D-09).

## Self-Check: PASSED

- FOUND: migrations/v1.1.1/add-aos-cron-scheduled-task-columns.ts
- FOUND: .planning/phases/07-single-scheduler/07-01-SUMMARY.md
- FOUND commit fa74d10 (RED tests)
- FOUND commit 6eb78a0 (Task 1 migration)
- FOUND commit ace0a6a (Task 2 db.ts)

---
*Phase: 07-single-scheduler*
*Completed: 2026-06-17*
