---
phase: 03-permissions-autonomy
plan: 03
subsystem: permissions-enforcement
tags: [permissions, autonomy, gate, approval-queue, canUseTool, migration, tdd-green]
requires: [03-01, 03-02]
provides:
  - "approval_queue table (dual-write: db.ts createSchema + migration v1.2.3)"
  - "approval-queue.ts: enqueueApproval/listPending/approve/deny/expireOlderThan + gateEnqueue adapter (status-guarded replay-once, L-3)"
  - "agent.ts buildAgentQueryOptions({gateCtx}) — permissionMode:'default' + canUseTool, NO bypass"
  - "runAgent/runAgentWithRetry trailing gateCtx with safe-background default (P-5)"
  - "GateContext threaded through scheduler (scheduled/mission/aos-cron), routine-runner step seam (D-06), orchestrator delegateToAgent, bot/slack-bot/routine-draft/message-core"
affects:
  - "03-04 (/api/permissions + /api/approvals routes consume approval-queue CRUD + listPending; attended chat requestInline replaces the background-safe ctx at the live chat call sites)"
tech-stack:
  added: []
  patterns:
    - "Exported query-options builder (buildAgentQueryOptions) so the no-bypass + canUseTool contract is unit-pinned"
    - "Safe-default gate context: any omitted gateCtx → background ask/queue, never silent-allow (P-5)"
    - "Enqueue adapter (gateEnqueue) bridges the gate's call shape to approval-queue's named-field API without leaking params into the summary (L-4)"
    - "Dual-write schema (createSchema + versioned migration) to keep the in-memory test DB and the live store in lock-step (P-4)"
key-files:
  created:
    - src/approval-queue.ts
    - migrations/v1.2.3/create-approval-queue.ts
  modified:
    - src/db.ts
    - migrations/version.json
    - src/agent.ts
    - src/scheduler.ts
    - src/orchestrator.ts
    - src/routine-runner.ts
    - src/bot.ts
    - src/slack-bot.ts
    - src/routine-draft.ts
    - src/message-core.ts
decisions:
  - "Added getDb() accessor to db.ts so sibling-module CRUD (approval-queue.ts) shares the single better-sqlite3 connection (serialization + test-DB swap) instead of importing the private db binding"
  - "gateEnqueue adapter maps the gate's {input,mode} field names to enqueueApproval's {toolInput,modeAtDecision} and derives the summary from summarize(tool,tier) — never the raw params (L-4)"
  - "message-core.ts (not in the plan's files_modified list) was wired too: it is the live operator chat entrypoint and the most important path to gate; passes a background-safe ctx until plan 04 supplies requestInline"
  - "Migration AUTHORED + validated on a throwaway DB only — NOT applied to the symlinked live store/ (operator runs `npm run migrate` before restart, L-6)"
metrics:
  duration: ~25min
  completed: 2026-06-23
---

# Phase 3 Plan 03: Approval Queue + Gate Wiring Summary

Slice B — the persistent approval queue plus the single most dangerous change in the phase: replacing `permissionMode:'bypassPermissions'` in `src/agent.ts` with a real `canUseTool` gate and threading a `GateContext` through every caller. The gate now fires on EVERY live run (chat / scheduler / mission / routine step); background "ask" outcomes enqueue a pending `approval_queue` row and deny immediately so the subprocess never blocks; any omitted context defaults to a safe background (ask/queue) context, never silent-allow. Made `src/approval-queue.test.ts` (7) and the `agent.test.ts "gate wired"` test GREEN without weakening either; the prior `gate.test.ts` (27) + `permissions-config.test.ts` (5) suites still pass.

## What Was Built

