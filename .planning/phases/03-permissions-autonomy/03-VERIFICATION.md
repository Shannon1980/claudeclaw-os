---
phase: 03-permissions-autonomy
verified: 2026-06-24T00:00:00Z
status: gaps_found
score: 2/4 must-haves verified
overrides_applied: 0
gaps:
  - truth: "A gated action is fully prepared and queued as a Needs you item for one-tap approval (PERM-04)"
    status: failed
    reason: "CR-01: The approve route (dashboard.ts:3526) calls replayApproval() BEFORE the status-guarded approve() at line 3530. Two concurrent approve requests (double-click, scheduler poll racing a UI click) both pass the listPending() check while the row is still pending, both execute the side-effectful replay (email sent twice, invoice paid twice), and only one wins the UPDATE WHERE status='pending' guard. The status guard protects the DB row state but NOT the side effect. The comment at lines 3510-3513 asserts the second caller 'finds no pending row' — but both callers found it pending on the SAME listPending() check before either replay ran. This is exactly the double-execution the phase set out to prevent (D-08, L-3)."
    artifacts:
      - path: "src/dashboard.ts"
        issue: "replayApproval() called before status-guarded approve() at lines 3514-3535; concurrent approvals both replay before either wins the guard"
      - path: "src/approval-queue.ts"
        issue: "approve() status guard is correct (UPDATE WHERE status='pending') but is positioned AFTER the side-effectful replay call in the route handler"
    missing:
      - "Add claimForReplay(id) that does UPDATE ... SET status='replaying' WHERE id=? AND status='pending' and returns changes===1; only the winner calls replayApproval(); loser returns {ok:false, error:'already decided or in progress'}"
      - "Alternative: serialize approve handling through the existing messageQueue keyed on approval id"

  - truth: "A user can override individual actions between Always and Ask first (PERM-02)"
    status: failed
    reason: "WR-01 confirmed in code: Settings.tsx OVERRIDE_ROWS (line 484-490) exposes keys 'prepare', 'draft', 'send', 'book', 'post'. Gate's TIER_CAPABILITY (gate.ts:100-105) only reads 'prepare' (T1), 'save' (T2), 'send' (T3), 'send-money' (T4) via capabilityForTier(). The keys 'draft', 'book', and 'post' are never read by resolveOutcome — toggling them has zero effect on gate behavior. Additionally, setting the single 'send' override to 'always' silently enables ALL Tier-3 actions (send email, post publicly, book meetings) at once, contradicting the per-action mental model the UI presents. The UI promises granular control; the gate delivers only one Tier-3 switch. This is a correctness defect in a security UI."
    artifacts:
      - path: "web/src/pages/Settings.tsx"
        issue: "OVERRIDE_ROWS at line 484-490 includes keys 'draft', 'book', 'post' that gate.ts never reads; operator believes they toggled individual actions when the gate ignores these keys"
      - path: "src/gate.ts"
        issue: "capabilityForTier() at lines 100-109 maps only 4 keys: prepare/save/send/send-money; resolveOutcome at line 125 reads only the key for the action's tier, ignoring the 3 UI-only keys"
    missing:
      - "Either collapse the Tier-3 UI rows into the single 'send' capability the gate honors (and relabel accordingly), OR extend gate.ts to support per-action sub-capabilities so 'book', 'post', and 'draft' emit distinct gate keys"
      - "Add a known-capability allowlist to PUT /api/permissions so unknown keys ('draft', 'book', 'post') return 400 instead of silently persisting as misleading stored config"
---

# Phase 3: Permissions & Autonomy Verification Report

