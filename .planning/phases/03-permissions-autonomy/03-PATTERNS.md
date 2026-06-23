# Phase 3: Permissions & Autonomy - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 16 (5 new src, 4 edited src, 1 new migration, 3 new/edited test, several new web components in 2 edited pages)
**Analogs found:** 16 / 16 (all have strong in-repo analogs — this phase is wiring existing primitives)

> **Branch note:** Phase 2 routine code IS present on this branch (`src/routine-runner.ts`, `src/scheduler.ts` `source==='routine'` branch + `triggerRoutineRun`, `routine_runs`/`routine_steps` tables, `migrations/v1.2.2/add-routine-tables`). The routine→gate seam is REAL — bind `GateContext` to `runRoutineOnce`'s `execContext.autonomy` (routine-runner.ts:96). Latest migration is **v1.2.2**, so the new approval_queue migration is **v1.2.3**.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/gate.ts` (NEW) | middleware (tool-call interceptor) | request-response (per tool call) | `src/kill-switches.ts` (`requireEnabled` chokepoint) + `src/agent.ts:122-129` (tool-name parsing) | role-match |
| `src/permissions-config.ts` (NEW) | config/service | CRUD over k/v | `src/db.ts:3581-3598` (`getDashboardSetting`/`setDashboardSetting`) + `src/db.ts:2777-2803` (paused-agents JSON-in-settings) | exact (thin wrapper) |
| `src/approval-queue.ts` (NEW) | service | CRUD + state machine | `src/db.ts:1561-1604` (`saveRoutineRun`/`getRoutineRuns`/`getLastRoutineOutcome`) | exact (companion-table CRUD) |
| `src/db.ts` (EDIT: approval_queue table + getters + addColumnIfMissing mirror) | model/migration | DDL | `src/db.ts:90-112` (`routine_steps`/`routine_runs` in `createSchema`) + `:489-503` (`addColumnIfMissing`) | exact |
| `migrations/v1.2.3/create-approval-queue.ts` (NEW) | migration | DDL | `migrations/v1.2.2/add-routine-tables.ts` | exact |
| `src/agent.ts` (EDIT: wire canUseTool, drop bypass, thread gateCtx) | service (SDK call site) | request-response | `src/agent.ts:246-282` itself (the `query()` options block) | exact (self) |
| `src/scheduler.ts` (EDIT: build background gateCtx) | service (background driver) | event-driven (poll) | `src/scheduler.ts:259-313` (existing `runAgent`/`runRoutineOnce` callers) | exact (self) |
| `src/message-core.ts` (EDIT: build attended gateCtx + requestInline) | service (chat turn) | request-response | `src/message-core.ts` `TransportCallbacks` (106-133) + `ProcessOptions.agentRuntime` (153-159) | role-match |
| `src/dashboard.ts` (EDIT: `/api/permissions*` + `/api/approvals*`) | route/controller | CRUD (request-response) | `src/dashboard.ts:1648-1737` (`/api/routines*`) + `:1514-1574` (`/api/tasks*`) | exact |
| `src/gate.test.ts` (NEW) | test | unit | `src/db.test.ts` (`_initTestDatabase` precedent) | role-match |
| `src/approval-queue.test.ts` (NEW) | test | unit | `src/db.test.ts` | role-match |
| `src/permissions-config.test.ts` (NEW) | test | unit | `src/db.test.ts` | role-match |
| `src/dashboard.contract.test.ts` (EDIT: add permissions + approvals) | test | contract | `src/dashboard.contract.test.ts:290-303` (routines contract block) | exact (self) |
| `web/src/pages/Settings.tsx` (EDIT: PermissionsSection + new components) | component (page) | request-response | `Settings.tsx` `Section`/`Card`/`Row`/`ReadOnlyRow` (427-468) + `ThemePicker` (211-240) | exact |
| `web/src/pages/Home.tsx` + `web/src/components/DailyLoop.tsx` (EDIT: ApprovalItem in NeedsYouCard) | component | request-response | `DailyLoop.tsx` `NeedsItem` (104-189) | exact |
| `web/src/components/AutonomySelector.tsx` (REUSE pattern for override segments) | component | — | `AutonomySelector.tsx:30-57` (segmented control) | exact |

