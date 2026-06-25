# Phase 5: Audit Log - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 16 (8 backend modify, 2 migration new, 4 frontend modify, 2+ test extend)
**Analogs found:** 16 / 16 (every file is an in-place enrichment of an existing seam; no greenfield files except the versioned migration, which has an exact v1.2.3 template)

This phase is **enrichment + instrumentation, not new architecture.** Every new field, event type, endpoint, and surface change has a verified in-repo analog. The only genuinely net-new logic is the CSV serializer (no library) and the migration file (copy v1.2.3 skeleton verbatim).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `migrations/v1.2.4/enrich-audit-log.ts` | migration | batch / schema DDL | `migrations/v1.2.3/create-approval-queue.ts` | exact (copy skeleton) |
| `migrations/version.json` | config | — | self (existing entries) | exact |
| `src/db.ts` (schema + writer + readers + retention) | model / DB | CRUD + transform | `audit_log` block `:332`, `addColumnIfMissing` `:526`, `insertAuditLog`/`getAuditLog` `:3113`, `getDashboardSetting` `:3618` | exact (same file, established patterns) |
| `src/security.ts` (`AuditAction` + `AuditEntry`) | model / type | event-driven | `AuditAction` union `:87`, `AuditEntry` `:95`, `audit()` `:109` | exact (extend in place) |
| `src/index.ts` (callback widen) | config / wiring | event-driven | `setAuditCallback` → `insertAuditLog` `:161` | exact (extend in place) |
| `src/gate.ts` (enrich permission detail) | service | request-response | `recordDecision`/`encodeDecision` `:169-191`, `makeCanUseTool` `:203` | exact (same writer, more fields) |
| `src/permissions-config.ts` → new retention get/set (or sibling module) | config | CRUD (k/v) | `getMode`/`setMode` `:32-50` (whole file) | exact (mirror pattern) |
| `src/routine-runner.ts` (emit `routine`) | service | event-driven | outcome derivation `:161`, run entry `:84` | role-match (new emit at existing seam) |
| `src/oauth-health.ts` (emit `auth`) | service | event-driven | `checkOAuthHealth` `:43` + `lastAlertLevel` | role-match (new emit at existing seam) |
| `src/message-core.ts` (emit `error`, capture model/session) | service | event-driven | `catch(err)` `:661`, model resolution `:394` | role-match (new emit + capture at existing seam) |
| `src/agent.ts` (capture duration/session/model at turn boundary) | service | streaming / request-response | `query()` boundary `:287`, `result` event `:418` | role-match |
| `src/dashboard.ts` (enrich `/api/audit` + new `/api/audit/export` + retention read) | controller / route | request-response + file-I/O | `/api/audit` `:3548`, download precedent `:2057`, token gate `:345` | exact |
| `web/src/pages/Audit.tsx` | component | request-response (read) | self (rework) + contrast `Activity.tsx` | exact (rework in place) |
| `web/src/lib/routes.ts` | config | — | `ROUTES` table `:27-43` (demote `/audit` `:38`) | exact |
| `web/src/App.tsx` | config / route | — | `<Route path="/audit">` `:61` (keep) | exact |
| `web/src/pages/Settings.tsx` | component | request-response | `Section` component `:433`, existing `<Section>` blocks `:84-179` | exact (add Security section) |
| `src/db.test.ts` / `src/dashboard.contract.test.ts` / `src/migrations.test.ts` / `src/gate.test.ts` (+ optional `src/audit-export.test.ts`) | test | — | contract harness `:33-39`, `gate.test.ts:146-194` audit assertions | exact (extend) |

---

## Shared Patterns

### Pattern A — Dual-write additive migration (P-4, load-bearing)
**Sources:** `src/db.ts:526` (`addColumnIfMissing`), `src/db.ts:601-615` (existing `addColumnIfMissing` precedent for scheduled_tasks/routines), `migrations/v1.2.3/create-approval-queue.ts` (whole file), `migrations/version.json`.
**Apply to:** `src/db.ts` runMigrations + `migrations/v1.2.4/enrich-audit-log.ts` + `migrations/version.json` — all three, in lockstep.

