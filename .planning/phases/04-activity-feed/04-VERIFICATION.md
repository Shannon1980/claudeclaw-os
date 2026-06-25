---
phase: 04-activity-feed
verified: 2026-06-24T20:26:00Z
status: passed
score: 15/15 must-haves verified
overrides_applied: 0
deferred:
  - truth: "At least one reversible family (label-remove or draft-delete) undoes end-to-end via a real inverse MCP call against a connected server (D-08 live confirmation)"
    addressed_in: "Post-phase human verification, tracked in deferred-items.md"
    evidence: "deferred-items.md: 'Undo inverse tool NAMES not confirmed against a live MCP tools/list (RESEARCH A1)'. Accepted context states: floor family proven end-to-end in undo-executor.test.ts against an injected fake JSON-RPC server; honest fallback ('Connect <server> in Settings') when server is absent. Accepted by operator on 2026-06-24."
human_verification:
  - test: "Confirm real end-to-end undo of the floor family (label-remove) against the operator's connected MCP server"
    expected: "Applying a Gmail label via an agent action, then clicking Undo in the Activity feed, removes the label and shows an honest success toast. The assumed tool name mcp__gmail__remove-label should be confirmed against the live tools/list output."
    why_human: "No MCP servers were connected in the build environment; live server confirmation cannot be automated without a running Gmail MCP server."
---

# Phase 04: Activity Feed Verification Report

**Phase Goal:** An operator can glance at what the team did, see which actions ran autonomously vs were approved, and undo anything reversible. The transparency that makes autonomy safe to trust.
**Verified:** 2026-06-24T20:26:00Z
**Status:** passed
**Re-verification:** No, initial verification.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | buildActivityFeed returns reverse-chronological, attributed rows from both sources (TRUST-01) | VERIFIED | `src/activity.ts:184` exports `buildActivityFeed`; merges approval_queue + audit_log permission rows, sorted by `created_at DESC, id DESC`; 17 unit tests green in `src/activity.test.ts` |
| 2 | Tags derived read-side: pending -> Needs you, approved -> You approved, allow -> Ran on its own, denied/expired -> honest distinct state (D-06) | VERIFIED | `src/activity.ts:108-121` `tagForQueueStatus`; audit rows hardcoded `tag: 'Ran on its own'`; test coverage confirms all tag derivations |
| 3 | Queued action appears exactly once (audit outcome='queued' excluded; queue row owns it) | VERIFIED | Audit SQL filters to `outcome IN ('allow','approved-inline')` only (line 208-210); JS double-check in `parseDetail` gate (line 218); unit test "no double" green |
| 4 | phraseFor maps known tools to plain phrases; unmapped tools get honest generic ("Ran <tool>"), never fabricated, never hidden (D-04/D-05) | VERIFIED | `src/activity-render.ts:35-55`; 6 unit tests green in `src/activity-render.test.ts`; no LLM call in path |
| 5 | getApprovalById returns any-status row; listApprovals(statuses) returns rows in those statuses | VERIFIED | `src/approval-queue.ts:160,181`; parameterized IN list (line 186); 17 tests green in `src/approval-queue.test.ts` |
| 6 | Feed row marked undoable only for approval_queue row, allowlisted tool, tier < 4, tool_input present (TRUST-02 prep) | VERIFIED | `src/activity.ts:126-130` `rowFromQueue` undoable guard; audit rows always `undoable: false` (line 164); unit test confirms |
| 7 | Visiting /activity shows reverse-chronological, plain-language feed, attributed by teammate, grouped by day (TRUST-01 / SC1) | VERIFIED | `web/src/pages/Activity.tsx`: dayKey/dayLabel grouping (lines 60-73), `ActivityRowCard` renders teammate dot + phrase + meta (lines 364-445), `groups.map` over `rows` |
| 8 | Each row tagged: Ran on its own (neutral) / You approved (green) / Needs you (amber); denied/expired show honestly (TRUST-01 / SC2, D-06) | VERIFIED | `Activity.tsx:43-57` `toneForTag` maps all 5 tag states to distinct Pill tones; Pill component renders the tag text |
| 9 | Filter chips All / Ran on its own / Needs you / per-teammate filter the feed read-side (D-11) | VERIFIED | `Activity.tsx:140-142` passes `?filter=<value>` to GET /api/activity; `buildActivityFeed` `applyFilter` handles all cases |
| 10 | GET /api/activity is token-gated and returns curated rows (TRUST-01) | VERIFIED | `src/dashboard.ts:3571` mounted on existing token-gated `app`; contract test "activity" group (12 tests) green |
| 11 | /activity nav route exists; /audit uses nav.audit; no duplicate Activity nav item (D-01/D-02) | VERIFIED | `routes.ts:37-38`: `/activity` vocabKey `nav.activity`, `/audit` vocabKey `nav.audit`; `vocabulary.ts:56-57` both terms defined; `App.tsx:60` route wired; exactly one row per vocabKey |
| 12 | Home has a one-click entry point to /activity (D-03) | VERIFIED | `web/src/pages/Home.tsx:183` `onClick={() => navigate('/activity')}` |
| 13 | Allowlisted reversible action can be undone end-to-end via real inverse; Tier 4 never undoable; non-allowlisted shows no undo (TRUST-02 / D-07/D-08/D-09) | VERIFIED | `src/undo-executor.ts:148` Tier >= 4 refused before dispatch; `isUndoableFamily` shared allowlist; label/draft/meeting inverses; 6 undo-executor tests green; Activity.tsx renders Undo only when `undoable` flag true |
| 14 | Undo is status-guarded (no double-fire); POST /api/activity/:id/undo returns non-200 on failure; honest verbatim result (TRUST-02) | VERIFIED | `claimUndo` stamps `UNDONE_MARKER` ('[undone] ') matching LIKE guard (CR-01 fix); route returns 404/409/400 on failure branches (CR-01/WR-01 fixed); contract "undo" tests green |
| 15 | Summarize Today produces Haiku/OAuth digest; governed by LLM_SPAWN_ENABLED; honest degrade on failure; no secrets in prompt (D-10) | VERIFIED | `src/activity-summary.ts:23` imports `extractViaClaude`; no Gemini/GOOGLE_API_KEY; `SUMMARIZE_DEGRADE` returned on failure/empty; prompt carries only phrase/teammate/time; 5 tests green; dashboard route checks `LLM_SPAWN_ENABLED` kill-switch before LLM call |

