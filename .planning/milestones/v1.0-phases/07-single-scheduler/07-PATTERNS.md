# Phase 7: Single Scheduler - Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 9 (new + modified)
**Analogs found:** 9 / 9 (every target has a real in-repo analog)

> **Read-only note for the planner:** Every excerpt below is copied verbatim from
> the cited file/line range. Path + line numbers are load-bearing — the planner
> should reference them directly in PLAN action steps, not paraphrase.
>
> **Plist naming correction:** CONTEXT/D-05 says "analog: existing
> `com.claudeclaw.app` plist". There is **no** `com.claudeclaw.app.plist`.
> The launchd dir holds **per-agent** plists (`com.claudeclaw.main.plist`,
> `com.claudeclaw.comms.plist`, …). The correct template for the new
> `com.claudeclaw.aos` service is `launchd/com.claudeclaw.comms.plist`
> (a `--agent <id>` standalone service). See the plist section below.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/aos-cron.ts` (new) — `syncAosCronJobs()` + `time`/`days`→cron mapping | service | file-I/O → CRUD | `src/scheduler.ts` `computeNextRun` + `src/db.ts` `createScheduledTask`/`updateScheduledTask` + `src/agent-config.ts` `loadAgentConfig` (yaml parse) | role-match (no existing dir-sync service) |
| `src/scheduler.ts` (modified) — aos firing loop on `initScheduler(send,'aos')` | service | event-driven (interval) | `src/scheduler.ts` `runDueTasks` / `runDueMissionTasks` / `startMissionTask` (self) | exact |
| `src/db.ts` (modified) — generalized atomic claim `claimDueTask()` | model | CRUD (atomic claim) | `src/db.ts` `markTaskRunning` (~1301) + `claimNextMissionTask` (~2269) | exact |
| `src/db.ts` (modified) — aos row read/write helpers (`getDueTasks` scoping, deactivate-orphan) | model | CRUD | `src/db.ts` `getDueTasks`/`updateScheduledTask`/`pauseScheduledTask` | exact |
| `migrations/<ver>/<slug>.ts` (new) — add `scheduled_tasks` columns | migration | schema | `.claude/skills/add-migration/SKILL.md` template + `scripts/migrate.ts` runner + `migrations/version.json` | exact (scaffold) |
| `launchd/com.claudeclaw.aos.plist` (new) | config | process | `launchd/com.claudeclaw.comms.plist` | exact |
| `src/index.ts` (modified) — wire `syncAosCronJobs()` at aos startup | config | request-response (boot) | `src/index.ts` ~119 (`checkPendingMigrations`) + ~357 (`initScheduler`) | exact |
| agent identity / cwd for `aos` (read-only use) | utility | transform | `src/agent-config.ts` `resolveAgentRuntime`/`isWorkspaceAgent`; `src/agent-create.ts` `isAgentRunning` | exact |
| `command-centre/src/instrumentation.ts` (modified, agentic-os repo) — `CRON_IN_PROCESS` gate | config | event-driven | self (the unconditional `initCronScheduler()` call) | exact |

---

## Pattern Assignments

### `src/aos-cron.ts` — `syncAosCronJobs()` + schedule mapping (NEW: service, file-I/O → CRUD)

No existing file syncs a directory of `.md` files into `scheduled_tasks`. Build it from three established pieces.

**(a) YAML frontmatter parse** — analog `src/agent-config.ts` lines 1-3, 116:
```typescript
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
// ...
const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
```
Job files (`/Users/shannongueringer/App Repo/agentic-os/cron/jobs/*.md`) are YAML frontmatter + a prompt body, so the parser must split the `---`-delimited front block from the body. `daily-memory-distill.md` lines 1-11 show the exact frontmatter keys to read: `name, time, days, active, model, notify, description, timeout, retry`. Note values are **quoted strings** (`active: 'true'`, `retry: '0'`), not booleans/ints — parse defensively.

**(b) Schedule derivation feeding `computeNextRun`** — analog `src/scheduler.ts` lines 276-279:
```typescript
export function computeNextRun(cronExpression: string): number {
  const interval = CronExpressionParser.parse(cronExpression);
  return Math.floor(interval.next().getTime() / 1000);
}
```
The mapping helper (`time`+`days` → cron string) is **new code**, but it must emit a string that `CronExpressionParser.parse` accepts, then call the existing `computeNextRun`. Do not add a second scheduling engine (D-08a). The full grammar to cover is in
`/Users/shannongueringer/App Repo/agentic-os/cron/templates/schedule-reference.md` lines 13-47:
- Exact `time: "09:00"` → `0 9 * * <days>`
- Multi-time `time: "09:00,17:00"` → **one row**, comma cron field `0 9,17 * * <days>` (D-08a)
- Interval `every_5m`→`*/5 * * * *`, `every_30m`→`*/30 * * * *`, `every_4h`→`0 */4 * * *`
- `days`: `daily`→`*`, `weekdays`→`1-5`, `weekends`→`0,6`, single `mon`→`1`, lists `mon,wed,fri`→`1,3,5`
- Raw `cron:` frontmatter field, if present, wins over `time`+`days` (D-08)

**(c) Row create/update (CRUD projection)** — analog `src/db.ts` lines 1261-1273 and 1342-1355:
```typescript
export function createScheduledTask(
  id: string, prompt: string, schedule: string, nextRun: number, agentId = 'main',
): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO scheduled_tasks (id, prompt, schedule, next_run, status, created_at, agent_id)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  ).run(id, prompt, schedule, nextRun, now, agentId);
}
```
Sync is upsert-shaped: one row per job, scoped `agent_id = 'aos'`, `source = 'aos-cron'`. `updateScheduledTask` (1342-1355) is the existing partial-patch precedent — extend it (or mirror it) for the new columns. **Deactivate-orphan (D-07):** when a `.md` is gone, set the row inactive — use the `pauseScheduledTask` pattern (1357-1359), not `deleteScheduledTask`, to preserve `last_result`. Dormant jobs (`active: 'false'`) are written with a paused/inactive status so they show on the dashboard but never fire.

**Prompt re-read at fire time (D-07):** do NOT store the body in `prompt` permanently as source of truth — the sync stores it, but the firing loop must re-read the `.md` body before each run so edits take effect with no restart. The DB row is a derived projection (handoff doc lines 10-13).

---

### `src/scheduler.ts` — aos firing loop (MODIFIED: service, event-driven)

**Analog:** self — `initScheduler` (43-73), `runDueTasks` (75-153), `runDueMissionTasks` (155-168), `startMissionTask` (171-274).

**Init + per-agent stuck recovery** (lines 43-73): `initScheduler(send, 'aos')` already takes an `agentId`, sets `schedulerAgentId`, recovers stuck tasks via `resetStuckTasks(agentId)`, and ticks every 60s. The aos service calls this verbatim with `'aos'`. The `if (agentId === 'main')` offline-agent recovery block (61-69) stays main-only.

**Firing loop with in-memory guard + DB lock + message queue** (lines 82-148) — the shape the aos loop copies:
```typescript
for (const task of tasks) {
  if (runningTaskIds.has(task.id)) { /* skip duplicate */ continue; }
  const nextRun = computeNextRun(task.schedule);
  runningTaskIds.add(task.id);
  markTaskRunning(task.id, nextRun);          // advance next_run NOW to prevent re-fire
  // ...
  messageQueue.enqueue(chatId, async () => {  // single-flight: no two Claude runs on one session
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);
    try {
      const result = await runAgent(task.prompt, undefined, () => {}, undefined, undefined, abortController, undefined, agentMcpAllowlist);
      // ... aborted → updateTaskAfterRun(..., 'timeout'); else success
    } catch (err) { updateTaskAfterRun(task.id, nextRun, errMsg.slice(0,500), 'failed'); }
    finally { runningTaskIds.delete(task.id); }
  });
}
```
Aos-cron deltas the planner must apply on top of this shape:
- **Suppress the preamble (D-12):** line 106 (`await sender('Scheduled task running: …')`) must NOT fire for aos-cron rows. The retired engine had no preamble.
- **`notify:` governs chat output (D-03/D-12):** `on_finish` → send result (the `splitMessage(formatForTelegram(text))` loop, 120-122); `on_failure` → send only on error/timeout (141 / 114). Read the row's notify policy, branch on it.
- **Per-job timeout (D-10):** replace the fixed `TASK_TIMEOUT_MS` (line 27, `10 * 60 * 1000`) with a parsed per-row timeout (`'5m'/'10m'/'15m'`), falling back to `TASK_TIMEOUT_MS` when absent.
- **Retry N (D-11):** wrap the `runAgent` call in a retry loop (up to N from the row), only recording failed + firing `on_failure` after the last attempt.
- **Re-read prompt body at fire time (D-07):** `task.prompt` in the DB is the projection; re-read the `.md` body before `runAgent`.
- **cwd / context:** aos runs as the workspace agent — see the agent-identity section; the aos service process (`--agent aos`) already runs in agentic-os cwd via its `project_dir`, so `runAgent` inherits the right CLAUDE.md.

---

### `src/db.ts` — generalized atomic claim (MODIFIED: model, CRUD atomic-claim)

**Analog A — the lock to generalize**, `markTaskRunning` lines 1301-1312:
```typescript
export function markTaskRunning(id: string, tentativeNextRun?: number): void {
  const now = Math.floor(Date.now() / 1000);
  if (tentativeNextRun !== undefined) {
    db.prepare(
      `UPDATE scheduled_tasks SET status = 'running', started_at = ?, next_run = ? WHERE id = ?`,
    ).run(now, tentativeNextRun, id);
  } else { /* ... */ }
}
```
This is currently a blind `WHERE id = ?`. **D-06 wants the cross-process backstop:** add the status predicate so the claim is atomic and can fail when another process already took it:
`UPDATE scheduled_tasks SET status='running', started_at=?, next_run=? WHERE id=? AND status='active'` — then check `result.changes === 1` to decide whether *this* process won the claim.

**Analog B — the transactional claim precedent**, `claimNextMissionTask` lines 2269-2286:
```typescript
export function claimNextMissionTask(agentId: string): MissionTask | null {
  const txn = db.transaction(() => {
    const task = db.prepare(
      `SELECT * FROM mission_tasks WHERE assigned_agent = ? AND status = 'queued'
       ORDER BY priority DESC, created_at ASC LIMIT 1`,
    ).get(agentId) as MissionTask | undefined;
    if (!task) return null;
    db.prepare(`UPDATE mission_tasks SET status = 'running', started_at = ? WHERE id = ?`)
      .run(Math.floor(Date.now() / 1000), task.id);
    return { ...task, status: 'running' as const, started_at: Math.floor(Date.now() / 1000) };
  });
  return txn();
}
```
This is the SELECT-then-claim-in-one-transaction pattern. The new `claimDueTask(agentId)` (or generalized `markTaskRunning`) should mirror this: it returns the row only if the claim succeeded (`result.changes === 1`), so two processes can never both fire the same row. This is the SCH-04 cross-process verification target.

**Scoping reads (D-06)** — `getDueTasks` lines 1275-1282 already filters `agent_id = ?`:
```typescript
`SELECT * FROM scheduled_tasks WHERE status = 'active' AND next_run <= ? AND agent_id = ? ORDER BY next_run`
```
aos rows are `agent_id='aos'`, so the aos loop's `getDueTasks('aos')` and main's `getDueTasks('main')` never overlap. `resetStuckTasks` (1326-1331) is likewise agent-scoped.

**`ScheduledTask` type** (lines 1247-1259) gains the new columns (`source`, job-file path, `model`, `timeout`, `notify`, plus whatever holds active/retry). Update this interface alongside the migration.

---

### `migrations/<ver>/<slug>.ts` — new `scheduled_tasks` columns (NEW: migration, schema)

**This is a custom SQLite migration system, NOT Prisma/Drizzle.** Do not write ORM migrations.

**Scaffold via the skill**, `.claude/skills/add-migration/SKILL.md` lines 52-68 — the file shape:
```typescript
export const description = '<what this migration does>';