**Task 1 — approval_queue table (dual-write) + approval-queue.ts CRUD (commit 793c30b)**
- `src/db.ts`: added the `approval_queue` CREATE TABLE (id, agent_id, chat_id, run_id, routine_id, tool_name, tool_input JSON, tier, mode_at_decision, summary, status default 'pending', decided_at, result, created_at) + `idx_approval_pending` and `idx_approval_agent` indices, placed next to `audit_log` in `createSchema` so `_initTestDatabase()` builds it (P-4). Added an exported `getDb()` accessor.
- `migrations/v1.2.3/create-approval-queue.ts`: mirrors the `v1.2.2/add-routine-tables.ts` structure (own better-sqlite3 handle from `process.cwd()/store/claudeclaw.db`, idempotent `CREATE TABLE/INDEX IF NOT EXISTS`, try/finally `db.close()`, exported `description` + `run()`). Registered `"v1.2.3": ["create-approval-queue"]` in `migrations/version.json` (L-6).
- `src/approval-queue.ts`: `enqueueApproval` (insert pending, return id; stores ONLY model-supplied params as JSON, `.slice` capped, never env/secrets — L-4/V8), `listPending` (hydrates tool_input via defensive `JSON.parse`, never eval — V5), `approve(id, result)`, `deny(id)`, `expireOlderThan(cutoff)`. approve/deny use `UPDATE ... WHERE id=? AND status='pending'` and return `info.changes === 1`, so a second approve / poll race is a no-op (L-3 replay-once).

**Task 2 — canUseTool wired into agent.ts (bypass dropped) + GateContext threaded (commit 05923cd)**
- `src/agent.ts`: removed BOTH `permissionMode:'bypassPermissions'` and `allowDangerouslySkipPermissions:true` (P-1, T-03-bypass-noop). Added exported `buildAgentQueryOptions({gateCtx})` → `{ permissionMode:'default', canUseTool: makeCanUseTool(ctx) }`, spread into the single `query()` options. Appended a trailing optional `gateCtx?: GateContext` to `runAgent` and `runAgentWithRetry` (forwarded). `safeBackgroundGateCtx()` returns `{ attended:false, enqueue: gateEnqueue }` so any omitted/partial context fails to ask/queue, never silent-allow (P-5). `requireEnabled('LLM_SPAWN_ENABLED')` + `getScrubbedSdkEnv` unchanged (L-4).
- `src/approval-queue.ts`: added the `gateEnqueue` adapter that satisfies `GateContext.enqueue`'s signature (`{toolName,input,tier,mode,...}`) and maps onto `enqueueApproval`, deriving the summary from `summarize(tool,tier)` (no params, L-4).
- `src/scheduler.ts`: background `gateCtx` for the aos-cron injected lambda (closure captures `aosGateCtx` and forwards it as the trailing arg), the user-scheduled task, and the mission path (both the `delegateToAgent` and direct `runAgent` branches). All `attended:false` with `runId`/`agentId`/`chatId`; stay inside `messageQueue.enqueue`. Background ask = enqueue + immediate deny (P-2).
- `src/routine-runner.ts`: builds `stepGateCtx` = `{ attended:false, routineId: task.id, routineAutonomy: task.autonomy, chatId, runId }` and threads it through every `deps.delegateToAgent` step call, so each routine step enters the gate carrying its stored autonomy (D-06).
- `src/orchestrator.ts`: `delegateToAgent` gains a trailing optional `gateCtx?: GateContext` forwarded to `runAgentWithRetry`.
- `src/bot.ts` (×2: session-summary + dashboard chat), `src/slack-bot.ts` (session-summary), `src/routine-draft.ts` (draft assemble), `src/message-core.ts` (live chat entrypoint): each passes an explicit background-safe `gateCtx`, with a code comment noting plan 04 supplies `requestInline` for the attended chat path. No module-global gate state — context travels per call.

## Migration Application Status

The `approval_queue` migration was **AUTHORED and VALIDATED on a throwaway DB only — it was NOT run against the live symlinked `store/claudeclaw.db`.** The store/ directory is symlinked from the main checkout, so `npm run migrate` would mutate the real operator database; per the plan's migration note I avoided that. I confirmed the DDL is additive + idempotent (re-running `CREATE TABLE/INDEX IF NOT EXISTS` is a no-op; all 14 columns present) against a temp copy. **Operator action required before the next service restart: run `npm run migrate` from the main checkout** so the live store gains `approval_queue` (the in-memory test DB already builds it via `createSchema`). Skipping this is the L-6 crash-loop trap.

## Verification

- `npx vitest run src/gate.test.ts src/approval-queue.test.ts src/agent.test.ts src/permissions-config.test.ts` → **47 passed (27+7+8+5)**, GREEN.
- `grep` confirms `bypassPermissions` / `allowDangerouslySkipPermissions` are absent from `src/agent.ts` (only a doc comment mentions they are GONE) and `makeCanUseTool(` is present; `migrations/version.json` contains `v1.2.3`.
- `npx tsc --noEmit` clean for all touched source files (agent, scheduler, orchestrator, routine-runner, routine-draft, bot, slack-bot, message-core, approval-queue, db).
- Migration DDL idempotency validated against a temp DB (not the live store).

