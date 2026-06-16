---
phase: 6
slug: memsearch-retirement
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-15
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
- **After every plan wave:** Run `npx vitest run` (tolerate only the 2 documented baseline failures: dashboard.contract chatId, chat-task-tracker no-key)
- **Before `/gsd-verify-work`:** Full suite green (modulo known baseline); live round-trip human-verified LAST
- **Max feedback latency:** ~10 seconds (quick), under a minute (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 0 | MEM-05 | — | recall calls `searchMemories` once, scoped `ws:aos`/`aos`/embedding | unit | `npx vitest run src/recall-cli.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 0 | MEM-05 | — | recall module source has no `memsearch`/`reranker` reference (single-index source-guard) | unit | `npx vitest run src/recall-cli.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | MEM-05 | — | per-agent scoping, no cross-agent leakage (CLI passes `strictAgentId='aos'`) | unit | `npx vitest run src/recall-cli.test.ts` + existing `src/db.test.ts` | partial | ⬜ pending |
| 06-02-01 | 02 | 1 | MEM-04 | — | terminal Stop hook writes terminal work into `(ws:aos, aos)` via committed `capture-cli.js` | unit+manual | `npx vitest run src/capture-cli.test.ts` (exists) + live | exists | ⬜ pending |
| 06-03-01 | 03 | 2 | MEM-05 | — | full suite stays green | regression | `npx vitest run` | exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/recall-cli.test.ts` — MEM-05 single-index invariant (`searchMemories` called once with `ws:aos`/`aos`/embedding) + source-guard (no `memsearch`/`reranker` in recall module source). Mock `db.js` + `embeddings.js` following `src/memory-projection.test.ts` pattern.
- [ ] (optional) extend `src/memory.test.ts` if `recallForWorkspace` lives in `memory.ts` — assert it forwards `strictAgentId` and `ws:aos`.
- [ ] No framework install needed (vitest present).

*Existing infrastructure (`src/capture-cli.test.ts`, `src/db.test.ts`, `src/memory.test.ts`) covers the capture + scoping requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Terminal recall-CLI parity (live) | MEM-05 | Requires a real terminal Claude Code session + live SQLite | `node "$HOME/.claudeclaw-app/dist/recall-cli.js" "<known fact>"` returns the fact in a terminal AND the bot recalls the same fact for an `@aos:` turn |
| Capture round-trip (live) | MEM-04 | Requires a real terminal session firing the Stop hook | Do work in a terminal session; confirm it lands in `(ws:aos, aos)` and a later bot `@aos:` turn recalls it |
| Nightly index does not fire | MEM-05 | Time-based cron behavior | Confirm `cron/jobs/nightly-memsearch-index.md` `active:'false'`; no `memsearch index` process after 23:30 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`src/recall-cli.test.ts`)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