**Phase Goal:** An operator can set how much the team may do on its own through a single autonomy dial backed by the four-tier reversibility model, and every external action is checked against it before it runs.
**Verified:** 2026-06-24
**Status:** gaps_found — 2 blockers
**Re-verification:** No (initial verification)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A user can set a global autonomy mode (Cautious/Balanced/Autonomous) and it changes what the team does unprompted (PERM-01) | VERIFIED | `src/gate.ts` TIER_DEFAULT matrix (lines 93-97) encodes cautious=T1 auto, balanced=T1+2 auto, autonomous=T1+2+3 auto, T4 always ask. `src/permissions-config.ts` getMode()/setMode() backed by dashboard_settings. `src/agent.ts` buildAgentQueryOptions() (line 203) spreads permissionMode:'default' + canUseTool gate into every query() call; bypassPermissions removed (only a doc comment reference at line 305). `web/src/components/AutonomyModeSelector.tsx` presents three-card dial; selection PUTs /api/permissions and toasts "Mode set to {Mode}." Mode persists via setDashboardSetting. |
| 2 | A user can override individual actions between Always and Ask first (PERM-02) | FAILED | Settings.tsx exposes 5 rows (prepare/draft/send/book/post). Gate's capabilityForTier() maps only 4 keys (prepare/save/send/send-money). Keys 'draft', 'book', 'post' are never consulted by resolveOutcome. Toggling "Book meetings" or "Post publicly" or "Draft messages" in the UI has no behavioral effect on the gate. Single 'send' override enables all Tier-3 simultaneously. Granular control promised is not delivered. |
| 3 | Irreversible actions (send money, sign, delete) are visibly locked to Ask-first and cannot be set to Always in any mode (PERM-03, D4) | VERIFIED | `gate.ts:124` — `if (tier === 4) return 'ask'` is the first branch in resolveOutcome, before any mode or override check. `dashboard.ts:3438` sets LOCKED_CAPABILITY='send-money' and `dashboard.ts:3472-3474` rejects PUT with {cap='send-money', value='always'} with 400. UI: LockedActionRow renders three non-interactive rows (send money / sign / permanently delete) with Lock icon and static "Always ask" Pill, no control rendered. All three enforcement layers (gate, API route, UI) independently enforce the lock. |
| 4 | A gated action is fully prepared and queued as a "Needs you" item for one-tap approval (PERM-04) | FAILED | The queue, UI surface, and approval flow exist and are wired — ApprovalItem on Home, /api/approvals routes, approval-queue.ts state machine — but the replay-once guarantee that PERM-04's "exact replay" promise depends on is broken. CR-01 (dashboard.ts:3519-3530): replayApproval() runs before the status-guarded approve() UPDATE; two concurrent approve requests both find the row pending, both replay the side-effectful action, then only one wins the status guard. The comment at lines 3510-3513 asserts safety that does not hold. For a feature whose explicit security property is "run the captured action exactly once," this defeats the guarantee. |

**Score:** 2/4 truths verified

### Deferred Items

