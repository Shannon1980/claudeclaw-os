---
phase: 05-audit-log
plan: 01
subsystem: audit-log-test-scaffold
tags: [tests, wave-0, red-baseline, audit, csv, migration, retention]
requires: []
provides:
  - "RED test contracts for AUD-01 schema/write/read (v1.2.4 migration, enriched columns, retention)"
  - "RED test contracts for AUD-02 export/CSV-safety (toCsv RFC-4180+injection, JSON envelope, full-set export)"
  - "Append-only invariant guard (no DELETE FROM audit_log in src/)"
affects:
  - src/migrations.test.ts
  - src/db.test.ts
  - src/audit-export.test.ts
  - src/dashboard.contract.test.ts
tech-stack:
  added: []
  patterns:
    - "Vitest in-memory test DB via _initTestDatabase() + getDb() PRAGMA introspection"
    - "Hono app.request(path + '?token=') contract harness (no real port)"
    - "Static source-scan guard for append-only invariant (comment-filtered grep)"
key-files:
  created:
    - src/audit-export.test.ts
  modified:
    - src/migrations.test.ts
    - src/db.test.ts
    - src/dashboard.contract.test.ts
decisions:
  - "insertAuditLog pinned to an options-object signature (>5 fields) — plan 02 widens the writer to match"
  - "cost_usd is NOT a column; tests assert its absence and pin read-side JOIN resolution (D-11)"
  - "toCsv + toJsonEnvelope exported from src/dashboard.ts (plan 03 implements)"
  - "getAuditLogFiltered is the single filtered reader; export reuses it minus LIMIT/OFFSET"
metrics:
  duration: ~9min
  completed: 2026-06-25
---

# Phase 5 Plan 01: Audit Log Test Scaffold Summary

Wave 0 RED baseline: 22 failing tests across four files that pin every automated AUD-01/AUD-02 behavior (schema enrichment, enriched write/read, cost JOIN, full-set CSV/JSON export, RFC-4180 + formula-injection CSV safety, retention get/set, append-only invariant) before any production code exists. Plans 02/03/04 turn these GREEN.

## What Was Built

Two task commits, each authoring failing tests against the current (un-enriched) source:

**Task 1 — Migration + schema + retention (`7ab7655`)**
- `src/migrations.test.ts`: new `describe('audit log migration v1.2.4')` — asserts `version.json` registers `v1.2.4 -> ["enrich-audit-log"]`, that it is the highest version, that the schema applies idempotently leaving all 11 new columns present exactly once, and that `cost_usd` is NOT a column (read-side JOIN per D-11).
- `src/db.test.ts`: `audit_log enriched columns` — `insertAuditLog` (options object) persists all 11 fields and the filtered reader returns them; omitted fields read back `null` (honest absence). `audit_log is append-only` — static source scan asserts zero `DELETE FROM audit_log` in `src/` (comment-filtered). `audit retention window` — default 90, integer round-trip, rejects non-positive and non-integer input.

**Task 2 — Export + CSV-safety + enriched-read (`f512ecd`)**
- `src/audit-export.test.ts` (new): `toCsv` RFC-4180 cases (plain unquoted; quote comma; double embedded quote; quote newline/CR; prefix leading `= + - @`; one combined nasty cell with comma+quote+newline+leading `=`); JSON envelope `{ exported_at, count, rows }`.
- `src/dashboard.contract.test.ts`: `/api/audit enriched` pins Pitfall 4 — 3 audit rows sharing one `session_id` + 1 `token_usage` row, each row returns the turn's cost (not 0, not 3x) with honest NULLs. `/api/audit/export` pins Pitfall 6 — 120 rows (> the 50 default page) returns the full set, `Content-Disposition: attachment` with `audit-<ts>.csv`/`.json` filename, `text/csv` / `application/json`, invalid `format` falls back to csv, and the route inherits the token gate (401 without token).

## Verification

`npx vitest run src/migrations.test.ts src/db.test.ts src/audit-export.test.ts src/dashboard.contract.test.ts`
- Result: **22 failed | 190 passed**. The 22 failures are the authored RED cases (9 Task 1 + 13 Task 2). All pre-existing tests stay GREEN.
- RED reasons are the intended missing behaviors: `v1.2.4` unregistered, new columns absent, `getAuditLogFiltered`/`getAuditRetentionDays`/`setAuditRetentionDays` not implemented, `insertAuditLog` not yet widened to the options object, `toCsv`/`toJsonEnvelope` not exported, `/api/audit/export` route absent, `/api/audit` cost JOIN absent.
- The two invariant guards (no `cost_usd` column, no `DELETE FROM audit_log`) PASS today and must keep passing — they protect against regressions plans 02/03 could introduce.

## Deviations from Plan

None - plan executed exactly as written. Both tasks authored the specified RED tests with no production code changes.

## Notes for Downstream Plans

- **Writer signature (plan 02):** Tests pin `insertAuditLog(opts)` where `opts` carries `agentId, chatId, action, detail, blocked` plus optional `eventType, tool, target, project, decision, decidedBy, decidedAt, result, durationMs, model, sessionId`. The existing positional call sites in `dashboard.contract.test.ts` (`/api/activity` tests) still use the old positional form and pass — plan 02 must migrate those call sites when it widens the writer, or keep positional back-compat.
- **Reader (plan 02):** `getAuditLogFiltered(filters)` returns enriched rows; the export endpoint reuses it minus LIMIT/OFFSET (Pitfall 6).
- **Cost JOIN (plan 02/03):** `/api/audit` must attach per-turn cost via correlated subquery on `session_id` — the enriched test asserts each of 3 same-session rows gets the single turn cost, not 0 and not 3x.
- **Export serializers (plan 03):** `toCsv(rows)` and `toJsonEnvelope(rows)` must be exported from `src/dashboard.ts`.
- **Retention (plan 02):** `getAuditRetentionDays()` / `setAuditRetentionDays(n)` keyed on `audit.retention_days` in `dashboard_settings`.

## Self-Check: PASSED

- FOUND: src/audit-export.test.ts
- FOUND: src/migrations.test.ts (modified)
- FOUND: src/db.test.ts (modified)
- FOUND: src/dashboard.contract.test.ts (modified)
- FOUND commit: 7ab7655 (Task 1)
- FOUND commit: f512ecd (Task 2)
