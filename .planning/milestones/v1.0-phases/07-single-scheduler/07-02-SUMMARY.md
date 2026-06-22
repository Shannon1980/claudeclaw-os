---
phase: 07-single-scheduler
plan: 02
subsystem: infra
tags: [cron, scheduler, js-yaml, cron-parser, agentic-os, aos-cron]

# Dependency graph
requires:
  - phase: 07-01
    provides: "scheduled_tasks aos-cron columns (source/job_path/model/timeout/notify/retry) + db.ts helpers upsertAosCronTask / deactivateAosCronTask / getAosCronTaskIds + ScheduledTask type"
provides:
  - "src/aos-cron.ts: syncAosCronJobs() startup sync service"
  - "parseJobFile() YAML frontmatter + body parser with defensive active/retry coercion"
  - "toCron() D-08a schedule grammar -> cron string mapping feeding computeNextRun"
  - "deactivate-orphan (D-07) and dormant-job lifecycle for aos-cron rows"
affects: [07-04 aos firing loop, 07-05 launchd cutover, single-scheduler]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Derived projection: cron/jobs/*.md -> scheduled_tasks rows, read-only on FS, DB is the projection"
    - "Single scheduling engine: toCron emits plain cron strings funneled into the existing computeNextRun (no second engine)"
    - "Optional dir-override arg on syncAosCronJobs(jobsDir?) for unit testing without mocking agent-config"

key-files:
  created:
    - "src/aos-cron.ts"
    - "src/aos-cron.test.ts"
  modified: []

key-decisions:
  - "syncAosCronJobs(jobsDir?) takes an optional dir override so tests inject a tmpdir; production resolves <aos project_dir>/cron/jobs via resolveAgentRuntime('aos')"
  - "Job id is the slugified frontmatter `name` (fallback filename stem) — stable across runs for idempotent upsert"
  - "daysToCronField throws on unknown day tokens (never silently defaults to *) so a bad job is skipped, not mis-fired daily"
  - "Borrowed proven parse/translate/orphan logic from the superseded claude/priceless-ramanujan-08913d:src/cron-sync.ts, adapted to 07-01 db.ts helper API and the aos-cron.ts file layout"

patterns-established:
  - "Per-file try/catch in sync loop: one malformed job logs+skips, never aborts the whole sync (T-07-04)"
  - "Orphan rows paused via deactivateAosCronTask, never deleted, preserving last_result (D-07)"

requirements-completed: [SCH-02]

# Metrics
duration: 6min
completed: 2026-06-17
---

# Phase 07 Plan 02: aos-cron Sync Service Summary

**syncAosCronJobs() reads agentic-os cron/jobs/*.md, maps the D-08a time/days grammar (and raw cron) into cron strings for the existing computeNextRun engine, and upserts one scoped scheduled_tasks row per job with dormant + deactivate-orphan lifecycle.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-17T17:23Z
- **Completed:** 2026-06-17T17:26Z
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments
- `parseJobFile()` splits YAML frontmatter from the prompt body and defensively coerces quoted `active` -> boolean and `retry` -> integer (missing -> 0).
- `toCron()` implements the full D-08a grammar: raw `cron:` passthrough, `every_Nm`/`every_Nh` intervals, exact `HH:MM`, multi-time `HH:MM,HH:MM` collapsed to a single comma cron string (one row), and days daily/weekdays/weekends/single/list. Every emitted string round-trips through CronExpressionParser/computeNextRun.
- `syncAosCronJobs()` projects each job to exactly one `agent_id='aos'`, `source='aos-cron'` row via 07-01's `upsertAosCronTask`; dormant jobs (incl. `nightly-memsearch-index`) stay paused and are never reactivated; orphaned rows are paused (never deleted) via `deactivateAosCronTask`, preserving `last_result` (D-07). Sync is read-only on the filesystem.

## Task Commits

Each task was committed atomically:

1. **Task 1: Frontmatter+body parser and time/days->cron mapping** - `4504c79` (feat)
2. **Task 2: syncAosCronJobs() upsert + deactivate-orphan lifecycle** - `d945208` (feat)

_Task 1 is tdd="true"; parser + mapping shipped with a test-first suite. The two source files are shared across both tasks, so each commit scopes the test additions to its task's behavior._

## Files Created/Modified
- `src/aos-cron.ts` - Sync service: parseJobFile, toCron + daysToCronField mapping, syncAosCronJobs upsert/orphan lifecycle. Uses 07-01 db.ts helpers and computeNextRun; no reinvented SQL.
- `src/aos-cron.test.ts` - 46 tests: grammar table (each D-08a row + multi-time single-row), CronExpressionParser round-trip, defensive frontmatter coercion, and the 8-fixture sync lifecycle (3 active, dormant stays dormant, orphan paused, idempotent, read-only, malformed-skip, missing-dir).

## Decisions Made
- `syncAosCronJobs(jobsDir?)` accepts an optional dir override; production resolves `<aos project_dir>/cron/jobs` from `resolveAgentRuntime('aos')`. This keeps the unit test free of agent-config/filesystem mocking while preserving the zero-arg production call site the plan describes for 07-04 startup wiring.
- Stable id = slugified frontmatter `name` (fallback filename stem). The real 8 jobs already use slug-shaped names, so derived ids match `daily-memory-distill` etc.
- Borrowed the proven parse/time-days translation/orphan-deactivation logic from the superseded reference branch (`claude/priceless-ramanujan-08913d:src/cron-sync.ts`) and adapted it to the 07-01 helper API (`upsertAosCronTask`/`deactivateAosCronTask`/`getAosCronTaskIds`) and the `aos-cron.ts` file layout. Extended it with the `every_Nh` interval and multi-time single-row collapse that the earlier branch did not cover.

## Deviations from Plan

None - plan executed exactly as written. The optional `jobsDir` test-override arg is an additive testability affordance, not a behavioral change: the default (no-arg) path resolves the aos jobs dir exactly as the plan's `<action>` specifies.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. (Startup wiring of `syncAosCronJobs()` into the aos boot path is plan 07-04's scope.)

## Next Phase Readiness
- `syncAosCronJobs()` is ready to be wired at aos process boot before `initScheduler(send, 'aos')` (07-04), so rows exist before the first tick.
- The aos firing loop (07-04) consumes these rows; it must suppress the "Scheduled task running…" preamble for `source='aos-cron'` rows (D-12) and re-read the job body at fire time (D-07) rather than trusting the projected `prompt`.
- No blockers.

## Self-Check: PASSED

- FOUND: src/aos-cron.ts
- FOUND: src/aos-cron.test.ts
- FOUND: .planning/phases/07-single-scheduler/07-02-SUMMARY.md
- FOUND commit: 4504c79 (Task 1)
- FOUND commit: d945208 (Task 2)

---
*Phase: 07-single-scheduler*
*Completed: 2026-06-17*