`addColumnIfMissing` already exists and is the exact tool — it PRAGMA-guards and tolerates the duplicate-column race (`src/db.ts:526-540`):
```typescript
function addColumnIfMissing(database, table, column, typeAndDefault) {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  try { database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeAndDefault}`); }
  catch (err) { if (/duplicate column/i.test(err?.message ?? '')) return; throw err; }
}
```
In `runMigrations` (`src/db.ts:543`), the established precedent to copy is the aos-cron/routines block at `:601-615` — a run of `addColumnIfMissing(database, 'scheduled_tasks', ...)` calls each carrying a comment that points to its versioned migration. Mirror that for `audit_log` with the new nullable columns (per RESEARCH §Pattern 1):
```typescript
addColumnIfMissing(database, 'audit_log', 'event_type',  `TEXT`);
addColumnIfMissing(database, 'audit_log', 'tool',        `TEXT`);
addColumnIfMissing(database, 'audit_log', 'target',      `TEXT`);
addColumnIfMissing(database, 'audit_log', 'project',     `TEXT`);
addColumnIfMissing(database, 'audit_log', 'decision',    `TEXT`);
addColumnIfMissing(database, 'audit_log', 'decided_by',  `TEXT`);
addColumnIfMissing(database, 'audit_log', 'decided_at',  `INTEGER`);
addColumnIfMissing(database, 'audit_log', 'result',      `TEXT`);
addColumnIfMissing(database, 'audit_log', 'duration_ms', `INTEGER`);
addColumnIfMissing(database, 'audit_log', 'model',       `TEXT`);
addColumnIfMissing(database, 'audit_log', 'session_id',  `TEXT`);
// cost_usd intentionally OMITTED — resolved read-side via JOIN token_usage (Pattern C)
```
**NOTE on `createSchema`:** Unlike the routines/aos-cron columns (added only via `addColumnIfMissing`), the `audit_log` CREATE TABLE block lives inline at `src/db.ts:332-342`. Planner's call whether to also add the new columns directly to that CREATE TABLE for fresh DBs OR rely solely on `addColumnIfMissing` running after createSchema. The existing precedent (`:601`) does it via `addColumnIfMissing` only — match that for consistency. Either way, the in-memory test DB reaches column parity because `_initTestDatabase` (`:861`) runs createSchema + runMigrations.

The versioned file is a verbatim copy of the v1.2.3 skeleton — same `Database(path.join(process.cwd(), 'store', 'claudeclaw.db'))`, same try/finally, but PRAGMA-guarded `ALTER TABLE ... ADD COLUMN` (SQLite has no `ADD COLUMN IF NOT EXISTS`). Full template in the per-file section below.

Register in `migrations/version.json` — append to the existing object:
```json
{
  "migrations": {
    "v1.2.1": ["add-aos-cron-scheduled-task-columns"],
    "v1.2.2": ["add-routine-tables"],
    "v1.2.3": ["create-approval-queue"],
    "v1.2.4": ["enrich-audit-log"]
  }
}
```
**Verified:** current max is `v1.2.3` (no concurrent phase claimed `v1.2.4`). RESEARCH assumption A5 holds.

### Pattern B — Single audit choke point: extend, never fork
**Sources:** `src/security.ts:87-114` (union + interface + `audit()`), `src/index.ts:161` (callback), `src/db.ts:3113` (`insertAuditLog`).
**Apply to:** all event-emitting modules (gate, agent, routine-runner, oauth-health, message-core, permissions-config).

Every event flows `audit()` → `_auditCallback` → `insertAuditLog`. Widen the union, the interface, the callback, and the writer **in lockstep**; call sites pass new optional fields. Do NOT add a second logger.

Current union/interface (`src/security.ts:87-101`) — extend in place:
```typescript
export type AuditAction =
  | 'message' | 'command' | 'delegation' | 'kill' | 'blocked' | 'permission'
  | 'auth' | 'routine' | 'error';     // D-12 additions

