---
phase: 05-audit-log
plan: 03
subsystem: audit-read-export-ui
tags: [audit, csv, export, rfc-4180, formula-injection, preact, settings, security, cost-join]

# Dependency graph
requires:
  - phase: 05-02
    provides: "getAuditLogFiltered (single filtered reader, enriched rows, honest NULLs), insertAuditLog options-object writer, getAuditRetentionDays, AuditLogEntry with index signature"
  - phase: 05-01
    provides: "Wave 0 RED contracts for /api/audit cost JOIN, /api/audit/export full-set, toCsv RFC-4180+injection, toJsonEnvelope"
provides:
  - "GET /api/audit enriched: read-side cost via correlated subquery on session_id (Pitfall 4 honored), server-side search/type/date filters via ? placeholders, retention_days + types in the envelope"
  - "GET /api/audit/export: complete filtered set (never page-capped, Pitfall 6) as CSV or JSON with Content-Disposition attachment; invalid format falls back to csv; token-gated under /api/"
  - "toCsv (RFC-4180 quoting + formula-injection neutralization) and toJsonEnvelope serializers exported from src/dashboard.ts"
  - "getAuditLogTypes() — distinct event_type list driving honest UI chips"
  - "Dense, monospace, expand-for-detail Audit surface relocated under Settings > Security (D-13), honest 'not captured', retention banner, accent-reserved Export control"