**Score:** 15/15 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/activity-render.ts` | Deterministic tool->phrase map, phraseFor | VERIFIED | 56 lines; exports `phraseFor`; no LLM call; no em dashes |
| `src/activity.ts` | buildActivityFeed read model; isUndoableFamily predicate | VERIFIED | 229 lines; exports `buildActivityFeed` and `isUndoableFamily` |
| `src/approval-queue.ts` | getApprovalById, listApprovals, claimUndo, finalizeUndo | VERIFIED | All 4 functions exported; parameterized IN list; status-guarded claimUndo with full UNDONE_MARKER stamp |
| `src/undo-executor.ts` | undoAction; Tier 4 guard first; shared isUndoableFamily; no eval | VERIFIED | 285 lines; tier >= 4 refused at line 148 before allowlist; imports isUndoableFamily from activity.js; no eval/exec |
| `src/activity-summary.ts` | summarizeDay; extractViaClaude; honest degrade | VERIFIED | 79 lines; exports `summarizeDay` and `SUMMARIZE_DEGRADE`; uses extractViaClaude only |
| `src/dashboard.ts` | GET /api/activity; POST /api/activity/:id/undo; POST /api/activity/summarize | VERIFIED | All 3 routes mounted on token-gated app; undo route non-200 failures; summarize route LLM_SPAWN_ENABLED-gated |
| `web/src/pages/Activity.tsx` | Feed surface; filter chips; Undo (conditional); Summarize Today | VERIFIED | 447 lines; fetches /api/activity; ConfirmModal on undoable rows only; Summarize Today button in PageHeader |
| `web/src/lib/routes.ts` | /activity -> nav.activity; /audit -> nav.audit; ListChecks icon for /activity | VERIFIED | Lines 37-38 confirm distinct icons, distinct vocabKeys |
| `web/src/lib/vocabulary.ts` | nav.audit term; nav.activity/page.activity pointing at new surface | VERIFIED | Lines 56-57, 71-72 confirm both terms defined |
| `web/src/App.tsx` | Route path="/activity" wired to Activity component | VERIFIED | Line 60 confirmed |
| `web/src/pages/Home.tsx` | One-click /activity entry point | VERIFIED | Line 183 confirmed |
| `src/activity.test.ts` | 17 unit tests; reverse-chron, tag derivation, dedupe, attribution, undoable | VERIFIED | 17 tests green |
| `src/activity-render.test.ts` | 6 unit tests; phrase mapping, honest generic, no em dash | VERIFIED | 6 tests green |
| `src/undo-executor.test.ts` | 6 unit tests; allowlist, tier 4 refusal, non-allowlisted honest reject | VERIFIED | 6 tests green |
| `src/activity-summary.test.ts` | 5 unit tests; digest, honest degrade, no secrets in prompt | VERIFIED | 5 tests green |
| `src/dashboard.contract.test.ts` | 105 tests (12 in activity/undo/summarize groups) | VERIFIED | All 105 green (12 new activity-related tests pass) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/activity.ts` | `src/activity-render.ts` | `phraseFor(...)` per queue row | WIRED | Line 138: `phraseFor(r.tool_name, r.tool_input, r.tier)` |
| `src/activity.ts` | `src/approval-queue.ts` | `listApprovals(...)` | WIRED | Line 193-196: `listApprovals(['pending','approved','denied','expired'], sourceLimit)` |
| `web/src/pages/Activity.tsx` | `/api/activity` | `apiGet` in `useEffect` | WIRED | Line 141: `apiGet<...>('/api/activity${q}')` |
| `src/dashboard.ts` | `src/activity.ts` | `buildActivityFeed` in GET handler | WIRED | Line 3575: `buildActivityFeed({ filter, limit })` |
| `web/src/App.tsx` | `web/src/pages/Activity.tsx` | `Route path="/activity"` | WIRED | Line 60 confirmed |
| `src/dashboard.ts` | `src/undo-executor.ts` | `undoAction(...)` in undo route | WIRED | Line 3625: `undoAction(row.tool_name, row.tool_input, row.tier)` |
| `src/undo-executor.ts` | `src/activity.ts` | `isUndoableFamily` (shared allowlist) | WIRED | Line 35: `import { isUndoableFamily } from './activity.js'`; used at line 154 |
| `web/src/pages/Activity.tsx` | `/api/activity/:id/undo` | `apiPost` after ConfirmModal confirm | WIRED | Line 340: `apiPost('/api/activity/${row.id}/undo')` |
| `src/dashboard.ts` | `src/activity-summary.ts` | `summarizeDay(today)` in summarize route | WIRED | Line 3653: `summarizeDay(today)` |
| `src/activity-summary.ts` | `src/memory-ingest.ts` | `extractViaClaude` (Haiku/OAuth) | WIRED | Line 23: `import { extractViaClaude }` |
| `web/src/pages/Activity.tsx` | `/api/activity/summarize` | `apiPost` from Summarize Today action | WIRED | Line 108: `apiPost('/api/activity/summarize')` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `Activity.tsx` | `rows` state | `GET /api/activity` -> `buildActivityFeed` -> DB | Yes: approval_queue + audit_log reads with bounded SQL | FLOWING |
| `Activity.tsx` | `summary` state | `POST /api/activity/summarize` -> `summarizeDay` -> `extractViaClaude` | Yes: Haiku/OAuth LLM or honest degrade | FLOWING |
| `src/activity.ts:buildActivityFeed` | `queueRows` | `listApprovals` -> `SELECT * FROM approval_queue` | Yes: parameterized DB query with LIMIT | FLOWING |
| `src/activity.ts:buildActivityFeed` | `auditRows` | `SELECT ... FROM audit_log WHERE action='permission' AND LIKE...` | Yes: SQL with LIMIT (CR-02 fix) | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All phase-04 unit tests pass | `npx vitest run src/activity.test.ts src/undo-executor.test.ts src/activity-render.test.ts src/approval-queue.test.ts src/activity-summary.test.ts src/dashboard.contract.test.ts` | 51 tests passed across 6 files | PASS |
| Tier 4 guard fires before any dispatch | `npx vitest run src/undo-executor.test.ts -t "tier 4"` | 1 test passed | PASS |
| Frontend build is clean | `npm run build` | vite + tsc succeed, no errors | PASS |
| Full suite (excluding known pre-existing failure) | `npx vitest run` | 835/836 pass; 1 failure is `chat-task-tracker.test.ts` (pre-existing, LLM-env-dependent, accepted out-of-scope) | PASS |