export async function run(): Promise<void> {
  // TODO: implement migration
}
```
The skill (steps 5-7) creates `migrations/<version>/<slug>.ts`, appends the filename to `migrations/version.json` under the version key, and bumps `package.json`. `version.json` is currently empty (`{ "migrations": {} }`), so this is the **first** registered migration — base the version on `package.json` per SKILL step 1.

**The `run()` body** uses the same idempotent `PRAGMA table_info` + conditional `ALTER` pattern the in-code migrations use (`src/db.ts` lines 503-525):
```typescript
const taskCols = database.prepare(`PRAGMA table_info(scheduled_tasks)`).all() as Array<{ name: string }>;
if (!taskCols.some((c) => c.name === 'agent_id')) {
  database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main'`);
}
```
Mirror this for each new column (`source`, `job_path`, `model`, `timeout`, `notify`, ...). The migration must open the DB itself (the in-code ones receive `database`); follow how other `run()` migrations acquire the handle — open `store/claudeclaw.db` via the same `better-sqlite3` import `db.ts` uses. **Per D-09: do NOT add these as inline `addColumnIfMissing` edits in `createSchema` — they ship as the versioned migration.**

**Runner contract**, `scripts/migrate.ts` lines 240-267: `npm run migrate` imports each pending `<ver>/<file>.ts`, calls `mod.run()`, then writes `migrations/.applied.json`. **Deploy ordering (D-09):** `checkPendingMigrations` (`src/migrations.ts` 53-62) `process.exit(1)`s the bot on startup if the migration is registered but unapplied — so `npm run migrate` MUST run before restart.

---

### `launchd/com.claudeclaw.aos.plist` — new aos service (NEW: config, process)

**Analog:** `launchd/com.claudeclaw.comms.plist` (the per-agent standalone-service template — NOT a nonexistent `com.claudeclaw.app.plist`):
```xml
<key>Label</key>
<string>com.claudeclaw.comms</string>
<key>ProgramArguments</key>
<array>
  <string>__NODE_PATH__</string>
  <string>dist/index.js</string>
  <string>--agent</string>
  <string>comms</string>