---

## Pattern Assignments

### `src/gate.ts` (middleware, request-response — the core new seam)

**Analogs:** `src/kill-switches.ts` (single-chokepoint precedent), `src/agent.ts:122-129` (tool-name parsing), `src/security.ts:108-113` (`audit()`).

**Tool-name parsing pattern to copy** (`src/agent.ts:122-129` — the classifier reuses this exact split):
```typescript
function toolLabel(toolName: string): string {
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName];
  // MCP tools: mcp__server__tool → "server: tool"
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    return parts.length >= 3 ? `${parts[1]}: ${parts.slice(2).join(' ')}` : toolName;
  }
  return toolName;
}
```
`classifyTier` keys off these same shapes: bare PascalCase built-ins (`TOOL_LABELS` keys at `agent.ts:108-120` enumerate them — `Read/Write/Edit/Bash/Grep/Glob/WebSearch/WebFetch/Agent/NotebookEdit/AskUserQuestion`) and `mcp__<server>__<tool>` MCP names.

**Single-chokepoint + typed-error + fail-safe pattern** (`src/kill-switches.ts:116-121`) — mirror this for the gate's enforcement posture; per L-2 the gate fails to ASK (Tier 3), never deny-all:
```typescript
export function requireEnabled(name: KillSwitch): void {
  if (!isEnabled(name)) {
    _refusalCounts[name] = (_refusalCounts[name] || 0) + 1;
    throw new KillSwitchDisabledError(name);
  }
}
```
The gate also follows the kill-switch env-flag precedent for the L-2 `PERMISSION_GATE_ENABLED` escape hatch — add it to the `KillSwitch` union (`kill-switches.ts:20-35`) if implemented as a switch, with `default: enabled` semantics (`isOff` at `:46-50`).

**Audit recording pattern** (`src/security.ts:108-113`) — call once per decision (D-10). `AuditEntry` shape is `{ agentId, chatId, action, detail, blocked }` (`security.ts:94-100`); `action` must be one of the `AuditAction` union (`security.ts:~80-92`) — **add `'permission'` to that union** since it is not present today. Encode tier/mode/outcome into the `detail` JSON string:
```typescript
export function audit(entry: AuditEntry): void {
  if (_auditCallback) {
    try { _auditCallback(entry); } catch { /* don't let audit failures block operations */ }
  }
  logger.info({ audit: true, ...entry }, `Audit: ${entry.action}`);
}
```

**`GateContext` design** (from RESEARCH Pattern 1) binds `attended`/`routineAutonomy` to real seams: `false` + `routineAutonomy` from routine-runner, `false` + no autonomy from scheduler/mission, `true` + `requestInline` from message-core. Keep gate state per-turn (closure in `makeCanUseTool(ctx)`), never module-global — mirrors the `agentRuntime`-per-turn rule.

---

### `src/permissions-config.ts` (config/service, CRUD over k/v)

**Analog:** `src/db.ts:3581-3598` (settings getters/setters) + `src/db.ts:2777-2803` (JSON-array-in-settings precedent for the paused-agents list — the exact shape for storing the overrides object).

