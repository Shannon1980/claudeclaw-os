---
phase: 04-activity-feed
plan: 01
subsystem: activity-feed-read-engine
tags: [activity, read-model, phrase-map, approval-queue, tdd, trust-01, trust-02]
requires:
  - approval_queue + audit_log event stream (Phase 3)
  - gate.summarize (params-free fallback)
provides:
  - phraseFor (deterministic tool->phrase map, D-04/D-05)
  - buildActivityFeed (curated merge/dedupe/tag/undoable read model, TRUST-01)
  - isUndoableFamily (shared undo allowlist predicate for plan 03)
  - getApprovalById / listApprovals (read helpers, TRUST-02 prep)
affects:
  - src/activity.ts, src/activity-render.ts, src/approval-queue.ts
tech-stack:
  added: []
  patterns:
    - defensive JSON.parse on read (never eval) for tool_input + audit detail
    - read-side tag derivation (no tag column, no Phase 3 write-path change)
    - parameterized IN list for status filtering (no SQL string interpolation)
key-files:
  created:
    - src/activity-render.ts
    - src/activity-render.test.ts
    - src/activity.ts
    - src/activity.test.ts
  modified:
    - src/approval-queue.ts
    - src/approval-queue.test.ts
decisions:
  - "isUndoableFamily lives in activity.ts as the single source of truth; plan 03 undo-executor reuses it (no allowlist drift)"
  - "Audit read filters outcome IN ('allow','approved-inline') which IS the dedupe; approval_queue owns any queued action"
  - "undoable requires status='approved' (in addition to allowlist + tier<4 + tool_input); pending rows go through Review, not Undo"
metrics:
  duration: ~6min
  completed: 2026-06-24
---

# Phase 4 Plan 1: Activity Feed Read Engine Summary

Built the testable read-side backbone for the Activity feed: a deterministic tool->phrase map, a curated merge/dedupe/tag-derive read model over `approval_queue` + `audit_log`, and the two approval-queue read helpers Undo will target. No UI, no new write path. All TDD, failing-first.

## What Was Built

**Task 1 — `src/activity-render.ts` (`phraseFor`):** Deterministic `(toolName, input, tier) -> string` map. gmail send names the recipient when honestly present ("Sent email to a@b.com" / "Sent an email"); draft tools return "Prepared a draft"; everything unmapped returns an honest generic "Ran <tool>" with the `mcp__server__` prefix stripped (D-05: never fabricated, never hidden). No LLM, no em dashes. `gate.ts summarize()` left untouched as the params-free fallback.

**Task 2 — `src/approval-queue.ts` read helpers:** `getApprovalById(id)` returns a hydrated row of any status (undefined when missing); `listApprovals(statuses)` filters via a parameterized IN list ordered `created_at DESC, id DESC`. Both reuse the existing `hydrate`/`parseToolInput` pipeline (corrupt JSON -> `{}`, never throws). No migration, no new column.

**Task 3 — `src/activity.ts` (`buildActivityFeed` + `isUndoableFamily`):** Two reads merged. `approval_queue` (all statuses, source of truth, carries `tool_input`) plus `audit_log WHERE action='permission'` filtered to `outcome IN ('allow','approved-inline')` — that filter is the dedupe, so a queued action's `outcome='queued'` audit row never double-renders. Tags derived read-side (D-06): pending->Needs you, approved->You approved, audit allow->Ran on its own, denied->Denied, expired->Expired (never dropped). Attribution by `agent_id`. Reverse-chron `created_at DESC, id DESC`. `undoable` = approval_queue row AND `isUndoableFamily` AND `tier < 4` AND non-empty `tool_input` AND `status='approved'`; audit rows (no params) are never undoable; tier 4 never undoable. Read-side filters: all / autonomous / needsyou / `<agent_id>`. Surfaces only stored param-level fields (no env/secrets).

## Verification

- `npx vitest run src/activity-render.test.ts src/activity.test.ts src/approval-queue.test.ts` — 35 passed (6 + 17 + 12).
- `npx tsc --noEmit` — clean across new/modified files.
- No migration files: `git status --porcelain migrations/` empty.
- `gate.ts` unchanged: `git diff --quiet src/gate.ts` true.
- No em dash in `src/activity.ts` / `src/activity-render.ts` (the only `—` remaining is the deliberate `EM_DASH` test fixture in activity-render.test.ts that asserts absence).
- No secret/env field copied into a row: grep for `process.env|getScrubbedSdkEnv|OAUTH|API_KEY` in `activity.ts` returns 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - CLAUDE.md] Removed em dashes from new doc comments and authored test comments**
- **Found during:** Tasks 1, 2, 3 (acceptance-criteria grep gates + CLAUDE.md hard rule)
- **Issue:** Initial JSDoc/comment prose in `activity-render.ts`, `activity.ts`, the new test files, and the new `listApprovals` doc used em dashes, violating CLAUDE.md "No em dashes. Ever." and the `grep -cP "\x{2014}" returns 0` acceptance gate.
- **Fix:** Replaced em dashes with periods/commas/colons in the source and in the comments I authored this plan. Pre-existing em dashes elsewhere in `approval-queue.ts` (file header and prior comments) were left untouched per the scope boundary. The `const EM_DASH = '—'` in activity-render.test.ts is an intentional fixture and stays.
- **Files modified:** src/activity-render.ts, src/activity.ts, src/approval-queue.ts, src/activity.test.ts, src/activity-render.test.ts
- **Commit:** 94788d0 (render), 666c9a6 (activity + test cleanup + approval-queue helper doc)

### Design choices within plan discretion

- `isUndoableFamily` recognises draft / (calendar|gcal|event|meeting) / label families by regex on the tool name, matching the D-08 target inverses. Exact MCP inverse tool names (RESEARCH A1, `[ASSUMED]`) are confirmed at the executor level in plan 03; this predicate only gates which families CAN be undone.
- `undoable` additionally requires `status='approved'`: a pending row is reviewed (approve/deny), not undone, and a denied/expired action never ran so there is nothing to undo.

## Notes for Downstream Plans

- Plan 03 (undo-executor) MUST import `isUndoableFamily` from `src/activity.ts` rather than redefining the allowlist (single source of truth, no drift).
- `audit_log` permission rows carry NO `tool_input` (RESEARCH Pitfall 1), so "Ran on its own" rows are correctly never undoable and get the coarse params-free phrase. The endpoint/UI plan must surface them honestly with no Undo affordance.
- `buildActivityFeed` is the read model the `GET /api/activity` endpoint wraps; the API plan just curates `{ rows: buildActivityFeed({ filter, limit }) }`.

## Self-Check: PASSED

- All 4 created source/test files present on disk.
- All 6 task commits (9fb7e77, 94788d0, 6e62e2e, 6861d64, f81a36e, 666c9a6) present in git history.