None. All four truths were verifiable against existing code.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/gate.ts` | classifyTier + resolveOutcome + makeCanUseTool gate | VERIFIED | Exists, substantive, wired via buildAgentQueryOptions in agent.ts. Tier 4 lock at line 124 is unconditional. |
| `src/permissions-config.ts` | getMode/setMode/getOverrides/setOverride | VERIFIED | Exists, substantive. Backed by dashboard_settings k/v. Default 'balanced' on null (line 34). |
| `src/approval-queue.ts` | enqueueApproval/listPending/approve/deny/expireOlderThan | VERIFIED | Exists, substantive. approve() and deny() are status-guarded (UPDATE WHERE status='pending'). The guard is correct in isolation; the bug is in the route handler sequencing. |
| `src/replay-executor.ts` | Allowlisted replay executor for approve path | STUB/WARNING | Exists. Dispatches on tool name (Write, Bash, mcp__). Bash path runs stored command string verbatim through /bin/sh -c. No HMAC/integrity binding between stored tool_input and the gate decision (CR-02). tool_input column is editable plain TEXT. |
| `src/agent.ts` buildAgentQueryOptions | Gate wired, bypassPermissions removed | VERIFIED | permissionMode:'default' + canUseTool present; bypassPermissions and allowDangerouslySkipPermissions removed from live code (line 305 reference is a comment only). |
| `src/dashboard.ts` | /api/permissions GET/PUT + /api/approvals GET + approve/deny | PARTIAL | Routes exist, auth-gated, enum-validated. Approve route has the CR-01 race. |
| `web/src/pages/Settings.tsx` PermissionsSection | Mode dial + override list + locked rows | PARTIAL | Exists, rendered, wired to /api/permissions. Override rows include 3 dead keys ('draft', 'book', 'post') the gate never reads. |
| `web/src/components/ApprovalItem.tsx` | One-tap approve/deny row | VERIFIED | Exists, rendered in NeedsYouCard via DailyLoop.tsx:65-66. Approve POSTs /api/approvals/:id/approve; honest replay-failure line shown on error. Tier 4 deny behind ConfirmModal. |
| `web/src/components/AutonomyModeSelector.tsx` | Three-card mode dial | VERIFIED | Exists. Three radio cards, Balanced "Recommended" Pill, selection fires PUT /api/permissions and pushToast. |
| `web/src/components/LockedActionRow.tsx` | Non-interactive locked rows with lock icon | VERIFIED | Exists. No control rendered. Lock icon (muted). Static "Always ask" Pill. Three rows in Settings. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `agent.ts runAgent` | `gate.ts makeCanUseTool` | buildAgentQueryOptions spreads canUseTool | WIRED | Confirmed at agent.ts:308. gateCtx defaults to safeBackgroundGateCtx() (attended:false, enqueue:gateEnqueue). |
| `message-core.ts processUserMessage` | `gate.ts makeCanUseTool` | attended GateContext with requestInline | WIRED | message-core.ts:500 passes {attended:true, agentId, chatId, requestInline: makeRequestInline(cb)}. resolveInlineAsk() called at line 258 intercepts the next message. |
| `web Settings.tsx PermissionsSection` | `/api/permissions` | apiPut GET/PUT | WIRED | save() calls apiPut('/api/permissions', {mode, overrides}); data fetched via useFetch('/api/permissions'). |
| `web ApprovalItem.tsx` | `/api/approvals/:id/approve` | apiPost on Approve click | WIRED | ApprovalItem.tsx:49 calls apiPost('/api/approvals/${approval.id}/approve'). |
| `web Home.tsx` | `/api/approvals` | useFetch polled every 15s | WIRED | Home.tsx:58 — useFetch<{approvals:Approval[]}>('/api/approvals', 15_000); passed to NeedsYouCard at line 170. |
| `Settings.tsx override key 'draft'` | `gate.ts resolveOutcome` | capabilityForTier() | NOT_WIRED | gate.ts TIER_CAPABILITY has no 'draft' key; resolveOutcome reads only 'prepare'/'save'/'send'/'send-money'. |
| `Settings.tsx override key 'book'` | `gate.ts resolveOutcome` | capabilityForTier() | NOT_WIRED | Same: 'book' is never a key gate reads. |
| `Settings.tsx override key 'post'` | `gate.ts resolveOutcome` | capabilityForTier() | NOT_WIRED | Same: 'post' is never a key gate reads. |
| `approval-queue.ts approve()` | `dashboard.ts /api/approvals/:id/approve` | status guard before replay | NOT_WIRED (race) | approve() guard is correct but positioned AFTER replayApproval() in the route; two concurrent requests both replay before either wins the guard. |
| `gate.ts routineAutonomy field` | `gate.ts makeCanUseTool resolveOutcome` | consumed in resolution | NOT_WIRED | routineAutonomy is set by routine-runner.ts:104 and is present in GateContext:153, but makeCanUseTool and resolveOutcome never read it. The D-06 behavioral distinction (unattended vs queue_approval) is dead code. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `PermissionsSection` (Settings.tsx) | `perms.data` | useFetch('/api/permissions') → GET /api/permissions → getMode()+getOverrides() → dashboard_settings SQLite | Yes — live DB reads | FLOWING |
| `NeedsYouCard` (Home.tsx via DailyLoop) | `pendingApprovals` | useFetch('/api/approvals') → GET /api/approvals → listPending() → approval_queue SQLite | Yes — live DB reads | FLOWING |
| `AutonomyModeSelector` | `value` prop | mode from perms.data fetched above | Yes — propagated from fetch | FLOWING |
| `ActionOverrideRow` (keys 'book','post','draft') | `overrides[row.key]` | overrides from perms.data | Data flows to UI but the stored/displayed value is never read by the gate | HOLLOW_PROP (gate side) |

### Behavioral Spot-Checks

Step 7b skipped for UI-dependent behaviors; no runnable entry point available in worktree (no built dist/, no running service). The critical behavioral guarantees were verified by code reading and are reported above.

### Probe Execution

No probes declared in PLAN frontmatter or found in scripts/. Step 7c: SKIPPED (no probe files).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PERM-01 | 03-01, 03-02, 03-03, 03-04 | Global autonomy mode dial | SATISFIED | gate.ts mode matrix + permissions-config + AutonomyModeSelector + /api/permissions all verified |
| PERM-02 | 03-01, 03-02, 03-04 | Per-action override between Always and Ask first | BLOCKED | 3 of 5 Settings rows ('draft','book','post') write keys the gate never reads; single 'send' key enables all Tier-3 simultaneously |
| PERM-03 | 03-01, 03-02, 03-04 | Irreversible actions locked to Ask-first in every mode | SATISFIED | gate.ts:124 unconditional T4 lock + API 400 + UI non-interactive rows all verified |
| PERM-04 | 03-01, 03-03, 03-04 | Gated action queued as Needs you for one-tap approval | BLOCKED | Queue, surface, and one-tap UI exist; but CR-01 race in dashboard.ts approve route allows double-replay before status guard fires |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/dashboard.ts` | 3519-3530 | replayApproval() called before status-guarded approve() | BLOCKER | Two concurrent approvals both replay the side-effectful action; only one wins the DB guard. Comment at 3510-3513 incorrectly asserts safety. For a security gate whose entire purpose is replay-once, this defeats the guarantee. |
| `web/src/pages/Settings.tsx` | 486, 488, 489 | OVERRIDE_ROWS keys 'draft', 'book', 'post' not read by gate | BLOCKER | Operator believes they have fine-tuned per-action behavior; the gate ignores 3 of 5 capability keys. Setting 'book' to Always has no effect. Setting 'send' to Always silently enables all Tier-3 action. Security UI correctness defect. |
| `src/replay-executor.ts` | 99 | Bash replay via spawn('/bin/sh', ['-c', command]) with no HMAC binding | WARNING | tool_input is a plain TEXT column; no integrity binding between stored command and the gate decision. A holder of the dashboard token can edit tool_input before approval and replay an arbitrary command. Combined with gate's Tier-3 default for unknown Bash, this is a meaningful injection surface. Not a showstopper alone but amplifies the CR-01 race. |
| `src/gate.ts` | 49, 84 | TIER1_MCP includes /draft/i tested before TIER3_PATTERNS | WARNING | Tool names containing 'draft' (e.g. mcp__gmail__send-draft) classify as Tier 1 (silent auto-run) in every mode. A tool that actually sends a draft would bypass the gate in Balanced/Autonomous. |
| `src/gate.ts` | 153 | routineAutonomy field declared but never consumed in makeCanUseTool | WARNING | D-06 distinction (unattended vs queue_approval) is documented and threaded from routine-runner.ts but resolveOutcome/makeCanUseTool never read it. A routine marked queue_approval behaves identically to unattended. The code comments imply an enforced guarantee that does not exist. |
| `src/warroom-text-orchestrator.ts` | 545, 546, 633, 634 | permissionMode:'bypassPermissions' + allowDangerouslySkipPermissions:true | WARNING | Out of scope per CONTEXT.md deferred list and review IN-04. Acknowledged but represents a real residual hole: agents invoked through war-room text paths are ungated. The phase goal states "every external action is checked against it before it runs" — this is not true for these paths. |
| `src/warroom-text-router.ts` | 227-228, 318-319 | permissionMode:'bypassPermissions' + allowDangerouslySkipPermissions:true | WARNING | Same as above. |
| `src/agent-voice-bridge.ts` | 161-162 | permissionMode:'bypassPermissions' + allowDangerouslySkipPermissions:true | WARNING | Same residual hole. Voice path fully bypasses gate. |
| `src/memory-ingest.ts` | 67-68 | permissionMode:'bypassPermissions' + allowDangerouslySkipPermissions:true | WARNING | Same residual hole. Memory ingest path fully bypasses gate. |