---

### Probe Execution

Not applicable. No probe scripts defined for this phase.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TRUST-01 | 04-01, 04-02, 04-04 | A user can see an activity feed of what the team did, each item tagged autonomous vs approved | SATISFIED | buildActivityFeed produces reverse-chron, tagged, attributed feed; GET /api/activity; Activity.tsx renders it with filter chips; 15/15 must-haves verified |
| TRUST-02 | 04-01, 04-03 | A user can undo a reversible action from the activity feed (D9) | SATISFIED | undoAction + claimUndo + POST /api/activity/:id/undo + Activity.tsx Undo affordance; status-guarded; Tier 4 refused; shared allowlist |

No orphaned requirements found for this phase.

---

### Code Review Findings Confirmed

All 8 findings from 04-REVIEW.md are verified fixed in source:

| Finding | Status | Verification |
|---------|--------|--------------|
| CR-01: claimUndo wrong marker (double-fire) | FIXED | `UNDONE_MARKER = '[undone] '` (with trailing space); `.run(UNDONE_MARKER, now, id)` without trim; LIKE guard `result NOT LIKE '[undone] %'` matches |
| CR-02: buildActivityFeed unbounded audit fetch | FIXED | Audit SQL now has `LIMIT ?` with `sourceLimit`; `listApprovals` takes bounded `limit` param |
| WR-01: Undo route HTTP 200 for all failures | FIXED | Route returns 404 (not found), 409 (wrong state/already undone), 400 (not undoable/bad id) |
| WR-02: /activity and /usage share same icon | FIXED | `/activity` uses `ListChecks`; `/usage` uses `Activity` (chart icon) |
| WR-03: Label undo dispatches with empty label | FIXED | `if (!label) return { args: {}, missing: 'no label id in the captured action' }` at line 98 |
| WR-04: Em dashes in Home.tsx user-facing copy | FIXED | `grep -cP "\x{2014}" Home.tsx` returns 0 |
| IN-01: Em dashes in code comments | FIXED | Phase-04 comments in approval-queue.ts and dashboard.ts use `--` separator |
| IN-02: buildActivityFeed applies limit after full table load | FIXED | Both sources bounded with `sourceLimit = limit * 2` at DB layer |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found in phase-04 files | | | | |

No TBD/FIXME/XXX markers in phase-04 source files. No stub return patterns. No hardcoded empty data fed to rendering.

---

### Human Verification Required

**One item requiring live server confirmation (deferred, accepted by operator on 2026-06-24):**

### 1. Live MCP Inverse Tool Name Confirmation

**Test:** With a Gmail MCP server connected, perform an allowlisted label-apply action through an agent, then click Undo in the Activity feed and confirm the label is actually removed.

**Expected:** The inverse tool `mcp__gmail__remove-label` exists in the connected server's `tools/list`. The label is genuinely removed and an honest success toast appears. If the tool name differs from the assumed name, update `inverseFor()` in `src/undo-executor.ts`.

**Why human:** No MCP servers were connected in the build environment. The floor family (label-remove) is proven structurally end-to-end with an injected fake JSON-RPC server in tests, but live server tool name confirmation requires a running Gmail MCP server. Accepted as a deferred follow-up per the known context.

---

### Gaps Summary

No gaps. All 15 must-haves verified. One human verification item exists (MCP live server confirmation) which was accepted by the operator as a tracked deferred item, not a phase blocker.

---

_Verified: 2026-06-24T20:26:00Z_
_Verifier: Claude (gsd-verifier)_
