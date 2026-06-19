---
phase: 07-single-scheduler
plan: 04
subsystem: scheduler
tags: [scheduler, aos-cron, single-scheduler, atomic-claim, fire-time-reread]
requires: ["07-01", "07-02"]
provides:
  - "aos-cron firing branch in scheduler.ts (claimDueTask, per-job timeout/retry, notify gating, fire-time prompt re-read)"
  - "syncAosCronJobs() wired at aos boot before initScheduler"
  - "runAosCronTaskOnce + parseTimeout exported for unit testing"
affects:
  - src/scheduler.ts
  - src/index.ts
tech-stack:
  added: []
  patterns:
    - "Injectable deps (AosFireDeps) to make the fire path unit-testable without the message queue, the 60s interval, or a real agent subprocess"
    - "Atomic exactly-once claim via claimDueTask (WHERE ... AND status='active' + changes===1) before enqueue"
    - "Per-task firing extracted to an exported async fn; runDueTasks orchestrates claim + enqueue"
key-files:
  created:
    - src/scheduler.aos.test.ts
  modified:
    - src/scheduler.ts
    - src/index.ts
decisions:
  - "New firing-loop tests live in src/scheduler.aos.test.ts (separate from the existing db state-machine tests in src/scheduler.test.ts) so the firing path is exercised through an injectable, exported runAosCronTaskOnce rather than the 60s interval"
  - "aos rows run directly via runAgent in the aos process (getDueTasks('aos')) inheriting aos cwd — NOT via delegateToAgent('aos', ...) as the superseded reference branch did, because here aos is its own standalone service with agent_id='aos' rows"
  - "parseTimeout handles Nm AND Nh (plan grammar) and lives in scheduler.ts; null/garbage falls back to TASK_TIMEOUT_MS instead of crashing the fire"
metrics:
  duration: ~6m
  completed: 2026-06-17
---

# Phase 07 Plan 04: aos firing path Summary

Extended the existing 60s scheduler loop to fire `source='aos-cron'` rows through the atomic `claimDueTask` (SCH-04), re-read each job's prompt body from its `.md` at fire time (D-07), honor per-job timeout (D-10) and retry (D-11), suppress the "Scheduled task running" preamble (D-12), and gate Slack output by the row's `notify` policy (D-03); wired `syncAosCronJobs()` into aos boot before `initScheduler(send,'aos')`.

## What Was Built

**Task 1 — aos firing branch (`src/scheduler.ts`)**
- `runDueTasks` now branches on `task.source === AOS_CRON_SOURCE`. The aos branch computes `nextRun`, calls `claimDueTask(task.id, nextRun)` and `continue`s when it returns false (atomic cross-process claim, no double-fire), keeps the in-process `runningTaskIds` guard, then enqueues the run through `messageQueue` (single-flight discipline preserved).
- New exported `runAosCronTaskOnce(task, nextRun, deps)` owns the run + bookkeeping:
  - **D-07** re-reads `parseJobFile(fs.readFileSync(task.job_path)).body` before running; on read failure logs and falls back to the stored `task.prompt`.
  - **D-10** parses `task.timeout` via the new `parseTimeout` helper (`Nm`/`Nh` → ms, fallback `TASK_TIMEOUT_MS`).
  - **D-11** retries up to `task.retry` times (absent=0; total attempts = 1 + retry) on throw/abort before recording failure.
  - **D-12** never sends the "Scheduled task running" preamble.
  - **D-03** gates sends on `notify`: `on_finish` sends the success result; `on_failure` sends only on error/timeout; both always call `updateTaskAfterRun` so the row carries `last_run`/`last_status`/`last_result`.
- The `source='user'` path is left byte-for-byte unchanged (preamble, fixed `TASK_TIMEOUT_MS`, always-send).
- `TASK_TIMEOUT_MS`, `parseTimeout`, `runAosCronTaskOnce`, and the `AosFireDeps` interface are exported for tests.

**Task 2 — boot wiring (`src/index.ts`)**
- Imported `syncAosCronJobs` from `./aos-cron.js`.
- Added `if (AGENT_ID === 'aos') { syncAosCronJobs(); }` immediately before `initScheduler(send, AGENT_ID)` so aos rows exist before the first 60s tick. `initScheduler`'s signature and all non-aos call sites are unchanged; no other agent calls `syncAosCronJobs`.

## Tests

`src/scheduler.aos.test.ts` (13 tests, all green), proving:
- `parseTimeout`: minutes, hours, and null/garbage fallback to `TASK_TIMEOUT_MS`.
- Atomic claim: a second concurrent `claimDueTask` returns false; the claimed row is invisible to `getDueTasks('aos')` (no double-fire, SCH-04).
- Fired prompt comes from re-reading `job_path`, not the stored `task.prompt`; unreadable `job_path` falls back to the stored prompt.
- Preamble suppression for aos rows.
- `notify='on_finish'` sends result on success only; `notify='on_failure'` sends only on failure/timeout; both write `last_status`.
- retry-N re-runs the agent N+1 times before recording failure; a mid-sequence success stops retrying.
- Timeout (aborted) records `last_status='timeout'` and notifies.

## Verification

- `npx vitest run src/scheduler.test.ts src/scheduler.aos.test.ts src/aos-cron.test.ts` → 86 passed (3 files).
- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0.
- `grep "AGENT_ID === 'aos'"` and `grep syncAosCronJobs` present in `src/index.ts`.

## Deviations from Plan

The plan's `files_modified` listed `src/scheduler.test.ts` for the new tests, and Task 1's automated verify referenced `npx vitest run src/scheduler.test.ts`. The firing-loop tests were instead added as **`src/scheduler.aos.test.ts`** (not a behavior change — a test-organization choice). Rationale: the existing `src/scheduler.test.ts` exclusively tests the `db.ts` state-machine helpers, while the new tests exercise the injectable, exported `runAosCronTaskOnce` firing path. Keeping them in a dedicated file avoids conflating the two concerns and keeps each suite focused. Both suites pass together; this is the only deviation and it is non-functional.

A second design choice (not a deviation from this plan, but a divergence from the superseded reference branch noted in the prompt): aos rows are fired **directly via `runAgent`** in the aos process (which has `agent_id='aos'` rows and runs in the aos cwd), not via `delegateToAgent('aos', ...)`. On the reference branch aos rows carried `agent_id='main'` and were delegated; on this branch aos is a standalone service per 07-02, so direct execution is correct and matches this plan's task structure.

## Self-Check: PASSED

All modified/created files exist (`src/scheduler.ts`, `src/index.ts`, `src/scheduler.aos.test.ts`, `07-04-SUMMARY.md`); all three task commits found in git log (da959b9, 048f99c, 82d086a).

## Threat Surface

No new network endpoints, auth paths, or schema changes were introduced. The two trust boundaries in the plan's threat model (cross-process due-row claim T-07-08; fire-time `.md` body execution T-07-09) are addressed exactly as specified: the atomic claim is proven by the concurrent-claim test; an unreadable `job_path` falls back to the stored projection and logs rather than executing arbitrary content. No threat flags.
