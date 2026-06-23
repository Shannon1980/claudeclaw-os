# Phase 2: Routines - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 11 (3 new backend, 1 new test, 3 modified backend/db, 1 new + ~8 sub-components UI, plus a versioned migration)
**Analogs found:** 11 / 11 (exact or strong role-match for every file)

This phase is extension work, not greenfield. Nearly every new file has a near-verbatim analog already in the repo. All line numbers below are verified against current source this session. **Copy these patterns; do not invent new ones.**

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/routine-runner.ts` (NEW) | service (scheduler runner) | batch / event-driven | `runAosCronTaskOnce` in `src/scheduler.ts:127-217` + `delegateToAgent` in `src/orchestrator.ts:147-285` | exact (role + flow) |
| `src/routine-draft.ts` (NEW) | service (LLM transform) | transform (NL → JSON) | `parseJson`/router prompt in `src/warroom-text-router.ts:143-160` | role-match |
| `src/scheduler.ts` (MODIFY) | service (scheduler loop) | event-driven | itself — add `source==='routine'` branch mirroring `:244-264` | exact |
| `src/db.ts` (MODIFY) | model / storage | CRUD | `warroom_meetings`/`warroom_transcript` FK pair `:272-291`; `scheduled_tasks` CRUD `:1271-1434` | exact |
| `migrations/v1.2.2/add-routine-tables.ts` (NEW) | migration | batch | `migrations/v1.2.1/add-aos-cron-scheduled-task-columns.ts` (whole file) | exact |
| `src/dashboard.ts` (MODIFY) | controller (HTTP routes) | request-response / CRUD | `/api/tasks*` handlers `:1507-1571` | exact |
| `src/routine-runner.test.ts` (NEW) | test | — | `src/scheduler.test.ts` (`AosFireDeps` injection) + `parseTimeout` pure-fn tests | role-match |
| `src/db.test.ts` (EXTEND) | test | — | itself — `_initTestDatabase()` real in-memory SQLite (`db.ts:786`) | exact |
| `src/dashboard.contract.test.ts` (EXTEND) | test | — | itself — `GET /api/tasks` block `:276-298` | exact |
| `web/src/pages/Routines.tsx` (NEW) | component (page) | request-response | `web/src/pages/Scheduled.tsx` (whole page) | exact |
| `web/src/components/{RoutineRow,RoutineDetail,StepList,StepRow,TeammateTag,RunHistoryItem,RoutineBuilderPanel,AutonomySelector,RunOutcomeBadge}.tsx` (NEW) | components | — | Row → Scheduled.tsx card; TeammateTag → `teammateColor` `Team.tsx:58-65`; schedule editor → `ScheduleBuilder.tsx`; badges → `Pill` | exact / role-match |
| `web/src/lib/routes.ts` (MODIFY) | config | — | itself — nav table `:28-41` | exact |

## Pattern Assignments

### `src/routine-runner.ts` (NEW — service, batch/event-driven)

Two analogs combine here. The **claim/queue/finally lock skeleton** comes from the aos-cron branch; the **per-step teammate execution** comes from `delegateToAgent`.

**Analog A — one-claim lock + messageQueue + finally guard** (`src/scheduler.ts:244-264`, copy this skeleton into the new `source==='routine'` branch of `runDueTasks`):
```typescript
if (task.source === AOS_CRON_SOURCE) {
  if (!claimDueTask(task.id, nextRun)) continue;   // ← ONE claim per run (anti-double-fire)
  runningTaskIds.add(task.id);
  const chatId = ALLOWED_CHAT_ID || 'scheduler';
  messageQueue.enqueue(chatId, async () => {        // ← serialize vs live user turns
    try {
      await runAosCronTaskOnce(task, nextRun, { sender, runAgent: (...) => ... });
    } finally {
      runningTaskIds.delete(task.id);               // ← remove in finally, always
    }
  });
  continue;
}
```
**Critical invariant (Pitfall 1):** `claimDueTask` is called ONCE at the top, never per step. `claimDueTask` itself (`db.ts:1376-1384`) does `UPDATE ... WHERE id = ? AND status = 'active'` and returns `changes === 1`. Mirror exactly.

**Analog B — run a step as its teammate** (`src/orchestrator.ts:147-285`). Signature to call (do NOT spawn `claude` yourself):
```typescript
export async function delegateToAgent(
  agentId: string, prompt: string, chatId: string, fromAgent: string,
  onProgress?: (msg: string) => void, timeoutMs = DEFAULT_TIMEOUT_MS,
  abortCtrl?: AbortController,
): Promise<DelegationResult>   // DelegationResult.text : string | null
```
`delegateToAgent` resolves the teammate's cwd/CLAUDE.md/model/MCP allowlist via `resolveAgentRuntime` (orchestrator.ts:192) and logs to `inter_agent_tasks`/`hive_mind`. The mission path already calls it this way (`scheduler.ts:385-393`): `delegateToAgent(delegateAgentId, mission.prompt, chatId, 'main', undefined, TASK_TIMEOUT_MS, abortController)`.

**Dependency-injection pattern for testability** — copy `AosFireDeps` (`scheduler.ts:55-61`). The aos runner takes injected `{ sender, runAgent }` so tests run without the queue/interval/subprocess. Do the same: `runRoutineOnce(task, steps, nextRun, { sender, delegateToAgent })`.

**Outcome derivation** — keep it a pure function (`deriveOutcome(results, steps, halted): 'ok'|'degraded'|'failed'`) so it tests like `parseTimeout` (`scheduler.ts:40-47`, a pure exported fn with a regex and fallback). Encode D-02: `halted → failed`; `!anyUsefulOutput → failed`; `every ok → ok`; else `degraded`.

**Post-run bookkeeping** — reuse `updateTaskAfterRun(id, nextRun, result, lastStatus)` (`db.ts:1386-1396`); it already slices `result` to 4000 chars and resets `status='active'`/`started_at=NULL`. Map routine outcome → its `'success'|'failed'|'timeout'` enum.

### `src/routine-draft.ts` (NEW — service, transform NL→JSON)

**Analog:** `src/warroom-text-router.ts:143-160` — the verified JSON-from-LLM parse. Copy `parseJson` verbatim (rename to `parseJsonLoose`):
```typescript
function parseJson<T>(text: string): T | null {
  if (!text) return null;
  const stripped = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);   // first {...} block fallback
    if (m) { try { return JSON.parse(m[0]) as T; } catch { /* fall through */ } }
    return null;
  }
}
```
**Prompt style** — the router's system prompt (`warroom-text-router.ts:139-140`) ends with `Respond with ONLY a JSON object, no prose, no code fences:` followed by the exact shape. Mirror that for the draft: `{ cron, schedule_text, steps: [{ action, agent_id, on_error }] }`.
**Shape validation after parse** — `warroom-text-router.ts:162-169` (`sanitizeDecision`) builds `new Set(ctx.roster.map(a => a.id))` and rejects unknown ids. Do the same: validate `agent_id` against `listAgentIds()`, fall back to `'main'`; validate the assembled `cron` with `computeNextRun(cron)` (throws on invalid — same call the PATCH route uses, see below); default `on_error: 'continue'` (D-01).
**Why server-side:** `runAgent` runs the SDK subprocess with scrubbed env; the browser cannot call it. The panel is a thin renderer over the returned draft (D-05: nothing persists here).

### `src/db.ts` (MODIFY — model, CRUD)

**Companion-table analog** — `warroom_meetings` + `warroom_transcript` (`db.ts:272-291`), the exact FK-with-CASCADE + index pattern to copy for `routine_steps`/`routine_runs`:
```sql
CREATE TABLE IF NOT EXISTS warroom_transcript (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id  TEXT NOT NULL,
  ...
  FOREIGN KEY (meeting_id) REFERENCES warroom_meetings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_warroom_transcript_meeting ON warroom_transcript(meeting_id, created_at);
```
Add both new tables inside `createSchema` (`db.ts:70`), FK → `scheduled_tasks(id) ON DELETE CASCADE`, with the matching `CREATE INDEX IF NOT EXISTS`.

**Additive column (dual-write)** — `runMigrations` (`db.ts:477`) already chains `addColumnIfMissing(database, 'scheduled_tasks', 'source', "TEXT NOT NULL DEFAULT 'user'")` etc. at `:535-540`. Add one line in the same block:
```typescript
addColumnIfMissing(database, 'scheduled_tasks', 'autonomy', `TEXT NOT NULL DEFAULT 'unattended'`);
```
`addColumnIfMissing` (`db.ts:460-474`) is PRAGMA-guarded + tolerates `duplicate column` — idempotent.

**Interface + CRUD analog** — extend `ScheduledTask` (`db.ts:1271-1291`) with `autonomy: string` (mirror how the aos-cron fields were appended at `:1283-1290`). Model new CRUD fns on the existing ones:
- `getRoutineSteps(routineId)` → `getDueTasks` style prepared-statement `.all()` (`db.ts:1307-1314`), ordered `by step_order`.
- `saveRoutineRun(...)` → `createScheduledTask` style parameterized `INSERT` (`db.ts:1293-1305`). **Always parameterized `better-sqlite3` statements — never string-concat user text (SQLi).**
- `getLastRoutineOutcome(routineId)` → single-row `.get()` ordered `ran_at DESC LIMIT 1`.
On/off reuse: `pauseScheduledTask`/`resumeScheduledTask` already exist (`db.ts:1429-1434`, `status='paused'|'active'`) — RTN-04 needs no new pause logic.

### `migrations/v1.2.2/add-routine-tables.ts` (NEW — migration)

**Analog:** `migrations/v1.2.1/add-aos-cron-scheduled-task-columns.ts` (whole file, 45 lines) — copy its structure exactly:
- `export const description = '...'`
- `export async function run()` opens its own handle: `new Database(path.join(process.cwd(), 'store', 'claudeclaw.db'))` (never an absolute out-of-repo path — the migrate runner warns on those).
- PRAGMA-guarded `has(name)` existence check before each `ALTER`; `CREATE TABLE IF NOT EXISTS` for the new tables.
- `finally { db.close(); }`.

Then register it in `migrations/version.json` (currently `{"migrations": {"v1.2.1": ["add-aos-cron-scheduled-task-columns"]}}`) by adding `"v1.2.2": ["add-routine-tables"]`. **Dual-write is mandatory** (Pitfall 3 / MEMORY.md): the `addColumnIfMissing` in `runMigrations` AND this versioned file, or `checkPendingMigrations` crash-loops on the live DB. Run `npm run migrate` before restart.

### `src/dashboard.ts` (MODIFY — controller, request-response/CRUD)

**Analog:** the `/api/tasks*` block (`dashboard.ts:1507-1571`). Mirror these for `/api/routines*`:
- List: `app.get('/api/routines', c => c.json({ routines }))` ← `:1507-1510`.
- Delete: `app.delete('/api/routines/:id', ...)` ← `:1513-1517` (FK CASCADE wipes steps/runs).
- Pause/resume: `app.post('/api/routines/:id/pause'|'/resume', ...)` ← `:1560-1571` verbatim (calls `pauseScheduledTask`/`resumeScheduledTask`).
- **Cron validation** (RTN-02 / V5) — copy the PATCH pattern `:1539-1547`:
  ```typescript
  try { patch.nextRun = computeNextRun(cron); patch.schedule = cron; }
  catch (err: any) { return c.json({ ok: false, error: 'invalid cron: ' + ... }, 400); }
  ```
- **Run-now** — new `app.post('/api/routines/:id/run', ...)`: `getAllScheduledTasks().find(t => t.id===id && t.source==='routine')`, `computeNextRun(task.schedule)`, `if (!claimDueTask(id, nextRun)) return c.json({...}, 409)`, then enqueue the runner via a thin exported wrapper. Same one-claim lock as the scheduler (Pattern 3); 409 on already-running.
- **Draft** — `app.post('/api/routines/draft', ...)` calls `assembleRoutineDraft(description)` and returns JSON only. **Must NOT write any rows** (D-05) — the contract test asserts this.

`buildDashboardApp(relayToUser?)` (`dashboard.ts:225`) already threads the transport sender; routines run-now/draft live inside it. Auth is the existing token gate (`:334`, `:345`) — no new auth surface.

### Tests (Wave 0)

- `src/routine-runner.test.ts` (NEW): pattern is `parseTimeout`-style pure-fn tests for `deriveOutcome` (incl. the all-continue-fail → `failed` edge), plus injected-deps tests using the `AosFireDeps` shape (`scheduler.test.ts`) — mock `delegateToAgent`/`sender`. Cover step threading, paused-teammate skip, one-claim/no-double-fire, notify-transition (D-10).
- `src/db.test.ts` (EXTEND): use `_initTestDatabase()` (`db.ts:786` — real in-memory SQLite) and round-trip `routine_steps`/`routine_runs` + the `autonomy` column.
- `src/dashboard.contract.test.ts` (EXTEND): copy the `GET /api/tasks` block (`:276-298`) and the helpers (`get()` `:37`, `_initTestDatabase()` in `beforeEach` `:33`, `TOKEN`/`Q` `:24-25`). Add `/api/routines*` shape tests + a **draft-does-not-persist** assertion.

### `web/src/pages/Routines.tsx` + components (NEW — Preact)

**Page analog:** `web/src/pages/Scheduled.tsx` (whole file). Copy its skeleton:
- Imports (`:1-15`): `PageHeader`, `Pill`, `PageState`, `ConfirmModal`, `useFetch`, `apiPost`/`apiDelete`, `formatRelativeTime`, `term`, `pushToast`, `describeCron`. Path alias `@/...`.
- Data load: `const { data, loading, error, refresh } = useFetch<{routines:[]}>('/api/routines', 30_000)` ← `:53`.
- `formatCountdown` (`:33-40`) — reuse for the next-run "in 3h" accent text.
- `RunOutcomeBadge` → `Pill` tones `done`/`medium`/`failed` (UI-SPEC color table).
- `TeammateTag` → reuse `teammateColor(id)` from `Team.tsx:58-65` verbatim (Research `#a78bfa`, Comms `#2dd4bf`, Content `#fb7185`, Ops `#f59e0b`, fallback `var(--color-accent)`).
- Schedule editor (detail "Change" + builder) → `ScheduleBuilder` props `{ cron, onChange, externalError }` (`ScheduleBuilder.tsx:20-25`); its **"Advanced (cron)"** toggle (`:226-233`) IS the D-06 raw-cron escape hatch — never default-show cron.
- Route entry: add to `web/src/lib/routes.ts` nav table (`:28-41`); the Routines slot likely reuses `vocabKey: 'nav.routines'` (currently on `/scheduled` at `:30`). All labels go through `term()`.

## Shared Patterns

### Anti-double-fire claim (the load-bearing invariant)
**Source:** `claimDueTask` `db.ts:1376-1384` + branch `scheduler.ts:244-264`.
**Apply to:** `routine-runner.ts` AND the `/api/routines/:id/run` route.
One claim per routine run (advancing `next_run`), `runningTaskIds.add` then remove in `finally`. Never per-step. A scheduled tick and a run-now both 409 if the row isn't `status='active'`.

### messageQueue serialization
**Source:** `scheduler.ts:252,276` — `messageQueue.enqueue(chatId, async () => {...})`.
**Apply to:** every routine fire (scheduled + run-now). Routine runs MUST go through the per-chat queue so they wait for in-flight user turns — never bypass it.

### State-change notification (D-09/D-10)
**Source:** in-process `sender` set by `initScheduler` (`scheduler.ts:63,81`) / `relayToUser` (`index.ts:230-239`, resolves to `slack.postToUser`).
**Apply to:** `routine-runner.ts` only on transition `(prior==='ok'||null) && (now==='degraded'||'failed')`. Silent on success; do NOT re-alert subsequent breaks. **Do NOT shell out to `scripts/notify.sh` from Node** — use the injected `sender`.

### Parameterized SQL everywhere
**Source:** every `db.prepare(...).run(...)` in `db.ts` (e.g. `createScheduledTask` `:1301`).
**Apply to:** all new routine CRUD. Never string-concat user step text / routine name into SQL.

### Vocabulary + describeCron (no raw cron in operator path)
**Source:** `term()` (`lib/vocabulary.ts`), `describeCron(cron).text` (`lib/cron.ts:195`).
**Apply to:** every routine row/detail. Render `describeCron(...).text`, never the raw `schedule` string, in the operator UI.

## No Analog Found

None. Every file has an exact or strong role-match analog in-repo. The genuinely new logic is small and isolated: `deriveOutcome` (pure, ~8 lines, D-02), the step-threading loop in `runRoutineOnce`, and the autonomy selector UI — all built on the patterns above.

## Metadata

**Analog search scope:** `src/` (scheduler, db, orchestrator, dashboard, warroom-text-router, index), `migrations/`, `web/src/{pages,components,lib}/`, `src/*.test.ts`.
**Files scanned:** 11 analogs read at targeted ranges; all line citations verified this session.
**Pattern extraction date:** 2026-06-23
