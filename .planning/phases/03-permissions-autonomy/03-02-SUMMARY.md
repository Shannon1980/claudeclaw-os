---
phase: 03-permissions-autonomy
plan: 02
subsystem: permissions-gate
tags: [permissions, autonomy, gate, audit, kill-switch, tdd-green]
requires: [03-01]
provides:
  - "classifyTier / resolveOutcome / capabilityForTier / summarize (pure policy engine)"
  - "makeCanUseTool factory (SDK CanUseTool callback with audit + fail-safe)"
  - "permissions-config: getMode/setMode/getOverrides/setOverride over dashboard_settings"
  - "'permission' AuditAction member"
  - "PERMISSION_GATE_ENABLED kill switch (default ENABLED)"
affects:
  - "03-03 (gate wiring into agent.ts query() will consume makeCanUseTool + GateContext)"
  - "03-03 (approval-queue.ts supplies the real ctx.enqueue)"
tech-stack:
  added: []
  patterns:
    - "Per-turn gate context factory (no module globals) for multi-agent concurrency"
    - "Fail-safe-usable degradation: throw or kill-switch-off → Tier 3 ask, never deny-all/allow-all"
    - "Tier-4-first lock precedes mode/override branch"
key-files:
  created:
    - src/gate.ts
    - src/permissions-config.ts
  modified:
    - src/security.ts
    - src/kill-switches.ts
decisions:
  - "Override capability keys: prepare(1)/save(2)/send(3)/send-money(4) — matches gate.test.ts override probes"
  - "GateContext.mode/overrides optional; fall back to getMode()/getOverrides() when absent so live callers need not pre-resolve"
  - "Audit detail key is `tool` (not `toolName`) to match the RED test contract"
metrics:
  duration: ~6min
  completed: 2026-06-23
---

# Phase 3 Plan 02: Permission Gate Engine Core Summary

Pure-logic permission engine: tier classification (money/sign/delete + destructive Bash → Tier 4, unknown → Tier 3), the mode×tier resolution matrix with per-capability overrides and a non-overridable Tier 4 lock, and a per-turn `makeCanUseTool` factory that audits every decision and fails to the safe-usable side. Made plan 01's `gate.test.ts` (27) and `permissions-config.test.ts` (5) GREEN without weakening any test.

## What Was Built

**Task 1 — `permission` AuditAction + permissions-config (commit b015a90)**
- Added `'permission'` to the `AuditAction` union in `src/security.ts` (D-10), no other change there.
- Created `src/permissions-config.ts`: `getMode` (defaults `'balanced'`, D-11), `setMode`, `getOverrides` (malformed JSON → `{}`, no throw; also guards non-object/array), `setOverride` (merges + persists). `setMode`/`setOverride` emit `audit({ action:'permission' })` config events carrying only event/value — no secrets (L-4 / ASVS V8).

**Task 2 — gate.ts + PERMISSION_GATE_ENABLED kill switch (commit d7b93db)**
- Added `'PERMISSION_GATE_ENABLED'` to both the `KillSwitch` union and `ALL_SWITCHES` in `src/kill-switches.ts` (default ENABLED → participates in the existing 1.5s TTL hot-reload).
- Created `src/gate.ts`:
  - `classifyTier(toolName, input?)` — Tier 4 keyword set; read-only built-ins + read-only Bash → 1; Write/Edit/NotebookEdit → 2; send/post/slack/gmail-send/calendar → 3; label/save/upload/drive/archive → 2; unknown → 3 (D-03). `classifyBash` escalates `rm -rf`/`git push --force`/`drop table`/`shred`/`dd if=` → 4. `input` defaulted to `{}` so the `classifyTier('Read')` two-arg-less test calls work.
  - `resolveOutcome(tier, mode, overrides)` — Tier 4 returns `'ask'` BEFORE any mode/override branch (PERM-03 lock); else override (`always`→allow, `ask`→ask); else the `TIER_DEFAULT` matrix.
  - `capabilityForTier`, `summarize`, `GateContext`, `makeCanUseTool`.
  - `makeCanUseTool` resolves mode (`ctx.mode ?? getMode()`), classifies+resolves inside try/catch, and on the kill switch being off OR any throw degrades to Tier 3 `'ask'` (never deny-all/allow-all, L-2). allow → `{behavior:'allow'}` + audit; ask+attended+requestInline → await inline yes/no + audit; ask+background → `ctx.enqueue(...)` + audit(blocked) + `{behavior:'deny', message}`. Never returns `updatedPermissions` (D-05). Audit detail = `{tool,tier,mode,outcome,queueId?}`.

