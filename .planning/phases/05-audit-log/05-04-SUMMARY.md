---
phase: 05-audit-log
plan: 04
subsystem: audit-instrumentation
tags: [audit, instrumentation, oauth-health, routine-runner, message-core, gate-context, turn-boundary, append-only, no-secrets, human-verify]

# Dependency graph
requires:
  - phase: 05-02
    provides: "Widened audit() choke point (AuditAction +auth/routine/error, AuditEntry optional captured fields), insertAuditLog options-object writer, GateContext sessionId/model/_startMs carriers, recordDecision already mapping model onto the row"
  - phase: 05-03
    provides: "getAuditLogTypes() driving honest chips; Audit surface already wired to enable a chip the moment a type has backing data; getAuditLogFiltered (the reader /api/audit uses)"
  - phase: 05-01
    provides: "Wave 0 contract pinning the emission seams and the end-to-end model-capture assertion"
provides:
  - "auth event emission at every OAuth health determination (none/warning/expired) via checkOAuthHealth through the single audit() choke point"
  - "routine event emission at runRoutineOnce outcome derivation (result + durationMs + blocked), detail = routineId/outcome/steps only"
  - "error event emission in the message-core catch, reusing AgentError.category, first-line + 500-cap message with no stack frames (T-05-10)"
  - "Turn-boundary capture: model/sessionId/_startMs threaded into the attended GateContext so permission rows resolve model/session/duration per-turn (D-01) with no module globals (T-05-11)"
  - "Honest type chips for auth/routine/error now light up because real backing data exists (getAuditLogTypes returns them once emitted)"
  - "checkOAuthHealth exported + dependency-injected so the auth row has a real automated seam (oauth-health.test.ts), not manual-only"
affects: [audit, dashboard, settings-ui, oauth-health, routine-runner, message-core]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Emit-at-source through the single audit() choke point (no second logger) for every new event type"
    - "Per-determination audit event decoupled from the anti-spam transition guard (the alert sends on change; the audit records every check)"
    - "Dependency-injected health check (readEnv/readCredentials/credentialsFileExists/alertThresholdMs) so emission is unit-testable without the real credentials file"
    - "Turn-boundary timing via a per-turn _startMs stamped at the turn entry and threaded through GateContext (Pattern 4); gate reuses the caller's _startMs"
    - "Error detail = first line only + 500-char cap (no stack frames, no secrets, Pattern D / T-05-10)"

key-files:
  created:
    - src/oauth-health.test.ts
  modified:
    - src/oauth-health.ts
    - src/routine-runner.ts
    - src/message-core.ts
    - src/routine-runner.test.ts
    - src/message-core.test.ts
    - src/gate.test.ts

key-decisions:
  - "checkOAuthHealth exported with an OAuthHealthDeps options object (defaults read the real file/env) so the auth row gets a REAL automated seam rather than manual-only — the test drives each alert level deterministically"
  - "The auth audit event fires on EVERY determination (point-in-time), decoupled from the existing anti-spam sender guard which only alerts on a level transition; durationMs is legitimately omitted -> NULL -> 'not captured' (Pattern 4, honest not a gap)"
  - "No auth event is emitted when there is no credentials file AND no env auth (no determination we can stand behind, per Open Q3) — the UI coverage banner states the rest; we do NOT fake refresh events"
  - "Error message is taken first-line-only THEN sliced to 500 (research said String(err).slice(0,500); first-line is a strictly stronger scrub that keeps stack frames out even on short messages)"
  - "Turn _startMs is stamped at the turn entry in message-core and passed through GateContext; the gate's own idempotent stamp (if undefined) is preserved, so durationMs spans the full turn (Pattern 4 wrap of runAgentWithRetry)"

patterns-established:
  - "Emit-at-source + single audit() choke point for new event types (no parallel logger)"
  - "Injectable health-check deps for unit-testable side-effect emission"
  - "Per-turn timing/identity carriers on GateContext (never module globals)"

requirements-completed: [AUD-01, AUD-02]

# Metrics
duration: ~25min
completed: 2026-06-25
---

# Phase 5 Plan 04: Audit Log Slice C (widen event types) Summary

**Emitted the three missing audit event types (auth, routine, error) at their source modules through the single audit() choke point, threaded per-turn model/session/duration into the attended GateContext so permission rows resolve full fidelity (no module globals), added a real automated auth-emission seam and an end-to-end model-capture assertion — turning the new emission tests GREEN with the full suite carrying no new regressions. The end-of-phase human-verify checkpoint over the live Audit surface is now AWAITING operator sign-off.**

## Performance

- **Duration:** ~25 min
- **Completed (Task 1):** 2026-06-25
- **Tasks:** 1 of 2 automated complete; Task 2 (human-verify) awaiting operator
- **Files modified:** 6 (+1 created)

