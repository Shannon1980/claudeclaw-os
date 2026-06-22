---
phase: 06-memsearch-retirement
plan: 03
subsystem: recall-cli-deploy-and-live-proof
tags: [recall, memsearch-retirement, live-verify, deploy, mem-05, mem-04, deviation]
requires:
  - "06-01: dist/recall-cli.js (ClaudeClaw recall CLI)"
  - "06-02: agentic-os AGENTS.md repointed at recall-cli, nightly memsearch index cron disabled"
provides:
  - "MEM-05 closed: one semantic index (ClaudeClaw SQLite), two surfaces (bot + terminal), second index dead in the workspace"
  - "MEM-04 closed (rescoped): terminal work persisted to context/MEMORY.md is recalled by the bot; shared workspace files are the capture layer"
  - "recall-cli works through the ~/.claudeclaw-app symlink AND from the agentic-os workspace cwd (two blocking bugs fixed)"
  - "memsearch Claude Code plugin disabled for the agentic-os workspace"
affects:
  - "Phase 6 complete; milestone v1.0 recall/capture consolidation proven live"
tech-stack:
  added: []
  patterns:
    - "ESM run-as-main guard must realpath argv[1] so symlink invocation matches import.meta.url"
    - "Cross-cwd CLIs anchor cwd on the package root before loading config (config.ts reads cwd/.env)"
    - "Per-project enabledPlugins:false disables a user-scoped plugin for one workspace, reversibly"
key-files:
  created:
    - ".planning/phases/06-memsearch-retirement/06-03-SUMMARY.md"
  modified:
    - "src/recall-cli.ts (two deploy-blocking fixes)"
    - "src/recall-cli.test.ts (regression guards)"
    - "/Users/shannongueringer/App Repo/agentic-os/.claude/settings.json (disable memsearch plugin for the workspace)"
decisions:
  - "MEM-04 rescope is authoritative (user decision): workspace files are the shared layer; the Stop-hook SQLite capture proof was dropped from this plan"
  - "Deploy target cut over: main repo checkout switched phase-5-rescope-files-shared-layer -> main, fast-forwarded to the recall fixes, rebuilt, launchd agents restarted"
  - "memsearch plugin disabled per-project (agentic-os enabledPlugins:false), not globally and not uninstalled (D-03 disable-not-remove)"
metrics:
  duration: "~110m (heavy: cross-repo forensics, 2 bug fixes, deploy, live human-verify)"
  completed: 2026-06-16
---

# Phase 6 Plan 3: Live Bidirectional Recall Proof + memsearch Retirement Summary

Closed Phase 6 with the automated regression gate plus a human-verified live proof that recall works in both surfaces against the single ClaudeClaw SQLite index and the second index is dead in the workspace. Reconciled the plan to the MEM-04 rescope, fixed two deploy-blocking recall-cli bugs the human-verify surfaced, deployed to the live target, and disabled the memsearch Claude Code plugin that the original phase scope had missed.

## What Was Proven (Task 2, human-verified)

| Criterion | Result | Evidence |
|-----------|--------|----------|
| Terminal recall (recall-cli, single index) | PASS | `node "$HOME/.claudeclaw-app/dist/recall-cli.js" "Q3 launch date"` from the agentic-os workspace cwd returns "The Q3 launch date is October 14." + other ws:aos facts |
| Bot recall, same fact (@aos:) | PASS | Slack `@aos when is the Q3 launch date?` -> "October 14." Both surfaces, one store |
| MEM-04 capture (rescoped, shared files) | PASS | Terminal session wrote "Demo ship date is Aug 9" into context/MEMORY.md (meta-memory-write skill, Active Threads); bot read it back via @aos: |
| Index off (success criterion 1) | PASS | nightly-memsearch-index.md active:'false'; no memsearch index/watch daemon; memsearch plugin banner absent in a fresh workspace session after disable |

## Task 1: Regression Gate + Deploy

- Full suite green modulo the documented baseline: 582/583 passing; the sole failure is the known `chat-task-tracker > returns null when classifier fails` baseline (no API key in test env), not a regression. Run on the deployed commit `f962d30`.
- Deterministic core (recall-cli, memory, db, orchestrator, dashboard) fully green.
- Deploy: the live target (`~/.claudeclaw-app` -> main repo) was on the stale `phase-5-rescope-files-shared-layer` branch with no built recall-cli. Switched the checkout to `main` (already carries merged Plan 01 recall-cli + the rescope), fast-forwarded `main` to the recall fixes, `npm run build`, restarted the `com.claudeclaw.app` and `com.claudeclaw.social` launchd agents.

## Deviations (3)

These were discovered during the live proof and fixed; the original plan assumed Plans 01/02 had delivered a working terminal recall path, which they had not through the documented invocation.

1. **recall-cli silent no-op through the symlink** (fix `3856c68`). The ESM run-as-main guard compared `process.argv[1]` (the `~/.claudeclaw-app` symlink path) against `import.meta.url` (always realpath-resolved by Node), so it never matched through the symlink and the CLI exited without running — printing nothing for facts that exist. AGENTS.md Tier-1 recall invokes via that symlink, so terminal recall had been a silent no-op since 06-01. Fixed with `realpathSync` + `pathToFileURL`; added a source-guard regression test.

2. **recall-cli crash from the workspace cwd** (fix `f962d30`). `config.ts` reads `.env` relative to `process.cwd()`. Invoked from the agentic-os workspace terminal (its actual AGENTS.md usage), recall-cli ran with cwd in the workspace, where `.env` has no `DB_ENCRYPTION_KEY`, and crashed before any query. Fixed by anchoring cwd on the package root (`process.chdir`) before dynamically importing the config-dependent modules; added a source-guard regression test.

3. **memsearch Claude Code plugin still enabled** (agentic-os `f9a5af4`). The phase plan's D-03 ("disable + de-reference") covered the nightly index cron, AGENTS.md, and the CLI/scripts but missed the user-scoped memsearch Claude Code plugin (installed 2026-06-12). Its SessionStart hook injects memory context + starts a watch singleton; its UserPromptSubmit hook nudges recall every prompt. Left enabled, MEM-05's "only ClaudeClaw embeddings run" was not truly met. Disabled for the workspace via project `enabledPlugins: { "memsearch@memsearch-plugins": false }` (reversible, global install untouched). Verified absent in a fresh workspace session.

Plan-doc reconciliation: 06-03-PLAN.md was rewritten to the MEM-04 rescope model (dropped the dead Stop-hook/capture-cli.js proof; capture proven via shared workspace files) and its stale `sharp-easley-ba9c43` worktree paths were corrected to the live `~/.claudeclaw-app` target.

## Outstanding (not blocking phase completion)

- ClaudeClaw recall fixes (`3856c68`, `f962d30`) and the deploy are on **local `main`, not pushed**.
- agentic-os Phase 6 commits (AGENTS.md repoint + cron disable in `4b91f5d`, plugin disable in `f9a5af4`) are on branch `claude/phase-06-memsearch-retirement`, **not pushed/merged**.
- Awaiting user decision on pushing / opening PRs.

## Result

- **MEM-05 closed:** one semantic index (ClaudeClaw SQLite), two surfaces, second index dead in the workspace.
- **MEM-04 closed (rescoped):** shared workspace files are the capture layer; terminal work is recalled by the bot.
- Phase 6 success criteria all observably true.
