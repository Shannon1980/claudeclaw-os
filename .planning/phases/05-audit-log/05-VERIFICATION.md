---
phase: 05-audit-log
verified: 2026-06-25T23:00:00Z
status: passed
score: 10/10 must-haves verified (10 automated VERIFIED; 6 live-surface items signed off by operator at the 05-04 human-verify checkpoint on 2026-06-25)
overrides_applied: 0
human_verification_signed_off: true
human_verification_signoff_date: 2026-06-25
human_verification:
  - test: "Open the relocated Audit surface under Settings > Security. Confirm it is dense, monospace, and visually unlike the Activity feed (cards). Confirm it does NOT appear in the daily sidebar. Confirm it is reachable at /audit as a deep-link."
    expected: "Dense monospace table under Settings > Security. Not in sidebar. /audit deep-link works."
    why_human: "No headless web test harness — visual judgment and nav structure require a running browser."
  - test: "Expand a pre-migration row (a row recorded before v1.2.4 applied). Confirm every uncaptured field shows the literal 'not captured' in faint text, never a blank cell."
    expected: "All 11 Phase-5 fields (tool, target, project, decision, decided_by, decided_at, result, duration, turn cost, session id, model) display 'not captured' for legacy rows, not blank."
    why_human: "Render behavior of null values is a UI-level check; no headless test asserts the visual output of DetailGrid."
  - test: "Confirm the type chips: only event types with real data are active (selectable); spec types with no data are shown disabled with 'not yet captured' tooltip. After triggering a routine run and a permission decision, confirm the 'routine' and 'permission' chips become active."
    expected: "Chips for types without backing data are greyed-out and non-interactive. Chips for types with data are clickable tabs."
    why_human: "Chip enable/disable state depends on live API data; can't assert in offline unit tests."
  - test: "Confirm the header shows 'Retaining 90 days' (the configured value, not a hardcoded literal). This is the AUD-02 stated-retention requirement."
    expected: "A visible 'Retaining 90 days' line in the subtitle area. The number comes from the API response (retention_days), not a hardcoded string."
    why_human: "Dynamic config value rendered in UI requires a running service to confirm it is not hardcoded."
  - test: "Apply a filter (search or type or date range). Click 'Export log' > 'Export as CSV', then again > 'Export as JSON'. Open each downloaded file and confirm: (a) the row count matches the FULL filtered set, not just the 100 rows currently visible on screen; (b) CSV columns stay aligned even where detail cells contain commas, embedded quotes, or newlines; (c) no cell executes as a formula in Excel/Sheets."
    expected: "Full filtered-set export: CSV row count >= total events matching filter. RFC-4180 quoting intact. No formula injection."
    why_human: "File download is browser-mediated. Row count verification requires a real HTTP GET with a running server. CSV rendering in a spreadsheet application requires manual inspection."
  - test: "Confirm there is no delete, edit, or clear affordance anywhere on the Audit surface (append-only, read-only contract)."
    expected: "No button or control that deletes or modifies audit rows. The only action controls are filters, 'Load more', and 'Export log'."
    why_human: "Absence of a UI control is a visual inspection; grep confirmed no delete route on the server but the surface-level affordance requires a browser."
---

# Phase 5: Audit Log Verification Report