## Verification

- `npx vitest run src/gate.test.ts src/permissions-config.test.ts` → **32 passed (27 + 5)**, GREEN.
- Manual inspection: no `updatedPermissions` returned (the two `grep` hits are doc comments); Tier-4 branch precedes mode/override; kill-switch-off + try/catch both route to Tier 3 ask.
- `grep` acceptance: `PERMISSION_GATE_ENABLED` in `KillSwitch` union + `ALL_SWITCHES` (2 hits); `isEnabled('PERMISSION_GATE_ENABLED')` used in gate.ts (not a bare `process.env` read).
- `npx tsc --noEmit` clean for all four touched source files (`gate.ts`, `permissions-config.ts`, `security.ts`, `kill-switches.ts`).

## Deviations from Plan

### Auto-fixed Issues
None affecting source logic.

### Notes
- `getOverrides` additionally rejects non-object / array JSON (e.g. `"[]"`, `"5"`) and returns `{}` — a Rule 2 hardening beyond the literal "malformed JSON → {}" spec, since a well-formed-but-wrong-shape value would otherwise leak a non-record into the resolver.

## TDD Gate Compliance

This is a GREEN plan: the RED `test(...)` commits live in plan 01 (dcd58ad, 6802c43). This plan supplies the `feat(...)` implementation that turns them GREEN. RED→GREEN sequence is satisfied across the 03-01 → 03-02 wave boundary.

## Known Pre-existing tsc Failures (out of scope — NOT introduced here)

`npx tsc --noEmit` across the whole repo still reports errors, all in plan-01 RED test files or plan-03 modules that do not exist yet:
- `src/gate.test.ts:135,151` — the RED test invokes the returned `CanUseTool` callback with 2 args, but the SDK `CanUseTool` type declares the 3rd `options` arg as required. The tests RUN and PASS under vitest (no type erasure at runtime); I did NOT weaken the test file to silence tsc, per the GREEN-plan contract ("do NOT modify the test files"). The returned callback's 3rd param is optional and the function IS assignable to `CanUseTool`; the error is purely the test's own call-site typing.
- `src/approval-queue.test.ts` and `src/dashboard.contract.test.ts` reference `./approval-queue.js`, which is created in plan 03. Expected RED until then.

These were already failing at commit dcd58ad (before this plan) and are owned by plans 01/03. No source module authored in this plan has a tsc error.

## Threat Model Coverage

| Threat ID | Disposition | How addressed |
|-----------|-------------|---------------|
| T-03-02 (Tier 4 lock) | mitigate | `resolveOutcome` returns `'ask'` for Tier 4 before any branch; tested in every mode AND with an `always` override present. |
| T-03-misclassify | mitigate | Unknown tool + unknown Bash → Tier 3; broad Tier 4 keyword set; no Tier 1/2 fallback. |
| T-03-cache | mitigate | `makeCanUseTool` never returns `updatedPermissions`. |
| T-03-failmode | mitigate | Kill-switch-off + classify/resolve throw → Tier 3 ask/queue, never deny-all/allow-all. |
| T-03-info | mitigate | Audit detail is `{tool,tier,mode,outcome}` only; config-event audits carry event/value only — no input params, no env. |
| T-03-SC | accept | No package installs. |

## For the Next Plan (03-03)

- Wire `makeCanUseTool(gateCtx)` into the single `query()` call in `src/agent.ts`; remove `permissionMode:'bypassPermissions'` (set `'default'`).
- Create `src/approval-queue.ts` exporting `enqueueApproval`; pass it as `ctx.enqueue` (or import directly inside the background branch). The `GateContext.enqueue` slot is already typed.
- Supply `ctx.requestInline` from `message-core.ts` for the attended inline-ask path.

## Self-Check: PASSED

- FOUND: src/gate.ts, src/permissions-config.ts, 03-02-SUMMARY.md
- FOUND commits: b015a90 (task 1), d7b93db (task 2)
