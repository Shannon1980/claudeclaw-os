# Phase 7: Single Scheduler - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

ClaudeClaw's scheduler becomes the **single** job runner for the agentic-os
workspace. On startup it syncs every agentic-os `cron/jobs/*.md` file into the
`scheduled_tasks` table (one row per job, `source = 'aos-cron'`), fires the
active ones on schedule as the workspace agent (`aos`, cwd = agentic-os +
its CLAUDE.md context), and the agentic-os cron engine is disabled with no
double-firing.

This phase delivers **SCH-01..SCH-04**:
- SCH-01: ClaudeClaw is the single job runner; the agentic-os cron engine no
  longer schedules or fires jobs.
- SCH-02: ClaudeClaw reads `cron/jobs/*.md` (YAML frontmatter + prompt body) and
  runs them on schedule.
- SCH-03: A migrated job fires at its configured time and writes its result
  where the user expects (status/log parity).
- SCH-04: No double-firing — a job runs once per trigger even with both a
  terminal workflow and the bot present, verified against the cross-process
  claim path.

Plus the cross-cutting milestone rule: any `scheduled_tasks` schema change ships
as a **versioned migration** and the test suite passes.

**The design is largely pre-locked** by the already-committed agentic-os doc
`cron/SCHEDULER-HANDOFF.md` (commit `2acb530`, 2026-06-17). That doc is intent,
not implementation — ClaudeClaw currently has **zero** aos-cron sync code
(`grep aos-cron src/` is empty). This phase implements what the handoff
describes, with the decisions below resolving the forks the handoff left open.

**In scope:**
- Cron-job sync: read `cron/jobs/*.md`, map frontmatter to a `scheduled_tasks`
  row, re-read prompt body at fire time.
- Firing aos-cron jobs as the `aos` workspace agent on its own scheduler loop.
- A new `com.claudeclaw.aos` launchd service so `aos` runs standalone.
- Disabling the agentic-os cron engine, including a `CRON_IN_PROCESS` opt-out
  gate in the Command Centre so booting it no longer starts a second scheduler.
- Result delivery via the DB row + Slack `notify`; retiring `cron/status/*.json`
  and `cron/logs/*.log` writes.
- Exactly-once firing via atomic DB claim + per-agent scoping.
- A versioned migration for the new `scheduled_tasks` columns.

**Out of scope (own phases / not this one):**
- Repointing the Command Centre to read ClaudeClaw's SQLite (Phase 9, CKPT-01).
  This phase only adds the `CRON_IN_PROCESS` gate so the CC scheduler can be
  turned off; it does not migrate CC's data reads.
- Per-agent `SOUL.md` / identity (Phase 8).
- Deleting agentic-os dead cron code paths (v2, CLN-01/02). This phase
  disables + de-references, it does not delete the old engine scripts.
- The memory content crons themselves (their content behavior is unchanged;
  this phase only changes *who runs* them and *how results are recorded*).
</domain>

<decisions>
## Implementation Decisions

### Old-engine disable depth (SCH-01, SCH-03)
- **D-01:** **Add a `CRON_IN_PROCESS` opt-out gate now.** Command Centre's
  `command-centre/src/instrumentation.ts` calls `initCronScheduler()`
  *unconditionally* on boot, which claims the `cron-runtime-lock.json` leader
  lock and ticks every 60s — booting CC therefore re-introduces a second
  runner. Gate that call behind an env var (e.g. `CRON_IN_PROCESS=0`) so the CC
  Next.js server can boot **without** starting its scheduler. This is
  defense-in-depth landed in Phase 7, ahead of Phase 9's full CC repoint.