</array>
<key>WorkingDirectory</key>
<string>__PROJECT_DIR__</string>
<key>RunAtLoad</key>
<true/>
<key>KeepAlive</key>
<true/>
<key>ThrottleInterval</key>
<integer>30</integer>
<key>StandardOutPath</key>
<string>__PROJECT_DIR__/logs/comms.log</string>
<key>StandardErrorPath</key>
<string>__PROJECT_DIR__/logs/comms.log</string>
```
For `com.claudeclaw.aos`: Label → `com.claudeclaw.aos`, the `--agent` arg → `aos`. `RunAtLoad` + `KeepAlive` + `ThrottleInterval 30` carry over for D-05's network-not-ready crash recovery.

**D-05 / CLAUDE.md launchd rules — the diverging detail:** the comms plist uses `__PROJECT_DIR__/logs/comms.log`, but the live ClaudeClaw project path **contains spaces** (`/Users/shannongueringer/App Repo/claudeclaw`). launchd exits 78 (`EX_CONFIG`) on spaces in `StandardOutPath`/`StandardErrorPath` (CLAUDE.md lines 86-94). So for aos:
- `StandardOutPath`/`StandardErrorPath` → `/tmp/claudeclaw-aos.log` (no spaces). Do NOT copy the `__PROJECT_DIR__/logs/...` form.
- `WorkingDirectory` → the `~/.claudeclaw-app` symlink (spaces are fine for `WorkingDirectory`, but the symlink is the project convention for the spaced path).

---

### `src/index.ts` — wire `syncAosCronJobs()` at startup (MODIFIED: config, boot)

**Analog:** the two existing boot hooks in `main()`:
- `checkPendingMigrations(PROJECT_ROOT)` at line 119 (migration gate runs first).
- `initScheduler(async (text) => { await notifyUser(text); }, AGENT_ID)` at line 357.

`syncAosCronJobs()` should run on the **aos** process boot, before `initScheduler(send, 'aos')` fires the loop, so rows exist before the first tick. Place it adjacent to the `initScheduler` call (357), gated to `AGENT_ID === 'aos'`. The `initScheduler` call already passes `AGENT_ID`, so when the aos service starts (`--agent aos`), it naturally calls `initScheduler(send, 'aos')` — no signature change needed.

---

### agent identity / cwd resolution for `aos` (read-only analogs)

**`aos` agent.yaml** (`agents/aos/agent.yaml` or `~/.claudeclaw/agents/aos/`): `project_dir: /Users/shannongueringer/App Repo/agentic-os`, currently delegation-only ("no standalone service"). Phase 7 promotes it to a standalone service via the plist above.

**cwd + CLAUDE.md context**, `src/agent-config.ts` `resolveAgentRuntime` lines 262-280:
```typescript
const cwd =
  config.projectDir && fs.existsSync(config.projectDir)
    ? config.projectDir
    : resolveAgentDir(agentId);
