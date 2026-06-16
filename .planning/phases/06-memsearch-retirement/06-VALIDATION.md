---
phase: 6
slug: memsearch-retirement
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-15
validated: 2026-06-16
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x (installed) |
| **Config file** | `package.json` `vitest` block (`src/**/*.test.ts`) |
| **Quick run command** | `npx vitest run src/recall-cli.test.ts` |
| **Full suite command** | `npx vitest run` (= `npm test`) |
| **Estimated runtime** | ~quick: a few seconds; full: under a minute |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/recall-cli.test.ts`
- **After every plan wave:** Run `npx vitest run` (tolerate only the documented baseline failures — see Baseline note below)
- **Before `/gsd-verify-work`:** Full suite green (modulo known baseline); live round-trip human-verified LAST
- **Max feedback latency:** ~10 seconds (quick), under a minute (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 0 | MEM-05 | T-06-01 | recall calls `searchMemories` once, scoped `ws:aos`/`aos`/embedding | unit | `npx vitest run src/recall-cli.test.ts` | ✅ | ✅ green |
| 06-01-02 | 01 | 0 | MEM-05 | T-06-02 | recall-cli source has no `memsearch`/`reranker`, server-side `RECALL_AGENT_ID`, `realpathSync` + `process.chdir`/`PACKAGE_ROOT` deploy guards | unit | `npx vitest run src/recall-cli.test.ts` | ✅ | ✅ green |
| 06-01-03 | 01 | 1 | MEM-05 | T-06-01 | per-agent scoping, no cross-agent leakage (CLI passes `agentId='aos'`; `searchMemories` filters by `agent_id`) | unit | `npx vitest run src/recall-cli.test.ts` + `src/db.test.ts` (`searchMemories scopes by agent_id`, line 449) | ✅ | ✅ green |
| 06-02-01 | 02/03 | 1 | MEM-04 | — | terminal work persisted to shared workspace files (`context/MEMORY.md`) is recalled by the bot | manual (live) | n/a — rescoped, see Manual-Only | n/a | ✅ human-verified (06-03) |
| 06-03-01 | 03 | 2 | MEM-05 | — | full suite stays green modulo documented baseline | regression | `npx vitest run` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **MEM-04 reclassification (audit 2026-06-16):** The original 06-02-01 row asserted a `capture-cli.js` Stop-hook unit test (`src/capture-cli.test.ts`). Both `src/capture-cli.ts` and `src/capture-cli.test.ts` were deleted in commit `7f62a81` ("drop Stop-hook SQLite capture; workspace files are the shared layer (MEM-04 rescope)"). MEM-04 capture is now satisfied by shared workspace markdown files and is inherently manual/live — proven human-verified in Plan 03. Moved to Manual-Only.

> **Baseline (worktree, audit 2026-06-16):** `npx vitest run` = 580 passing / 3 failing / 4 skipped (583). The 3 failures are all `src/schedule-cli.test.ts` and are environmental: they `execSync dist/schedule-cli.js`, which calls `initDatabase()` and throws `DB_ENCRYPTION_KEY is missing` because this worktree has no `.env`. On the live deploy target (with `.env`) Plan 03 measured 582/583 (sole real baseline failure: `chat-task-tracker > returns null when classifier fails`, no API key in test env). Neither set is a phase-06 regression. The phase-06 suite (`recall-cli.test.ts`) is 4/4 green.

---

## Wave 0 Requirements

- [x] `src/recall-cli.test.ts` — MEM-05 single-index invariant (`searchMemories` called once with `ws:aos`/`aos`/embedding) + source-guard (no `memsearch`/`reranker` in recall module source, plus the 06-03 deploy guards: `realpathSync`, `process.chdir`, `PACKAGE_ROOT`). Mocks `db.js` + `embeddings.js` following the `src/memory-projection.test.ts` pattern. 4/4 green.
- [x] `recallForWorkspace` lives in `src/memory.ts`; the source-guard test asserts the wrapper references `workspaceMemoryKey` and routes through `searchMemories` only.
- [x] No framework install needed (vitest present).

*Existing infrastructure (`src/db.test.ts` — including `searchMemories scopes by agent_id`, line 449 — and `src/memory.test.ts`) covers the scoping requirements. The `capture-cli.test.ts` referenced in the original draft was deleted with the MEM-04 rescope (commit `7f62a81`); capture is now manual-only.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Status |
|----------|-------------|------------|-------------------|--------|
| Terminal recall-CLI parity (live) | MEM-05 | Requires a real terminal Claude Code session + live SQLite | `node "$HOME/.claudeclaw-app/dist/recall-cli.js" "<known fact>"` returns the fact in a terminal AND the bot recalls the same fact for an `@aos:` turn | ✅ verified 06-03 ("Q3 launch date" returned in both surfaces) |
| Capture round-trip via shared files (live) | MEM-04 | Rescoped — capture is shared workspace markdown written by a skill in a live session; no SQLite Stop-hook path remains to unit-test | Do work in a terminal session that writes to `context/MEMORY.md` (meta-memory-write skill); confirm a later bot `@aos:` turn recalls it | ✅ verified 06-03 ("Demo ship date is Aug 9" round-trip) |
| Nightly index + memsearch plugin do not fire | MEM-05 | Time-based cron + per-workspace plugin behavior | Confirm `cron/jobs/nightly-memsearch-index.md` `active:'false'`, no `memsearch index` process after 23:30, and memsearch plugin banner absent in a fresh agentic-os workspace session | ✅ verified 06-03 (plugin disabled per-project, banner absent) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are documented Manual-Only (MEM-04 capture is genuinely manual/live by the rescope)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (`src/recall-cli.test.ts` exists, 4/4 green)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-06-16 (audit)

---

## Validation Audit 2026-06-16

| Metric | Count |
|--------|-------|
| Gaps found | 1 |
| Resolved (already covered) | 0 |
| Reclassified to manual-only | 1 (06-02-01 MEM-04 capture — `capture-cli` deleted in rescope `7f62a81`) |
| Escalated | 0 |

**Method:** State A audit. Read all PLAN/SUMMARY files, cross-referenced the per-task map against tests on disk, ran `npx vitest run src/recall-cli.test.ts` (4/4 green) and the full suite. No automatable gaps remained — every MEM-05 requirement has a green test; the one stale row (MEM-04 capture, citing a deleted `capture-cli.test.ts`) was reclassified manual-only per Plan 03's authoritative rescope and was already human-verified. No auditor spawn required.