### Human Verification Required

The human-verify checkpoint (Task 3, plan 03-04) was completed and operator-approved on 2026-06-24 per the SUMMARY.md. That covers live end-to-end behavior (dial persists, locked rows stay locked in Autonomous, inline ask, queue approve/deny, fail-safe). No additional human verification items are added by this automated verification beyond the gaps above, which require code fixes.

### Gaps Summary

**Gap 1 — CR-01: Replay-before-claim race in approve route (PERM-04 BLOCKER)**

`src/dashboard.ts:3514-3535`: the approve handler calls `replayApproval(pending.tool_name, pending.tool_input)` at line 3526 and only then calls the status-guarded `approve(id, replay.message)` at line 3530. The `listPending().find()` check at line 3519 is not atomic with either the replay or the status guard. Two concurrent HTTP requests — a double-click from the operator, a scheduler poll racing a UI click — both see the row as `pending` on the `find()`, both call `replayApproval`, and the tool action executes twice. The `approve()` UPDATE only guards the DB row state, not the side effect. The module comment and the route comment both assert replay-once semantics that the sequencing does not deliver.

Fix: perform an atomic `UPDATE ... SET status='replaying' WHERE id=? AND status='pending'` (returning `changes===1`) before calling `replayApproval`; only the winning caller proceeds to replay. Alternatively serialize through the existing `messageQueue`.

