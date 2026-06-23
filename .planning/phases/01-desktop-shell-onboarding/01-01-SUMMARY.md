---
phase: 01-desktop-shell-onboarding
plan: 01
subsystem: auth
tags: [auth-precedence, env-merge, oauth, anthropic-api-key, electron, setup-token, vitest, tdd]

# Dependency graph
requires: []
provides:
  - "Pure, unit-tested auth-precedence + .env-merge helpers in src/desktop-config.ts (resolveAuthWrite, mergeEnv, isConfigured, activeAuthSource)"
  - "Proven never-coexist invariant: ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN can never both be set (D1, PKG-05)"
  - "Empirical A1 answer: `claude setup-token` CAN capture a token from a non-TTY Electron subprocess (spawn+capture path)"
  - "electron/spike-setup-token.cjs throwaway diagnostic harness (token never persisted)"
  - "SMOKE-CHECKLIST.md manual clean-machine -> onboarding -> dashboard -> reboot checklist, cross-referenced to PKG-01..05"
affects: [01-03, desktop-onboarding, electron-shell, auth-settings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure auth-precedence resolver: resolveAuthWrite returns an env-delta where null/'' deletes a key, so the chosen auth var is always the only one present"
    - "Env merge mirrors config.cjs writeEnv semantics (null/undefined/'' delete; managed-header # lines ignored on re-read)"
    - "Diagnostic spike harness logs only token length + 12-char prefix, never the full credential, and writes nothing to disk"

key-files:
  created:
    - src/desktop-config.ts
    - src/desktop-config.test.ts
    - electron/spike-setup-token.cjs
    - .planning/phases/01-desktop-shell-onboarding/SMOKE-CHECKLIST.md
  modified:
    - src/env.test.ts

key-decisions:
  - "A1 RESOLVED: `claude setup-token` captures a token from a non-TTY Electron subprocess (SPIKE RESULT: token captured, length=108, prefix=sk-ant-oat01…). Plan 03 uses the spawn+capture path, NOT the TTY/pty fallback."
  - "Auth precedence follows the OFFICIAL order from RESEARCH.md (ANTHROPIC_API_KEY outranks CLAUDE_CODE_OAUTH_TOKEN); the load-bearing invariant is that the chosen var is the only auth var present."
  - "Spike harness is throwaway/diagnostic — to be deleted (or build-excluded) once plan 03's setup-token mechanism lands so it never ships in the packaged build."

patterns-established:
  - "Pattern: auth-precedence as a pure function unit-tested in isolation before any handler consumes it (interface-first)"
  - "Pattern: secrets in diagnostics are reported as length + prefix only, never persisted"

requirements-completed: [PKG-03, PKG-05]

# Metrics
duration: ~30min (across initial run + checkpoint resume)
completed: 2026-06-22
---

# Phase 01 Plan 01: Auth-Precedence Contract & setup-token Spike Summary

**Pure, unit-tested auth-precedence + .env-merge module (src/desktop-config.ts) with a proven OAuth/API-key never-coexist invariant, plus an empirical answer to A1: `claude setup-token` captures a token from a non-TTY Electron subprocess, so plan 03 uses the spawn+capture path.**

## Performance

- **Duration:** ~30 min (initial Task 1 + checkpoint pause + resume)
- **Tasks:** 2 (Task 1 auto/TDD, Task 2 checkpoint:human-verify — resolved "approved")
- **Files created:** 4
- **Files modified:** 1

## Accomplishments

- Extracted auth-precedence and .env-merge logic into a pure, I/O-free module (`src/desktop-config.ts`) exporting `resolveAuthWrite`, `mergeEnv`, `isConfigured`, `activeAuthSource`.
- Proved the D1/PKG-05 invariant under test: no `resolveAuthWrite` output ever contains both `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` as non-null; empty credential clears BOTH.
- Extended `src/env.test.ts` with null-delete round-trips and managed-header (`#` line) parsing cases.
- Built and ran `electron/spike-setup-token.cjs` to resolve open question A1.
- Authored `SMOKE-CHECKLIST.md` (manual OS/browser-bound flows) cross-referenced to PKG-01..05.

## A1 Decision (input for Plan 03)

**Question:** Does `claude setup-token` capture a token from a non-TTY Electron subprocess?

**Answer: YES — token captured.** The spike's final line was:

```
SPIKE RESULT: token captured (length=108, prefix=sk-ant-oat01…)
```

(Operator response on resume: "approved" + "token captured".)

**Consequence for Plan 03:** Use the **spawn + capture** path (`child_process.spawn` of `claude setup-token`, parse the printed token from stdout). The TTY/pty wrapper fallback and the browser-flow + status-check fallback are NOT needed.

**Security note:** The actual token was never stored, logged in full, or written to disk anywhere. Only the non-sensitive descriptor (`length=108, prefix=sk-ant-oat01…`) and the A1 decision are recorded here, per T-01-01 mitigation.

## Spike Harness Disposition

`electron/spike-setup-token.cjs` is throwaway/diagnostic. **Disposition: delete or build-exclude once plan 03's production setup-token mechanism lands**, so it does not ship in the packaged app's `build.files`. It is not currently in `.gitignore` (it lives in git history under commit `3051107` as a diagnostic record); plan 03 should remove it when the real mechanism is wired. The spike contains no `writeFile`/`writeEnv`/`appendFile` calls (verified) — it persists nothing.

## Task Commits

1. **Task 1 (RED): failing auth-precedence + env-merge unit suite** - `95b6a91` (test)
2. **Task 1 (GREEN): pure auth-precedence + env-merge helpers (desktop-config.ts)** - `a758378` (feat)
3. **Task 2: setup-token spike harness + manual smoke checklist** - `3051107` (chore)

**Plan metadata:** committed separately (this SUMMARY + STATE.md + ROADMAP.md).

_Note: Task 1 is TDD (test → feat). No refactor commit was needed (GREEN code was already clean)._

## Files Created/Modified

- `src/desktop-config.ts` (93 lines) - Pure auth-precedence + env-merge helpers; exports `resolveAuthWrite`, `mergeEnv`, `isConfigured`, `activeAuthSource`. No I/O.
- `src/desktop-config.test.ts` (159 lines) - 24 tests covering every behavior bullet incl. the never-coexist invariant and the both-cleared edge case.
- `src/env.test.ts` (141 lines, modified) - Added null-delete round-trip and managed-header parsing cases.
- `electron/spike-setup-token.cjs` (121 lines) - Throwaway Electron main; spawns `claude setup-token` non-TTY, reports `SPIKE RESULT:` with token length+prefix only, persists nothing.
- `.planning/phases/01-desktop-shell-onboarding/SMOKE-CHECKLIST.md` (81 lines) - Manual clean-machine flows, 23 PKG-01..05 cross-references.

## Verification

- **Plan-specific tests:** `npx vitest run src/desktop-config.test.ts src/env.test.ts` → **37 passed (2 files)**. Green.
- **Typecheck:** `npm run typecheck` (`tsc --noEmit`) → **clean, no errors**.
- **Full suite (`npm test`):** **690 passed / 6 failed (696 total, 41 files)**.
  - The 6 failures are all in `src/schedule-cli.test.ts` (4) and `src/chat-task-tracker.test.ts` (2).
  - **Cause:** both are CLI integration tests that `execSync` against `dist/schedule-cli.js`; this worktree has no built `dist/`, so Node throws `MODULE_NOT_FOUND`. Environmental, not a regression.
  - **Out of scope:** neither file was modified by this plan (`git diff ecea5f6..HEAD` confirms). Logged to `deferred-items.md`. Fix is to `npm run build` before `npm test` in CI/worktree.

## Decisions Made

- **Spawn+capture chosen for plan 03** based on A1 spike result (token captured from non-TTY subprocess).
- **Official auth-precedence order** (RESEARCH.md) used over CONTEXT.md shorthand; for this phase's two-way OAuth-vs-API-key choice the invariant is "chosen var is the only auth var present."

## Deviations from Plan

None — plan executed exactly as written. All required exports, tests, the spike, and the smoke checklist were produced as specified. The 6 unrelated full-suite failures were logged (not fixed) per the scope boundary.

## Authentication Gates

The Task 2 checkpoint (`checkpoint:human-verify`) required the operator to complete the Claude browser sign-in for the `claude setup-token` spike — normal onboarding flow, not a failure. Operator completed it and responded "approved" with the A1 outcome.

## Issues Encountered

None during planned work. The full-suite `dist/` failures are pre-existing/environmental (documented above).

## User Setup Required

None for this plan beyond the one-time Claude sign-in already completed during the A1 spike. Production onboarding is wired in plan 03.

## Next Phase / Plan Readiness

- **Plan 03 unblocked:** A1 resolved → spawn+capture mechanism selected. `src/desktop-config.ts` contract is ready for `electron/config.cjs` to re-export (the `resolveAuthWrite` key-link the plan declared).
- **Cleanup carried forward:** plan 03 must delete or build-exclude `electron/spike-setup-token.cjs`.
- No blockers.

## Self-Check: PASSED

All declared files exist on disk; all task commits (`95b6a91`, `a758378`, `3051107`) and the docs commit (`1f2fd8c`) are present in git history.

---
*Phase: 01-desktop-shell-onboarding*
*Completed: 2026-06-22*