## Accomplishments

- **routine event (D-12):** `runRoutineOnce` stamps a start time at entry and, after outcome derivation, emits one `audit({ action:'routine', eventType:'routine', result: outcome, durationMs, blocked: outcome==='failed' })`. detail carries ONLY `{routineId, outcome, steps}` — never raw step output (which can hold secrets, Pattern D).
- **auth event (D-12):** `checkOAuthHealth` now emits one `audit({ action:'auth', eventType:'auth', detail:{event:'oauth_check', level}, blocked: level==='expired' })` at each determination (none/warning/expired/unreadable-file). It is exported + dependency-injected (`OAuthHealthDeps`) so the new `oauth-health.test.ts` seam stubs the `audit()` callback and asserts the entry shape per level. Per Open Q3, no event fires when there is no credentials file AND no env auth (no determination to stand behind); SDK-internal refreshes are not faked. durationMs omitted (point-in-time -> NULL -> "not captured").
- **error event (D-12):** the message-core `catch(err)` emits one `audit({ action:'error', eventType:'error', detail:{category, message}, result:'error', blocked:false })` alongside the existing `logger.error`. It reuses `AgentError.category` (no re-classify) and caps the message at the first line + 500 chars, so stack frames / file paths / secrets in deeper frames never reach the log (T-05-10).
- **Turn-boundary capture (D-01):** message-core stamps `turnStartMs` at the turn entry and threads `model: effectiveModel`, `sessionId`, `_startMs: turnStartMs` into the attended GateContext. Every permission row this turn now resolves model (token_usage has no model column), session_id (the read-side cost JOIN key), and a real durationMs — all per-turn carriers, NO module globals (T-05-11, Phase 3 D-09 concurrency rule).
- **Honest chips on real data:** auth/routine/error now produce backing rows, so `getAuditLogTypes()` returns them and the plan-03 UI enables those chips automatically. Types still genuinely absent stay disabled + footnoted (never fabricated).
- **End-to-end model capture proven:** `gate.test.ts` now wires the audit callback to the real `insertAuditLog`, fires a permission decision in a GateContext carrying a sentinel model, and reads the row back via `getAuditLogFiltered` — asserting `model` is non-null and equals the sentinel. This closes the `GateContext.model -> recordDecision -> audit() -> insertAuditLog -> audit_log -> /api/audit` chain against a real row, not a synthetic fixture.

## Task Commits

1. **Task 1 (RED): failing emission seams** - `7d1e7d2` (test)
2. **Task 1 (GREEN): emit auth/routine/error + turn-boundary capture** - `9f67ecf` (feat)

_TDD note: this plan authored NEW emission tests (auth/routine/error seams + the e2e model-capture row) not present in Wave 0, so it follows a real RED (`test`) -> GREEN (`feat`) pair. No REFACTOR commit was needed._

## Files Created/Modified

- `src/oauth-health.ts` - `checkOAuthHealth` exported + `OAuthHealthDeps` (readEnv/readCredentials/credentialsFileExists/alertThresholdMs, defaults read the real file/env); `emitAuthEvent(level)` helper emits one auth event per determination through `audit()`; `AlertLevel` type extracted.
- `src/routine-runner.ts` - `startedAt` stamp at `runRoutineOnce` entry; one `audit({action:'routine'})` after `deriveOutcome`, before the persist/notify block; imports `audit` from security.
- `src/message-core.ts` - `turnStartMs` stamped at the turn entry; `model`/`sessionId`/`_startMs` threaded into the attended GateContext; `audit({action:'error'})` in the catch (first-line + 500-cap, category reuse). `audit` was already imported.
- `src/oauth-health.test.ts` - NEW. The auth-emission seam: stubs `audit()` via `setAuditCallback`, drives each alert level via injected deps, asserts `{event:'oauth_check', level}` + blocked + no-secret detail.
- `src/routine-runner.test.ts` - new "emits a routine audit event" describe: shape (result/durationMs/blocked), failed=>blocked, no-raw-output.
- `src/message-core.test.ts` - new error-emission cases (classified category reuse + capped/stack-free unknown-error); ErrorRecovery full shape + `as unknown as` cast fix.
- `src/gate.test.ts` - new "model capture is persisted end-to-end" describe wiring the real `insertAuditLog` and reading back via `getAuditLogFiltered`.

## Decisions Made