affects: [05-04 widen-event-types, audit, dashboard, settings-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-side cost resolution via a correlated subquery (NOT a JOIN) to avoid fan-out across N audit rows sharing one session_id (Pitfall 4)"
    - "Parameterized audit filter builder shared by read + export so export scope === on-screen filters; all values bind via ? placeholders (ASVS V5)"
    - "Hand-rolled RFC-4180 CSV serializer with formula-injection neutralization (no CSV library installed)"
    - "Complete-set HTTP file download via new Response + Content-Disposition (mirrors project file-download precedent); token-in-URL GET for the browser download"
    - "Honest UI: type chips enabled only for types with backing data; literal 'not captured' token for every null detail field"
    - "Route demotion: remove from ROUTES (sidebar/palette source) but keep the App.tsx <Route> for deep-linking; host under Settings > Security"

key-files:
  created: []
  modified:
    - src/db.ts
    - src/dashboard.ts
    - web/src/pages/Audit.tsx
    - web/src/pages/Settings.tsx
    - web/src/lib/routes.ts

key-decisions:
  - "Cost resolved read-side as a correlated subquery COALESCE(SUM(t.cost_usd),0) WHERE t.session_id = a.session_id — a JOIN would fan out and lose/multiply the per-turn cost; the subquery returns the single turn cost to each of N same-session rows (Pitfall 4)"
  - "Retention window + available event types ride in the /api/audit response envelope (no second /api/audit/meta call) — the UI needs both on first paint for the banner and the honest chips"
  - "/audit removed from ROUTES (Sidebar's only consumer) rather than flag-hidden; App.tsx route kept verbatim so deep-links + command palette still resolve; Settings > Security links to it"
  - "Export uses window.location.href = tokenizedSseUrl(path): token-in-URL is the only way a browser file download GET can carry the dashboard token (T-05-08 accepted; Referrer-Policy no-referrer already set)"
  - "toCsv column order = union of keys in first-seen order so a sparse row still lands values under the right header; csvField neutralizes leading = + - @ THEN RFC-4180-quotes"

patterns-established:
  - "Correlated-subquery cost resolution to prevent JOIN fan-out on append-only logs"
  - "Shared parameterized filter parser feeding both a paged read and an uncapped export"
  - "RFC-4180 + formula-injection-safe CSV serializer pattern (reusable for any future export)"

requirements-completed: [AUD-01, AUD-02]

# Metrics
duration: ~14min
completed: 2026-06-25
---

# Phase 5 Plan 03: Audit Log Slice B (read + export + UI) Summary

**Built the enriched filtered read (read-side cost via correlated subquery, honest NULLs, ? placeholders), the complete-filtered-set CSV/JSON export endpoint with an RFC-4180 + formula-injection-safe serializer, and reworked the Audit surface into a dense monospace expand-for-detail table relocated under Settings > Security — turning all 4 plan-03 Wave 0 RED contracts GREEN with the web build clean.**

## Performance

- **Duration:** ~14 min
- **Completed:** 2026-06-25
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- `getAuditLogFiltered` now attaches cost READ-SIDE via a correlated subquery on `session_id` (`COALESCE(SUM(t.cost_usd),0)`), so 3 audit rows sharing one turn each return that turn's cost — not 0 (fan-out lost it) and not 3x (fan-out summed it). This is a subquery, deliberately NOT a JOIN, exactly because a JOIN fans out (Pitfall 4). Append-only row never mutated (D-11).
- `GET /api/audit` is enriched: it parses `search`/`type`/`from`/`to` (dates accept epoch seconds or ISO/date strings, clamped to integers, malformed ones silently dropped — never poison the query), binds everything via `?` placeholders, and returns `{ entries, total, retention_days, types }` so the UI renders the retention banner and honest chips without a second call.
- `GET /api/audit/export` streams the COMPLETE filtered set (calls the reader with NO limit/offset — Pitfall 6), CSV or JSON, `Content-Disposition: attachment; filename="audit-<ts>.<ext>"`, invalid `format` falls back to csv, mounted under `/api/` so it inherits the token gate (GET is mutations-exempt). No `[SEND_FILE]` marker — this is an HTTP download.
- `toCsv` is RFC-4180 compliant (quotes `, " \r \n`, doubles embedded `"`) and neutralizes formula injection (prefixes a cell whose first non-space char is `= + - @` with `'`); `toJsonEnvelope` returns `{ exported_at, count, rows }`. Both exported from `src/dashboard.ts` and unit-covered.
- Audit surface reworked into the dense technical contract (05-UI-SPEC): absolute monospace to-the-second timestamps (no `formatRelativeTime`), actor colour dot (`teammateColor`), monospace type chip, outcome icon (ShieldCheck/Clock/ShieldAlert), single-open expand-for-detail key/value grid where EVERY uncaptured field renders the literal `not captured` in faint text. Honest type chips: active only for types with backing data; spec types with no data shown disabled + a "Not yet captured" coverage banner. Retention line reads the configured day count. Export log button is the ONLY accent fill, opening a CSV/JSON popover that triggers the full-filtered-set download.
- D-13 relocation: `/audit` removed from `ROUTES` (the sidebar's only consumer) so it leaves the daily nav; the `<Route path="/audit">` in App.tsx is kept verbatim for deep-linking + command palette; a new `Settings > Security` section links to it.

## Task Commits

1. **Task 1: Enriched filtered read + complete-set export endpoint + CSV serializer** - `b7976c3` (feat)
2. **Task 2: Dense Audit surface rework + relocation under Settings > Security** - `09bc3e5` (feat)

_TDD note: Wave 0 (05-01) authored the failing tests; this plan implemented to GREEN, so Task 1 is a single feat() commit. Task 2 is UI under a build-only automated gate (no unit contract), also a single feat()._

## Files Created/Modified

- `src/db.ts` - `getAuditLogFiltered` gains the read-side cost correlated subquery (aliased table `a`, ordered by `a.created_at`); new `getAuditLogTypes()` (distinct non-null event_type).
- `src/dashboard.ts` - new exported `toCsv` / `toJsonEnvelope` (+ private `csvField` / `neutralizeFormula`); `/api/audit` enriched with a shared `parseAuditFilters` (`?`-bound), cost, retention_days, types; new `/api/audit/export` route (full set, csv|json, attachment); imports updated (dropped unused `getAuditLog`, added `getAuditLogFiltered`/`getAuditLogTypes`/`getAuditRetentionDays`/`AuditLogEntry`).
- `web/src/pages/Audit.tsx` - full rework: enriched `AuditEntry` interface, `absoluteTime` monospace timestamps, outcome resolver, debounced search + date range, honest type chips + coverage banner, retention line, accent Export popover with token-in-URL full-set download, single-open `DetailGrid` with literal `not captured`.
- `web/src/pages/Settings.tsx` - new `SecuritySection` (links to `/audit` via `useLocation` navigate) inserted after Permissions; `ScrollText` icon + `useLocation` imports.
- `web/src/lib/routes.ts` - `/audit` entry removed from ROUTES (replaced with an explanatory comment); unused `ShieldCheck` import dropped.

## Decisions Made

- Correlated subquery (not a JOIN) for cost to prevent fan-out across same-session audit rows (Pitfall 4).
- retention_days + types delivered in the /api/audit envelope (no separate /api/audit/meta) so the UI paints the banner and honest chips in one round-trip.
- /audit demoted by removing it from ROUTES (Sidebar's only ROUTES consumer) while keeping the App.tsx route for deep-linking — the cleanest demotion with no router breakage.
- Export download uses token-in-URL GET (the only mechanism a browser file download can authenticate with); T-05-08 already accepted in the threat model (Referrer-Policy: no-referrer set).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed the now-unused `getAuditLog` import from dashboard.ts**
- **Found during:** Task 1
- **Issue:** `/api/audit` was switched from `getAuditLog` to `getAuditLogFiltered`; the old import became unused, which fails the strict `tsc` step of the build (noUnusedLocals).
- **Fix:** Dropped `getAuditLog` from the db.js import list.
- **Files modified:** src/dashboard.ts
- **Committed in:** b7976c3

**2. [Rule 3 - Blocking] Removed the now-unused `ShieldCheck` import from routes.ts**
- **Found during:** Task 2
- **Issue:** Removing the `/audit` ROUTES entry orphaned its `ShieldCheck` icon import; `tsc` would fail on the unused import.
- **Fix:** Dropped `ShieldCheck` from the lucide-preact import in routes.ts.
- **Files modified:** web/src/lib/routes.ts
- **Committed in:** 09bc3e5

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking unused-import build breaks caused directly by this plan's own changes). No scope creep.

## Issues Encountered

- The full `src/dashboard.contract.test.ts` run shows 2 failures (`auth gate > serves SPA shell at /` and `/warroom` without a token). These are PRE-EXISTING and unrelated to audit — verified failing on clean HEAD by plan 02 and already logged in `deferred-items.md`. They reference `/` and `/warroom`, never `/audit`. Out of scope per the scope boundary.
- `src/schedule-cli.test.ts` (3) and `src/chat-task-tracker.test.ts` (1) remain environment/unrelated failures already logged in deferred-items.md (no `dist/` build in the worktree; classifier-mock timing). Not touched.
- Audit-adjacent previously-GREEN suites re-verified clean post-build: `src/db.test.ts` (72), `src/migrations.test.ts` (23), `src/gate.test.ts` all pass.

## User Setup Required

None - no external service configuration. No packages installed (T-05-SC: zero installs this phase).

## Next Phase Readiness

- Plan 04 can widen event-type EMISSIONS (auth/routine/error) and the honest chips + coverage banner will light up automatically as `getAuditLogTypes()` starts returning those types — the UI is already wired to enable a chip the moment a type has backing data.
- The end-of-phase human-verify checkpoint (owned by plan 04 Task 2) covers the live-surface checks: dense/mono look, "not captured" rendering, honest chip enablement, retention banner, and the export download. This plan intentionally stayed autonomous behind a build-only automated gate.

## Threat Flags

None - no new security surface beyond the plan's threat_model. All filters bind via `?` placeholders (T-05-05); toCsv neutralizes formula injection + RFC-4180 quotes (T-05-06); export is under `/api/` token gate (T-05-07); read/export are SELECT-only, zero UPDATE/DELETE on audit_log (T-05-09); token-in-URL accepted with no-referrer (T-05-08).

## Self-Check: PASSED

- FOUND: .planning/phases/05-audit-log/05-03-SUMMARY.md
- FOUND commit: b7976c3 (Task 1)
- FOUND commit: 09bc3e5 (Task 2)
- VERIFIED: 4 plan-03 Wave 0 RED contracts GREEN (audit cost JOIN, export full-set csv+json, invalid-format fallback, toCsv/toJsonEnvelope)
- VERIFIED: cd web && npm run build (vite + tsc) succeeds

---
*Phase: 05-audit-log*
*Completed: 2026-06-25*
