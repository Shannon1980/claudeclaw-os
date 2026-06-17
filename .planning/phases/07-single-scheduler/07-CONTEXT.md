# Phase 7: Single Scheduler - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

ClaudeClaw's SQLite scheduler becomes the **only** job runner for the workspace. It
ingests agentic-os `cron/jobs/*.md` definitions (YAML frontmatter + prompt body), fires
them on schedule with status/log parity, guarantees exactly-once firing across processes,
and the agentic-os cron engine is disabled with no double-firing.

The target architecture is already locked by agentic-os `cron/SCHEDULER-HANDOFF.md` — this
phase implements it. Scope is the ingestion + firing + claim + engine-shutoff path, plus a
versioned schema migration. Not in scope: Command Centre repoint (Phase 9 / CKPT-02),
per-agent SOUL identity (Phase 8).

</domain>

<decisions>
## Implementation Decisions

### Schedule translation
- **D-01:** Translate each job's `time`/`days` into a standard cron expression stored in
  the existing `scheduled_tasks.schedule` column; reuse `cron-parser` + `computeNextRun`.
  One scheduling code path for all tasks — no second engine.
- **D-02:** Interval schedules translate to cron step expressions: `every_5m` → `*/5 * * * *`,
  `every_4h` → `0 */4 * * *`, etc.
- **D-03:** Multi-time jobs (e.g. `time: '09:00,17:00'`) become a single row with comma cron
  fields (`0 9,17 * * *`). One row per job (not one row per fire time).
- **D-04:** Fire times use **server-local time** (matches SCHEDULER-HANDOFF.md and current
  launchd behavior). No per-job timezone field this phase.

### Job sync & lifecycle
- **D-05:** Stable job identity = **filename slug**, e.g. `daily-memory-distill.md` →
  `aos:daily-memory-distill`. Re-syncs update the existing row rather than duplicating;
  survives `name:`/display edits.
- **D-06:** Inactive jobs (`active: 'false'`) are synced as `status = 'paused'` — visible on
  the dashboard, and flipping `active: 'true'` activates on next startup re-sync.
- **D-07:** Orphaned rows (`source = 'aos-cron'` with no backing `cron/jobs/*.md` file) are
  **removed** on startup sync, keeping the DB in lockstep with the job directory. (`paused`
  = file exists but inactive; orphan = no file → delete.)
- **D-08:** The prompt **body is re-read from the `.md` file at fire time** (store the file
  path on the row); metadata (`schedule`/`active`/`model`/etc.) is re-synced on each startup.
  Edits take effect on the next run with no restart.

### Per-job execution
- **D-09:** Jobs run as the **`aos` workspace agent** (`~/.claudeclaw/agents/aos/agent.yaml`,
  `project_dir` → agentic-os) so they execute in the workspace with its CLAUDE.md/SOUL
  context, exactly like a terminal session there.
- **D-10:** `notify:` is honored strictly — `on_finish` → send the result to chat;
  `on_failure` → send **only** on error/timeout. Suppress the "Scheduled task running…"
  preamble for aos jobs (the old engine had no such preamble).
- **D-11:** Per-job `model` and `timeout` from frontmatter are honored, with scheduler
  defaults as fallback when absent (current default 10m / default model).
- **D-12:** `retry: N` is honored — on failure/timeout, re-run up to N times before recording
  a failed result. (Values in use are 0–1.)

### Exactly-once + disabling the old engine
- **D-13:** Exactly-once across processes via an **atomic conditional claim**:
  `UPDATE scheduled_tasks SET status='running', started_at=?, next_run=? WHERE id=? AND status='active'`,
  and only run the job when `changes() === 1`. The in-memory `runningTaskIds` Set stays as a
  same-process fast-path. (Today's `markTaskRunning` updates `WHERE id=?` only — not
  cross-process safe.)
- **D-14:** Disable the agentic-os engine by (a) **uninstalling the PID daemon**
  (`scripts/uninstall-crons.sh`, stop `command-centre/scripts/cron-daemon.cjs`) AND (b)
  adding a **`CRON_IN_PROCESS` opt-out gate** to agentic-os
  `command-centre/src/instrumentation.ts` so booting the Next.js server cannot re-introduce a
  second in-process runner. This is a cross-repo change into agentic-os.
- **D-15:** No-double-fire (SCH-04) is verified by an **automated concurrency test** (two
  concurrent claims against one task assert exactly one wins) **plus a live single-fire
  observation** of a migrated job with both bot and terminal present.
- **D-16:** The schema change ships as **discrete columns** added via a versioned migration
  (`npm run migrate`): `source`, `job_file`, `model`, `timeout_ms`, `notify`, `retry`,
  `last_status`. Queryable and dashboard-friendly. The migration MUST run before restart
  (else `checkPendingMigrations` crash-loops).

### Claude's Discretion
- Exact cron-translation helper shape and where it lives (e.g. a `aos-cron.ts` module vs
  inline in `scheduler.ts`).
- Naming of the new columns/fields beyond the set in D-16, and how `last_status` reconciles
  with the existing `updateTaskAfterRun` `lastStatus` param.