export interface AuditEntry {
  agentId: string; chatId: string; action: AuditAction;
  detail: string; blocked: boolean;
  // D-01/D-11 optional captured fields (omit when N/A → NULL in DB → "not captured" in UI):
  eventType?: string;
  tool?: string; target?: string; project?: string;
  decision?: string; decidedBy?: string; decidedAt?: number;
  result?: string; durationMs?: number;
  model?: string; sessionId?: string;
}
```
The callback at `src/index.ts:161` is the single mapping point — currently:
```typescript
setAuditCallback((entry) => {
  insertAuditLog(entry.agentId, entry.chatId, entry.action, entry.detail, entry.blocked);
});
```
Widen `insertAuditLog`'s signature (`src/db.ts:3113`) to accept the new fields (prefer an options object once arg count grows past ~5) and pass each through the callback. `insertAuditLog` is INSERT-only — keep it that way (append-only hard rule; no UPDATE/DELETE ever).

### Pattern C — token_usage ↔ audit_log cost resolution (read-side JOIN, the D-11 crux)
**Sources:** `src/db.ts:202` (`token_usage`, has `session_id`/`cost_usd`, **no `model` column**), `src/message-core.ts:394` (model resolved write-side), `src/agent.ts:418` (`result` event after turn).
**Apply to:** the enriched `/api/audit` reader (`src/db.ts`) and the export reader.

Audit rows are written **mid-turn** (inside `canUseTool`), before cost is known. So: **capture `session_id` + `model` write-side** (both known at turn start), **resolve `cost_usd` read-side** via correlated subquery (never write cost onto the row — that would force an append-only-violating UPDATE):
```sql
SELECT a.*,
       (SELECT COALESCE(SUM(t.cost_usd),0) FROM token_usage t WHERE t.session_id = a.session_id) AS cost_usd
FROM audit_log a
WHERE /* filters */ ORDER BY a.created_at DESC LIMIT ? OFFSET ?;
```
**Landmine:** `token_usage` has no `model` column (confirmed `src/db.ts:202-213`). Do NOT read model from `token_usage`; capture it onto the audit row. Cost is per-turn, shared across all audit rows in one session — UI must label it "turn cost" (Pitfall 4).

### Pattern D — No-secrets-in-detail invariant (security, non-negotiable)
**Sources:** `src/security.ts:139-209` (`getScrubbedSdkEnv` / drop-vars), `src/gate.test.ts:184-194` (the enforcing test), `approval_queue.tool_input` comment `src/db.ts:351`.
**Apply to:** every call site that sets `detail` / `target` — especially `gate.ts` (raw model `input`) and `message-core.ts` (`error` messages).

`detail` and `target` carry ONLY scrubbed, model-supplied params — never env/secrets. `src/gate.test.ts:184` asserts the secret never lands in `detail`; extend that assertion to the new `target` field. For `target` extraction, build a per-tool whitelist (mirror `summarize()` `src/gate.ts:135`) and default to omitting (→ "not captured") rather than dumping raw input (RESEARCH Open Q2). Cap error messages and never include stack frames (path/secret leak).

---

## Pattern Assignments

### `migrations/v1.2.4/enrich-audit-log.ts` (migration, schema DDL) — NEW

**Analog:** `migrations/v1.2.3/create-approval-queue.ts` (copy skeleton verbatim).

**Skeleton to copy** (`migrations/v1.2.3/create-approval-queue.ts:1-48`): own `better-sqlite3` handle at `process.cwd()/store/claudeclaw.db`, try/finally, idempotent, `description` export + `run()`. The ONLY change is the body — instead of `CREATE TABLE IF NOT EXISTS`, run PRAGMA-guarded ADD COLUMNs (SQLite has no per-column IF NOT EXISTS):
```typescript
import Database from 'better-sqlite3';
import path from 'path';