// ... systemPrompt = fs.readFileSync(resolveAgentClaudeMd(agentId), 'utf-8')
return { agentId, cwd, model: resolveAgentModel(config.model), systemPrompt, mcpAllowlist: config.mcpServers };
```
When the aos service runs as `--agent aos`, this resolves cwd to agentic-os so the SDK auto-loads that workspace's CLAUDE.md. `isWorkspaceAgent('aos')` (234-241) returns true (it has an existing `project_dir`).

**Offline-agent skip (D-06)**, `src/agent-create.ts` `isAgentRunning` lines 845-854:
```typescript
export function isAgentRunning(agentId: string): boolean {
  const pidFile = path.join(STORE_DIR, `agent-${agentId}.pid`);
  if (!fs.existsSync(pidFile)) return false;
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    return isProcessAlive(pid);
  } catch { return false; }
}
```
`main`'s offline-agent fallback in `runDueMissionTasks` (scheduler.ts 162-167) already skips agents where `isAgentRunning(agent.id)` is true. **D-06 extends this to scheduled tasks:** main must NOT claim `aos` rows when the aos service is live. With agent-scoped `getDueTasks` (main only reads `'main'`), this is already structurally enforced for scheduled tasks; the atomic-claim backstop covers the race window during aos startup/shutdown.

---

### `command-centre/src/instrumentation.ts` — `CRON_IN_PROCESS` gate (MODIFIED: agentic-os repo, config)

**Analog:** self, lines 14-16 (the unconditional call to gate):
```typescript
// Start the in-process cron scheduler used while the Command Centre is running.
const { initCronScheduler } = await import("./lib/cron-scheduler");
initCronScheduler();
```
**D-01:** wrap line 16 behind an env check so booting CC no longer starts a second scheduler:
```typescript
if (process.env.CRON_IN_PROCESS !== "0") {
  const { initCronScheduler } = await import("./lib/cron-scheduler");
  initCronScheduler();
}
```
(Exact env name/semantics is Claude's discretion per CONTEXT; `CRON_IN_PROCESS=0` is the handoff doc's suggestion, lines 30-33.) This is defense-in-depth in the **agentic-os** repo — a cross-repo edit, sequence it in the cutover step last (specifics: never disable the old engine before the new path fires a real job).

---

## Shared Patterns

### Single-flight via message queue
**Source:** `src/scheduler.ts` line 101 (`messageQueue.enqueue(chatId, async () => { ... })`)
**Apply to:** the aos firing loop. Two Claude runs must never hit one session; every fire goes through `messageQueue.enqueue`. (CONTEXT names this as Claude's-discretion for how the aos service shares the discipline — the answer is: reuse `messageQueue.enqueue` exactly as `runDueTasks` does.)

### Atomic claim = `WHERE … AND status=…` + `changes` check
**Source:** `src/db.ts` `claimNextMissionTask` (2269-2286), `markTaskRunning` (1301-1312)
**Apply to:** the generalized scheduled-task claim. The status predicate in the UPDATE is what makes it cross-process safe; check `result.changes`.

### Per-agent scoping via `agent_id`
**Source:** `src/db.ts` `getDueTasks` (1279), `resetStuckTasks` (1328)
**Apply to:** all aos row reads/writes — scope to `agent_id='aos'` so main and aos loops never contend.

### Idempotent column add via `PRAGMA table_info`
**Source:** `src/db.ts` lines 503-525
**Apply to:** the migration `run()` body — guard each `ALTER` with a `PRAGMA table_info` existence check so re-runs are safe.

### Status/result bookkeeping in the row
**Source:** `src/db.ts` `updateTaskAfterRun` (1314-1324) — sets `last_run`, `next_run`, `last_result`, `last_status`
**Apply to:** aos job results (D-03: DB row + Slack only; no `cron/status/*.json` or `cron/logs/*.log`).

---

## No Analog Found

None. Every target maps to a real in-repo pattern. The two genuinely-new pieces are:
- The `time`+`days`→cron **mapping table** (new logic, but it feeds the existing `computeNextRun`; grammar source = `cron/templates/schedule-reference.md`).
- The `.md` frontmatter+body **parser** (new, but built from `js-yaml` exactly as `loadAgentConfig` parses agent.yaml).

Both are net-new functions inside the otherwise-analog `src/aos-cron.ts`; the planner should treat them as fresh code with the cited grammar/parse references, not as copies of an existing file.

## Metadata

**Analog search scope:** `src/` (scheduler, db, agent-config, agent-create, index, schedule-cli, migrations), `scripts/`, `migrations/`, `launchd/`, `.claude/skills/add-migration/`, and the agentic-os repo (`cron/jobs/`, `cron/templates/`, `cron/SCHEDULER-HANDOFF.md`, `command-centre/src/instrumentation.ts`).
**Files scanned:** ~15
**Pattern extraction date:** 2026-06-17