- Whether `retry` backoff is immediate or delayed (no requirement either way).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Target design (authoritative — read first)
- `/Users/shannongueringer/App Repo/agentic-os/cron/SCHEDULER-HANDOFF.md` — locks the
  architecture: sync model (`source='aos-cron'`, one row per job, body re-read at fire),
  schedule derivation, atomic claim, "do NOT restart old engine", bookkeeping moves to the
  DB row + Slack notify.

### agentic-os job format & engine
- `/Users/shannongueringer/App Repo/agentic-os/cron/jobs/*.md` — job definitions (YAML
  frontmatter: `name`, `time`, `days`, `active`, `model`, `notify`, `timeout`, `retry`,
  `description` + prompt body).
- `/Users/shannongueringer/App Repo/agentic-os/cron/templates/schedule-reference.md` — the
  full schedule grammar (single/comma times, `every_Nm`/`every_Nh`, `daily`/`weekdays`/
  `weekends`/specific days).
- `/Users/shannongueringer/App Repo/agentic-os/command-centre/src/instrumentation.ts` —
  calls `initCronScheduler()` unconditionally on Next.js boot; needs the `CRON_IN_PROCESS`
  gate (D-14).
- `/Users/shannongueringer/App Repo/agentic-os/scripts/uninstall-crons.sh` — stops the PID
  cron daemon (D-14).

### ClaudeClaw scheduler & DB
- `src/scheduler.ts` — `initScheduler`, `runDueTasks` loop, `computeNextRun`,
  `runningTaskIds` fast-path, message-queue serialization, `runAgent` call site.
- `src/db.ts` — `scheduled_tasks` schema (lines ~72-83), `getDueTasks`, `markTaskRunning`,
  `updateTaskAfterRun`, `resetStuckTasks`, and `addColumnIfMissing` migration helper pattern.
- `src/schedule-cli.ts` — CLI create/list/delete/pause/resume against `scheduled_tasks`.
- `src/agent-config.ts` — `resolveAgentCwd` / `isWorkspaceAgent` / `project_dir` resolution
  (how the `aos` agent's cwd is chosen, D-09).
- `scripts/migrate.ts` + `migrations/` + `version.json` — versioned migration mechanism (D-16).

### Phase definition
- `.planning/ROADMAP.md` — Phase 7 section (goal + 5 success criteria, `Mode: mvp`).
- `.planning/REQUIREMENTS.md` — SCH-01, SCH-02, SCH-03, SCH-04.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `runDueTasks()` / `computeNextRun()` in `src/scheduler.ts` — the existing tick loop and
  cron next-run computation extend directly to synced aos jobs.
- `runAgent(prompt, …, model, abortController, …, mcpAllowlist)` — already accepts a model
  and abort controller; per-job model/timeout (D-11) plug in here.
- `addColumnIfMissing(database, table, col, def)` in `src/db.ts` — established additive
  migration pattern for the new columns (D-16).
- `messageQueue.enqueue(chatId, fn)` — serializes scheduled runs against in-flight user
  messages; keep for aos jobs.

### Established Patterns
- Per-agent config lives in `~/.claudeclaw/agents/<id>/agent.yaml`; `project_dir` makes the
  agent a "workspace agent" and sets the SDK cwd (Phase 1 wiring) — the `aos` agent already
  exists and points at agentic-os.
- Scheduler runs per `schedulerAgentId` (default `'main'`); `getDueTasks(agentId)` is
  agent-scoped. aos jobs need to fire under the `aos` agent identity (D-09).

### Integration Points
- Mission Control dashboard reads `scheduled_tasks` (`last_run`, `last_result`, `status`) —
  new `source`/`last_status`/`job_file` columns surface aos jobs there (status parity).
- Startup path (where `initScheduler` is called) is where the `cron/jobs/*.md` → DB sync
  runs and where orphan removal (D-07) happens.

</code_context>

<specifics>
## Specific Ideas

- Existing job files to migrate: `daily-memory-distill`, `weekly-memory-curator`,
  `weekly-memory-gaps`, `weekly-activity-digest`, `skill-update-check`,
  `monthly-learnings-health`, `youtube-newsletter`. `nightly-memsearch-index` was already
  cron-disabled in Phase 6 — treat it as inactive/retired, don't re-activate.
- Per SCHEDULER-HANDOFF.md, ClaudeClaw does **not** write `cron/status/*.json` or
  `cron/logs/*.log` anymore — status/history lives in the `scheduled_tasks` row + `notify:`
  Slack delivery. The old status/log files are superseded, not maintained.
- `scheduled_tasks` currently has no `last_status` column — `updateTaskAfterRun` takes a
  `lastStatus` arg that isn't persisted to a dedicated column today; the D-16 migration adds it.
- Transport is **Slack** (Socket Mode); `notify:` delivery routes through the existing
  `sender`/`ALLOWED_CHAT_ID` path, not Telegram.

</specifics>

<deferred>
## Deferred Ideas

- A dedicated dashboard view distinguishing aos jobs from user-created scheduled tasks —
  Command Centre repoint is Phase 9 (CKPT-02); basic parity via existing columns is enough now.
- Per-job timezone (`tz:`) frontmatter — server-local for this phase (D-04); revisit only if
  a job needs a non-local zone.
- Re-enabling `nightly-memsearch-index` or any memsearch-era job — out of scope (memsearch
  retired in Phase 6).

</deferred>

---

*Phase: 07-single-scheduler*
*Context gathered: 2026-06-17*