**Settings getter/setter to wrap** (`src/db.ts:3581-3591`):
```typescript
export function getDashboardSetting(key: string): string | null {
  const row = db.prepare(`SELECT value FROM dashboard_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row ? row.value : null;
}
export function setDashboardSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO dashboard_settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value);
}
```
`getMode()` reads `permissions.mode` and defaults `'balanced'` (D-11) when null. `getOverrides()` JSON-parses `permissions.overrides` with a `try/catch → {}` fallback (RESEARCH Code Examples). `setMode` also emits a `'permission'` audit config event (D-11).

---

### `src/approval-queue.ts` (service, CRUD + state machine)

**Analog:** `src/db.ts:1561-1604` (`saveRoutineRun`/`getRoutineRuns`/`getLastRoutineOutcome`) — same companion-table CRUD shape, including the `.slice(N)` text caps and second-granularity `ran_at`/`created_at`.

**Insert pattern to copy** (`src/db.ts:1561-1580`):
```typescript
export function saveRoutineRun(routineId, outcome, stepResults, detail, output = null): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO routine_runs (routine_id, outcome, detail, output, step_results, ran_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(routineId, outcome, (detail ?? '').slice(0, 4000),
    output === null ? null : output.slice(0, 4000), JSON.stringify(stepResults ?? []), now);
}
```
`enqueueApproval` inserts a `pending` row and returns its `id`. **State-transition concurrency guard (L-3):** approve/deny use `UPDATE approval_queue SET status=? , decided_at=? WHERE id=? AND status='pending'` and act only if `.changes === 1`, so the dashboard approve and a poll race cannot double-replay. Single-connection SQLite serializes the write.

---

### `src/db.ts` (model/migration — approval_queue table + getters + addColumnIfMissing mirror)

**Analog:** `src/db.ts:90-112` (`routine_steps`/`routine_runs` in `createSchema`) — copy the `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` shape. Place the new table in `createSchema` (around the `audit_log` block at `:322-332`). The full DDL is specified in RESEARCH Code Examples (approval_queue with `tool_name`, `tool_input` JSON, `tier`, `mode_at_decision`, `summary`, `status`, `decided_at`, `result`, plus the two indices).

**`audit_log` table** (`src/db.ts:322-332`) — reuse as-is; no schema change needed (D-10 says encode into `detail`):
```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL DEFAULT 'main',
  chat_id  TEXT NOT NULL DEFAULT '',
  action   TEXT NOT NULL,
  detail   TEXT NOT NULL DEFAULT '',
  blocked  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
```

**Dual-write mirror** (`src/db.ts:489-503`) — `approval_queue` is a new TABLE, so the in-memory test DB gets it from `createSchema` directly (not `addColumnIfMissing`, which is for columns). Confirm the table lands in `createSchema` so `_initTestDatabase` (`:824`) builds it without running the versioned migration. `addColumnIfMissing` is the precedent only if a column is added to an existing table.

**Audit insert helper** (`src/db.ts:3083-3086`) — already wired to `setAuditCallback`; the gate's `audit()` calls route here:
```typescript
db.prepare(
  `INSERT INTO audit_log (agent_id, chat_id, action, detail, blocked, created_at) VALUES (?, ?, ?, ?, ?, strftime('%s','now'))`,
).run(agentId, chatId, action, detail.slice(0, 2000), blocked ? 1 : 0);
```

---

### `migrations/v1.2.3/create-approval-queue.ts` (migration, DDL)

**Analog:** `migrations/v1.2.2/add-routine-tables.ts` — copy verbatim structure (own `better-sqlite3` handle from `process.cwd()/store/claudeclaw.db`, `CREATE TABLE IF NOT EXISTS` idempotent, `try/finally db.close()`):
```typescript
import Database from 'better-sqlite3';
import path from 'path';
export const description = 'Add approval_queue table (Phase 3 Permissions & Autonomy, PERM-04)';
export async function run(): Promise<void> {
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS approval_queue ( ... );`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_approval_pending ON approval_queue(status, created_at DESC);`);
  } finally {
    db.close();
  }
}
```
**Register in `migrations/version.json`** under a new `"v1.2.3": ["create-approval-queue"]` key (current file has only v1.2.1, v1.2.2). Skipping this crash-loops `checkPendingMigrations` (L-6). Run `npm run migrate` before restart.

---

### `src/agent.ts` (service, SDK call site — the core edit)

**Analog:** itself, `src/agent.ts:246-282` (the `query()` options block).

**The exact lines to change** (`src/agent.ts:260-262`):
```typescript
// BEFORE:
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
// AFTER:
        permissionMode: 'default',
        canUseTool: makeCanUseTool(gateCtx),
