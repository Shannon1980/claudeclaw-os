---
phase: 07-single-scheduler
verified: 2026-06-18T21:15:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 7: Single Scheduler Verification Report

**Phase Goal:** ClaudeClaw's scheduler is the only job runner: it reads agentic-os `cron/jobs/*.md` definitions, fires them on schedule with status/log parity, and the agentic-os cron engine is disabled with no double-firing.
**Verified:** 2026-06-18T21:15:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                   | Status     | Evidence                                                                                                                                     |
|----|--------------------------------------------------------------------------------------------------------|------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | ClaudeClaw loads a job from `cron/jobs/*.md` (YAML frontmatter + prompt body) and schedules it        | VERIFIED  | `src/aos-cron.ts` `parseJobFile()` + `syncAosCronJobs()` upsert one `scheduled_tasks` row per .md; 46 unit tests cover all grammar cases     |
| 2  | A migrated job fires at its configured time, writing `last_status`, `last_run`, `last_result` to the row | VERIFIED | `runAosCronTaskOnce()` calls `updateTaskAfterRun()` on both success and failure paths; live proof: `weekly-memory-gaps` fired, `last_status=success` recorded |
| 3  | The agentic-os cron engine no longer schedules or fires any jobs                                       | VERIFIED  | `agentic-os/command-centre/src/instrumentation.ts` line 18 gates `initCronScheduler()` behind `process.env.CRON_IN_PROCESS !== "0"`; live run showed no `cron-runtime-lock.json` |
| 4  | A given job runs exactly once per trigger (no double-fire) even with both processes present            | VERIFIED  | `claimDueTask()` uses `UPDATE ... WHERE id=? AND status='active'` returning `changes===1`; `getDueTasks('aos')` is agent-scoped so main's loop never sees aos rows; 13 firing tests cover concurrent-claim |
| 5  | Any schema change ships as a versioned migration and the test suite passes                             | VERIFIED  | `migrations/v1.2.1/add-aos-cron-scheduled-task-columns.ts` registered in `migrations/version.json`; 117 tests pass across `db.test.ts`, `scheduler.aos.test.ts`, `aos-cron.test.ts` |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact                                                      | Expected                                                    | Status    | Details                                                                    |
|---------------------------------------------------------------|-------------------------------------------------------------|-----------|----------------------------------------------------------------------------|
| `migrations/v1.2.1/add-aos-cron-scheduled-task-columns.ts`   | Versioned migration adding 6 aos-cron columns               | VERIFIED  | Exports `run()`, PRAGMA-guarded idempotent ADD COLUMNs; registered in `version.json` under `v1.2.1` |
| `src/db.ts`                                                   | `claimDueTask`, extended `ScheduledTask` type, aos helpers  | VERIFIED  | `claimDueTask` (line 1345), `ScheduledTask` with 6 new fields (line 1259-1278), `upsertAosCronTask`, `deactivateAosCronTask`, `getAosCronTaskIds` all present and substantive |
| `src/aos-cron.ts`                                             | `syncAosCronJobs()`, `parseJobFile()`, `toCron()`, orphan lifecycle | VERIFIED | All exported; full D-08a grammar (intervals, exact time, multi-time, days); per-file try/catch prevents one bad job from aborting sync |
| `src/scheduler.ts`                                            | aos-cron firing branch with atomic claim, prompt re-read, notify gating, no preamble | VERIFIED | Lines 237-255: branch on `task.source === AOS_CRON_SOURCE`, `claimDueTask` claim, `runAosCronTaskOnce` with D-07/D-10/D-11/D-12 all honoured |
| `src/index.ts`                                                | `syncAosCronJobs()` wired at aos boot before `initScheduler`; `createSlackSender` routing | VERIFIED | Lines 371-376: `if (AGENT_ID === 'aos') { syncAosCronJobs(); }` then `initScheduler(notifyUser, AGENT_ID)`; line 213: `slackSender` created and routed for Slack sub-agents |
| `launchd/com.claudeclaw.aos.plist`                            | Standalone aos service; spaces-safe /tmp log paths          | VERIFIED  | Label `com.claudeclaw.aos`, `--agent aos`, `StandardOutPath`/`StandardErrorPath` both `/tmp/claudeclaw-aos.log` (no spaces), `RunAtLoad`, `KeepAlive`, `ThrottleInterval 30` |
| `agentic-os/command-centre/src/instrumentation.ts`            | `CRON_IN_PROCESS` opt-out gate                              | VERIFIED  | Line 18: `if (process.env.CRON_IN_PROCESS !== "0") { ... initCronScheduler(); }` |
| `src/slack-bot.ts`                                            | `createSlackSender` Web-API-only post path for sub-agents   | VERIFIED  | `createSlackSender()` at line 724 uses `WebClient` only (no Socket Mode), `postToUser` resolves DM channel and posts via `chat.postMessage` |