**Gap 2 — WR-01: Per-action override UI keys unread by gate (PERM-02 BLOCKER)**

`web/src/pages/Settings.tsx` OVERRIDE_ROWS includes keys `'draft'`, `'book'`, and `'post'`. `gate.ts` `TIER_CAPABILITY` maps only `'prepare'` (T1), `'save'` (T2), `'send'` (T3), `'send-money'` (T4). `resolveOutcome()` calls `capabilityForTier(tier)` and looks up exactly that key in the overrides object. The keys `'draft'`, `'book'`, and `'post'` can never be returned by `capabilityForTier()`; toggling them stores data but produces no behavioral change in the gate.

Additionally, a `'send': 'always'` override silently enables all Tier-3 actions simultaneously (send email, post publicly, book meetings with external attendees), because all three actions classify as Tier 3 and resolve through the single `'send'` capability key. The UI presents this as three separate, independently controllable actions, which it is not.

Fix option A: remove the dead rows from Settings, relabel the three Tier-3 rows as a single "Send, post, and book" row mapped to `'send'`, and explain in the UI copy that this controls all Tier-3 actions together.

Fix option B: extend the gate to emit per-action capability keys (e.g. `mcp__calendar__*` → `'book'`, `mcp__twitter__*` → `'post'`) and widen `TIER_CAPABILITY` to a two-level lookup. This is the fuller fix but requires classifyTier to emit finer-grained keys.

Either way, add a known-capability allowlist to `PUT /api/permissions` so unknown keys return 400 instead of persisting silently.

**Residual PERM-01 hole (WARNING, acknowledged out-of-scope)**

Four agent invocation paths still use `permissionMode:'bypassPermissions'` and `allowDangerouslySkipPermissions:true`: `src/warroom-text-orchestrator.ts` (lines 545-546, 633-634), `src/warroom-text-router.ts` (lines 227-228, 318-319), `src/agent-voice-bridge.ts` (lines 161-162), `src/memory-ingest.ts` (lines 67-68). Per CONTEXT.md deferred list and REVIEW.md IN-04, these are declared out of scope. They are noted here because the phase goal states "every external action is checked against it before it runs" and these paths are not. A future phase should route every `query()` call site through `buildAgentQueryOptions` and add a lint/CI rule that greps for `bypassPermissions` in new code.

---

## Verdict

The phase delivered real, working infrastructure: a correctly locked Tier-4 gate, a functioning autonomy mode dial backed by a real gate, a queued approval surface on Home, and an attended inline-ask mechanism. These are genuinely non-trivial security contributions.

However, two must-haves fail on code evidence:

- **PERM-04 (Needs you one-tap approval)**: The replay-once guarantee — the core security property of the approval queue — is defeated by a race condition in the approve route. The status guard protects the database row but not the side-effecting replay call. This is CR-01 and is a blocker.
- **PERM-02 (per-action override)**: Three of the five override rows in the Settings UI write capability keys the gate never reads. The operator cannot actually fine-tune by individual action as the UI promises; toggling "Book meetings" to Always does nothing, while toggling "Send emails" simultaneously enables booking and posting. This is WR-01 and is a blocker.

Both gaps are fixable without architectural changes. The replay-once fix is a small transactional restructuring of the approve route. The override-key mismatch is a naming alignment between the UI rows and the gate's capability model.

**Status: gaps_found. Do not proceed to Phase 4 until CR-01 and WR-01 are resolved.**

---

_Verified: 2026-06-24_
_Verifier: Claude (gsd-verifier)_
