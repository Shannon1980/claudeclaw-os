---
phase: 05-audit-log
plan: 02
subsystem: database
tags: [audit, sqlite, migration, better-sqlite3, permission-gate, retention, append-only]

# Dependency graph
requires:
  - phase: 05-01
    provides: "Wave 0 RED tests pinning v1.2.4 migration, enriched insertAuditLog (options object), getAuditLogFiltered, retention get/set, append-only invariant, and gate enriched-detail/no-secrets contracts"
provides:
  - "audit_log enriched with 11 nullable per-event columns in BOTH DB paths (createSchema+runMigrations and migrations/v1.2.4) — P-4 dual-write"
  - "Widened single audit() choke point (union + AuditEntry interface + index.ts callback + insertAuditLog writer) carrying the captured fields end-to-end"
  - "getAuditLogFiltered — the single filtered audit reader returning enriched rows with honest NULLs"
  - "Fully instrumented permission decisions: tool, scrubbed target, decision, decidedBy, decidedAt, durationMs, sessionId, model via GateContext (no module globals)"
  - "Configurable audit retention window (default 90, validated, append-only — zero deletes), with an audited setter mirroring setMode"
affects: [05-03 read-export-ui, 05-04 widen-event-types, audit, dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual-write additive migration (addColumnIfMissing in runMigrations + PRAGMA-guarded ALTER in versioned migration, byte-identical DDL)"
    - "Single audit choke point widened in lockstep (union/interface/callback/writer); options-object writer once args exceed ~5"
    - "Per-turn capture via GateContext carriers (sessionId/model/_startMs) — never module globals"
    - "Per-tool whitelist target extractor (safeTarget) with secret-field-name guard and length cap"
    - "Append-only audit log: storage primitives in db.ts (pure, validated), audited wrapper in permissions-config.ts"

key-files:
  created:
    - migrations/v1.2.4/enrich-audit-log.ts
  modified:
    - src/db.ts
    - src/security.ts
    - src/index.ts
    - src/gate.ts
    - src/permissions-config.ts
    - src/dashboard.ts
    - src/warroom-text-orchestrator.ts
    - migrations/version.json
    - src/gate.test.ts
    - src/dashboard.contract.test.ts

key-decisions:
  - "insertAuditLog converted to a single options-object parameter; ALL positional call sites migrated (dashboard.ts x11, warroom x1, index.ts callback, contract-test /api/activity x2) — no half-migrated signature"
  - "Retention storage primitives (getAuditRetentionDays/setAuditRetentionDays) live in db.ts where the Wave 0 test imports them and where getDashboardSetting lives; permissions-config.ts adds setAuditRetention (audited wrapper) + re-exports the getter, mirroring setMode"
  - "Added a string index signature to AuditLogEntry so the Wave 0 cast `as Array<Record<string,unknown>>` typechecks and to host the read-side cost JOIN column (plan 03)"
  - "safeTarget Bash special-case records the command string (already classified upstream); secret-shaped field names are dropped even when whitelisted"

patterns-established:
  - "Dual-write migration with byte-identical DDL across both DB paths"
  - "GateContext per-turn carriers for audit enrichment (no globals)"
  - "safeTarget whitelist+secret-guard for recording tool targets without leaking secrets"

requirements-completed: [AUD-01, AUD-02]

# Metrics
duration: ~9min
completed: 2026-06-25
---

# Phase 5 Plan 02: Audit Log Slice A (data spine) Summary

**Enriched audit_log with 11 nullable per-event columns (dual-written via v1.2.4 + addColumnIfMissing), widened the single audit() pipeline to carry them end-to-end, fully instrumented permission decisions write-side via GateContext, and added a validated append-only retention window — turning the Wave 0 migration/db/retention/gate tests GREEN.**

## Performance

- **Duration:** ~9 min
- **Completed:** 2026-06-25T21:24:00Z
- **Tasks:** 2
- **Files modified:** 10 (+1 created)

## Accomplishments
- audit_log now carries event_type/tool/target/project/decision/decided_by/decided_at/result/duration_ms/model/session_id in BOTH the in-memory test DB (createSchema + runMigrations) and the live store (migrations/v1.2.4), with byte-identical DDL so checkPendingMigrations cannot crash-loop (P-4 / Pitfall 1). cost_usd intentionally absent (resolved read-side, D-11).
- The single audit() choke point is widened in lockstep: AuditAction gains auth/routine/error (D-12), AuditEntry gains the optional captured fields, the index.ts callback maps every field, and insertAuditLog became an options-object INSERT-only writer (append-only, D-31). getAuditLogFiltered is the single filtered reader returning enriched rows with honest NULLs.
- Permission decisions are fully instrumented: recordDecision emits tool, scrubbed target (safeTarget whitelist), decision, decidedBy (operator for inline / system otherwise), decidedAt, durationMs (from GateContext._startMs), sessionId and model — all per-turn carriers on GateContext, no module globals. classifyTier/resolveOutcome untouched.
- Retention window is configurable: getAuditRetentionDays/setAuditRetentionDays (db.ts, default 90, rejects non-positive/non-integer) plus an audited setAuditRetention wrapper (permissions-config.ts) mirroring setMode. No DELETE/UPDATE on audit_log anywhere.

## Task Commits

1. **Task 1: Dual-write schema migration + widen the audit choke point** - `dbe36f6` (feat)
2. **Task 2: Instrument permission decisions + retention config** - `b12759b` (feat)

_TDD note: Wave 0 (05-01) authored the failing tests; this plan implemented to GREEN, so each task is a single feat() commit rather than a separate test()→feat() pair._

## Files Created/Modified
- `migrations/v1.2.4/enrich-audit-log.ts` - NEW. Versioned dual-write migration; PRAGMA-guarded idempotent ALTER TABLE for the 11 columns (v1.2.3 skeleton).
- `migrations/version.json` - Registered `v1.2.4: [enrich-audit-log]`.
- `src/db.ts` - audit_log addColumnIfMissing block in runMigrations; options-object insertAuditLog (INSERT-only); enriched AuditLogEntry + index signature; getAuditLogFiltered; getAuditRetentionDays/setAuditRetentionDays.
- `src/security.ts` - AuditAction +auth/routine/error; AuditEntry +optional captured fields.
- `src/index.ts` - setAuditCallback maps every optional field into insertAuditLog (single mapping point).
- `src/gate.ts` - GateContext +sessionId/model/_startMs; _startMs stamp in makeCanUseTool; widened recordDecision; safeTarget whitelist extractor.
- `src/permissions-config.ts` - setAuditRetention audited wrapper + getAuditRetentionDays re-export (mirrors setMode).
- `src/dashboard.ts` - migrated 11 positional insertAuditLog calls to the options object.
- `src/warroom-text-orchestrator.ts` - migrated the tool_call insertAuditLog call.
- `src/gate.test.ts` - added enriched-detail + operator-decidedBy cases; extended no-secrets assertion to the target field.
- `src/dashboard.contract.test.ts` - migrated 2 /api/activity positional insertAuditLog calls.

## Decisions Made
- insertAuditLog took a single options object; every positional call site migrated in the same commit to avoid a half-migrated signature (Wave 0 contract).
- Retention storage primitives placed in db.ts (test imports them there; getDashboardSetting lives there); the audited mutator lives in permissions-config.ts to mirror setMode/setOverride and keep db.ts free of a security import (no circular dependency).
- Added a string index signature to AuditLogEntry to satisfy the Wave 0 cast and to host plan 03's read-side cost JOIN column.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Migrated pre-existing positional insertAuditLog call sites**
- **Found during:** Task 1 (widening insertAuditLog to an options object)
- **Issue:** 14 positional callers (dashboard.ts x11, warroom-text-orchestrator.ts x1, index.ts callback, dashboard.contract.test.ts /api/activity x2) would break the build once the signature changed — a half-migrated signature was explicitly forbidden by the Wave 0 contract.
- **Fix:** Converted every call to the options-object form in the same commit.
- **Files modified:** src/dashboard.ts, src/warroom-text-orchestrator.ts, src/index.ts, src/dashboard.contract.test.ts
- **Verification:** tsc clean (except the two unrelated plan-03 audit-export.test.ts errors); /api/activity contract tests stay GREEN.
- **Committed in:** dbe36f6 (Task 1 commit)

**2. [Rule 3 - Blocking] Added index signature to AuditLogEntry for the Wave 0 cast**
- **Found during:** Task 1 (getAuditLogFiltered return type)
- **Issue:** The Wave 0 db.test.ts casts `getAuditLogFiltered({}) as Array<Record<string, unknown>>`; a strict AuditLogEntry without an index signature makes that cast a TS2352 error.
- **Fix:** Added `[key: string]: string | number | null | undefined` to AuditLogEntry (also hosts plan 03's cost JOIN column).
- **Files modified:** src/db.ts
- **Verification:** tsc clean on db.test.ts.
- **Committed in:** dbe36f6 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking signature/type propagation)
**Impact on plan:** Both were mandatory to keep the build and pre-existing tests GREEN after widening the writer. No scope creep — strictly required by the Wave 0 contract.

## Issues Encountered
- Full-suite run shows failures OUTSIDE this plan's scope, all logged to `deferred-items.md`:
  - 4 plan-03 Wave 0 RED contracts (`/api/audit` cost JOIN, `/api/audit/export` route, `toCsv`/`toJsonEnvelope` in audit-export.test.ts) — intentionally still RED; plan 03 owns them.
  - 2 pre-existing SPA-shell auth-gate failures (verified failing on clean HEAD).
  - 3 schedule-cli.test.ts failures (`Cannot find module dist/schedule-cli.js` — no build in worktree) and 1 chat-task-tracker classifier-mock failure — environment, unrelated, no audit reference.
- A `git stash`/`pop` was briefly used to confirm the SPA-shell failures pre-date this plan; the working tree and stash list were verified intact immediately after, and no further stash use occurred (worktree shared-stash hazard noted).

## User Setup Required
None - no external service configuration required. The v1.2.4 migration runs idempotently via `npm run migrate` before the next live-service restart (it adds nullable columns only).

## Next Phase Readiness
- Slice A data spine is complete: a permission event is now captured at full fidelity end-to-end (write-side), with honest NULLs for everything not yet captured.
- Plan 03 can build the read/export/UI layer on `getAuditLogFiltered`: add the read-side cost JOIN (Pattern C), the `/api/audit/export` route, and `toCsv`/`toJsonEnvelope` serializers — its Wave 0 RED tests are already authored.
- Plan 04 can widen emissions to auth/routine/error event types (the union already ships).

## Threat Flags

None - no new security surface beyond the plan's threat_model. safeTarget and the no-secrets assertions keep detail/target scrubbed (T-05-02); the writer stays INSERT-only (T-05-03); the dual-write DDL is byte-identical (T-05-04).

## Self-Check: PASSED

- FOUND: migrations/v1.2.4/enrich-audit-log.ts
- FOUND: .planning/phases/05-audit-log/05-02-SUMMARY.md
- FOUND commit: dbe36f6 (Task 1)
- FOUND commit: b12759b (Task 2)

---
*Phase: 05-audit-log*
*Completed: 2026-06-25*