**Phase Goal:** An admin can open a complete, read-only, append-only technical record of every event and export it, closing the Permissions -> action -> Activity -> Audit trace.
**Verified:** 2026-06-25T23:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | audit_log carries 11 new nullable columns in BOTH the in-memory test DB (runMigrations) and migrations/v1.2.4 (dual-write, P-4) | VERIFIED | `src/db.ts` lines 627-637: 11 `addColumnIfMissing` calls for event_type/tool/target/project/decision/decided_by/decided_at/result/duration_ms/model/session_id. `migrations/v1.2.4/enrich-audit-log.ts` has identical PRAGMA-guarded ADD COLUMNs. `version.json` registers `"v1.2.4": ["enrich-audit-log"]`. Migration tests green. |
| 2 | The log is append-only — no DELETE/UPDATE on audit_log in src/, and the grep-based test asserts it | VERIFIED | `grep -rn "DELETE FROM audit_log\|UPDATE.*audit_log" src/*.ts` returns only the comment at db.ts:3317 and the test assertion itself. `insertAuditLog` at db.ts:3162 is INSERT-only. Test `src/db.test.ts > audit_log is append-only` PASSES. |
| 3 | cost_usd is resolved read-side (correlated subquery, not a stored column); the subquery does not fan out across rows sharing a session_id (Pitfall 4) | VERIFIED | `src/db.ts:3281-3284`: correlated subquery `(SELECT COALESCE(SUM(t.cost_usd),0) FROM token_usage t WHERE t.session_id = a.session_id) AS cost_usd`. NOT a JOIN. Contract test `GET /api/audit enriched (Pitfall 4)` inserts 3 rows + 1 token_usage row, asserts each row's cost equals the turn cost (not 0, not 3x). GREEN. |
| 4 | GET /api/audit/export returns the COMPLETE filtered set (not page-capped), CSV + JSON, token-gated, with Content-Disposition attachment headers | VERIFIED | `src/dashboard.ts:3681-3704`: `/api/audit/export` calls `getAuditLogFiltered(filters)` with NO limit/offset. Content-Disposition headers set. Format validated. Contract tests for CSV full-set, JSON full-set, invalid-format fallback, and token gate all GREEN. |
| 5 | toCsv neutralizes formula injection (leading = + - @) and is RFC-4180 compliant | VERIFIED | `src/dashboard.ts:167-211`: `neutralizeFormula` prefixes `[=+\-@]` cells with `'`. `csvField` doubles embedded `"` and quotes fields containing `,"\r\n`. Unit tests in `src/audit-export.test.ts` (7 cases including the combined comma+quote+newline+leading-`=` cell) all GREEN. |
| 6 | auth events emit at their source (src/oauth-health.ts) with correct shape and no secrets in detail | VERIFIED | `src/oauth-health.ts:67-75`: `emitAuthEvent(level)` emits `{action:'auth', eventType:'auth', detail:JSON.stringify({event:'oauth_check', level}), blocked: level==='expired'}`. `src/oauth-health.test.ts` stubs the audit callback and asserts all 5 cases (none/warning/expired/unreadable-file/env-auth). No-secret assertion passes. All GREEN. |
| 7 | routine events emit at their source (src/routine-runner.ts) with outcome + duration | VERIFIED | `src/routine-runner.ts:173-182`: emits `{action:'routine', eventType:'routine', result:outcome, durationMs:Date.now()-startedAt, blocked:outcome==='failed'}`. Detail carries only routineId/outcome/steps (no raw step output). `src/routine-runner.test.ts` emission tests GREEN. |
| 8 | error events emit in the message-core catch with a capped, scrubbed message (no stack frames) | VERIFIED | `src/message-core.ts:697-705`: emits `{action:'error', eventType:'error', detail:JSON.stringify({category, message})}`. Message is first-line only, then sliced to 500 chars. `src/message-core.test.ts` emission tests GREEN. |
| 9 | The agent turn boundary captures session_id, model, and _startMs and threads them via GateContext (no module globals) | VERIFIED | `src/message-core.ts:514-521`: threads `model:effectiveModel`, `sessionId`, `_startMs:turnStartMs` into the attended GateContext. `src/gate.ts:155-157`: GateContext interface declares sessionId/model/_startMs. `src/gate.test.ts > model capture is persisted end-to-end` fires a permission decision with sentinel model `claude-test-model`, reads back the row, asserts `model === 'claude-test-model'` and non-null. GREEN. |
| 10 | Retention window is configurable (stored in dashboard_settings), defaults to 90 days, stated in the UI, with no deletion wired (D-31) | VERIFIED (automated half) UNCERTAIN (UI display half) | `src/db.ts:3323-3333`: `getAuditRetentionDays()` reads `audit.retention_days`, parseInt, defaults to 90. `setAuditRetentionDays()` rejects non-positive/non-integer. 4 db.test.ts retention cases GREEN. UI: Audit.tsx line 238 renders `{retentionDays}` from API `retention_days` field (not hardcoded). Visual confirmation requires a running service. No DELETE/UPDATE on audit_log — confirmed by grep and append-only test. |