```
Both bypass lines must go (P-1 — bypass skips prompting so the callback never fires). `canUseTool` does NOT conflict with `permissionMode` (only with `permissionPromptToolName`).

**Threading gateCtx (P-5):** `runAgent` is positional (`src/agent.ts:179-189`, 9 params ending `cwd?`). Append a trailing optional `gateCtx?: GateContext` and **default it to a safe background context** (attended:false → queue/ask) so any missed caller fails safe, not silent-allow. All callers: `bot.ts` (×2), `scheduler.ts` (×3 — lines 260, 313, 456), `orchestrator.ts`, `message-core.ts`. The kill-switch chokepoint (`requireEnabled('LLM_SPAWN_ENABLED')` at `:196`) stays — the gate is its richer sibling. Keep `getScrubbedSdkEnv` (`:206`); never leak env into queue rows (L-4).

---

### `src/scheduler.ts` (service, background driver)

**Analog:** itself — the three `runAgent`/`runRoutineOnce` call sites.

**Routine branch (the routine→gate seam, `src/scheduler.ts:275-293`)** — `runRoutineOnce` carries `execContext.autonomy` (routine-runner.ts:96). Build a background `gateCtx` with `attended:false` and `routineAutonomy = task.autonomy` and thread it into the step delegation:
```typescript
if (task.source === 'routine') {
  if (!claimDueTask(task.id, nextRun)) continue;
  runningTaskIds.add(task.id);
  const chatId = ALLOWED_CHAT_ID || 'scheduler';
  messageQueue.enqueue(chatId, async () => {
    try {
      await runRoutineOnce(task, getRoutineSteps(task.id), nextRun, {
        sender, delegateToAgent, isAgentPaused, getLastRoutineOutcome,
      });
    } finally { runningTaskIds.delete(task.id); }
  });
  continue;
}
```
**Scheduled-task + mission `runAgent` callers** (lines 260, 313, 456) get `attended:false`, no `routineAutonomy`, `runId = task.id`/`mission.id` for queue attribution. Stay inside `messageQueue.enqueue` (L-4 serialization). Background "ask" → enqueue + immediate `deny` (P-2 — never block the SDK subprocess for hours).

---

### `src/message-core.ts` (service, chat turn — attended path)

**Analog:** `src/message-core.ts` `TransportCallbacks` (106-133), `ProcessOptions.agentRuntime` (153-159), agent invocation (~407-421).

Build `gateCtx` with `attended:true`, `chatId`, `agentId` and supply `requestInline` (D-04). `TransportCallbacks` has `sendPlain`/`editPlain` but NO interactive yes/no primitive (Open Q3) — `requestInline` must be assembled here (Slack interactive buttons OR a bounded-timeout text "yes/no" follow-up parse). The inline-ask blocks the in-process callback while the operator is present; keep a bounded timeout (P-2). `agentRuntime` is the per-turn-identity precedent the gateCtx must travel alongside (not a module global).

---

### `src/dashboard.ts` (route/controller — `/api/permissions*` + `/api/approvals*`)

**Analog:** `src/dashboard.ts:1648-1737` (`/api/routines*`) and `:1514-1574` (`/api/tasks*`). Both mount behind the existing auth gate (`app.use('*')` token check at `:332-352`) and the mutations kill-switch (`:366-379` returns 503 when `DASHBOARD_MUTATIONS_ENABLED` is off). New routes inherit these by being registered on the same `app`.

**Validation + JSON-response + enum-check pattern to copy** (`src/dashboard.ts:1706-1737`):
```typescript
app.post('/api/routines', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; autonomy?: unknown; ... };
  const autonomy = typeof body.autonomy === 'string' ? body.autonomy : 'unattended';
  if (!ROUTINE_AUTONOMY.has(autonomy)) {
    return c.json({ ok: false, error: "autonomy must be 'unattended' or 'queue_approval'" }, 400);
  }
  // ... persist, return c.json({ ok: true, ... }, 201);
});
```
- `GET /api/permissions` → `{ mode, overrides }`; `PUT /api/permissions` validates `mode ∈ {cautious,balanced,autonomous}` and override values `∈ {always,ask}` (V5), persists via `permissions-config`, audits config event.
- `GET /api/approvals` → `{ approvals: [...] }` (mirror `GET /api/routines` shape at `:1648-1651`). `POST /api/approvals/:id/approve` → status-guarded replay (L-3) + `c.json({ ok:true })`; `POST /api/approvals/:id/deny` → status-guarded deny. Replay = re-invoke captured `{toolName,input}`; MCP tools direct-call, built-in `Bash`/`Write` via a tiny explicit executor, reject others with an honest error (P-3).

---

### Tests

**Unit tests** (`gate.test.ts`, `approval-queue.test.ts`, `permissions-config.test.ts`) — co-located `src/{module}.test.ts` (TESTING glob `src/**/*.test.ts`), use `_initTestDatabase()` from `src/db.ts:824` in `beforeAll`/`beforeEach`. `gate.ts` pure functions (`classifyTier`/`resolveOutcome`) need no DB — test the tier matrix + mode resolution + Tier 4 lock directly. Mock `audit()` via `setAuditCallback` (`security.ts:104`) to assert decision recording.

**Contract test** (`src/dashboard.contract.test.ts`) — extend, don't replace. Existing structure (`:10-45`): `_initTestDatabase()` in `beforeAll`, `app.request(path + '?token=' + TOKEN)` helpers, `describe` blocks. Copy the routines contract block (`:290-303`) shape for new `describe('permissions API contract')` and `describe('approvals API contract')`:
```typescript
const res = await get('/api/routines');         // get() appends ?token=TOKEN
expect(res.status).toBe(200);
const body = await res.json();
expect(body).toMatchObject({ routines: expect.any(Array) });
```

---

### UI: `web/src/pages/Settings.tsx` (PermissionsSection + new components)

**Analog:** `Settings.tsx` primitives `Section`/`Card`/`Row`/`ReadOnlyRow`/`Divider` (427-468) and `ThemePicker` (211-240, the active-card accent pattern).

**Section/Card/Row primitives to reuse** (`Settings.tsx:427-468`) — `PermissionsSection` wraps `<Section title subtitle>`; mode dial + override list + tier legend each in a `<Card>`; each override row uses `<Row label hint>`; locked Tier 4 rows use the `ReadOnlyRow` non-editable presentation precedent.

**Active-card accent pattern for `AutonomyModeSelector`** (`ThemePicker`, `Settings.tsx:218-235`) — the three mode radio cards copy this exact active treatment:
```tsx
class={[
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] border transition-colors',
  active
    ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-text)]'
    : 'bg-[var(--color-card)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]',
].join(' ')}
// ... {active && <Check size={12} class="text-[var(--color-accent)]" />}
```

**Segmented Always/Ask-first control for `ActionOverrideRow`** — reuse `AutonomySelector.tsx:30-57` (the segmented control; active segment `bg-[var(--color-accent)] text-white`), NOT `Toggle` (states are named, not boolean — UI-SPEC §1c).

**Reset-to-default affordance** — copy the `AccentPicker` "Reset" text-action (`Settings.tsx:280-289`, `RotateCcw size={11}`) for the per-override reset (UI-SPEC §1c).

---

### UI: `web/src/components/DailyLoop.tsx` (`ApprovalItem` inside `NeedsYouCard`)

**Analog:** `NeedsItem` (`DailyLoop.tsx:104-189`) — `ApprovalItem` is a sibling row in the same `NeedsYouCard` (`:31`), do NOT build a parallel card (UI-SPEC §2).

**Row scaffold + optimistic-action + honest-error + toast pattern to copy** (`DailyLoop.tsx:140-160`):
```tsx
<div class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-2.5">
  <div class="flex items-center gap-1.5 mb-1">
    {isFailed ? <Pill tone="failed">needs a look</Pill> : <Pill tone="neutral">unrouted</Pill>}
    <span class="ml-auto text-[10px] text-[var(--color-text-faint)] tabular-nums">{formatRelativeTime(task.created_at)}</span>
  </div>
  <div class="text-[12.5px] text-[var(--color-text)] leading-snug mb-2 line-clamp-2">{task.title}</div>
  {isFailed && task.error && (
    <div class="text-[10.5px] text-[var(--color-status-failed)] font-mono line-clamp-2 mb-2">{task.error}</div>
  )}