- **D-02:** The old **PID daemon** (`command-centre/scripts/cron-daemon.cjs`,
  started via `scripts/start-crons.sh`) stays **stopped**; do not re-enable it.
  Disable + de-reference, not deletion (the scripts/permissions stay dormant for
  reversibility, mirroring Phase 6's D-03 stance).

### Result delivery / status-log parity (SCH-03)
- **D-03:** **DB row + Slack only.** A job's run status/history lives in its
  `scheduled_tasks` row (`last_run`, `last_status`, `last_result`) — visible on
  the ClaudeClaw dashboard — plus each job's `notify:` Slack delivery
  (`on_finish` / `on_failure`). ClaudeClaw does **not** write
  `cron/status/*.json` or `cron/logs/*.log` (the retired engine's bookkeeping).
  Note: this is engine *bookkeeping* only — jobs whose prompts write their own
  output files (e.g. `weekly-activity-digest` → `projects/ops-cron/…`) continue
  to do so; that is the job's behavior, not the scheduler's.

### Job-runner agent identity + process model (SCH-04)
- **D-04:** **`aos` gets its own scheduler loop.** aos-cron jobs run as the
  `aos` workspace agent (cwd = agentic-os, its CLAUDE.md context, honoring each
  job's `model` and `timeout`). Rather than have `main` fire them via the
  offline-agent delegation path, `aos` runs **standalone** with its own
  `initScheduler`.
- **D-05:** **Create a `com.claudeclaw.aos` launchd service** so `aos` (today a
  delegation-only agent with no process) runs standalone. MUST follow the
  project launchd rules: the project path contains spaces, so use the
  `~/.claudeclaw-app` symlink for `WorkingDirectory` and `/tmp/claudeclaw-aos.log`
  (never a space-containing path) for `StandardOutPath`/`StandardErrorPath`
  (launchd exits 78 / `EX_CONFIG` on spaces in log paths). Include
  `KeepAlive` + `ThrottleInterval` for network-not-ready crash recovery.

### Exactly-once / no double-fire (SCH-04)
- **D-06:** **Atomic claim + agent scoping.** aos-cron rows are scoped to
  `agent_id = 'aos'`, so only the `aos` scheduler loop claims them; `main`
  continues to claim only its own. The atomic
  `UPDATE … WHERE id=? AND status='active'` (the existing `markTaskRunning`
  lock pattern, generalized to a claim) is the **cross-process backstop**.
  `main`'s existing offline-agent fallback (it runs mission/scheduled work for
  agents with no live process) MUST skip `aos` when `isAgentRunning('aos')` is
  true — otherwise `main` and the new `aos` service would both contend for the
  same rows. The verification must exercise the cross-process claim path
  explicitly (SCH-04 success criterion).

### Sync lifecycle (SCH-02)
- **D-07:** **Sync all jobs; deactivate orphans.** Sync **every** `cron/jobs/*.md`
  file on startup — including `active: 'false'` ones, written as dormant rows so
  they are visible on the dashboard but do not fire. Re-sync schedule/active/
  model/timeout/notify metadata on each startup; **re-read the prompt body from
  the `.md` at fire time** so edits take effect on the next run with no restart.
  When a job `.md` is **deleted or renamed**, mark its DB row **inactive** rather
  than deleting it (preserves `last_result` history). `cron/jobs/*.md` remain the
  editable **source of truth**; ClaudeClaw's DB rows are a derived projection
  and ClaudeClaw never writes back to the `.md` files.

### Schedule mapping (SCH-02)
- **D-08:** Map frontmatter `time` (`'HH:MM'`, server-local) + `days` to a cron
  expression for the existing `CronExpressionParser`/`computeNextRun` path.
  Observed `days` values to support: `daily`, `weekdays`, single weekday
  (`mon`/`fri`/`sun`/…). If a raw `cron:` frontmatter field is present, it wins
  over `time`+`days`. (Exact mapping table is Claude's discretion — none of the
  current 8 jobs use a raw `cron:` field, but support it for forward-compat.)
- **D-08a:** The mapping must cover the full `cron/templates/schedule-reference.md`
  grammar, not just the values the current 8 jobs use:
  - **Interval `time`** → cron steps: `every_5m` → `*/5 * * * *`,
    `every_30m` → `*/30 * * * *`, `every_4h` → `0 */4 * * *`, etc.
  - **Multi-time `time`** (comma list, e.g. `'09:00,17:00'`) → a **single** row
    with comma cron fields (`0 9,17 * * *`) — one row per job, not one row per
    fire time, so bookkeeping stays one-row-per-job (consistent with D-07).
  - **`days`** also supports `weekends` and multi-day lists (`mon,wed,fri`)
    alongside the values named in D-08.
  Keep all of this inside the single `computeNextRun`/cron-string path — no
  second scheduling engine.

### Per-job execution detail (SCH-02, SCH-03)
- **D-10:** Honor per-job **`timeout`** (`'5m'`/`'10m'`/`'15m'`) by parsing it to
  a per-run abort timeout, falling back to the existing `TASK_TIMEOUT_MS` (10m)
  when absent. (Resolves the timeout half of D-09's open discretion item.)
- **D-11:** Honor **`retry: N`** — on failure/timeout, re-run the job up to N
  times before recording a failed result and firing `on_failure`. Current values
  are `'0'`/`'1'`; treat absent as `0`. Backoff timing is Claude's discretion.
- **D-12:** For aos-cron jobs, **suppress the "Scheduled task running…" preamble**
  that the current scheduler sends before user-created tasks — the retired engine
  had no such preamble, and `notify:` (D-03) governs aos-job chat output:
  `on_finish` → send result, `on_failure` → send only on error/timeout.

### Schema migration (milestone rule / success criterion 5)
- **D-09:** New `scheduled_tasks` columns (at minimum `source`, plus whatever is
  needed to hold the job-file path, `model`, `timeout`, and `notify` policy)
  ship as a **versioned migration** via the `add-migration` skill +
  `npm run migrate` — NOT inline `ALTER`/`addColumnIfMissing` edits in
  `db.ts createSchema`. `checkPendingMigrations` will crash-loop the bot on
  startup if the migration is registered but unapplied, so the migration must be
  applied before restart (this is the documented deploy step). The exact column
  set and names are Claude's discretion.

### Claude's Discretion
- Exact `days`→cron mapping table and the parser for `time`/`days`.
- Exact new column names/set on `scheduled_tasks` and the sync function shape
  (a `syncAosCronJobs()` on startup mirroring how the bot already initializes).
- How the `aos` service shares the message-queue / single-flight discipline the
  current scheduler uses (`messageQueue.enqueue`) to avoid two Claude processes
  hitting one session.
- The exact env-var name/semantics for the CC gate (`CRON_IN_PROCESS=0`
  suggested by the handoff doc).
- `timeout`/`retry` mapping is now decided in D-10/D-11; only the precise
  duration-parse helper and retry backoff timing remain Claude's discretion.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirement & roadmap
- `.planning/REQUIREMENTS.md` — SCH-01..SCH-04 (the four phase requirements) +
  the "Running two schedulers" out-of-scope row.
- `.planning/ROADMAP.md` §"Phase 7: Single Scheduler" — goal + 5 success
  criteria (criterion 5 = versioned migration + tests pass).
- `.planning/PROJECT.md` — consolidation key decisions (single scheduler).

### The locked design (intent doc — implement this)
- `/Users/shannongueringer/App Repo/agentic-os/cron/SCHEDULER-HANDOFF.md` — the
  committed handoff describing the target behavior: startup sync, prompt re-read
  at fire time, `time`+`days`/`cron:` schedule derivation, atomic claim, DB+Slack
  bookkeeping, and the CC `initCronScheduler()` warning.

### ClaudeClaw scheduler (the surviving runner)
- `src/scheduler.ts` — `initScheduler(send, agentId)`, `runDueTasks`,
  `runDueMissionTasks`/`startMissionTask` (the offline-agent delegation pattern),
  `computeNextRun` (CronExpressionParser). This is where aos-cron sync + firing
  hooks in.
- `src/db.ts` — `scheduled_tasks` schema (CREATE ~line 72; in-code ALTER
  migrations ~503–525), `getDueTasks` (~1275), `markTaskRunning` (~1301, the
  atomic lock to generalize into the claim), `updateTaskAfterRun` (~1314),
  `resetStuckTasks` (~1326), `claimNextMissionTask` (~2269, the atomic-claim
  precedent).
- `src/schedule-cli.ts` — existing task CRUD CLI (how rows are created today;
  `source` defaulting).
- `src/agent-config.ts` — `isWorkspaceAgent`, `workspaceMemoryKey`,
  `resolveAgentRuntime`/`projectDir` resolution (~50–270). Defines the `aos`
  workspace agent's cwd + context loading.
- `src/agent-create.ts` — `isAgentRunning(agentId)` (used by D-06's offline
  fallback skip).

### Migration system (success criterion 5)
- `src/migrations.ts` — `checkPendingMigrations` (crash-loops on pending),
  `compareSemver`.
- `scripts/migrate.ts` — the `npm run migrate` runner.
- `migrations/version.json` — the migration registry (currently empty).
- `.claude/skills/add-migration/` — the skill that scaffolds a versioned
  migration.

### agentic-os cron footprint to migrate/disable
- `/Users/shannongueringer/App Repo/agentic-os/cron/jobs/*.md` — the 8 job
  definitions to sync (frontmatter: `name`, `time`, `days`, `active`, `model`,
  `notify`, `description`, `timeout`, `retry`; body = prompt). Source of truth.
- `/Users/shannongueringer/App Repo/agentic-os/cron/templates/schedule-reference.md`
  — the full `time`/`days` schedule grammar the mapping must cover (interval
  `every_Nm`/`every_Nh`, comma multi-time, `weekends`, multi-day) per D-08a.
- `/Users/shannongueringer/App Repo/agentic-os/command-centre/src/instrumentation.ts`
  — calls `initCronScheduler()` unconditionally (D-01 gates this).
- `/Users/shannongueringer/App Repo/agentic-os/command-centre/scripts/cron-daemon.cjs`
  — the PID daemon to keep stopped (D-02).
- `/Users/shannongueringer/App Repo/agentic-os/scripts/start-crons.sh` — must not
  be run.
- `/Users/shannongueringer/App Repo/agentic-os/cron/status/`,
  `/Users/shannongueringer/App Repo/agentic-os/cron/logs/` — legacy bookkeeping
  ClaudeClaw stops writing (D-03).

### Project launchd rules (D-05)
- `CLAUDE.md` §"launchd Rules" — exit-78-on-spaces, symlink for
  `WorkingDirectory`, `/tmp` or `~/Library/Logs` for log paths,
  `KeepAlive`+`ThrottleInterval` recovery, diagnosis via `launchctl print`.
- Existing `com.claudeclaw.app` plist — the template for the new
  `com.claudeclaw.aos` service.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/scheduler.ts` `runDueMissionTasks`/`startMissionTask`: the
  offline-agent + cross-process-cancel-poll pattern; the aos scheduler loop and
  the no-double-fire backstop reuse this shape.
- `src/db.ts` `markTaskRunning` / `claimNextMissionTask`: atomic
  `UPDATE … WHERE` claim precedent for D-06.
- `src/scheduler.ts` `computeNextRun` (CronExpressionParser): schedule
  computation; D-08 feeds it a cron string derived from `time`+`days`.
- `messageQueue.enqueue` (used throughout `scheduler.ts`): single-flight so two
  Claude runs don't hit one session — the aos loop should honor it.
- The `com.claudeclaw.app` launchd plist: template for `com.claudeclaw.aos`.

### Established Patterns
- Per-agent task scoping via `agent_id` (`getDueTasks(agentId)`,
  `resetStuckTasks(agentId)`) — D-06 scopes aos-cron rows to `agent_id='aos'`.
- `main` runs work for offline agents but skips live ones via
  `isAgentRunning()` — D-06 extends this skip to the aos scheduler case.
- Versioned migrations are mandatory for schema changes (Phase 6 canonical_refs
  noted the rule; D-09 enforces it here, which is the first time this milestone
  actually adds columns).
- Workspace agent `aos` established in Phase 1 (`~/.claudeclaw/agents/aos/
  agent.yaml`, `project_dir` = agentic-os, delegation-only) — Phase 7 promotes
  it from delegation-only to a standalone service.

### Integration Points
- Startup: a `syncAosCronJobs()` call wired into bot/aos init (mirrors how
  `initScheduler` is called today).
- aos service → its own `initScheduler(send, 'aos')` loop.
- agentic-os CC `instrumentation.ts` → reads `CRON_IN_PROCESS` before
  `initCronScheduler()`.
</code_context>

<specifics>
## Specific Ideas

- The agentic-os `cron/SCHEDULER-HANDOFF.md` was written/committed ahead of this
  phase as the design contract. Treat it as near-locked intent and implement to
  it; the decisions above only resolve the forks it left open (CC gate depth,
  the aos-own-loop vs main-delegation choice, orphan handling).
- Current job inventory: 8 jobs, of which 3 are `active: 'true'`
  (`daily-memory-distill`, `weekly-memory-curator`, `weekly-memory-gaps`); the
  rest are dormant. `nightly-memsearch-index` is intentionally `active: 'false'`
  from Phase 6 — keep it dormant (do not reactivate on sync).
- Sequence the destructive/cutover steps (disable old engine, CC gate, live
  proof) **last**, after sync + the aos service + firing all work — never
  disable the old engine before the new path fires a real job.
- **Cross-repo boundary (D-01 execution mechanic):** the `CRON_IN_PROCESS` gate
  in `command-centre/src/instrumentation.ts` is the **only write** this phase
  makes into the **agentic-os** repo (`Shannon1980/agentic-os`); every other
  agentic-os touchpoint here is read-only (`cron/jobs/*.md`,
  `schedule-reference.md`) or left dormant (`cron-daemon.cjs`, `start-crons.sh`).
  All ClaudeClaw source/migrations/launchd work lands in the claudeclaw repo
  (`Shannon1980/claudeclaw-os`) on the phase branch. A single git commit cannot
  span both repos, so the executor MUST land the `instrumentation.ts` edit as a
  **separate atomic commit on its own branch in the agentic-os checkout**
  (`/Users/shannongueringer/App Repo/agentic-os`, currently on
  `claude/phase-06-memsearch-retirement` with a dirty tree — branch from a clean
  base) with its **own PR `--repo Shannon1980/agentic-os`** — do **not** attempt
  to stage or commit it on the claudeclaw phase branch. The phase isn't fully
  cut over until that agentic-os PR also merges; note the dependency in PLAN.md
  so the live-proof step accounts for both repos.
</specifics>

<deferred>
## Deferred Ideas

- **Command Centre reading ClaudeClaw's SQLite** (CKPT-01) and fully disabling
  its memory/cron engines (CKPT-02) — Phase 9. Phase 7 only adds the
  `CRON_IN_PROCESS` gate so CC's scheduler can be turned off.
- **Deleting agentic-os dead cron code** (scripts, daemon, plugin) — v2
  CLN-01/02, once the ClaudeClaw-only path has soaked.
- **Generalizing aos-cron sync to other workspace agents / multi-client crons**
  (MC-01) — v2.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.
</deferred>

---

*Phase: 7-single-scheduler*
*Context gathered: 2026-06-17*
