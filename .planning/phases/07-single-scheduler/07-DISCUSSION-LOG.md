# Phase 7: Single Scheduler - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 07-single-scheduler
**Areas discussed:** Schedule translation, Job sync & lifecycle, Per-job execution, Exactly-once + kill old engine

---

## Schedule translation

| Question | Option | Selected |
|----------|--------|----------|
| Schedule representation | Translate to cron string (reuse cron-parser) | ✓ |
| | Native next_run computor | |
| Interval schedules | Translate to cron steps (`*/5 * * * *`) | ✓ |
| | Reject at sync with warning | |
| Multi-time jobs | One row, comma cron fields (`0 9,17 * * *`) | ✓ |
| | One row per fire time | |
| Timezone | Server-local time | ✓ |
| | Per-job TZ frontmatter | |

**Notes:** Keep a single scheduling code path for all tasks. Server-local matches
SCHEDULER-HANDOFF.md and current launchd behavior.

---

## Job sync & lifecycle

| Question | Option | Selected |
|----------|--------|----------|
| Job identity | Filename slug (`aos:daily-memory-distill`) | ✓ |
| | `name:` frontmatter | |
| Inactive jobs | Sync as `status='paused'` | ✓ |
| | Skip entirely | |
| Orphaned rows (file deleted/renamed) | Remove orphaned rows | ✓ |
| | Deactivate, keep row | |
| Prompt body source | Re-read file at fire time | ✓ |
| | Stored snapshot | |

**Notes:** `paused` distinguishes inactive-but-present from orphan (no file → delete).
Body re-read at fire means edits apply next run without restart.

---

## Per-job execution

| Question | Option | Selected |
|----------|--------|----------|
| Run-as agent | The `aos` workspace agent (cwd → agentic-os) | ✓ |
| | `main`, cwd override | |
| Notify handling | Honor `notify:` strictly (suppress preamble) | ✓ |
| | Always send result | |
| Model/timeout | Honor both, with fallbacks | ✓ |
| | Honor model only | |
| Retry | Honor `retry:N` | ✓ |
| | Defer retry | |

**Notes:** `on_finish` → send result; `on_failure` → send only on error/timeout. Per-job
model + timeout fall back to scheduler defaults when absent.

---

## Exactly-once + kill old engine

| Question | Option | Selected |
|----------|--------|----------|
| Exactly-once enforcement | Atomic conditional claim (`WHERE id=? AND status='active'`, `changes()==1`) | ✓ |
| | Keep current guard | |
| Disable agentic-os engine | Uninstall daemon + gate Command Centre (`CRON_IN_PROCESS`) | ✓ |
| | Operational stop only | |
| Verify no double-fire | Automated concurrency test + live check | ✓ |
| | Live observation only | |
| Schema migration shape | Discrete columns | ✓ |
| | Single meta JSON column | |

**Notes:** In-memory Set stays as same-process fast-path. Command Centre gate is a cross-repo
change into agentic-os `instrumentation.ts`. Migration adds source, job_file, model,
timeout_ms, notify, retry, last_status; must run before restart.

---

## Claude's Discretion

- Cron-translation helper module shape/location.
- Exact new column naming beyond the D-16 set; reconciling `last_status` with the existing
  `updateTaskAfterRun` `lastStatus` arg.
- Whether `retry` backoff is immediate or delayed.

## Deferred Ideas

- Dedicated dashboard view separating aos jobs from user tasks (Command Centre repoint is
  Phase 9 / CKPT-02).
- Per-job timezone (`tz:`) frontmatter (server-local for now).
- Re-enabling `nightly-memsearch-index` / memsearch-era jobs (retired in Phase 6).