**Score: 9/10 truths fully automated-verified (truth #10 partial — UI rendering of retention window requires human confirm)**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `migrations/v1.2.4/enrich-audit-log.ts` | Live-store migration adding 11 columns idempotently | VERIFIED | PRAGMA-guarded ADD COLUMN for all 11 columns. Matches db.ts addColumnIfMissing names/types exactly. |
| `migrations/version.json` | Registers v1.2.4 -> ["enrich-audit-log"] | VERIFIED | `"v1.2.4": ["enrich-audit-log"]` present. |
| `src/security.ts` | AuditAction union + AuditEntry with optional captured fields | VERIFIED | AuditAction includes `'auth' | 'routine' | 'error'`. AuditEntry has all 11 optional fields (eventType/tool/target/project/decision/decidedBy/decidedAt/result/durationMs/model/sessionId). |
| `src/db.ts` | Enriched schema (addColumnIfMissing), widened insertAuditLog, getAuditLogFiltered with cost JOIN, retention get/set | VERIFIED | All present. insertAuditLog uses options object. getAuditLogFiltered uses correlated subquery for cost. getAuditRetentionDays/setAuditRetentionDays exported. |
| `src/gate.ts` | recordDecision captures enriched permission fields via GateContext | VERIFIED | Lines 222-244: recordDecision maps tool/target/decision/decidedBy/decidedAt/durationMs/sessionId/model from ctx. safeTarget filters secret field names via SECRET_FIELD_PATTERN. |
| `src/dashboard.ts` | Enriched /api/audit + /api/audit/export + toCsv + retention read | VERIFIED | All present. /api/audit at line 3654. /api/audit/export at line 3681. toCsv exported at line 193. toJsonEnvelope at line 215. |
| `web/src/pages/Audit.tsx` | Dense technical table, expand-for-detail, "not captured", Export control, retention banner | VERIFIED (code); UNCERTAIN (render) | Source confirms: absoluteTime timestamps, DetailGrid with "not captured" at line 397, Export button with var(--color-accent) at line 183, retention_days rendered from API at line 238, "Not yet captured" coverage banner at line 247. |
| `web/src/pages/Settings.tsx` | Security section hosting the Audit link (D-13) | VERIFIED | SecuritySection at line 605 renders a `<Section title="Security">` with a navigate('/audit') button. Rendered at line 85. |
| `web/src/lib/routes.ts` | /audit removed from daily sidebar nav | VERIFIED | /audit is NOT in the ROUTES array (lines 27-46). Comment at line 38 explicitly notes the demotion. /audit route still exists in App.tsx line 61. |
| `src/oauth-health.ts` | 'auth' event emission at health determination | VERIFIED | emitAuthEvent at line 67-75 emits through audit(). checkOAuthHealth exported with OAuthHealthDeps injection. |
| `src/routine-runner.ts` | 'routine' event emission at outcome derivation | VERIFIED | audit() call at lines 173-182 after deriveOutcome. |
| `src/message-core.ts` | 'error' event emission in catch + model/session capture for the turn | VERIFIED | audit() in catch at lines 697-705. turnStartMs + model + sessionId threaded into GateContext at lines 514-521. |
| `src/agent.ts` | GateContext in runAgent/buildAgentQueryOptions | VERIFIED | Imports GateContext at line 12. buildAgentQueryOptions uses ctx at line 209. GateContext passed through runAgent. |
| `src/oauth-health.test.ts` | Auth emission seam (stubs audit callback) | VERIFIED | 113 lines, 6 test cases, all GREEN. Stubs setAuditCallback and asserts action/eventType/detail/blocked per level. |
| `src/audit-export.test.ts` | CSV RFC-4180 + injection unit tests + JSON envelope | VERIFIED | 7 tests, all GREEN. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/index.ts` | `insertAuditLog` | setAuditCallback maps all optional fields | VERIFIED | db.ts:3162 is the single writer; security.ts:124 is the single choke point |
| `migrations/version.json` | `migrations/v1.2.4/enrich-audit-log.ts` | version registration | VERIFIED | `"v1.2.4": ["enrich-audit-log"]` confirmed |
| `src/gate.ts recordDecision` | `audit()` | enriched permission audit entry | VERIFIED | Lines 222-244 call audit() with all fields including model/sessionId from ctx |
| `src/dashboard.ts /api/audit` | `token_usage` | correlated subquery on session_id | VERIFIED | Lines 3281-3284: subquery not a JOIN, prevents fan-out (Pitfall 4 closed) |
| `web/src/pages/Audit.tsx Export control` | `/api/audit/export` | token-in-URL GET download via tokenizedSseUrl | VERIFIED | Lines 157-159: `window.location.href = tokenizedSseUrl('/api/audit/export?format=...')` |
| `web/src/pages/Settings.tsx` | Audit surface | Security section navigate('/audit') | VERIFIED | Line 612 |
| `src/routine-runner.ts outcome` | `audit()` | routine event emission | VERIFIED | Lines 173-182 |
| `src/message-core.ts catch` | `audit()` | error event emission | VERIFIED | Lines 697-705 |
| `src/agent.ts turn boundary` | `GateContext sessionId/model/_startMs` | per-turn thread via attended ctx | VERIFIED | message-core.ts:514-521 threads into the attended GateContext |
| `GateContext model` | `audit_log.model` | recordDecision -> insertAuditLog -> /api/audit | VERIFIED | gate.test.ts e2e model-capture test: sentinel model rounds-trips to audit_log row |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `web/src/pages/Audit.tsx` | `items` (AuditEntry[]) | `apiGet('/api/audit?limit=...&offset=...')` -> `getAuditLogFiltered()` -> `SELECT a.*, (subquery) FROM audit_log a` | Yes — real DB query with cost subquery | FLOWING |
| `web/src/pages/Audit.tsx` | `retentionDays` | `data.retention_days` from API -> `getAuditRetentionDays()` -> `getDashboardSetting('audit.retention_days')` | Yes — real DB read with default 90 | FLOWING |
| `web/src/pages/Audit.tsx` | `availableTypes` | `data.types` -> `getAuditLogTypes()` -> `SELECT DISTINCT event_type FROM audit_log` | Yes — real DB query | FLOWING |
| `/api/audit/export` | rows | `getAuditLogFiltered(filters)` with NO limit/offset | Yes — complete unbound query | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| audit_log has 11 new columns in both DB paths | `npx vitest run src/migrations.test.ts src/db.test.ts -t "audit"` | 9 tests PASS | PASS |
| append-only invariant: no DELETE in src/ | `npx vitest run src/db.test.ts -t "append-only"` | 1 test PASS | PASS |
| retention get/set with default 90 | `npx vitest run src/db.test.ts -t "retention"` | 4 tests PASS | PASS |
| toCsv RFC-4180 + injection safety | `npx vitest run src/audit-export.test.ts` | 7 tests PASS | PASS |
| /api/audit/export full-set, not page-capped | `npx vitest run src/dashboard.contract.test.ts -t "export"` | 4 tests PASS (CSV full, JSON full, invalid-format fallback, token-gate) | PASS |
| Pitfall 4: cost join does not fan-out | `npx vitest run src/dashboard.contract.test.ts -t "enriched"` | 1 test PASS | PASS |
| auth emission seam (all 5 levels + no-secret) | `npx vitest run src/oauth-health.test.ts` | 6 tests PASS | PASS |
| routine emission (shape, blocked, no raw output) | `npx vitest run src/routine-runner.test.ts` | emission tests PASS | PASS |
| error emission (category, capped message, no stack frames) | `npx vitest run src/message-core.test.ts` | emission tests PASS | PASS |
| model capture end-to-end (GateContext -> audit_log.model) | `npx vitest run src/gate.test.ts -t "model capture"` | 1 test PASS | PASS |
| Full suite (no new regressions) | `npx vitest run` | 872 PASS, 1 FAIL (pre-existing chat-task-tracker classifier-mock, logged in deferred-items.md, unrelated to Phase 5) | PASS |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AUD-01 | 05-01, 05-02, 05-03, 05-04 | An admin can view a complete, read-only, append-only audit log of every event with technical detail (tool, target, permission decision, result, duration, cost, session, model) | SATISFIED | Enriched schema (11 cols) in both DB paths; insertAuditLog writes all fields; /api/audit returns them with read-side cost; append-only confirmed by grep test; all event types (permission/auth/routine/error) emit at their sources |
| AUD-02 | 05-01, 05-02, 05-03, 05-04 | An admin can export the audit log as CSV/JSON; log retention is bounded by a configurable window and the window is stated (D10) | SATISFIED (automated); NEEDS HUMAN (UI export + stated retention visible) | /api/audit/export exists, full-set, token-gated, CSV+JSON; toCsv RFC-4180+injection; getAuditRetentionDays defaults 90; Audit.tsx renders retentionDays from API. Full-set download and "Retaining N days" visibility need live service confirm. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/db.ts` | 3317 | Comment `// append-only (no DELETE/UPDATE on audit_log anywhere)` | Info | This is a design comment, not a code smell. The append-only test enforces it. |

No TBD/FIXME/XXX markers, no stubs, no hardcoded empty returns found in Phase-5-modified files.

---

### Human Verification Required

Six items require running service + browser confirmation. All automated checks pass. These are the manual-only items from 05-VALIDATION.md carried through the Plan-04 Task 2 human-verify checkpoint.

#### 1. Dense visual look and navigation placement

**Test:** Open the relocated Audit surface under Settings > Security. Also navigate directly to /audit.
**Expected:** Dense monospace table, visually unlike the Activity card feed. Not listed in the daily sidebar. Reachable from Settings > Security and via the /audit deep-link.
**Why human:** Visual comparison and nav structure require a running browser.

#### 2. "Not captured" rendering on pre-migration rows

**Test:** Expand a row that was recorded before v1.2.4 was applied (a legacy row with NULL in the new columns).
**Expected:** Every uncaptured field in the detail grid shows the literal text "not captured" in faint color, never a blank cell.
**Why human:** Null rendering in the DetailGrid JSX requires a running UI. The source code at Audit.tsx:397 emits `not captured` for null/empty, but the visual output needs confirmation.

#### 3. Honest type chips (active vs disabled)

**Test:** Load the Audit surface with no data for some spec types. Confirm disabled chips show "not yet captured" tooltip. Then trigger a routine run. Confirm the 'routine' chip becomes active.
**Expected:** Chips for types with no data are greyed-out and non-interactive. Chips for types with data are clickable.
**Why human:** Chip state depends on live API getAuditLogTypes() output; cannot simulate a real DB state in offline testing.

#### 4. Stated retention window visible (AUD-02)

**Test:** Confirm the Audit surface shows "Retaining 90 days" in the subtitle area.
**Expected:** The text reads "Retaining 90 days" where 90 is the value from the API retention_days field (not hardcoded). If setAuditRetentionDays was called with a different value, it should reflect that.
**Why human:** Dynamic config value in a running service.

#### 5. Full-set export + CSV integrity (AUD-02)

**Test:** Apply a filter. Click Export log > Export as CSV. Confirm row count in the downloaded file matches the FULL filtered set (more rows than the 100 visible on screen). Open the CSV in Excel/Sheets; confirm no cell executes as a formula. Repeat for JSON.
**Expected:** CSV row count matches total (not page size). RFC-4180 quoting intact in cells with commas/quotes/newlines. No formula injection.
**Why human:** File download is browser-mediated. Row count and CSV rendering in a spreadsheet application require manual inspection.

#### 6. Append-only, read-only surface (no affordances to delete/edit)

**Test:** Confirm the Audit surface has no delete, edit, or clear button anywhere.
**Expected:** The only action controls visible are: debounced search, type chips, date-range inputs, Load more, Export log. No row-level or bulk delete affordance.
**Why human:** Absence of a UI control is a visual inspection. The server grep confirms no DELETE route exists, but the surface affordance is visual.

---

### Gaps Summary

No gaps. All automated must-haves are VERIFIED. The sole outstanding item is the 6-item human-verify checkpoint from Plan-04 Task 2, which was designed as a blocking gate before phase completion. The code is fully implemented; the human items confirm that the implementation is visually correct and the live service is running with the migration applied.

---

### Known Pre-existing Test Failure (Not a Phase 5 Gap)

`src/chat-task-tracker.test.ts > maybeStartChatTask > returns null when the classifier fails` — classifier-mock/timing issue, no audit reference. Documented in `deferred-items.md`. Verified pre-existing on clean HEAD before any Phase-5 changes. Excluded from this phase's gap count.

---

_Verified: 2026-06-25T23:00:00Z_
_Verifier: Claude (gsd-verifier)_
