# Phase 5: Audit Log - Research

**Researched:** 2026-06-25
**Domain:** Append-only audit schema enrichment + full-fidelity write-path instrumentation, server-side export, retention statement, surface relocation (TypeScript / better-sqlite3 / Hono / Preact)
**Confidence:** HIGH (all claims grounded in this worktree's source at cited file:line; no external library APIs needed beyond installed versions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Instrument the write path now, full fidelity. Add the spec's per-event fields as real captured data (tool, target, project, permission decision + who/when approved, result, duration, cost, session, model, event-type tag). Reopening the gate/agent write path is intentional and is the bulk of this phase.
- **D-11:** All event types, full fidelity. Every audited event type gets the new columns and captures all applicable fields. Wire `token_usage` ↔ `audit_log` (cost/model/session are per-turn; audit events are per-action — planner must define how a per-action row resolves its turn's cost/model/session). Add duration timing where none exists.
- **D-12:** Add the missing event types — auth (session refresh / auth events), routine runs, and caught errors — at their source modules, in addition to existing `message | command | delegation | kill | blocked | permission` (config-change already audited). After this, the spec's `Actions · Permissions · Auth · Errors` chip set has real backing data.
- **D-13:** Relocate the Audit surface under Settings > Security / admin, out of the operator's main nav. Honest type chips — only render an active chip for a type with backing data; spec chips with no data are stated "not yet captured", never as an empty filter implying coverage. Keep the dense/technical look (monospace timestamps + detail) deliberately unlike Activity.
- **D-21:** Server-side export of the complete filtered set. New `/api/audit/export` streams every row matching active filters/search/date-range (not page-capped), in CSV and JSON, as a file download. Inherits the same dashboard token gate as other `/api/*` routes.
- **D-31:** State the window, do not auto-prune this phase. Retention window is configurable and displayed ("retaining 90 days") but NO rows are deleted this phase. Strictly honors the append-only/no-delete/no-silent-drop hard rule; enforcement (archive-then-prune) is explicitly deferred. Default window value is Claude's discretion (spec suggests ~90 days) but MUST be stated wherever shown.

### Claude's Discretion
- Exact default retention window value (spec suggests ~90 days) — but it must be stated.
- How a per-action audit row resolves its turn-level cost/model/session from `token_usage` (join key, nearest-turn, or capture-at-write).
- How duration is measured for each event type (where start/stop boundaries sit).
- Export file naming, CSV column order, JSON envelope shape.
- Precise Settings/admin nav grouping and route/`vocabKey` for the relocated Audit page.
- Migration sequencing and any backfill/default behavior for existing rows that predate the new columns.
- Whether new columns are added to `audit_log` directly vs a companion detail table — planner's call, guided by `addColumnIfMissing` + versioned `migrations/` dual-write.

### Deferred Ideas (OUT OF SCOPE)
- **Automatic retention enforcement** — archive/roll-up/prune at the window boundary.
- **Enterprise compliance wrapper** — SSO-gated audit access, compliance export formats, tamper-evidence/hash-chaining.
- **Per-project filtering** of Audit (the `project` field IS captured this phase, but a dedicated project-filter UI follows alongside Projects work).
- **Scheduled/automated exports** — on-demand export only this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUD-01 | An admin can view a complete, read-only, append-only audit log of every event with technical detail | Schema enrichment (§Pattern 1) + write-path instrumentation (§Pattern 2) + relocated dense surface (§Pattern 6). Honest-coverage rendering (§Pitfall 2) makes "complete" a kept promise. |
| AUD-02 | An admin can export the audit log (CSV/JSON); log retention is bounded and configurable (D10) | `/api/audit/export` streaming endpoint reusing the `new Response(data,{headers})` download precedent at `src/dashboard.ts:2057` (§Pattern 5). Retention window stored in `dashboard_settings` and displayed; NO deletion (§Pattern 7). |
</phase_requirements>

## Summary

Every piece this phase needs already exists as a seam in the codebase; the work is enrichment and instrumentation, not new architecture. The audit spine is three tables in `src/db.ts`: `audit_log` (`:332`, thin: `action, detail, blocked, agent_id, chat_id, created_at`), `approval_queue` (`:352`, already carries `tier, mode_at_decision, decided_at, result, tool_name, tool_input`), and `token_usage` (`:202`, per-turn `session_id/cost_usd` but **no `model` column** — a confirmed gap). The single audit choke point is clean: every event flows `audit()` (`src/security.ts:109`) → `setAuditCallback` (`src/index.ts:161`) → `insertAuditLog` (`src/db.ts:3113`). Permission events additionally pass through `recordDecision`/`encodeDecision` in `src/gate.ts:179`. Adding fields means widening one `AuditEntry` interface, one writer, and one callback — then enriching each call site.

The central design tension the planner must resolve is **D-11's `token_usage` ↔ `audit_log` join**: audit rows are per-action and are written *during* the agent turn (inside `canUseTool`), while cost/model/session are only known *after* the turn completes (the `result` event in `src/agent.ts:418`, persisted by `saveTokenUsage` in `src/message-core.ts:616`). A per-action audit row cannot know its turn's final cost at write time. The recommended resolution is **capture session_id + model at the turn boundary and thread them through `GateContext` (no globals — per the established `opts.agentRuntime` rule), and resolve cost/model read-side by joining `audit_log.session_id` to `token_usage` at query time** rather than denormalizing post-turn cost into each audit row.

The migration is the highest-risk mechanical step: **P-4 dual-write** is mandatory. Schema changes must land in BOTH `createSchema` (via `addColumnIfMissing`, for the in-memory test DB) AND a new versioned `migrations/v1.2.4/` directory registered in `migrations/version.json` (for the live store). Skipping the versioned file crash-loops the live service via `checkPendingMigrations` (see MEMORY.md / `src/migrations.ts`). The `append-only/no-delete` hard rule and D-31 retention coexist because D-31 ships configuration + display only — zero `DELETE` statements this phase.

**Primary recommendation:** Add the new fields as **direct nullable columns on `audit_log`** (not a companion table — the existing read path is a single `SELECT *`, joins would complicate the streaming export, and SQLite `ALTER TABLE ADD COLUMN` is the established additive pattern). Thread `session_id`/`model`/duration through `GateContext`. Resolve cost read-side via a `LEFT JOIN token_usage ON session_id`. Ship a thin vertical slice first (schema + `permission` events fully instrumented → enriched `/api/audit` → reworked surface → export), then widen to all event types and add auth/routine/error emissions.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Audit schema + columns | Database (`src/db.ts`) | Migration (`migrations/v1.2.4`) | Schema is owned by `createSchema`/`runMigrations`; dual-write to migration for live store |
| Event capture (write path) | Backend modules (gate, agent, scheduler, oauth-health, message-core) | Security choke (`audit()`) | Each event type originates in its source module; all funnel through one writer |
| token_usage↔audit join | Database (read query) | Backend (capture session_id/model at turn boundary) | Cost/model live in `token_usage`; resolve read-side, capture keys write-side |
| Retention value | Database (`dashboard_settings` k/v) | API (read + expose) | Reuses the restart-safe config store; no schema change, no deletion |
| Export (CSV/JSON stream) | API (`src/dashboard.ts` Hono route) | Database (filtered SELECT) | HTTP file download; inherits token gate + mutations middleware |
| Audit read + filters | API (`/api/audit`) | Database (parameterized filtered query) | Server-side filter/search/date-range; export reuses the same query builder |
| Surface relocation | Frontend (`web/src/`) | — | Pure client routing/nav change in `routes.ts`/`App.tsx`/`Settings.tsx` |
| Dense audit UI | Frontend (Preact, `web/src/pages/Audit.tsx`) | — | Browser render; reuses existing primitives |

## Standard Stack

This phase introduces **zero new packages**. It uses the installed stack verbatim. No `npm install` is required.

### Core (already installed — verified in package.json this worktree)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | ^11.8.1 | Synchronous single-connection SQLite; the audit store | Already the system DB; `ALTER TABLE ADD COLUMN` + prepared statements |
| `hono` | ^4.12.3 | API router for `/api/audit*` + `/api/audit/export` | Existing dashboard router; `hono/streaming` already imported (`src/dashboard.ts:3`) |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.34 | Agent `query()` turn boundary (duration/model/session capture) | Already the engine; gate is a `canUseTool` callback |
| `preact` | ^10.29.1 | Dashboard renderer for the Audit surface | Established design system (UI-SPEC) |
| `lucide-preact` | ^1.14.0 | Outcome/type icons (`ShieldCheck`, `ShieldAlert`, `Clock`) | Already used in `Audit.tsx:2` |
| `tailwindcss` | ^4.2.4 | Styling tokens (`@theme inline`) | Established; UI-SPEC mandates inheritance |
| `vitest` | ^2.0.0 | Test framework (unit + `app.request()` contract) | Established (`*.test.ts`, `dashboard.contract.test.ts`) |

### Supporting (existing modules, not packages)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/security.ts` `audit()` / `AuditEntry` | Single audit choke point + event-type union | Extend the union (D-12) + the entry interface (D-01) |
| `src/db.ts` `insertAuditLog` / `getAuditLog` | The writer + reader | Widen signature for new fields; add a filtered/export reader |
| `src/gate.ts` `encodeDecision`/`recordDecision` | Permission-event detail producer | Add tool/target/result/duration capture for permission rows |
| `src/permissions-config.ts` | Precedent: config setter that audits + reads `dashboard_settings` | Mirror for the retention window value (get/set) |
| `src/db.ts` `getDashboardSetting`/`setDashboardSetting` (`:3618`) | k/v config store | Store + read the retention window (D-31) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct columns on `audit_log` | Companion `audit_detail` table (1:1) | Companion table avoids widening every row but forces a JOIN on the export's streaming SELECT and on every read; the existing reader is `SELECT *` (`db.ts:3142`). Direct nullable columns are simpler and match the `addColumnIfMissing` precedent. **Recommend direct columns.** |
| Read-side cost join (`LEFT JOIN token_usage`) | Denormalize cost onto each audit row post-turn | Denormalizing requires a second write after the turn completes (the audit row was written mid-turn inside `canUseTool`), creating an update-after-insert pattern that fights the append-only rule. Read-side join keeps audit rows immutable. **Recommend read-side join.** |
| Store `model` in `audit_log` | Store `model` in `token_usage` (where it belongs but is absent) | `token_usage` has no `model` column today (confirmed `db.ts:202-213`). Adding it there is the "correct" home but means a second migration target and the join still resolves it. Capturing `model` directly on the audit row at the turn boundary is simpler for this phase. **Planner's call; capturing on audit row is lower-risk.** |

**Installation:** None. No external packages added.

**Version verification:** All versions above read directly from `package.json` (root) in this worktree on 2026-06-25. No registry lookup needed — nothing is being installed.

## Package Legitimacy Audit

> Not applicable. This phase installs **zero external packages**. All work uses already-installed, already-vetted dependencies. slopcheck/registry verification is moot — there is nothing new to verify.

## Architecture Patterns

### System Architecture Diagram

```
WRITE PATH (instrumentation — D-01/D-11/D-12)
─────────────────────────────────────────────

  [agent turn boundary]                 [permission decision]        [routine run]      [auth check]        [caught error]
  src/agent.ts query()                  src/gate.ts makeCanUseTool   routine-runner.ts  oauth-health.ts     message-core.ts
  capture session_id, model,            classify→resolve→            runRoutineOnce()   checkOAuthHealth()  catch(err) →
  start/stop ms                         encodeDecision(tool,tier,      catch/outcome      expiry/refresh      classifyError
        │                               mode,outcome,target,result)        │                  │                  │
        │ thread via GateContext               │                           │                  │                  │
        │ (NO module globals)                  ▼                           ▼                  ▼                  ▼
        └──────────────►  audit({ agentId, chatId, action, detail, blocked,  + new fields })  src/security.ts:109
                                                            │
                                            setAuditCallback  src/index.ts:161
                                                            │
                                                            ▼
                                            insertAuditLog(...)  src/db.ts:3113  ── INSERT only, never UPDATE/DELETE
                                                            │
                                                            ▼
                                        ┌──────────────────────────────────┐
                                        │ audit_log  (enriched, append-only) │
                                        │  + tool,target,project,decision,   │
                                        │    decided_by,decided_at,result,   │
                                        │    duration_ms,model,session_id,   │
                                        │    event_type   (cost via JOIN)    │
                                        └──────────────────────────────────┘
                                                  │              │
READ PATH                                         │              │  LEFT JOIN token_usage ON session_id (cost_usd)
─────────                                         ▼              ▼
                              GET /api/audit (filtered)   GET /api/audit/export (full filtered set, streamed)
                              src/dashboard.ts:3548       new Response(csv|json, {Content-Disposition})
                                       │                            │
                                       ▼                            ▼  file download (token in URL)
                              web/src/pages/Audit.tsx  (dense table + expand-for-detail + honest chips + Export)
                                       │
                                       ▼  relocated under Settings > Security (D-13)
                              web/src/pages/Settings.tsx  <Section title="Security">  /  routes.ts demote
```

### Recommended Project Structure
```
src/
├── db.ts              # audit_log schema enrich (createSchema + addColumnIfMissing); insertAuditLog/getAuditLog widen; new filtered + export readers; retention get/set
├── security.ts        # AuditAction union += 'auth'|'routine'|'error'; AuditEntry interface += new optional fields
├── gate.ts            # encodeDecision/recordDecision capture target/result/duration on permission rows
├── agent.ts           # capture model + session_id + start/stop duration at the query() boundary
├── routine-runner.ts  # emit 'routine' audit event per run (outcome already derived :161)
├── oauth-health.ts    # emit 'auth' audit event on refresh/expiry checks
├── message-core.ts    # emit 'error' audit event in the existing catch(err) (:661)
├── dashboard.ts       # enrich GET /api/audit (filters); new GET /api/audit/export; retention read/write
migrations/
├── version.json       # register "v1.2.4": ["enrich-audit-log"]
└── v1.2.4/
    └── enrich-audit-log.ts   # dual-write: same ADD COLUMN DDL as createSchema (P-4)
web/src/
├── pages/Audit.tsx    # rework: dense table, monospace, expand-for-detail, honest chips, Export, retention banner
├── pages/Settings.tsx # add <Section title="Security"> hosting/linking Audit (D-13)
├── lib/routes.ts      # demote /audit out of 'intelligence' nav section
└── App.tsx            # keep <Route path="/audit"> for deep-linking (:61)
```

### Pattern 1: Dual-write additive migration (P-4 — the load-bearing pattern)
**What:** Every schema change lands in TWO places: `createSchema`/`runMigrations` in `src/db.ts` (built for the in-memory test DB by `_initTestDatabase` at `:861`) AND a versioned `migrations/vX/` file registered in `migrations/version.json` (run against the live `store/` by `npm run migrate`).
**When to use:** Always, for any `audit_log` column. Skipping the versioned file crash-loops the live service on next restart (`checkPendingMigrations`, MEMORY.md "Deploy: migrations + worktrees").
**Example:**
```typescript
// Source: src/db.ts:601-606 (existing aos-cron precedent) + migrations/v1.2.3/create-approval-queue.ts
// In src/db.ts runMigrations() — mirrors the versioned file for the in-memory test DB:
addColumnIfMissing(database, 'audit_log', 'event_type', `TEXT`);
addColumnIfMissing(database, 'audit_log', 'tool', `TEXT`);
addColumnIfMissing(database, 'audit_log', 'target', `TEXT`);
addColumnIfMissing(database, 'audit_log', 'project', `TEXT`);
addColumnIfMissing(database, 'audit_log', 'decision', `TEXT`);
addColumnIfMissing(database, 'audit_log', 'decided_by', `TEXT`);
addColumnIfMissing(database, 'audit_log', 'decided_at', `INTEGER`);
addColumnIfMissing(database, 'audit_log', 'result', `TEXT`);
addColumnIfMissing(database, 'audit_log', 'duration_ms', `INTEGER`);
addColumnIfMissing(database, 'audit_log', 'model', `TEXT`);
addColumnIfMissing(database, 'audit_log', 'session_id', `TEXT`);
// cost_usd intentionally OMITTED as a column — resolved read-side via JOIN token_usage (see Pattern 3)

// In migrations/v1.2.4/enrich-audit-log.ts — the SAME columns, ADD COLUMN IF-guarded, for the live store.
// Use the exact migrations/v1.2.3 skeleton: open own better-sqlite3 handle at process.cwd()/store/claudeclaw.db,
// PRAGMA table_info guard each ADD COLUMN (SQLite ALTER has no "IF NOT EXISTS" for columns), idempotent.
```
**Backfill:** All new columns are nullable (no `NOT NULL DEFAULT`), so existing rows get `NULL` automatically — which the UI renders as the literal `not captured` token (UI-SPEC honest-detail rule). No data backfill needed; absence is honestly displayed, never fabricated.

### Pattern 2: Single audit choke point — extend, never fork
**What:** All events funnel through `audit()` → `setAuditCallback` → `insertAuditLog`. Widen the `AuditEntry` interface (`src/security.ts:95`), the union (`:87`), the writer signature (`db.ts:3113`), and the callback (`index.ts:161`) in lockstep. Call sites pass the new fields.
**When to use:** For every event type (D-11 full fidelity).
**Example:**
```typescript
// Source: src/security.ts:87-101 (extend in place)
export type AuditAction =
  | 'message' | 'command' | 'delegation' | 'kill' | 'blocked' | 'permission'
  | 'auth' | 'routine' | 'error';     // D-12 additions

export interface AuditEntry {
  agentId: string;
  chatId: string;
  action: AuditAction;
  detail: string;
  blocked: boolean;
  // D-01/D-11 optional captured fields (omit when not applicable; NULL in DB → "not captured" in UI):
  eventType?: string;       // the type-chip tag; usually === action but decoupled for config vs permission
  tool?: string; target?: string; project?: string;
  decision?: string; decidedBy?: string; decidedAt?: number;
  result?: string; durationMs?: number;
  model?: string; sessionId?: string;
}
```
The callback at `src/index.ts:161` becomes the single place that maps every optional field into the widened `insertAuditLog`.

### Pattern 3: token_usage ↔ audit_log resolution (the D-11 crux)
**What:** Audit rows are written *mid-turn* (inside `canUseTool`, before the turn's cost is known). `token_usage` is written *after* the turn (`message-core.ts:616`, from the `result` event `agent.ts:418`). Therefore: **capture `session_id` and `model` write-side** (both ARE known at turn start — `model` is the input param resolved at `message-core.ts:394`; `session_id` is `result.newSessionId ?? sessionId`), and **resolve `cost_usd` read-side** with a LEFT JOIN.
**When to use:** D-11 cost/model/session display.
**Example:**
```typescript
// Read-side resolution in the enriched /api/audit reader (src/db.ts):
// cost is the SUM of the turn's token_usage rows for that session, joined by session_id.
// Note: token_usage is per-API-call-turn, audit is per-action; multiple audit rows in one
// turn share one session_id and thus the same turn cost. The UI shows turn cost, labeled as such.
SELECT a.*,
       (SELECT COALESCE(SUM(t.cost_usd),0) FROM token_usage t WHERE t.session_id = a.session_id) AS cost_usd
FROM audit_log a
WHERE /* filters */ ORDER BY a.created_at DESC LIMIT ? OFFSET ?;
```
**Landmine flagged:** `token_usage` has **no `model` column** (confirmed `db.ts:202-213`). Do NOT try to read model from `token_usage`. Capture `model` directly onto the audit row at the turn boundary. The planner may *optionally* also add `model` to `token_usage` for correctness, but it's not required for this phase.

### Pattern 4: Duration timing (cheapest reliable approach)
**What:** Nothing measures per-event duration today. The cheapest reliable boundary differs per event type:
- **Permission decision:** `Date.now()` at the top of `makeCanUseTool` (`gate.ts:203`), diff at `recordDecision`. Captures gate evaluation + inline-ask wait. Sub-millisecond for allow, real for inline-ask.
- **Routine run:** `Date.now()` at `runRoutineOnce` entry (`routine-runner.ts:84`), diff before the emit at outcome derivation (`:161`).
- **Agent turn / message:** wrap `runAgentWithRetry` (`message-core.ts:481`) start/stop; the turn-boundary audit row stamps it.
- **Auth/error:** point-in-time events; `duration_ms` is legitimately `NULL` (→ "not captured"), which is honest, not a gap.
**When to use:** Per the boundaries above. Use monotonic `Date.now()` deltas; no external timing lib.

### Pattern 5: Streaming export file download (D-21)
**What:** A GET route returning a raw `Response` with `Content-Disposition: attachment`. The codebase already has this exact precedent at `src/dashboard.ts:2057-2062` (project file download). Inherits the `/api/*` token gate (`:345`) automatically; GET is exempt from the mutations kill-switch (`:381`).
**When to use:** `/api/audit/export?format=csv|json&<same filters as /api/audit>`.
**Example:**
```typescript
// Source: src/dashboard.ts:2057 (existing download precedent), adapted
app.get('/api/audit/export', (c) => {
  const format = c.req.query('format') === 'json' ? 'json' : 'csv';
  // Reuse the SAME filter parsing + query builder as /api/audit, but WITHOUT limit/offset —
  // the complete filtered set (D-21: never page-capped).
  const rows = getAuditLogFiltered({ ...filters /* no limit */ });
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  if (format === 'json') {
    const body = JSON.stringify({ exported_at: Date.now(), filters, count: rows.length, rows }, null, 2);
    return new Response(body, { headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="audit-${ts}.json"`,
    }});
  }
  const csv = toCsv(rows);  // RFC-4180 quote+escape; see Don't Hand-Roll note
  return new Response(csv, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="audit-${ts}.csv"`,
  }});
});
```
**[SEND_FILE] vs HTTP download:** `[SEND_FILE]` markers (CLAUDE.md) are a chat-transport affordance for the Slack/Telegram bot, NOT for the web dashboard. The Audit surface is a browser page; use the HTTP `Content-Disposition` download. **Do not use `[SEND_FILE]`** here. The browser fetch must put the token in the URL (`?token=...`) because the gate reads `c.req.query('token')` (`:352`) and a plain anchor/`window.location` download cannot send headers. Trigger the download client-side via `window.location.href = '/api/audit/export?...&token=...'` or fetch→blob→anchor.

### Pattern 6: Retention via dashboard_settings + read-only display (D-31)
**What:** Store the window as a `dashboard_settings` k/v entry (mirroring `permissions-config.ts`), read it in `/api/audit` (or a small `/api/audit/meta`) and display it. **No `DELETE` anywhere.**
**Example:**
```typescript
// Mirror src/permissions-config.ts getMode/setMode exactly:
const RETENTION_KEY = 'audit.retention_days';
export function getAuditRetentionDays(): number {
  const v = getDashboardSetting(RETENTION_KEY);
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 90;   // default 90 (spec), Claude's discretion
}
// setAuditRetentionDays mirrors setMode (validate + setDashboardSetting + optional config-change audit).
```
The UI subtitle renders `Retaining {N} days` from this value, never a hardcoded literal (UI-SPEC copy contract).

### Pattern 7: Honest type chips + honest detail (the AUD-01 promise)
**What:** Render an *active* filter chip only for event types that actually have backing rows; show spec types with no data as a disabled chip footnoted "not yet captured". For row detail, any column that is `NULL` renders the literal token `not captured` in faint text — never blank, never fabricated (UI-SPEC Interaction Contract; CONTEXT success criterion 2).
**How to know which chips have data:** a cheap `SELECT DISTINCT event_type FROM audit_log` (or per-type `COUNT > 0`) drives chip enablement.

### Anti-Patterns to Avoid
- **Forking the audit writer.** Do not add a second logger for the new event types — extend the single `audit()` path (Pattern 2). A parallel path re-creates the drift the spine was built to prevent.
- **Updating audit rows after insert.** The log is append-only (hard rule). Resolve cost read-side (Pattern 3); never `UPDATE audit_log SET cost_usd=...`.
- **Skipping the versioned migration.** `createSchema`-only changes pass tests but crash-loop the live service (P-4 / MEMORY.md). Both targets, always.
- **Reopening gate DECISION logic.** D-01 changes what the write path *records*, not whether/how the gate *decides* (CONTEXT out-of-scope). Touch `encodeDecision`/`recordDecision` to capture more fields; do NOT touch `classifyTier`/`resolveOutcome`.
- **Module globals for turn context.** Per-turn identity travels via `GateContext`/`opts.agentRuntime` — never a module-level mutable (multi-agent concurrency, STATE.md `gsd-subagents` + Phase 3 D-09 rule).
- **Putting tool_input/env into audit detail.** `detail`/`target` must carry only model-supplied, scrubbed params — never env/secrets (L-4 / ASVS V8; asserted by `gate.test.ts:184`).
- **Using `[SEND_FILE]` for the web export.** That's a chat-bot marker; the dashboard uses HTTP download (Pattern 5).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema migration | Inline `ALTER TABLE` edits | `addColumnIfMissing` + versioned `migrations/v1.2.4/` (`db.ts:526`, `migrations/v1.2.3`) | Dual-write is the only drift-safe path; bespoke ALTERs crash-loop live (P-4) |
| Config persistence (retention) | A new table | `getDashboardSetting`/`setDashboardSetting` + `permissions-config.ts` pattern | Restart-safe k/v already exists; new table = new migration risk |
| File download | Manual stream wiring | `new Response(body, {Content-Disposition})` (`dashboard.ts:2057`) | Exact precedent; inherits gate + mutations middleware |
| Token gate on export | Bespoke auth on the route | Mount under `/api/`; middleware (`dashboard.ts:345`) handles it | One auth boundary; D-21 says export inherits the same gate |
| Audit row dedupe/filter base | A second query language | Extend the existing `getAuditLog` SELECT (`db.ts:3135`) | Export reuses the SAME filter builder, just drops limit/offset |
| Outcome/type icons + tones | New icon set / colors | `lucide-preact` + CSS status tokens (UI-SPEC §Color) | Established design system; theme-agnostic status tokens |

**Key insight:** The only genuinely new code is the CSV serializer and the field-capture plumbing. CSV is the one place to be careful — see below.

**CSV serialization caution:** There is no CSV library installed and the set is small/structured, so a hand-rolled serializer is acceptable IF it implements RFC-4180 correctly: quote any field containing `,`, `"`, `\n`, or `\r`; escape embedded `"` as `""`; and guard against CSV-injection (a leading `=`/`+`/`-`/`@` in a cell — prefix with `'`) since exports open in Excel. `audit_log.detail` is free-text and WILL contain commas/quotes/newlines. Do not naively `.join(',')`. This is a known pitfall (Pitfall 3).

## Runtime State Inventory

> This is a schema-enrichment + instrumentation phase, not a rename/refactor. Most categories are N/A, but the migration touches live state, so the relevant ones are answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `audit_log` in `store/claudeclaw.db` (live) has existing rows with only the thin columns. New columns are nullable → existing rows read as `NULL` → UI shows "not captured". | Migration `v1.2.4` adds columns; NO data backfill (absence is honest). Operator runs `npm run migrate` before restart (MEMORY.md deploy rule). |
| Live service config | Retention window is NEW config in `dashboard_settings` (a DB table, not git). Defaults to 90 if unset — no migration row needed; `getAuditRetentionDays` supplies the default. | None at migration time; written on first operator change. |
| OS-registered state | None — no launchd/Task Scheduler/pm2 touch. Verified: phase changes are DB + API + web only. | None. |
| Secrets/env vars | None added. The gate's `getScrubbedSdkEnv` (`security.ts:193`) already strips secrets; audit `detail`/`target` must never store env (L-4, enforced by `gate.test.ts:184`). | None — preserve the no-secrets-in-detail invariant. |
| Build artifacts | The web bundle (`web/`) rebuilds on the Audit.tsx rework; the compiled `dist/` rebuilds for backend changes. No stale egg-info equivalent. | Standard `npm run build` / web build; no special handling. |

**Migration-specific note:** The in-memory test DB (`_initTestDatabase`, `db.ts:861`) gets the columns from `createSchema`+`runMigrations`; the live `store/` gets them from `migrations/v1.2.4`. Both MUST contain identical DDL or tests pass while production drifts (P-4).

## Common Pitfalls

### Pitfall 1: Migration drift (P-4) — tests green, production crash-loops
**What goes wrong:** Columns added only to `createSchema` (or only to a versioned migration). Tests use the in-memory DB and pass; the live service's `checkPendingMigrations` finds the registered version unapplied (or the table shape mismatches) and crash-loops on restart.
**Why it happens:** Two DB-build paths (test vs live) with no single source.
**How to avoid:** Add identical DDL to BOTH `src/db.ts` (`addColumnIfMissing` in `runMigrations`) AND `migrations/v1.2.4/enrich-audit-log.ts`, register `v1.2.4` in `migrations/version.json`. There is a dedicated test (`migrations.test.ts`, `migrate-runner.test.ts`) — add a case asserting the new version is registered and applies idempotently.
**Warning signs:** `migrations.test.ts` failing on version count; a column present in one path's `PRAGMA table_info` but not the other.

### Pitfall 2: Implying coverage that isn't captured (violates the AUD-01 promise)
**What goes wrong:** A row shows a blank cell (reads as "no value") instead of "not recorded"; or a type chip appears active with zero data, implying the log covers that type.
**Why it happens:** Default UI rendering of `NULL`/empty as blank.
**How to avoid:** Every `NULL` field renders the literal `not captured` in faint text; type chips with no backing rows render disabled + footnoted "not yet captured" (UI-SPEC). "Complete, read-only" is a promise (CONTEXT success criterion 2, verbatim).
**Warning signs:** An empty `<td>`; an enabled chip that returns zero rows when clicked.

### Pitfall 3: CSV corruption / injection on export
**What goes wrong:** `detail` (free-text, contains `,"\n`) breaks column alignment; or a cell starting with `=` executes as a formula when opened in Excel.
**Why it happens:** Naive `fields.join(',')` + no injection guard.
**How to avoid:** RFC-4180 quoting/escaping + leading-`=+-@` neutralization (see Don't Hand-Roll). Add a unit test with a `detail` containing a comma, a quote, a newline, and a leading `=`.
**Warning signs:** Misaligned CSV columns; a security review flag on spreadsheet formula injection.

### Pitfall 4: Cost shown per-row when it's per-turn
**What goes wrong:** Multiple audit rows from one agent turn each display the full turn cost, implying N× the real spend.
**Why it happens:** `token_usage` is per-turn; the JOIN attaches the same turn cost to every audit row in that turn.
**How to avoid:** Label the cost as the turn's cost (not the action's), or display it only on the turn-boundary/message row. The UI-SPEC expand-detail shows cost per row — caption it honestly ("turn cost") rather than implying per-action attribution.
**Warning signs:** Summed export cost wildly exceeds `token_usage` totals.

### Pitfall 5: Capturing cost at write time (impossible) and corrupting the append-only log
**What goes wrong:** An attempt to write cost onto the audit row triggers an `UPDATE` after the turn, violating append-only.
**Why it happens:** Misreading D-11 as "store cost on the row."
**How to avoid:** Resolve cost read-side (Pattern 3). The audit row is written once, mid-turn, and never updated.

### Pitfall 6: Export silently page-capped
**What goes wrong:** Export reuses `/api/audit`'s `limit` (default 50) and ships only the first page.
**Why it happens:** Copy-pasting the read endpoint's pagination.
**How to avoid:** The export query builder must drop `LIMIT/OFFSET` and stream the COMPLETE filtered set (D-21, explicit). Add a contract test: insert >page rows, export, assert full count.

## Code Examples

### Emitting a new event type (D-12 routine run)
```typescript
// Source: src/routine-runner.ts:161 (outcome already derived) + src/security.ts audit()
// After `const outcome = deriveOutcome(...)`, before/after persistRun:
audit({
  agentId: 'main', chatId: ALLOWED_CHAT_ID || 'routine',
  action: 'routine', eventType: 'routine',
  detail: JSON.stringify({ routineId: task.id, outcome, steps: results.length }),
  result: outcome, durationMs: Date.now() - startedAt,
  blocked: outcome === 'failed',
});
```

### Emitting an auth event (D-12)
```typescript
// Source: src/oauth-health.ts:43 checkOAuthHealth — at each expiry/refresh determination
audit({
  agentId: 'main', chatId: '', action: 'auth', eventType: 'auth',
  detail: JSON.stringify({ event: 'oauth_check', level: lastAlertLevel /* none|warning|expired */ }),
  blocked: lastAlertLevel === 'expired',
});
```

### Emitting a caught-error event (D-12)
```typescript
// Source: src/message-core.ts:661 catch(err) — alongside the existing logger.error
audit({
  agentId, chatId: chatIdStr, action: 'error', eventType: 'error',
  detail: JSON.stringify({ category: classifyError(err)?.category ?? 'unknown', message: String(err).slice(0, 500) }),
  result: 'error', blocked: false,
});
```
(Never include stack frames that could leak paths/secrets; cap message length.)

### Enriched permission decision (D-01)
```typescript
// Source: src/gate.ts:179 recordDecision — widen encodeDecision payload + pass through audit()
function recordDecision(ctx, d, blocked) {
  audit({
    agentId: ctx.agentId ?? 'main', chatId: ctx.chatId ?? '',
    action: 'permission', eventType: 'permission',
    detail: encodeDecision(d),                 // existing {tool,tier,mode,outcome,queueId}
    tool: d.tool, target: safeTarget(input),   // scrubbed, never env/secrets
    decision: d.outcome, decidedBy: d.outcome.includes('inline') ? 'operator' : 'system',
    decidedAt: Date.now(), durationMs: Date.now() - ctx._startMs,
    sessionId: ctx.sessionId, model: ctx.model,
    blocked,
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Thin `audit_log` (action/detail/blocked) | Enriched columns + read-side cost join | This phase | Real per-event technical detail (AUD-01) |
| `/audit` in main intelligence nav | Relocated under Settings > Security | This phase (D-13) | Admin-facing, opened deliberately |
| Page-capped read only | Complete-filtered-set CSV/JSON export | This phase (D-21) | Answers "what did the AI do with our data" |
| Unbounded silent log | Stated, configurable retention (no prune) | This phase (D-31) | Honest bound; enforcement deferred |

**Deprecated/outdated:** Nothing removed. `Audit.tsx`'s `formatRelativeTime` (`:108`) is replaced by absolute monospace timestamps per UI-SPEC (relative time is an Activity affordance); the file stays, the timestamp rendering changes.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Default retention window = 90 days | Pattern 6 / D-31 | Low — spec suggests ~90; explicitly Claude's discretion and must be stated. Easy to change. |
| A2 | Direct nullable columns on `audit_log` (not a companion table) | Standard Stack / Pattern 1 | Low-Med — companion table is a valid alternative (planner's call); direct columns simplify export streaming and match the `addColumnIfMissing` precedent. |
| A3 | `model` captured onto the audit row (not added to `token_usage`) | Pattern 3 | Low — both work; capturing on the row avoids a second migration target. Optional `token_usage.model` addition is non-blocking. |
| A4 | Cost is resolved read-side per-turn and labeled as turn cost | Pattern 3 / Pitfall 4 | Med — if the UI implies per-action cost, summed exports mislead. Mitigation = honest labeling (Pitfall 4). |
| A5 | Next migration version is `v1.2.4` | Pattern 1 | Low — current max in `migrations/version.json` is `v1.2.3`; standard increment. Verify no concurrent phase claimed it. |
| A6 | Export download triggers via token-in-URL GET (no header auth possible from a browser download) | Pattern 5 | Low — confirmed gate reads `c.req.query('token')` (`:352`); fetch→blob is the alternative if URL-token leakage via history is a concern (Referrer-Policy is already `no-referrer`, `:281`). |

## Open Questions

1. **Per-action vs per-turn cost attribution.**
   - What we know: `token_usage` is per-turn; multiple audit rows share one `session_id`.
   - What's unclear: whether the operator expects cost on every row or only on the turn-summary row.
   - Recommendation: display cost in expand-detail labeled "turn cost"; sum-by-session in export. Surface to discuss-phase if precise per-action cost is required (it isn't derivable from current data).

2. **`target` extraction without leaking secrets.**
   - What we know: `tool_input` is scrubbed in `approval_queue` but the gate's `input` param is raw model-supplied params.
   - What's unclear: which param is the "target" per tool (e.g. `to` for email, `file_path` for Write) and how to whitelist safely.
   - Recommendation: a small per-tool target-extractor (mirror `summarize()`/D-04 tool→phrase map in `gate.ts`) that whitelists known non-secret fields; default to omitting (→ "not captured") rather than dumping raw input.

3. **Session-refresh as a discrete event.**
   - What we know: `oauth-health.ts` runs periodic checks (`checkOAuthHealth`), not an explicit "refresh" hook.
   - What's unclear: whether the spec's "session refresh" maps to these health checks or to an actual token refresh the SDK does opaquely.
   - Recommendation: emit `auth` events at the health-check determinations we control; honestly note (coverage banner) if true SDK-internal refreshes aren't observable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `better-sqlite3` | schema/migration | ✓ | ^11.8.1 | — |
| `hono` (+`hono/streaming`) | export endpoint | ✓ | ^4.12.3 (imported `dashboard.ts:3`) | — |
| `@anthropic-ai/claude-agent-sdk` | turn-boundary capture | ✓ | ^0.2.34 | — |
| `preact` / `lucide-preact` / `tailwindcss` | Audit surface | ✓ | 10.29 / 1.14 / 4.2 | — |
| `vitest` | tests | ✓ | ^2.0.0 | — |
| `npm run migrate` runner | apply `v1.2.4` to live store | ✓ | `scripts/migrate.ts` / `src/migrations.ts` present | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None. This phase adds no external dependencies.

**Worktree note (STATE.md `gsd-execute-phase-worktree-deps`):** This is a git worktree; `node_modules`/`.env`/`store/` may be symlinked from the main checkout. Run tests against the in-memory test DB (`_initTestDatabase`) — they do not need the live `store/`. The live migration is applied by the operator on the main checkout before restart, never from the worktree.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2.0.0 |
| Config file | `vitest` block in root `package.json` |
| Quick run command | `npx vitest run src/db.test.ts src/gate.test.ts` |
| Full suite command | `npx vitest run` |
| Contract-test harness | `src/dashboard.contract.test.ts` uses `_initTestDatabase()` + Hono `app.request(path + '?token=' + TOKEN)` — no real port (`:34`, `:38`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUD-01 | New `audit_log` columns exist in both test DB and migration | unit | `npx vitest run src/migrations.test.ts -t "audit"` | ❌ Wave 0 (extend `migrations.test.ts`) |
| AUD-01 | `insertAuditLog` persists + `getAuditLog`/filtered reader returns new fields | unit | `npx vitest run src/db.test.ts -t "audit"` | ❌ Wave 0 (add to `db.test.ts`) |
| AUD-01 | Permission decision records enriched detail (tool/target/result/duration), no secrets | unit | `npx vitest run src/gate.test.ts` | ✅ extend (`gate.test.ts:146` "audit recorded", `:184` no-secrets) |
| AUD-01 | New event types emit (`auth`/`routine`/`error`) | unit | `npx vitest run src/routine-runner.test.ts src/message-core.test.ts` | ✅ extend |
| AUD-01 | `/api/audit` returns enriched rows + cost via JOIN + honest NULLs | contract | `npx vitest run src/dashboard.contract.test.ts -t "audit"` | ✅ extend |
| AUD-01 | NULL fields surface as "not captured", never blank; chips honest | component/manual | UI render check (no headless web test infra) | manual-only (no web test runner) |
| AUD-02 | `/api/audit/export` returns full filtered set (not page-capped), CSV + JSON, Content-Disposition | contract | `npx vitest run src/dashboard.contract.test.ts -t "export"` | ❌ Wave 0 |
| AUD-02 | CSV serializer RFC-4180 + injection-safe (comma/quote/newline/leading-`=`) | unit | `npx vitest run src/db.test.ts -t "csv"` (or new `audit-export.test.ts`) | ❌ Wave 0 |
| AUD-02 | Retention window get/set + default 90; displayed value reads config | unit | `npx vitest run -t "retention"` | ❌ Wave 0 |
| AUD-02 | No DELETE on audit_log anywhere (append-only invariant) | unit/grep | assert no `DELETE FROM audit_log` in `src/`; CRUD test inserts only | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/db.test.ts src/gate.test.ts src/dashboard.contract.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** full suite green + `npm run migrate` dry-run applies `v1.2.4` idempotently before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/migrations.test.ts` — assert `v1.2.4` registered + idempotent apply (covers AUD-01 schema)
- [ ] `src/db.test.ts` — audit insert/read with new fields; cost JOIN; "no DELETE" invariant
- [ ] `src/audit-export.test.ts` (new) OR add to `db.test.ts` — CSV RFC-4180 + injection cases
- [ ] `src/dashboard.contract.test.ts` — `/api/audit` enriched + `/api/audit/export` full-set + Content-Disposition headers
- [ ] retention get/set unit test (default 90, validates input)
- [ ] Framework install: none — Vitest already present.
- [ ] Note: no headless web test harness exists; the honest-chip / "not captured" rendering is **manual-only** verification (flag for the end-of-phase human-verify checkpoint).

## Security Domain

> `security_enforcement` config not located as explicitly `false`; treating as enabled. This phase is security-adjacent (audit_log is encryption-adjacent and append-only per STATE.md blocker).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Export inherits the existing dashboard token gate; no new auth |
| V3 Session Management | no | No new sessions |
| V4 Access Control | yes | `/api/audit/export` MUST mount under `/api/` so the token middleware (`dashboard.ts:345`) gates it; GET is mutations-exempt by design |
| V5 Input Validation | yes | Filter/search/date-range + `format` query params parameterized into the SELECT (better-sqlite3 prepared statements); validate `format ∈ {csv,json}`, clamp/parse dates |
| V6 Cryptography | no | No new crypto; audit reads must go through ClaudeClaw's decryption path, not raw ciphertext reads (STATE.md blocker) — relevant only if any audit field is an encrypted column (current `audit_log` is not) |
| V7 Error Handling/Logging | yes | The `error` event type IS structured logging; cap message length, never log secrets/stack paths |
| V8 Data Protection | yes | `detail`/`target` must never store env/secrets (L-4; `gate.test.ts:184`); CSV-injection neutralization on export |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via filter/search params | Tampering | better-sqlite3 prepared statements (`?` placeholders) — never string-concatenate filters |
| Secret/env leakage into audit detail or export | Information Disclosure | Scrubbed input only into `detail`/`target` (L-4 / ASVS V8); reuse `getScrubbedSdkEnv` boundary; test asserts no secrets |
| CSV formula injection (export opened in Excel) | Tampering/Code-exec | Prefix leading `= + - @` cells with `'`; RFC-4180 quoting |
| Tampering with the append-only log | Tampering | No UPDATE/DELETE statements on `audit_log` (hard rule); tamper-evidence/hash-chaining explicitly deferred (enterprise wrapper) |
| Token leakage via export URL in browser history/Referer | Information Disclosure | `Referrer-Policy: no-referrer` already set (`dashboard.ts:281`); consider fetch→blob over `window.location` if history retention is a concern (A6) |
| Unauthorized export access | Spoofing/Elevation | Mount under `/api/` for automatic token gate; do not add a public path |

## Sources

### Primary (HIGH confidence — this worktree's source)
- `src/db.ts` — `audit_log` (:332), `token_usage` (:202, no `model` col), `approval_queue` (:352), `insertAuditLog` (:3113), `getAuditLog` (:3135), `addColumnIfMissing` (:526), `runMigrations` (:543), `_initTestDatabase` (:861), `getDashboardSetting`/`setDashboardSetting` (:3618)
- `src/security.ts` — `AuditAction` (:87), `AuditEntry` (:95), `audit()` (:109), `setAuditCallback` (:105), `getScrubbedSdkEnv` (:193), drop-vars (:139-185)
- `src/gate.ts` — `encodeDecision` (:169), `recordDecision` (:179), `makeCanUseTool` (:203), `summarize` (:135), `GateContext` (:145)
- `src/index.ts` — `setAuditCallback` wiring → `insertAuditLog` (:161)
- `src/permissions-config.ts` — `dashboard_settings` config + audit-on-write precedent (whole file)
- `src/agent.ts` — `query()` turn boundary (:287), `result` event usage (:418), `UsageInfo` (:80, no model field), `AgentResult` (:134)
- `src/message-core.ts` — `saveTokenUsage` (:616), model resolution (:394), `catch(err)` (:661)
- `src/routine-runner.ts` — `runRoutineOnce` (:84), outcome derivation (:161)
- `src/oauth-health.ts` — `checkOAuthHealth` (:43), expiry/level logic
- `src/dashboard.ts` — `/api/audit` (:3548), `/api/audit/blocked` (:3557), token middleware (:345), mutations kill-switch (:379), file-download precedent (:2057), `hono/streaming` import (:3)
- `migrations/version.json` (max v1.2.3), `migrations/v1.2.3/create-approval-queue.ts` (dual-write skeleton)
- `web/src/pages/Audit.tsx` (whole), `web/src/lib/routes.ts` (:27-43), `web/src/lib/vocabulary.ts` (:56-72), `web/src/App.tsx` (:50-64), `web/src/pages/Settings.tsx` (Section composition)
- `src/gate.test.ts` (:146-184), `src/dashboard.contract.test.ts` (:34-38), `src/migrations.test.ts`, `src/migrate-runner.test.ts`
- `package.json` (versions), `.planning/phases/05-audit-log/05-CONTEXT.md`, `05-UI-SPEC.md`, `specs/operator-product/08-activity-audit.md`, `.planning/STATE.md`, MEMORY.md

### Secondary / Tertiary
- None. No external sources needed; no packages installed; no library API uncertainty.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions read from package.json; nothing installed
- Architecture/integration points: HIGH — every seam cited at file:line in this worktree
- Migration pattern: HIGH — `v1.2.3` is an exact, recent precedent
- token_usage↔audit join: HIGH on the constraint (model absent, cost post-turn confirmed); MEDIUM on the chosen resolution (read-side join) being the operator's preference (flagged A3/A4, Open Q1)
- Duration timing: HIGH — boundaries identified in source; approach is standard `Date.now()` deltas
- UI relocation: HIGH — routes/router/Settings structure confirmed

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (stable internal codebase; re-verify migration version + any concurrent phase touching `audit_log` before planning)
