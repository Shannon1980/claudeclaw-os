---
phase: 03-permissions-autonomy
plan: 01
subsystem: permissions
tags: [tdd, red, permissions, gate, approval-queue, contract-tests]
requires: []
provides:
  - "src/gate.test.ts — RED contract for classifyTier + resolveOutcome matrix + Tier 4 lock + background-deny + audit"
  - "src/permissions-config.test.ts — RED contract for default-balanced mode + override round-trip"
  - "src/approval-queue.test.ts — RED contract for enqueue/list/approve/deny/expire + replay-once"
  - "src/agent.test.ts — RED gate-wiring assertion (no bypassPermissions, canUseTool present)"
  - "src/dashboard.contract.test.ts — RED route contracts for /api/permissions* and /api/approvals*"
affects:
  - "plans 03-02..03-04 (graded against these pinned tests)"
tech-stack:
  added: []
  patterns:
    - "Wave 0 RED tests: import not-yet-created modules so the suite fails before implementation"
    - "_initTestDatabase() in-memory SQLite for DB-backed tests"
    - "setAuditCallback spy to assert decision recording without a real audit_log write"
    - "Hono app.request(path + '?token=') contract-test helpers"
key-files:
  created:
    - src/gate.test.ts
    - src/permissions-config.test.ts
    - src/approval-queue.test.ts
  modified:
    - src/agent.test.ts
    - src/dashboard.contract.test.ts
decisions:
  - "Test names match the VALIDATION -t filters: classify, resolveOutcome mode matrix, override, tier4 locked, background queue deny, audit recorded, default balanced, approval-queue, gate wired"
  - "gate.ts pure-function signatures pinned: classifyTier(tool, input?), resolveOutcome(tier, mode, overrides), makeCanUseTool(ctx)"
  - "approval-queue API pinned: enqueueApproval({toolName, toolInput, tier, modeAtDecision, summary, runId}) -> id; listPending(); approve(id, result) -> bool; deny(id) -> bool; expireOlderThan(cutoff)"
  - "agent gate-wiring pinned via a buildAgentQueryOptions({gateCtx}) extraction asserting permissionMode==='default' + canUseTool function"
metrics:
  duration: ~5min
  completed: 2026-06-23
---

# Phase 3 Plan 01: Permission Contract RED Tests Summary

Authored the five failing TDD RED test files that pin the Phase 3 permission contract (four-tier classification, mode-resolution matrix, Tier 4 lock, approval-queue state machine, audit recording, and gate-wiring) as executable specifications before any implementation exists.

## What Was Built

Three new co-located unit test files and two extended test files, all running RED:

- **src/gate.test.ts** — pins `classifyTier` (money/sign/delete + destructive Bash -> Tier 4; read-only -> Tier 1; Write/Edit -> Tier 2; external send/post + unknown -> Tier 3 per D-03 safe default), the full `resolveOutcome` mode x tier (allow|ask) matrix (PERM-01), per-action overrides flipping Tier 2/3 (PERM-02), the Tier 4 lock that ignores both mode and override (PERM-03), `makeCanUseTool` background Tier 3 deny+enqueue (PERM-04), and one `permission` audit per decision carrying tool/tier/mode/outcome with no secret material (D-10).
- **src/permissions-config.test.ts** — pins getMode default-balanced (D-11), set/get mode round-trip, setOverride/getOverrides round-trip, and malformed-JSON fallback to `{}` without throwing.
- **src/approval-queue.test.ts** — pins the enqueue -> pending -> approve/deny/expire state machine, the L-3 replay-once guard (second approve is a no-op returning false), tool_input round-trip (D-08), and no secret material in rows.
- **src/agent.test.ts** (extended) — adds a "gate wired" test asserting `buildAgentQueryOptions({gateCtx}).permissionMode === 'default'` (not `bypassPermissions`), no `allowDangerouslySkipPermissions`, and `canUseTool` is a function (T-03-01).
- **src/dashboard.contract.test.ts** (extended) — adds permissions + approvals API contract blocks: GET/PUT `/api/permissions` shape + auth gate + enum validation (V5), GET `/api/approvals` shape, approve/deny with the second-approve-not-replayed invariant (L-3 / T-replay-twice).

## How It Was Verified

- `npx vitest run src/gate.test.ts src/permissions-config.test.ts src/approval-queue.test.ts src/agent.test.ts src/dashboard.contract.test.ts` -> 5 files failed, 10 tests failed / 91 passed. The 91 passing are pre-existing contract/agent tests untouched by this plan; the 10 failures are the new RED specs.
- gate / permissions-config / approval-queue files fail with `Failed to load url ./gate.js / ./permissions-config.js / ./approval-queue.js` (intended missing-module RED).
- The agent "gate wired" test fails with `expected 'undefined' to be 'function'` (buildAgentQueryOptions not yet exported) — RED for the right reason, not a syntax error.
- The approvals/permissions contract tests fail with 404 (routes not mounted) and missing-module load errors — RED for the right reason.
- Confirmed `src/gate.ts`, `src/permissions-config.ts`, `src/approval-queue.ts` do NOT exist — no source module was created this plan.

## Deviations from Plan

None - plan executed exactly as written.

## Threat Model Coverage

All four `mitigate` threats now have a failing pinning test:
- T-03-01 (gate-wiring bypass) -> agent.test "gate wired"
- T-03-02 (Tier 4 lock) -> gate.test "tier4 locked"
- T-03-03 (replay-once) -> approval-queue.test + dashboard.contract "approve...does NOT replay"
- T-03-04 (secret disclosure) -> gate.test "never writes secret/env material" + approval-queue.test "does not write env/secret material"

## Self-Check: PASSED

- FOUND: src/gate.test.ts
- FOUND: src/permissions-config.test.ts
- FOUND: src/approval-queue.test.ts
- FOUND: src/agent.test.ts (modified)
- FOUND: src/dashboard.contract.test.ts (modified)
- FOUND commit 9867055 (gate.test.ts)
- FOUND commit d2f306b (config + queue tests)
- FOUND commit dcd58ad (contract + agent gate-wiring)
