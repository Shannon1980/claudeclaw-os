---
phase: 02-routines
plan: 04
subsystem: web
tags: [routines, ui, preact, dashboard, builder, autonomy, cron-display]

# Dependency graph
requires:
  - phase: 02-routines (02-01)
    provides: RED contract tests
  - phase: 02-routines (02-02)
    provides: routine data model, runner, scheduler routine branch, triggerRoutineRun
  - phase: 02-routines (02-03)
    provides: /api/routines* HTTP surface (list, detail, draft, create, edit/reorder, delete, pause, resume, run-now)
provides:
  - "web/src/pages/Routines.tsx: operator-facing Routines list + detail surface wired to /api/routines*"
  - "Embedded draft-first conversational builder (RoutineBuilderPanel) — proposes schedule + steps, persists nothing until Save (D-04/D-05)"
  - "At-creation AutonomySelector (D-07) — stores unattended | queue_approval, presents-not-enforces (D-08)"
  - "Plain-language schedule display only; raw cron confined to ScheduleBuilder Advanced toggle (RTN-02/D-06)"
affects: [phase-3 (autonomy enforcement reads the stored choice), phase-8 (activity reads routine_runs)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Routines page modeled on Scheduled.tsx; teammate tags reuse teammateColor() from Team.tsx + AgentAvatar"
    - "describeCron(...).text for all operator-facing schedule rendering; raw cron only behind ScheduleBuilder Advanced toggle"
    - "Draft-first builder: POST /api/routines/draft (no persist) renders an editable draft; only Save POSTs /api/routines"
    - "On/off Toggle is the primary non-destructive control (pause/resume, no confirm modal); only Delete uses ConfirmModal"

key-files:
  created:
    - web/src/pages/Routines.tsx
    - web/src/components/RoutineRow.tsx
    - web/src/components/RoutineDetail.tsx
    - web/src/components/StepList.tsx
    - web/src/components/StepRow.tsx
    - web/src/components/TeammateTag.tsx
    - web/src/components/RunHistoryItem.tsx
    - web/src/components/RunOutcomeBadge.tsx
    - web/src/components/AutonomySelector.tsx
    - web/src/components/RoutineBuilderPanel.tsx
    - web/src/lib/routine.ts
    - web/src/lib/teammate.ts
  modified:
    - web/src/lib/routes.ts
    - web/src/App.tsx
    - web/src/pages/Team.tsx

key-decisions:
  - "nav.routines slot repointed from /scheduled to /routines (vocabKey preserved); /scheduled redirects to /routines — no dangling slug"
  - "On/off toggle is non-destructive (no confirm modal); only Delete is destructive (ConfirmModal)"
  - "AutonomySelector stores the coarse machine value (unattended | queue_approval), presented as a stored preference, not an enforced guarantee (D-08)"

patterns-established:
  - "Pattern: operator-facing schedule rendered via describeCron(...).text; raw cron never leaves the ScheduleBuilder Advanced toggle"
  - "Pattern: draft-first creation — the assistant's proposal is an editable, clearly-marked 'Draft, not saved yet' that persists nothing until Save"

requirements-completed: [RTN-01, RTN-02, RTN-03, RTN-04, RTN-05]

# Metrics
duration: 9 min
completed: 2026-06-23
---

# Phase 2 Plan 04: Routines Slice C (operator-facing surface) Summary

**The full Routines UI wired to the live /api/routines* endpoints: list with plain-language schedules and a non-destructive on/off toggle, expandable detail with editable steps + honest run history, an embedded draft-first conversational builder, and a visible at-creation autonomy selector. Human-verify checkpoint approved by the operator.**

## Performance

- **Duration:** ~9 min (implementation) + operator verification
- **Completed:** 2026-06-23
- **Tasks:** 3 (2 implementation + 1 human-verify checkpoint)
- **Files:** 12 created, 3 modified

## Accomplishments
- **List page** (`/routines`): `PageHeader` with "{on} on, {off} off" count line and an accent "New routine" button that opens the builder inline (never navigates to Chat — D-04). `PageState` for loading/error/empty. Nav slot repointed from `/scheduled` (vocabKey `nav.routines` preserved); `/scheduled` redirects, no dangling slug.
- **RoutineRow:** plain-language schedule via `describeCron(...).text` with a Clock icon (never raw cron — RTN-02/D-06), step count + last/next meta with accent countdown when on, `RunOutcomeBadge` for the latest run, a `size="sm"` Toggle as the primary non-destructive on/off control (POST pause/resume, no confirm modal), chevron to expand. Off routines dim content to `opacity-50`; the toggle stays full opacity.
- **RoutineDetail:** When (describeCron text + "Change" opening ScheduleBuilder, raw cron only behind its Advanced toggle), Steps (editable `StepList`/`StepRow` with `TeammateTag`, add/reorder), Recent runs (`RunHistoryItem`, honest ok/degraded/failed + "View output"), Actions (Run now → "Run started" toast / 409 handling, Turn off, read-only autonomy Pill).
- **RoutineBuilderPanel:** embedded, draft-first. POSTs the description to `/api/routines/draft` (persists nothing), renders the returned schedule + steps as an editable "Draft, not saved yet", and only POSTs `/api/routines` on Save. Dirty-draft cancel routes through a destructive ConfirmModal.
- **AutonomySelector:** visible above Save, stores `unattended | queue_approval` (forward-compatible with Phase 3's tier model), presents/stores only — no enforcement claim (D-08).
- **RunOutcomeBadge:** ok=done/green Check, degraded=medium/amber AlertTriangle, failed=failed/red XCircle. Failures shown honestly, never collapsed to a generic error.

## Task Commits

1. **Task 1: Routines page, list/detail/run components, route entry** - `f90b642` (feat)
2. **Task 2: embedded draft-first builder + at-creation autonomy selector** - `9d8680a` (feat)
3. **Task 3: human-verify checkpoint** - operator approved 2026-06-23 (no code commit; gate satisfied)

## Files Created/Modified
- Created: `web/src/pages/Routines.tsx`; components `RoutineRow`, `RoutineDetail`, `StepList`, `StepRow`, `TeammateTag`, `RunHistoryItem`, `RunOutcomeBadge`, `AutonomySelector`, `RoutineBuilderPanel`; libs `routine.ts`, `teammate.ts`.
- Modified: `web/src/lib/routes.ts` (route slot), `web/src/App.tsx` (route wiring + /scheduled redirect), `web/src/pages/Team.tsx` (teammateColor export reuse).

## Decisions Made
- **Route slot repointed**, not duplicated: `/scheduled` → `/routines` with the vocabKey preserved and a redirect, avoiding a dead nav entry.
- **Non-destructive on/off**: the toggle never prompts; only Delete (destructive) uses ConfirmModal.
- **Autonomy is presented, not enforced**: the selector stores a coarse machine value for Phase 3 to refine; the UI makes no enforcement promise (D-08 honesty).

## Deviations from Plan
None requiring auto-fix beyond the corrected verify command (no-raw-cron-leak grep), which was fixed at plan-review time. Build green on both commits; describeCron used in RoutineRow; no raw-cron leak; TeammateTag uses teammateColor; builder draft call separate from persist call; AutonomySelector emits machine values; no em dashes in shipped copy.

## Issues Encountered
- Two pre-existing dashboard contract-test failures (`serves SPA shell at /`, `/warroom`) are unrelated to routines (fail identically before this work); logged to `.planning/phases/02-routines/deferred-items.md`, not fixed (scope boundary).

## User Setup Required
- **Before restarting the live service, run `npm run migrate`** to apply the `v1.2.2` schema (routine_steps/routine_runs + autonomy). Skipping it crash-loops the service via checkPendingMigrations (known trap).

## Next Phase Readiness
- All five RTN requirements delivered end-to-end. The stored autonomy choice (`unattended | queue_approval`) is the seam Phase 3 (Permissions) reads to gate tool calls. `routine_runs` rows are shaped for Phase 8 (Activity) to read as "Ran on its own".

## Verification
- `npm run build` (vite + tsc) green on both implementation commits.
- describeCron-used grep + no-raw-cron-leak grep clean.
- Human-verify checkpoint: operator approved the end-to-end experience (create-by-describing → editable draft → save → plain-language schedule → on/off → run-now → honest run history).

---
*Phase: 02-routines*
*Completed: 2026-06-23*
