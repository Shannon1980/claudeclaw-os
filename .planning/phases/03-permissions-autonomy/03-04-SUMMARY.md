---
phase: 03-permissions-autonomy
plan: 04
subsystem: permissions-autonomy
tags: [permissions, autonomy, dashboard-api, approval-queue, replay, inline-ask, preact, hono]
requires:
  - phase: 03-03
    provides: "approval_queue table + approval-queue CRUD (listPending/approve/deny), canUseTool gate wired into agent.ts, GateContext threaded through every caller with a background-safe default"
  - phase: 03-02
    provides: "gate.ts classifyTier/resolveOutcome + permissions-config getMode/setMode/getOverrides/setOverride"
provides:
  - "GET/PUT /api/permissions (mode + per-capability overrides, enum-validated, audited via setMode/setOverride)"
  - "GET /api/approvals + POST /api/approvals/:id/approve|:id/deny with status-guarded one-time replay"
  - "src/replay-executor.ts — allowlisted replay (MCP direct-call + tiny Bash/Write executor), honest rejection of anything else, Tier 4 per-instance only (D-05)"
  - "message-core.ts attended GateContext with bounded-timeout requestInline resolver (fails to deny) for live-chat Tier 3/4 asks (D-04)"
  - "Settings PermissionsSection: AutonomyModeSelector dial, tier legend, ActionOverrideRow list, LockedActionRow Tier 4 rows"
  - "Home NeedsYouCard ApprovalItem rows: one-tap Approve/Deny with optimistic state + honest replay-failure line"
affects: [04-activity-feed, 05-audit-log, 06-memory-surface, 07-power-surfaces]
tech-stack:
  added: []
  patterns:
    - "Allowlist replay executor: parse stored JSON tool params, dispatch only to known tool families (MCP direct-call, Bash, Write), reject all else with a verbatim honest error stored in result — no eval, no shell interpolation beyond the already-gated captured command (P-3, T-03-replay-exec)"
    - "Attended GateContext supplies a bounded-timeout requestInline that fails-safe to deny; the model can only request, never self-approve (T-03-injection-selfapprove)"
    - "Tier 4 approvals are per-instance only — neither the inline resolver nor the approve route ever persists an Always (D-05)"
    - "UI surfaces reuse existing primitives (ThemePicker active-card accent, AutonomySelector segmented control, NeedsYouCard sibling row) rather than building parallel cards; tokens-only, weights 400/500 only, no em dashes"
key-files:
  created:
    - src/replay-executor.ts
    - web/src/components/AutonomyModeSelector.tsx
    - web/src/components/ActionOverrideRow.tsx
    - web/src/components/LockedActionRow.tsx
    - web/src/components/ApprovalItem.tsx
  modified:
    - src/dashboard.ts
    - src/message-core.ts
    - src/gate.test.ts
    - web/src/pages/Settings.tsx
    - web/src/pages/Home.tsx
    - web/src/components/DailyLoop.tsx
    - web/src/lib/vocabulary.ts
key-decisions:
  - "Replay logic extracted into a dedicated src/replay-executor.ts (not inlined in dashboard.ts) so the allowlist + honest-rejection contract is isolated and testable — this file was NOT in the plan's files_modified list"
  - "message-core.ts inline-ask resolver (requestInline) wired here per the plan action; 03-03 left a background-safe ctx with a comment that plan 04 supplies requestInline — this completes that handoff"
  - "Tier 4 approve/deny remains per-instance only; the approve route refuses to persist an Always for a Tier 4-classified tool (D-05)"
patterns-established:
  - "Allowlist replay executor with honest rejection — reusable for any future approve-and-replay surface"
  - "Bounded-timeout fail-to-deny inline resolver for attended chat gating"
requirements-completed: [PERM-01, PERM-02, PERM-03, PERM-04]
duration: ~30min
completed: 2026-06-24
---

# Phase 3 Plan 04: Permissions & Approvals Surfaces Summary

**The operator-facing vertical slice: `/api/permissions` + `/api/approvals` routes with status-guarded one-time replay, the Settings Permissions section (mode dial, tier legend, override list, locked Tier 4 rows), the Home "Needs you" one-tap approve/deny surface, and the inline yes/no chat ask — PERM-01/02/03/04 + D-04/D-05 now usable end to end.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-06-24
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint, operator-approved)
- **Files modified:** 12 (5 created, 7 modified)

## Accomplishments

- Exposed the permission engine over authed HTTP: `GET/PUT /api/permissions` (enum-validated mode + overrides, audited) and `GET /api/approvals` + `POST /api/approvals/:id/approve|:id/deny` with status-guarded one-time replay.
- Built `src/replay-executor.ts` — an allowlisted replay path (MCP direct-call + a tiny explicit Bash/Write executor) that rejects anything else with an honest verbatim error, with no eval and no shell interpolation beyond the already-gated captured command (P-3, T-03-replay-exec).
- Wired the attended `requestInline` resolver into `src/message-core.ts` so live-chat Tier 3/4 actions ask inline (yes/no) and only run on yes, with a bounded timeout that fails-safe to deny (D-04). Tier 4 inline approval is per-instance only — never writes an Always (D-05).
- Shipped the Settings Permissions section (mode dial with Balanced "Recommended", collapsible tier legend, override list with Always/Ask segments, three locked Tier 4 rows showing a lock + static "Always ask" with no control in any mode) and the Home `ApprovalItem` rows inside the existing NeedsYouCard (one-tap Approve/Deny, optimistic state, honest replay-failure line, Tier 4 deny behind a destructive ConfirmModal).