### Key Link Verification

| From                          | To                          | Via                                             | Status   | Details                                                                   |
|-------------------------------|-----------------------------|-------------------------------------------------|----------|---------------------------------------------------------------------------|
| `src/index.ts` AGENT_ID=aos   | `syncAosCronJobs()`         | `if (AGENT_ID === 'aos')` guard at line 371     | WIRED    | Called before `initScheduler`; confirmed by grep                          |
| `syncAosCronJobs`             | `src/db.ts` helpers         | `upsertAosCronTask` / `deactivateAosCronTask` / `getAosCronTaskIds` imports | WIRED | Direct imports in aos-cron.ts lines 22-26                                |
| `src/scheduler.ts runDueTasks` | `claimDueTask`             | `task.source === AOS_CRON_SOURCE` branch line 237-240 | WIRED | Claim called with `nextRun` before enqueue; `continue` on false          |
| `runAosCronTaskOnce`          | `parseJobFile(readFileSync(job_path))` | D-07 fire-time re-read at lines 136-144 | WIRED | Falls back to stored prompt on read error; logged                        |
| `runAosCronTaskOnce`          | `updateTaskAfterRun`        | Called in finally/catch of all outcome paths    | WIRED    | Success (line 187), failure (line 173/208), timeout paths all write row  |
| `createSlackSender`           | `notifyUser` → scheduler    | `slackSender.postToUser` in `notifyUser` at lines 219-220 | WIRED | Routing confirmed; sub-agent Slack send gap closed in 07-05              |
| `migrations/version.json`     | `migrations/v1.2.1/add-aos-cron-scheduled-task-columns.ts` | Registry key `v1.2.1` maps to filename | WIRED | `version.json` confirmed; `package.json` version `1.2.1` matches         |
| CC `instrumentation.ts`       | `initCronScheduler` disabled | `CRON_IN_PROCESS !== "0"` gate                  | WIRED    | Confirmed present in agentic-os repo; live run showed engine off          |

### Data-Flow Trace (Level 4)

| Artifact              | Data Variable    | Source                                             | Produces Real Data | Status    |
|-----------------------|------------------|----------------------------------------------------|--------------------|-----------|
| `runAosCronTaskOnce`  | `body` (prompt)  | `parseJobFile(fs.readFileSync(task.job_path))`     | Yes — live .md file | FLOWING  |
| `runDueTasks`         | due `task` rows  | `getDueTasks(agentId)` → SQLite `SELECT ... WHERE status='active' AND next_run <= ?` | Yes — real DB rows | FLOWING |
| `syncAosCronJobs`     | scheduled_tasks rows | `upsertAosCronTask` from parsed .md files → `INSERT ... ON CONFLICT DO UPDATE` | Yes — writes real rows from real FS files | FLOWING |
| `updateTaskAfterRun`  | `last_status`, `last_result` | Written after real `runAgent()` call | Yes — proven by live weekly-memory-gaps run | FLOWING |

### Behavioral Spot-Checks