- The auth event fires on every determination (decoupled from the anti-spam sender), so the audit log honestly records each health check; the operator alert still only fires on a level change.
- No auth event when there is neither a credentials file nor env auth — there is no determination to record (Open Q3); the UI banner states coverage honestly rather than inventing a row.
- Error detail is first-line-only then 500-capped — a stricter scrub than the research's plain `slice(0,500)`, keeping stack frames out even on short multi-line errors.
- checkOAuthHealth was made injectable specifically to upgrade the auth row from manual-only to a real automated seam (the plan explicitly preferred this).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed ErrorRecovery shape + AuditEntry cast in the new message-core test**
- **Found during:** Task 1 GREEN (tsc step)
- **Issue:** The new error-emission test constructed an `AgentError` with a partial `ErrorRecovery` (missing `shouldNewChat`/`shouldSwitchModel`/`retryAfterMs`) and cast `AuditEntry as Record<string, unknown>` directly — both fail strict `tsc`.
- **Fix:** Supplied the full ErrorRecovery shape and used `as unknown as Record<string, unknown>`.
- **Files modified:** src/message-core.test.ts
- **Verification:** `tsc --noEmit` clean (exit 0).
- **Committed in:** 9f67ecf

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking type error in this plan's own new test). No scope creep; no source behavior changed by the fix.

## Issues Encountered

- Full suite: **1 failure**, pre-existing and out of scope — `src/chat-task-tracker.test.ts > maybeStartChatTask > returns null when the classifier fails` (classifier-mock/timing; no audit reference). Already logged in `.planning/phases/05-audit-log/deferred-items.md` and verified pre-existing by plans 02 and 03. My changes touch no file it references.
- The previously-logged SPA-shell auth-gate and schedule-cli failures did NOT recur in this run (dashboard.contract.test.ts passed all 110; agent.test.ts passed all 8). No new regressions vs prior waves.

## Known Stubs

None introduced by this plan. The honest "not captured" rendering for genuinely-absent fields (e.g. auth durationMs, point-in-time) is the intended honest-coverage behavior per 05-UI-SPEC, not a stub — it is backed by real NULLs and stated by the coverage banner.

## Awaiting Human Verification (Task 2 — checkpoint:human-verify, blocking)

Task 2 is the end-of-phase operator sign-off over the LIVE Audit surface. It is NOT auto-approvable. The manual-only items (from 05-VALIDATION.md + the plan's Task 2 checklist):

1. **Dense look vs Activity:** the relocated Audit surface (Settings > Security, also `/audit` deep-link) is dense + monospace and visually unlike the Activity card feed; not in the daily sidebar.
2. **"Not captured" rendering:** expanding a pre-migration row shows the literal "not captured" in faint text for uncaptured fields, never a blank cell.
3. **Honest chips:** only event types with real data are active; absent spec types are disabled + footnoted "not yet captured". After triggering a routine/permission/error, the corresponding chips light up.
4. **Stated retention:** the header shows "Retaining 90 days" (the configured value, not a hardcoded literal) [AUD-02].
5. **Full-set export:** with a filter applied, Export log -> CSV and -> JSON each download a file whose row count matches the FULL filtered set (not just the loaded page); CSV columns stay aligned with commas/quotes/newlines in detail and no cell executes as a formula [AUD-02].
6. **Append-only:** no delete/edit/clear affordance anywhere on the surface.

**Precondition for the operator:** run `npm run migrate` on the MAIN checkout BEFORE restarting the live service (v1.2.4 must apply or checkPendingMigrations crash-loops — STATE.md deploy rule). The worktree does not touch the live store.

**Resume signal:** Type "approved" or describe the issues found. The phase is NOT marked complete until sign-off; the orchestrator finalizes after approval.

## Threat Flags

None - no new security surface beyond the plan's threat_model. Error detail is first-line + 500-capped with no stack frames (T-05-10); routine/auth detail carry no raw output/token (Pattern D); turn context travels per-turn via GateContext with no module globals (T-05-11); all emissions are INSERT via the single audit() path, zero UPDATE/DELETE on audit_log (T-05-13); zero packages installed (T-05-SC).

## Self-Check: PASSED

- FOUND: src/oauth-health.test.ts (new auth-emission seam)
- FOUND: src/oauth-health.ts, src/routine-runner.ts, src/message-core.ts (emissions)
- FOUND: .planning/phases/05-audit-log/05-04-SUMMARY.md
- FOUND commit: 7d1e7d2 (test - RED emission seams)
- FOUND commit: 9f67ecf (feat - GREEN emissions + turn-boundary capture)
- VERIFIED: 4 emission test files GREEN (57 tests); full suite 872 passed, 1 pre-existing out-of-scope failure (chat-task-tracker classifier-mock, logged in deferred-items.md)
- VERIFIED: tsc --noEmit clean (exit 0); no new module global for turn context

---
*Phase: 05-audit-log*
*Completed (Task 1): 2026-06-25 — Task 2 human-verify awaiting operator sign-off*