## Task Commits

1. **Task 1: /api/permissions* + /api/approvals* routes + inline-ask resolver + replay executor** - `baeeea9` (feat)
2. **Task 2: Permissions section in Settings + ApprovalItem on Home** - `526946f` (feat)
3. **Task 3: Human verification of live gate, dial, locked rows, queue, inline ask** - operator checkpoint, **APPROVED 2026-06-24** (no code commit — verification gate)

Supporting docs commit: `d59f9ff` (docs: deferred-items.md log of pre-existing out-of-scope items).

## Files Created/Modified

- `src/dashboard.ts` - Added `/api/permissions` GET/PUT and `/api/approvals` GET + approve/deny routes on the existing token-gated `app` (inherits the mutations kill-switch), enum-validating mode and override values (400 on invalid), persisting via setMode/setOverride.
- `src/replay-executor.ts` (created) - Allowlisted replay: dispatches stored `{tool_name, tool_input}` to MCP direct-call or the tiny Bash/Write executor, rejects everything else with an honest error string stored in `result`; refuses to persist an Always for Tier 4 (D-05).
- `src/message-core.ts` - Builds an attended `GateContext { attended:true, chatId, agentId, requestInline }` and passes it into the run; `requestInline` is a bounded-timeout yes/no resolver that fails to deny on timeout (D-04/D-05).
- `src/gate.test.ts` - Minor test adjustment accompanying the inline-ask wiring.
- `web/src/components/AutonomyModeSelector.tsx` (created) - Three radio cards (Cautious/Balanced/Autonomous), Balanced carries a soft-accent "Recommended" Pill, selecting toasts "Mode set to {Mode}." and PUTs `/api/permissions`.
- `web/src/components/ActionOverrideRow.tsx` (created) - Capability label + tier badge + Always/Ask segmented control + "overridden" marker + reset-to-default text-action.
- `web/src/components/LockedActionRow.tsx` (created) - Non-interactive ReadOnlyRow for the three D-01 locked actions: muted Lock icon (not red) + static "Always ask" Pill + faint one-line reason, no control in any mode (PERM-03).
- `web/src/components/ApprovalItem.tsx` (created) - One-tap approve/deny row inside NeedsYouCard: plain-language summary + avatar/teammate + target + tier badge + relative time; Approve POSTs approve with optimistic chip + honest replay-failure line; Deny POSTs deny, Tier 4 behind a destructive ConfirmModal.
- `web/src/pages/Settings.tsx` - PermissionsSection assembling the dial, tier legend, override list, and locked rows, wired to GET/PUT `/api/permissions` with PageState loading/error.
- `web/src/pages/Home.tsx` - Fetches `/api/approvals` into the NeedsYouCard list.
- `web/src/components/DailyLoop.tsx` - Renders `ApprovalItem` as a sibling row inside the existing NeedsYouCard.
- `web/src/lib/vocabulary.ts` - Added permissions/needs-you/mode vocab keys.

## Decisions Made

- **Replay logic lives in its own `src/replay-executor.ts`** rather than inline in `dashboard.ts`, isolating the allowlist + honest-rejection contract. This file was not in the plan's `files_modified` frontmatter — documented as a deviation below.
- **`message-core.ts` inline-ask resolver was completed here**, fulfilling the handoff 03-03 left open (background-safe ctx with a comment that plan 04 supplies `requestInline`).
- **Tier 4 approvals stay per-instance only** — neither the inline resolver nor the approve route ever persists an Always for a Tier 4-classified tool (D-05).

## Deviations from Plan

### Auto-fixed / completeness additions