## Deviations from Plan

### Auto-fixed / completeness additions

**1. [Rule 2 — missing critical wiring] Added getDb() accessor to db.ts**
- **Found during:** Task 1. The plan put the CRUD in a separate `src/approval-queue.ts`, but the `db` handle in `db.ts` is module-private and there was no accessor.
- **Fix:** Exported `getDb()` so approval-queue.ts shares the single connection (preserving SQLite write serialization and the `_initTestDatabase` swap) instead of opening a second handle or importing a private binding.
- **Commit:** 793c30b

**2. [Rule 2 — missing critical wiring] gateEnqueue adapter**
- **Found during:** Task 2 typecheck. `GateContext.enqueue` expects `{toolName,input,tier,mode,...}` but `enqueueApproval` takes `{toolName,toolInput,tier,modeAtDecision,summary,...}`. Without an adapter the background enqueue path would not type-check / would lose the summary.
- **Fix:** Added `gateEnqueue` in approval-queue.ts mapping the gate's shape onto enqueueApproval and deriving the summary from `summarize(tool,tier)` (no raw params, L-4).
- **Commit:** 05923cd

**3. [Rule 2 — completeness] Wired message-core.ts (outside the plan's files_modified list)**
- **Reason:** message-core.ts:407 is the live operator chat entrypoint — the single most important path to gate. The plan's read_first named it as a "remaining caller". It now passes an explicit background-safe ctx (plan 04 swaps in `requestInline`). This is the only file touched that was not in the plan frontmatter.
- **Commit:** 05923cd

## Out-of-Scope Test Failures (NOT regressions from this plan)

`npx vitest run` (full suite) reports 13 failures across 3 files. None are caused by 03-03 — verified none of these test files import the modules I changed in a way that 03-03 broke, and all were failing for the same reasons before this plan:

- **`src/dashboard.contract.test.ts` (9):** 4 `permissions API contract` + 3 `approvals API contract` tests exercise `/api/permissions` and `/api/approvals` HTTP routes that are built in **plan 03-04** — they are RED route contracts authored in the 03-01 RED commit (dcd58ad). The `enqueueApproval` import in those tests now RESOLVES (my module exists), but the routes 401/404 until 03-04. Plus 2 "serves SPA shell at /" + "/warroom" tests need a built SPA `dist/` not present in the worktree. The other 84 contract tests pass.
- **`src/chat-task-tracker.test.ts` (1):** "returns null when the classifier fails" depends on the Claude/Gemini classifier fallback returning null in tests; in this environment the fallback produced a task id. Does not import gate/agent/approval-queue. Pre-existing environment flake.
- **`src/schedule-cli.test.ts` (3):** all fail with `Cannot find module dist/schedule-cli.js` — the worktree has no compiled `dist/` build. Pre-existing infra, unrelated to source changes.

## Threat Model Coverage

| Threat ID | Disposition | How addressed |
|-----------|-------------|---------------|
| T-03-bypass-noop | mitigate | Both bypass lines removed from agent.ts; `agent.test "gate wired"` asserts `permissionMode==='default'`, no `allowDangerouslySkipPermissions`, `canUseTool` present. |
| T-03-replay-twice | mitigate | approve/deny `UPDATE ... WHERE status='pending'` + `.changes===1`; replay-once test GREEN. |
| T-03-missed-caller | mitigate | `safeBackgroundGateCtx()` default + partial-ctx enqueue backfill → omitted context routes to ask/queue (P-5). |
| T-03-block-subprocess | mitigate | Background "ask" enqueues + denies immediately; scheduler/mission/routine ctx all `attended:false` (P-2). |
| T-03-env-leak | mitigate | tool_input stores only model params; gateEnqueue summary = tool+tier; getScrubbedSdkEnv unchanged (L-4/V8). |
| T-03-migration | mitigate | Dual-write (createSchema + v1.2.3 registered in version.json); idempotent additive DDL. Operator must run `npm run migrate` before restart (L-6). |
| T-03-SC | accept | No package installs. |

## Self-Check: PASSED

- FOUND: src/approval-queue.ts, migrations/v1.2.3/create-approval-queue.ts, 03-03-SUMMARY.md
- FOUND commits: 793c30b (task 1), 05923cd (task 2)