export const description =
  'Enrich audit_log with per-event technical columns (Phase 5 Audit, AUD-01/D-01)';

export async function run(): Promise<void> {
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);
  try {
    const have = new Set(
      (db.prepare(`PRAGMA table_info(audit_log)`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    const add = (col: string, type: string) => {
      if (!have.has(col)) db.exec(`ALTER TABLE audit_log ADD COLUMN ${col} ${type}`);
    };
    add('event_type', 'TEXT'); add('tool', 'TEXT'); add('target', 'TEXT');
    add('project', 'TEXT'); add('decision', 'TEXT'); add('decided_by', 'TEXT');
    add('decided_at', 'INTEGER'); add('result', 'TEXT'); add('duration_ms', 'INTEGER');
    add('model', 'TEXT'); add('session_id', 'TEXT');
  } finally {
    db.close();
  }
}
```
The DDL must be **identical** to the `addColumnIfMissing` calls in `src/db.ts runMigrations` (Pattern A) — drift here = tests green, production crash-loop (Pitfall 1).

---

### `src/db.ts` (model/DB: schema + writer + readers + retention)

**Analog:** itself — four established in-file patterns.

**1. Schema enrich** — Pattern A above (`audit_log` block `:332`, `addColumnIfMissing` precedent `:601`).

**2. Writer** (`insertAuditLog` `:3113-3123`) — current:
```typescript
export function insertAuditLog(agentId, chatId, action, detail, blocked): void {
  db.prepare(
    `INSERT INTO audit_log (agent_id, chat_id, action, detail, blocked, created_at)
     VALUES (?, ?, ?, ?, ?, strftime('%s','now'))`,
  ).run(agentId, chatId, action, detail.slice(0, 2000), blocked ? 1 : 0);
}
```
Widen to accept the optional fields (options object recommended once >5 args). Keep `detail.slice(0, 2000)`. INSERT-only — no UPDATE/DELETE (append-only).

**3. Readers** (`getAuditLog` `:3135`, `getAuditLogCount` `:3146`, `getRecentBlockedActions` `:3153`) — current `getAuditLog` is `SELECT * ... LIMIT ? OFFSET ?` with an optional `agentId` branch. Extend into a parameterized filtered builder (search + type + date range), add the cost JOIN (Pattern C). The **export reader reuses the same builder minus LIMIT/OFFSET** (Pitfall 6 — never page-cap the export). Update `AuditLogEntry` interface `:3125` with the new nullable columns. Use `?` placeholders only — never string-concat filters (SQL injection, ASVS V5).

**4. Retention** — reuse the k/v store at `getDashboardSetting`/`setDashboardSetting` `:3618-3628` (read in Pattern E). No new table.

---

### `src/security.ts` (model/type) + `src/index.ts` (wiring)

**Analog:** Pattern B. Extend `AuditAction` `:87`, `AuditEntry` `:95`, and the `src/index.ts:161` callback in lockstep with the widened `insertAuditLog`. `audit()` itself (`:109`) needs no change — it already forwards the whole `entry` object and logs it.

---

### `src/gate.ts` (service: enriched permission detail)

**Analog:** `recordDecision`/`encodeDecision` `:169-191` (same file).

Current `recordDecision` (`src/gate.ts:179-191`) passes only `{action, detail, blocked}`. Widen it to capture the new fields, threading `sessionId`/`model`/`_startMs` through `GateContext` (`:145` — the established no-globals per-turn carrier; add fields there). Keep `encodeDecision` (`:169`) as the `detail` JSON producer; add the structured columns alongside:
```typescript
function recordDecision(ctx, d, blocked) {
  audit({
    agentId: ctx.agentId ?? 'main', chatId: ctx.chatId ?? '',
    action: 'permission', eventType: 'permission',
    detail: encodeDecision(d),                       // existing {tool,tier,mode,outcome,queueId}
    tool: d.tool, target: safeTarget(input),         // whitelisted, never env/secrets (Pattern D)
    decision: d.outcome,
    decidedBy: d.outcome.includes('inline') ? 'operator' : 'system',
    decidedAt: Date.now(),
    durationMs: ctx._startMs ? Date.now() - ctx._startMs : undefined,
    sessionId: ctx.sessionId, model: ctx.model,
    blocked,
  });
}
```
**Duration:** stamp `Date.now()` at the top of `makeCanUseTool` (`:203`), diff in `recordDecision`. **Do NOT touch** `classifyTier`/`resolveOutcome` — D-01 changes what is recorded, not how the gate decides (out-of-scope). `gate.test.ts:159,171,184` already assert the audit shape and no-secrets — extend, don't break them.

---

### `src/permissions-config.ts` (config: retention get/set) — Pattern E

**Analog:** `getMode`/`setMode` `:32-50` (whole file is the template).

Mirror exactly — k/v read with default + validated write that audits a config-change event:
```typescript
const RETENTION_KEY = 'audit.retention_days';
export function getAuditRetentionDays(): number {
  const v = getDashboardSetting(RETENTION_KEY);
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 90;   // default 90 (spec), Claude's discretion
}
export function setAuditRetentionDays(days: number, agentId = 'main'): void {
  // validate days > 0 …
  setDashboardSetting(RETENTION_KEY, String(days));
  audit({ agentId, chatId: '', action: 'permission',
    detail: JSON.stringify({ event: 'retention_change', days }), blocked: false });
}
```
Planner's call whether this lives in `permissions-config.ts` or a small sibling `audit-config.ts`. **No DELETE anywhere** (D-31 / hard rule).

---

### `src/routine-runner.ts` / `src/oauth-health.ts` / `src/message-core.ts` (service: new event emissions)

**Analog:** Pattern B (`audit()` choke point) called at each module's existing outcome/catch seam.

- **`routine`** — `src/routine-runner.ts`: outcome already derived at `:161` (`const outcome = deriveOutcome(...)`); run entry at `:84` for the duration start. Emit one `audit({action:'routine', eventType:'routine', result: outcome, durationMs, blocked: outcome === 'failed'})` after outcome derivation. The `chatId` precedent in this file is `ALLOWED_CHAT_ID || 'routine'` (`:105`).
- **`auth`** — `src/oauth-health.ts:43` `checkOAuthHealth`: emit at each expiry/refresh determination; `lastAlertLevel` (`none|warning|expired`) is the level. `blocked: lastAlertLevel === 'expired'`. Point-in-time → `durationMs` legitimately NULL. RESEARCH Open Q3: honestly note in the coverage banner if true SDK-internal refreshes aren't observable.
- **`error`** — `src/message-core.ts:661` `catch(err)`: alongside the existing `logger.error`, emit `audit({action:'error', eventType:'error', detail: JSON.stringify({category: err instanceof AgentError ? err.category : 'unknown', message: String(err).slice(0,500)}), result:'error', blocked:false})`. Note `:667` already branches on `AgentError` with `err.category` — reuse it. Cap message length; never include stack frames (Pattern D).

---

### `src/agent.ts` (service: turn-boundary capture)

**Analog:** `query()` boundary `:287`, `result` event `:418`. **Capture `session_id` + `model` and start/stop ms at the turn boundary** and thread them via `GateContext`/`opts.agentRuntime` (per-turn, no module globals — Pattern B/established rule). `model` is resolved write-side at `src/message-core.ts:394` (`effectiveModel`); `session_id` is `result.newSessionId ?? sessionId`. This is the lowest-confidence wiring (RESEARCH A3/A4/Open Q1) — planner must define exactly where the start/stop boundaries sit per event type (RESEARCH §Pattern 4).

---

### `src/dashboard.ts` (controller/route: read + export)

**Analog:** `/api/audit` `:3548`, download precedent `:2057`, token gate `:345`.

**1. Enrich `/api/audit`** (`:3548-3555`) — current parses `limit`/`offset`/`agent`. Add search + type + date-range query params, pass to the new filtered reader (with cost JOIN). Parameterized only (ASVS V5).

**2. New `/api/audit/export`** — mount under `/api/` so the token middleware (`:345-357`, reads `c.req.query('token')`) gates it automatically; GET is exempt from the mutations kill-switch (`:379-389`). Copy the `new Response(body, {headers:{'Content-Disposition':...}})` shape from the project-file download precedent (`:2057-2062`):
```typescript
app.get('/api/audit/export', (c) => {
  const format = c.req.query('format') === 'json' ? 'json' : 'csv';   // validate ∈ {csv,json}
  const rows = getAuditLogFiltered({ ...filters /* NO limit/offset — full set, Pitfall 6 */ });
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  if (format === 'json') {
    return new Response(JSON.stringify({ exported_at: Date.now(), count: rows.length, rows }, null, 2),
      { headers: { 'Content-Type':'application/json',
        'Content-Disposition':`attachment; filename="audit-${ts}.json"` }});
  }
  return new Response(toCsv(rows),
    { headers: { 'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':`attachment; filename="audit-${ts}.csv"` }});
});
```
**`toCsv` is the one net-new serializer** — no CSV lib installed. RFC-4180: quote any field with `, " \n \r`; escape `"` → `""`; CSV-injection guard (prefix leading `= + - @` with `'`). `detail` is free-text and WILL contain these (Pitfall 3). **Do not `.join(',')`.** Add a unit test (comma + quote + newline + leading `=`).
**Do NOT use `[SEND_FILE]`** — that's a chat-bot marker; the dashboard uses HTTP download. Trigger client-side via token-in-URL (`window.location.href = '/api/audit/export?...&token='`) or fetch→blob (`Referrer-Policy: no-referrer` already set `:281`).

**3. Retention read** — expose `getAuditRetentionDays()` (extend `/api/audit` response or a small `/api/audit/meta`) so the UI renders the configured number.

---

### `web/src/pages/Audit.tsx` (component: dense technical rework)

**Analog:** itself (rework) + **contrast** `web/src/pages/Activity.tsx` (must look deliberately UNLIKE it — UI-SPEC's one overriding rule).

The current file already has the bones: `PageHeader`+`Tab` (`:3,66`), `PageState` (`:4,86-90`), paginated load-of-100 with "Load more" footer (`:128-137`), `ShieldAlert`/`ShieldCheck` outcome icons (`:2,114-119`), and the sticky-table layout (`:94-103`). **Rework per UI-SPEC:**
- Replace `formatRelativeTime` (`:6,108`) with **absolute monospace timestamps to the second** (relative time is an Activity affordance; this is the explicit deprecation noted in RESEARCH State-of-the-Art).
- Add **expand-for-detail** disclosure row (single-open model, mirror Activity's `openRow`) — two-column key/value grid; **every NULL field renders the literal `not captured` in `--color-text-faint`, never blank** (Pitfall 2 / UI-SPEC honesty rule).
- **Honest type chips** — `SELECT DISTINCT event_type` drives chip enablement; types with no data render disabled + "not yet captured" footnote (RESEARCH §Pattern 7).
- Add the **Export log** button (accent fill, the ONLY accent surface besides chip-active per UI-SPEC §Color) with CSV/JSON popover → triggers `/api/audit/export`.
- Add the **retention + coverage banner** rendering `Retaining {N} days` from config (never hardcoded).
- Update the `AuditEntry` interface (`:9-17`) with the new fields.
Reuse `lib/format.ts` `formatCost`/`formatDuration`, `Pill`/`StatusDot`, `AgentAvatar`/`teammateColor` per UI-SPEC Component Inventory.

---

### `web/src/lib/routes.ts` + `web/src/App.tsx` + `web/src/pages/Settings.tsx` (relocation, D-13)

**Analogs:** `ROUTES` table `:38` (demote), `<Route path="/audit">` `:61` (keep), `Section` component `Settings.tsx:433` + existing `<Section>` blocks `:84-179`.

- **`routes.ts:38`** — remove/demote the `/audit` entry from the `intelligence` nav section (it stays in the route table conceptually but leaves the daily sidebar). Keep `vocabKey: 'nav.audit'` unchanged (UI-SPEC: term doesn't change, only placement).
- **`App.tsx:61`** — KEEP `<Route path="/audit"><Audit /></Route>` for deep-linking + command palette.
- **`Settings.tsx`** — add a `<Section title="Security">` (the `Section` component `:433` takes `title`/`subtitle`/`children`; existing blocks at `:84,103,130,141,164,175` are the copy templates) that links to / hosts the Audit surface. Exact route string + vocabKey grouping is planner's discretion but MUST land under Settings/Security, not daily nav.

---

### Tests (extend in place)

**Analog:** contract harness `dashboard.contract.test.ts:33-39` (`_initTestDatabase()` in `beforeEach`, `app.request(path + '?token=' + TOKEN)`); audit assertions `gate.test.ts:146-194`.

- **`src/migrations.test.ts`** — assert `v1.2.4` registered + idempotent apply (the file uses `compareSemver`/`checkPendingMigrations` describes at `:10,52`; add an "audit" case). Covers AUD-01 schema (Pitfall 1).
- **`src/db.test.ts`** — audit insert/read with new fields; cost JOIN; CSV RFC-4180 + injection cases (or new `src/audit-export.test.ts`); "no DELETE FROM audit_log anywhere" invariant grep.
- **`src/gate.test.ts`** — extend `:159/:171` (enriched detail with tool/target/result/duration) and `:184` (no-secrets now covers `target` too).
- **`src/dashboard.contract.test.ts`** — `/api/audit` enriched rows + honest NULLs; `/api/audit/export` full-set (insert > page rows, assert full count — Pitfall 6) + `Content-Disposition` header.
- **retention** — get/set unit test (default 90, validates input).
- **Note:** no headless web test harness — honest-chip / "not captured" rendering is manual-only verification (flag for human-verify checkpoint).

---

## No Analog Found

None. Every file is an in-place enrichment of an existing seam. The two pieces with the least direct precedent both have close templates:

| Item | Role | Data Flow | Closest available pattern |
|------|------|-----------|---------------------------|
| `toCsv` serializer in `src/dashboard.ts` | utility | transform | No CSV lib installed; hand-roll per RFC-4180 (RESEARCH Don't-Hand-Roll caution). The Response/download wrapper around it IS analogged (`:2057`). |
| Turn-boundary duration/session/model capture in `src/agent.ts` | service | streaming | No existing per-event timing; `GateContext` threading (`gate.ts:145`) is the carrier pattern; boundaries per RESEARCH §Pattern 4. |

---

## Metadata

**Analog search scope:** `src/` (db, security, gate, index, agent, message-core, routine-runner, oauth-health, permissions-config, dashboard), `migrations/`, `web/src/` (pages, lib, App), test suite.
**Files scanned (read):** db.ts (4 ranges), security.ts, gate.ts, index.ts, permissions-config.ts, dashboard.ts (3 ranges), routine-runner.ts, oauth-health.ts, message-core.ts (2 ranges), migrations/v1.2.3, migrations/version.json, Audit.tsx, routes.ts, Settings.tsx (2 ranges), App.tsx (grep), dashboard.contract.test.ts, gate.test.ts (grep), migrations.test.ts (grep).
**All RESEARCH file:line citations verified against this worktree's source on 2026-06-25.** `v1.2.4` confirmed unclaimed; `token_usage` confirmed has no `model` column; `audit_log` CREATE TABLE is inline (not addColumnIfMissing) — flagged in Pattern A.
**Pattern extraction date:** 2026-06-25