| Behavior                                          | Command                                                                     | Result                     | Status |
|---------------------------------------------------|-----------------------------------------------------------------------------|----------------------------|--------|
| TypeScript compiles clean                         | `npx tsc --noEmit`                                                          | exit 0 (no output)         | PASS   |
| 117 unit tests pass across three test suites      | `npx vitest run src/db.test.ts src/scheduler.aos.test.ts src/aos-cron.test.ts` | 117 passed, 0 failed      | PASS   |
| Migration file registered in version.json         | `grep v1.2.1 migrations/version.json`                                       | Found                      | PASS   |
| CRON_IN_PROCESS gate present in CC                | `grep CRON_IN_PROCESS .../instrumentation.ts`                               | Found at line 18           | PASS   |
| plist log paths contain no spaces                 | Read `launchd/com.claudeclaw.aos.plist`                                     | Both paths = `/tmp/claudeclaw-aos.log` | PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files were declared or discovered for this phase. Step 7c skipped — no probes defined.

### Requirements Coverage

| Requirement | Source Plan | Description                                                              | Status    | Evidence                                                                                 |
|-------------|-------------|--------------------------------------------------------------------------|-----------|------------------------------------------------------------------------------------------|
| SCH-01      | 07-05       | ClaudeClaw's scheduler is the single job runner; agentic-os engine disabled | SATISFIED | CC `CRON_IN_PROCESS` gate; `getDueTasks` agent-scoped; live: no `cron-runtime-lock.json` |
| SCH-02      | 07-01/02    | Scheduler reads `cron/jobs/*.md` (YAML frontmatter + prompt body)        | SATISFIED | `parseJobFile()` + `syncAosCronJobs()` project .md files → scheduled_tasks rows         |
| SCH-03      | 07-04/05    | Migrated job fires at configured time, writes result where user expects   | SATISFIED | `updateTaskAfterRun` writes `last_status`/`last_result`; notify gates Slack output; live proof |
| SCH-04      | 07-01/04    | No double-fire — job runs once per trigger even with both processes present | SATISFIED | `claimDueTask` atomic claim + agent-scoped `getDueTasks`; concurrent-claim test covers this |
| SC-5 (migration) | 07-01 | Schema change ships as versioned migration, test suite passes            | SATISFIED | `migrations/v1.2.1/` registered; `npx tsc` clean; 117 tests pass                        |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | No debt markers (TBD/FIXME/XXX), no stub patterns, no hollow return values found in any phase-07 files |

The one pre-existing issue logged in `deferred-items.md` (3 failing `schedule-cli.test.ts` integration tests due to missing `.env` in the worktree) is a worktree environment gap unrelated to phase-07 code — those tests require `DB_ENCRYPTION_KEY` at runtime and were failing before phase 07 began.

### Human Verification Required

None. All five success criteria are machine-verifiable, and live verification was completed on 2026-06-18 14:48 with the actual `weekly-memory-gaps` job firing. The 07-05-SUMMARY records:

- One `Firing aos-cron task` log line (exactly-once)
- `last_status=success` + `last_result` written to the row
- Slack message arrived clean (no "Scheduled task running" preamble)
- No `cron-runtime-lock.json` (CC engine confirmed off)
- `next_run` auto-recomputed to next Sun 09:30

No further human UAT is required.

### Gaps Summary

No gaps. All 5 success criteria are verified in the codebase with supporting unit test coverage and live production evidence.

**Deviations from original plan that are non-issues:**

1. Migration re-versioned `v1.1.1 → v1.2.1` during live cutover to work around a phantom `v1.2.0` written by a deleted branch. The worktree `.applied.json` still shows `v1.1.1` (the dev-time state) but the live DB has all 6 columns applied. Both `version.json` and `package.json` align on `v1.2.1`.

2. Fleet launchd paths fixed for 6 agents during 07-05 cutover (spaces-safe `/tmp/` log paths). Only `main` and `social` are provisioned with configs/tokens; the other 6 fleet agents remain unprovisioned. This is explicitly noted as future work in 07-05-SUMMARY and is out-of-scope for this phase.

3. Test files split to `src/scheduler.aos.test.ts` (not `src/scheduler.test.ts` as the 07-04 plan listed) — a non-functional organisation choice; both suites pass.

---

_Verified: 2026-06-18T21:15:00Z_
_Verifier: Claude (gsd-verifier)_