```
- `busy` state + `try/catch` + `pushToast({ tone:'success'|'error', ... })` + `onChange()` refresh (`:110-130`) — Approve POSTs `/api/approvals/:id/approve`, toast "Sent"; Deny POSTs `/api/approvals/:id/deny`, toast "Discarded".
- Honest replay-failure: render the verbatim reason in the `--color-status-failed` line (`:147-149`), never a generic error (UI-SPEC).
- Tier badge: `<Pill tone="neutral">` (Tier 3) / `<Pill tone="medium">` (Tier 4) per UI-SPEC §2.
- For Tier 4 deny, wrap in `ConfirmModal` (destructive) — UI-SPEC §2; normal Tier 3 deny is one tap.

---

## Shared Patterns

### Audit recording (D-10)
**Source:** `src/security.ts:108-113` (`audit()`), `src/db.ts:3083-3086` (insert), `AuditEntry` `src/security.ts:94-100`.
**Apply to:** `gate.ts` (every decision), `permissions-config.ts` (mode-change config event).
**Action required:** add `'permission'` to the `AuditAction` union (`security.ts:~80-92`). Encode `{tool,tier,mode,outcome}` in `detail` (capped at 2000 chars by the insert). Never put env/secrets in `detail` (L-4, V8).

### Config storage
**Source:** `src/db.ts:3581-3598` (`getDashboardSetting`/`setDashboardSetting`/`getAllDashboardSettings`), JSON-in-settings precedent `:2777-2803`.
**Apply to:** `permissions-config.ts` (mode + overrides). Keys `permissions.mode`, `permissions.overrides`. Last-write-wins, restart-safe, dashboard-token-auth-scoped.

### Companion-table CRUD + concurrency guard
**Source:** `src/db.ts:1561-1604` (routine_runs CRUD), `src/scheduler.ts:276` (`claimDueTask` single-claim).
**Apply to:** `approval-queue.ts` — `UPDATE ... WHERE status='pending'` + check `.changes` so approve/poll races can't double-replay (L-3).

### Route auth + mutation kill-switch
**Source:** `src/dashboard.ts:332-352` (token gate), `:366-379` (`DASHBOARD_MUTATIONS_ENABLED` → 503).
**Apply to:** all `/api/permissions*` + `/api/approvals*` routes — inherited automatically by registering on the same `app`. Validate enums in-handler (V5).

### Scrubbed SDK env (do not regress)
**Source:** `src/security.ts:115-149` (`getScrubbedSdkEnv`), used at `src/agent.ts:206`.
**Apply to:** `agent.ts` edit — keep scrubbing; gate runs in the parent (full env) so it must NOT copy env into queue rows or audit detail (L-4, V8).

---

## No Analog Found

| File / Concern | Role | Data Flow | Reason / Mitigation |
|----------------|------|-----------|---------------------|
| `requestInline` interactive yes/no (Slack) in `message-core.ts` | transport primitive | request-response | No interactive yes/no primitive exists in `TransportCallbacks` (only `sendPlain`/`editPlain`, `message-core.ts:106-133`). Open Q3 — scope as its own task: Slack interactive buttons OR bounded-timeout text-reply parse. The `attended` branch + `requestInline` seam isolates this; MVP may fall back to queuing chat asks if button plumbing is heavy (D-04 prefers true inline). |
| Built-in tool replay executor (`Bash`/`Write`) in `approval-queue`/`dashboard` | service | transform | No standalone executor for SDK built-ins exists (they run in the SDK subprocess, P-3). New small allowlisted executor needed: MCP tools replay clean (direct call with stored params); built-ins need explicit Node-side ops; reject others with an honest "can't replay" error. |

---

## Metadata

**Analog search scope:** `src/` (gate/config/queue/agent/scheduler/message-core/dashboard/security/kill-switches/db + contract test), `migrations/`, `web/src/components/`, `web/src/pages/`, `web/src/lib/`.
**Files scanned:** ~16 read in full or targeted ranges; branch presence of Phase 2 routine code + migration version (v1.2.2 latest → v1.2.3 next) confirmed.
**Pattern extraction date:** 2026-06-23
