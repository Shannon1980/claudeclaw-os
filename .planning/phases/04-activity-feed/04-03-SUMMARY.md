---
phase: 04-activity-feed
plan: 03
subsystem: api
tags: [undo, mcp, json-rpc, allowlist, status-guard, hono, preact, vitest]

# Dependency graph
requires:
  - phase: 03-permissions-autonomy
    provides: "approval_queue + audit_log event stream, replay-executor.ts MCP-over-stdio pattern, status-guarded approve(), DASHBOARD_MUTATIONS_ENABLED kill-switch, token gate"
  - phase: 04-activity-feed (plan 01)
    provides: "isUndoableFamily allowlist predicate, getApprovalById / listApprovals read helpers, undoable flag on feed rows"
  - phase: 04-activity-feed (plan 02)
    provides: "GET /api/activity endpoint, Activity.tsx feed surface"
provides:
  - "src/undo-executor.ts: allowlisted inverse executor (sibling of replay-executor.ts), Tier 4 refused before dispatch, honest no-undo for everything else"
  - "POST /api/activity/:id/undo: status-guarded (claim-before-dispatch), mutation-gated undo route"
  - "claimUndo / finalizeUndo / undo status-guarded writes on approval_queue (no migration)"
  - "Conditional Undo affordance in Activity.tsx (renders only when undoable, never a dead button)"
affects: [05-audit, end-of-phase-human-verify]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inverse executor: mirror replay-executor (loadMcpServers + spawn + JSON-RPC initialize/initialized/tools-call), swap to inverse tool name, derive inverse args from captured tool_input, no eval/no shell"
    - "Claim-before-dispatch: a status-guarded UPDATE claims the row BEFORE the inverse runs, so a real inverse can never double-fire"
    - "Guard order: refuse tier>=4 first, then allowlist, then dispatch (single source of truth via isUndoableFamily)"

key-files:
  created:
    - src/undo-executor.ts
    - src/undo-executor.test.ts
  modified:
    - src/approval-queue.ts
    - src/approval-queue.test.ts
    - src/dashboard.ts
    - src/dashboard.contract.test.ts
    - web/src/pages/Activity.tsx

key-decisions:
  - "Label-remove is the designated floor family (cleanest, idempotent); drafts + meetings ship with structurally-correct inverse mappings that fail honestly when their server is absent"
  - "Double-fire prevention via claim-before-dispatch (claimUndo) rather than the approve-route's replay-then-guard, so the inverse itself never runs twice"
  - "Undo result stored in the existing approval_queue.result column with an in-band [undone] marker; no new status, no migration (RESEARCH A2)"
  - "Inverse tool NAMES could not be confirmed against a live MCP tools/list (no servers connected in this environment); assumed names logged as a deferred follow-up, behavior is honest no-undo until confirmed"

patterns-established:
  - "Undo executor: the structural inverse of replay-executor.ts; allowlist + honest-rejection + MCP-over-stdio, Tier 4 hard-refused before any dispatch"
  - "Claim-before-dispatch status guard for any do-once external side effect that must not double-fire"

requirements-completed: [TRUST-02]

# Metrics
duration: 14min
completed: 2026-06-24
---

# Phase 4 Plan 03: Undo Vertical Slice Summary

**Allowlisted Undo executor (structural inverse of replay-executor.ts) with Tier 4 hard-refused before dispatch, a claim-before-dispatch status-guarded POST /api/activity/:id/undo route that never double-fires, and a conditional Undo affordance in Activity.tsx that renders only on genuinely undoable rows.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-24T19:36:00Z
- **Completed:** 2026-06-24T19:50:00Z
- **Tasks:** 3
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- `src/undo-executor.ts` runs the real inverse of an allowlisted forward call over MCP-stdio, mirroring `replay-executor.replayMcp` exactly (loadMcpServers, spawn with cfg.env, JSON-RPC initialize -> notifications/initialized -> tools/call with derived structured-JSON args). Tier 4 is refused before any allowlist check or dispatch (D-09). Reuses the shared `isUndoableFamily` allowlist as the single source of truth.
- The floor family (label-remove) is proven end-to-end in test against an injected fake JSON-RPC server: the inverse is dispatched and the derived arguments round-trip. No eval, no shell string-building.
- `POST /api/activity/:id/undo` validates the id, requires an approved + undoable row, claims the row status-guarded BEFORE running the inverse (so it can never double-fire), records the verbatim honest result, and inherits the token gate + DASHBOARD_MUTATIONS_ENABLED kill-switch by mounting on `app`.
- Activity.tsx renders an Undo button ONLY when `row.undoable` is true, confirms destructively (naming the concrete inverse), runs the real inverse via the endpoint, and surfaces honest success/failure toasts (never a generic error). No dead/no-op buttons.

## Task Commits

1. **Task 1: undo-executor.ts (failing-first)** - `a5071c4` (feat, TDD red->green in one commit) + `9672da8` (test, lowercase "tier 4" filter)
2. **Task 2: status-guarded undo write + POST route + contract tests** - `5dc1dbc` (feat)
3. **Task 3: conditional Undo affordance in Activity.tsx** - `430d857` (feat)

_TDD note: Task 1 RED was verified (module-missing failure) before GREEN; both committed together since the test file and module ship as one unit._

