---
phase: 06-memory-surface
plan: 03
subsystem: ui
tags: [react, hono, memory, provenance, operator-surface, tombstone, dashboard]

# Dependency graph
requires:
  - phase: 06-memory-surface (06-02)
    provides: getMemoriesForOperatorSurface, addOperatorFact, deleteMemory, writeTombstoneForMemory, deriveProvenance, category/confirmed columns
  - phase: 04-activity-feed
    provides: Activity.tsx page pattern (PageHeader, PageState, Pill, grouped useMemo, ConfirmModal, apiGet/apiPost, pushToast)
provides:
  - "Net-new /api/memory* routes: GET (grouped + provenance), POST (Add fact), PATCH (edit), DELETE (tombstone-first), POST :id/confirm"
  - "Operator-facing /memory page: facts grouped by category with provenance pill as hero, Add/Edit/Delete/Confirm in place, on-this-machine assurance"
  - "Developer Memories view demoted off daily nav (D-02) but still reachable; /memory no longer redirects to /memories"
affects: [06-04, memory, trust-surface, operator-product]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Operator surface modeled on Activity.tsx: grouped useMemo + provenance Pill hero + ConfirmModal destructive + verbatim server-error toasts"
    - "Mutation routes inherit app middleware (token gate :432, kill switch :449, CSRF :495) — no bespoke per-route auth"
    - "DELETE writes tombstone before deleting the row (Pitfall 6 fail-safe ordering)"
    - "All SQL delegated to db.ts functions — zero raw SQL in route handlers"

key-files:
  created:
    - web/src/pages/Memory.tsx
  modified:
    - src/dashboard.ts
    - web/src/App.tsx
    - web/src/lib/routes.ts
    - web/src/lib/vocabulary.ts

key-decisions:
  - "Contract test for the four routes was authored Wave 0 (plan 06-01); the 06-03 Task 1 commit is the GREEN implementation against those pre-existing assertions, so there is no separate RED commit in this plan."
  - "D-05 honest coverage: the email provenance pill renders only when an email-sourced row exists."
  - "D-07: a category section renders only when it has >=1 row; empty categories are hidden."
  - "D-02: /memories developer view removed from the visible intelligence nav but its <Route> stays in App.tsx for deep-link / command-palette access; App.tsx:69 /memory->/memories redirect removed."

patterns-established:
  - "Operator trust surface: provenance is the hero pill per row; actions that cannot act are ABSENT, never disabled."
  - "Tombstone-first delete with success toast 'Deleted. It will not come back.' backing the no-resurrection guarantee."

requirements-completed: [MEM-01, MEM-02]

# Metrics
duration: ~20min
completed: 2026-06-26
---

# Phase 6 Plan 3: Operator Memory Surface Summary

**Net-new /api/memory* routes plus a /memory operator page ("What I know about you") that shows facts grouped by category with provenance as the hero pill and Add/Edit/Delete/Confirm in place — the trust surface the phase exists for. Operator-approved live.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-06-26
- **Tasks:** 3 (2 autonomous + 1 human-verify checkpoint, approved)
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- Four net-new mutation/read routes under `/api/memory` in dashboard.ts: GET (provenance-tagged grouped rows, D-05 email omission), POST (Add fact -> confirmed/you-told-me), PATCH (edit with id + category enum validation), DELETE (tombstone-first then delete, Pitfall 6), POST `:id/confirm` (status-guarded on `.changes`). All inherit the app token gate + kill switch + CSRF — no bespoke auth.
- New `web/src/pages/Memory.tsx` (487 lines) modeled on Activity.tsx: grouped-by-category facts, provenance Pill hero (You told me -> accent; Learned from your work / Learned from email -> neutral, email only when present), "Needs review" amber marker + Confirm action on unconfirmed rows (D-04), Add/Edit modals, tombstone-backed Delete ConfirmModal, on-this-machine assurance line, PageState for loading/error/empty.
- Nav wiring: `/memory` added to the intelligence section; developer `/memories` view demoted off the daily nav (D-02) but kept reachable via direct URL / command palette; App.tsx `/memory -> /memories` redirect removed.
- Operator manually walked the 7 verification steps on the live surface and approved.

## Task Commits

1. **Task 1: Net-new /api/memory* mutation + grouped-read routes** - `145d1f9` (feat) — GREEN against the Wave 0 (06-01) contract test
2. **Task 2: Operator Memory page + nav wiring + Labs demotion** - `1fc4f03` (feat)
   - **Out-of-scope log:** `27648e3` (chore) — recorded pre-existing `web` tsc errors in unrelated files
3. **Task 3: Human-verify the live Memory surface** - checkpoint, operator typed "approved" (no code)

**Plan metadata:** see final docs commit below.

## Files Created/Modified
- `web/src/pages/Memory.tsx` - Operator Memory surface: grouped facts, provenance pills, Add/Edit/Delete/Confirm, assurance line, PageState
- `src/dashboard.ts` - GET + POST + PATCH + DELETE + confirm `/api/memory*` routes delegating to db.ts
- `web/src/App.tsx` - `<Route path="/memory">` added; `/memory -> /memories` redirect removed; `/memories` Route retained for reachability
- `web/src/lib/routes.ts` - `/memory` RouteDef in intelligence section; `/memories` removed from visible nav (Audit D-13 demotion precedent)
- `web/src/lib/vocabulary.ts` - `nav.memory` term added

## Decisions Made
- Task 1 is TDD GREEN against the contract test authored in Wave 0 (plan 06-01); no separate RED commit lives in 06-03. The `dashboard.contract.test.ts` assertions passed once the routes were implemented.
- D-05 honest coverage: email provenance pill only when an email-sourced row exists.
- D-07: empty categories hidden.
- D-02: developer Memories view relocated, not deleted.

## Deviations from Plan

None — plan executed exactly as written. The four edited files compile clean; pre-existing `web` TypeScript errors in unrelated files were left untouched per the scope boundary and logged to `deferred-items.md` (commit `27648e3`).

## Issues Encountered
- `cd web && npx tsc --noEmit` surfaces errors in files this plan never touched (AgentSuggestions, BrainGraph3D, Activity, HiveMind, Scheduled, StandupConfig). These predate 06-03 and are out of scope; the acceptance criterion is scoped to Memory.tsx / App.tsx / routes.ts, which compile clean. Logged to `.planning/phases/06-memory-surface/deferred-items.md`.

## Authentication Gates
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The operator-facing Memory trust surface is live and approved: grouped view, provenance hero, Add/Edit/Delete/Confirm, on-this-machine assurance, demoted-but-reachable developer view.
- Ready for 06-04 (the remaining phase plan: ingest/consolidate tombstone-respect wiring per T-06-04).

## TDD Gate Compliance
Task 1 was `tdd="true"`. The RED gate (failing contract test) was satisfied by the Wave 0 plan 06-01 (`dashboard.contract.test.ts`), and the GREEN gate is commit `145d1f9` in this plan. No separate `test(06-03)` commit exists because the test asset is shared from 06-01 — this is expected for the Wave 0 / Wave 3 split in this phase.

## Self-Check: PASSED

- FOUND: web/src/pages/Memory.tsx
- FOUND: src/dashboard.ts
- FOUND: .planning/phases/06-memory-surface/06-03-SUMMARY.md
- FOUND commits: 145d1f9, 1fc4f03, 27648e3

---
*Phase: 06-memory-surface*
*Completed: 2026-06-26*