**1. [Rule 2 - completeness] Extracted replay logic into a new `src/replay-executor.ts` (outside the plan's files_modified list)**
- **Found during:** Task 1.
- **Issue:** The plan put the approve-replay logic inside the `/api/approvals/:id/approve` route, but the allowlist + honest-rejection + Tier 4 per-instance guard is substantial and security-sensitive; inlining it in `dashboard.ts` would have buried the threat-mitigation surface (T-03-replay-exec).
- **Fix:** Created `src/replay-executor.ts` housing the allowlisted dispatch (MCP direct-call + tiny Bash/Write executor), the honest rejection for non-allowlisted tools, and the Tier 4 per-instance refusal. `dashboard.ts` calls it and, on success, records via approve(id, result); on failure stores the verbatim reason. No eval, no extra shell interpolation.
- **Files modified:** src/replay-executor.ts (created), src/dashboard.ts.
- **Verification:** dashboard.contract.test.ts approvals block GREEN including the replay-not-twice assertion; typecheck clean.
- **Committed in:** baeeea9 (Task 1 commit).

**2. [Rule 2 - completeness] `message-core.ts` inline-ask resolver wired (carrying forward the 03-03 handoff)**
- **Found during:** Task 1.
- **Issue:** 03-03 left `message-core.ts` passing a background-safe ctx with a code comment that plan 04 supplies `requestInline`; the plan action for this task explicitly calls for building that resolver.
- **Fix:** Built the attended `GateContext` with a bounded-timeout `requestInline` (yes/no) that fails to deny on timeout, satisfying D-04 (inline live-chat ask) and D-05 (Tier 4 one-time, never an Always).
- **Files modified:** src/message-core.ts.
- **Verification:** typecheck clean; live behavior verified at the human-verify checkpoint (operator-approved).
- **Committed in:** baeeea9 (Task 1 commit).

---

**Total deviations:** 2 completeness additions (both Rule 2).
**Impact on plan:** Both serve the plan's stated actions/security goals. No scope creep — the replay executor is the plan's required replay logic relocated for clarity, and the inline resolver is the plan's named D-04 work completing 03-03's deferred handoff.

## Verification

- **`npx vitest run src/dashboard.contract.test.ts` → 93 passed (GREEN)** — re-confirmed on finalize, including the permissions + approvals contract blocks (shapes, token auth gate, enum 400s, replay-not-twice).
- **`npx tsc --noEmit` → clean (exit 0)** — re-confirmed on finalize across all touched server + web files.
- Full suite (run prior to finalize per the orchestrator handoff): 779 passed, with 1 pre-existing classifier flake (`src/chat-task-tracker.test.ts` "returns null when the classifier fails") that is unrelated to this plan and documented in deferred-items.md + 03-03-SUMMARY.
- `npm run build` succeeds (web build + tsc).

## Human Verification (Task 3 checkpoint — operator-approved 2026-06-24)

The blocking `checkpoint:human-verify` gate covered the live behavior the automated suite cannot reach (per the VALIDATION Manual-Only Verifications): the Settings mode dial persists across reload and toasts "Mode set to {Mode}.", the three locked Tier 4 rows stay locked with no control even when the dial is set to Autonomous (PERM-03), live-chat Tier 3/4 actions ask inline and run only on yes (D-04) with Tier 4 offered one-time-only (D-05), a background Tier 3 send surfaces under "Needs you" on Home and one-tap Approve replays it once with an audit row, and the fail-safe degrades to ask/queue rather than deny-all or allow-all. **The operator reviewed the live system and approved.**

## Threat Model Coverage

| Threat ID | Disposition | How addressed |
|-----------|-------------|---------------|
| T-03-tier4-ui | mitigate | LockedActionRow renders no control in any mode; the server-side resolveOutcome lock (plan 02) is the real enforcement; the approve route refuses to persist an Always for a Tier 4 tool (PERM-03/D-05). Live-verified at checkpoint (locked rows stay locked under Autonomous). |
| T-03-replay-exec | mitigate | replay-executor.ts allowlists MCP direct-call + tiny Bash/Write executor, rejects all else with a verbatim honest error stored in result; parses stored JSON, no eval/shell interpolation beyond the already-gated captured command (P-3). |
| T-03-replay-twice | mitigate | Status-guarded approve from plan 03 (L-3); contract test asserts a second approve does not replay (GREEN). |
| T-03-config-validate | mitigate | PUT /api/permissions enum-validates mode + override values, 400 on invalid (V5); change is audited via setMode/setOverride (D-11). |
| T-03-injection-selfapprove | mitigate | Approval decisions come from the operator over the token-authed dashboard or an explicit chat reply, not model output; the model can only request, never self-approve; inline resolver times out to deny. |
| T-03-SC | accept | No new packages — reuses Preact/lucide-preact/hono already present. |

## Issues Encountered

None during planned work. The full-suite classifier flake is a pre-existing environment issue (does not import any module changed by this plan) and is logged in deferred-items.md.

## User Setup Required

None new from this plan. (The 03-03 `npm run migrate` requirement before the next live restart still stands — see 03-03-SUMMARY.)

## Next Phase Readiness

- The permission trust chain front half is complete: rules (Permissions) → gated action → queued/approved. Phase 4 (Activity Feed) is the operator view of these outcomes and reads the same audit/approval event stream — ready to build on this.
- PERM-01/02/03/04 + D-04/D-05 are operator-usable end to end and live-verified.

## Self-Check: PASSED

- FOUND: src/replay-executor.ts, src/dashboard.ts, src/message-core.ts
- FOUND: web/src/components/AutonomyModeSelector.tsx, ActionOverrideRow.tsx, LockedActionRow.tsx, ApprovalItem.tsx
- FOUND commits: baeeea9 (Task 1), 526946f (Task 2), d59f9ff (docs)

---
*Phase: 03-permissions-autonomy*
*Completed: 2026-06-24*