## Files Created/Modified
- `src/undo-executor.ts` - Allowlisted inverse executor; `undoAction(toolName, toolInput, tier)`; Tier 4 refused before dispatch; inverse map for labels/drafts/meetings; MCP-stdio dispatch mirroring replay-executor; honest failures; never throws.
- `src/undo-executor.test.ts` - 6 cases: floor-family end-to-end via injected fake server, tier 4 refused before dispatch, honest no-undo, server-absent honest failure, never-throws on bad input, no em dash.
- `src/approval-queue.ts` - `claimUndo` (status-guarded claim, `WHERE status='approved' AND result NOT LIKE '[undone] %'`), `finalizeUndo`, `undo` convenience. No new column, no migration.
- `src/approval-queue.test.ts` - 4 cases for the undo write: records on approved row, second undo no-op, pending/unknown no-op.
- `src/dashboard.ts` - `POST /api/activity/:id/undo` (claim-before-dispatch); imports undoAction + isUndoableFamily + claimUndo/finalizeUndo/getApprovalById.
- `src/dashboard.contract.test.ts` - 5 undo cases: 400 bad id, 503 mutation-gated, undo-not-twice, Tier 4 + non-allowlisted honest reject.
- `web/src/pages/Activity.tsx` - Conditional Undo affordance + destructive ConfirmModal + honest toast; `load` refactored to a `useCallback` so undo can refresh the feed.

## Decisions Made
- **Floor family = label-remove.** All three families (labels, drafts, meetings) ship with concrete inverse mappings, but label-remove is the guaranteed-working floor proven end-to-end in test. The cleanest, most idempotent inverse (D-08).
- **Claim-before-dispatch over replay-then-guard.** The approve route runs replay then status-guards the transition (a small race window). For undo I claim the row first (status-guarded) and only run the inverse if the claim succeeded, so the inverse side effect can never fire twice (T-04-undo-doublefire), which matters more for a destructive inverse than for a replay.
- **No migration.** Undo records its result in the existing `result` column with an in-band `[undone]` marker; the guard refuses a second undo by matching that marker. No new status, no `migrations/` change (RESEARCH A2; avoids the crash-loop trap).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Claim-before-dispatch to prevent inverse double-fire**
- **Found during:** Task 2
- **Issue:** The plan described a status-guarded write mirroring `approve()` (run inverse, then guard the transition). That ordering leaves a window where a sequential second click runs `undoAction` again before the first `undo()` returns false. For a real destructive inverse (delete draft / cancel meeting), firing twice is a correctness defect (T-04-undo-doublefire).
- **Fix:** Split the write into `claimUndo` (status-guarded claim) + `finalizeUndo`. The route claims the row BEFORE dispatching the inverse; if the claim fails (already undone), the inverse never runs. `undo()` is retained as a claim+finalize convenience for non-route callers/tests.
- **Files modified:** src/approval-queue.ts, src/dashboard.ts
- **Verification:** `dashboard.contract.test.ts` undo-not-twice case + `approval-queue.test.ts` second-undo-no-op case both green.
- **Committed in:** `5dc1dbc` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** The deviation strengthens the Tampering mitigation the plan's threat model already required (T-04-undo-doublefire). No scope creep; the route shape and contract assertions are exactly as planned.

## Issues Encountered
- **No MCP servers connected in this environment.** `.claude/settings.json` is absent and the user `~/.claude/settings.json` has an empty `mcpServers`, so the `[ASSUMED]` inverse tool names from RESEARCH (A1) could not be confirmed against a live `tools/list`. Resolved by: (a) making the executor structurally correct and proving the floor family end-to-end against an injected fake JSON-RPC server, and (b) logging the assumed names + the confirm-at-human-verify follow-up in `deferred-items.md`. Absent families fail honestly ("Connect <server> in Settings to undo this"), never faked (D-08).

## Known Stubs
None. The Undo affordance is wired to the real endpoint and the floor-family inverse is proven end-to-end against an injected server. The only unconfirmed element is the exact inverse tool NAMES for the operator's live MCP servers, which is an honest deferred follow-up (see deferred-items.md), not a UI stub.

## User Setup Required
None for this plan. To exercise a real end-to-end undo at the end-of-phase human-verify, the operator must connect their Gmail/Calendar MCP servers in Settings; the assumed inverse tool names should be confirmed against those servers' `tools/list` (see deferred-items.md).

## Next Phase Readiness
- TRUST-02 is now genuinely satisfiable: an operator can undo a reversible action from the feed, irreversible/non-allowlisted/autonomous rows show no undo.
- Plan 04 (Summarize digest + end-of-phase human-verify) is unblocked. The human-verify should run a real end-to-end undo of the floor family against a connected MCP server and confirm Tier 4 + autonomous rows show no Undo.
- Pre-existing unrelated test failure (`src/chat-task-tracker.test.ts`, LLM-environment-dependent) logged in deferred-items.md; verified failing on the parent commit before any plan-03 change.

## Self-Check: PASSED

- Created files exist: src/undo-executor.ts, src/undo-executor.test.ts, 04-03-SUMMARY.md
- Commits exist: a5071c4, 5dc1dbc, 430d857, 9672da8

---
*Phase: 04-activity-feed*
*Completed: 2026-06-24*
