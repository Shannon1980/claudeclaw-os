---
phase: 4
slug: memory-source-of-record
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-15
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/memory.test.ts src/orchestrator.test.ts src/db.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30-90 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched module(s).
- **After every plan wave:** `npx vitest run`.
- **Before `/gsd-verify-work`:** Full suite at baseline (519 pass, 4 pre-existing failures unrelated to this work).
- **Max feedback latency:** ~90 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 4-01-01 | 01 | 1 | MEM-02 (scoping) | unit | `npx vitest run src/memory.test.ts` (recall with strictAgentId excludes other agents' memories) | ⬜ pending |
| 4-01-02 | 01 | 1 | MEM-02 (scoping) | unit | `npx vitest run src/orchestrator.test.ts` OR a memory-scope test asserting the delegated recall passes strictAgentId | ⬜ pending |
| 4-01-03 | 01 | 1 | MEM-01 | structural | assert single DB resolves from PROJECT_ROOT (path test) and no second store path is constructed from cwd | ⬜ pending |
| 4-02-01 | 02 | 2 | MEM-02 | manual | live two-session transcript: write a standing preference via @aos: in session A, recall it in session B (fresh delegation; /newchat unnecessary — see 04-02-SUMMARY) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements

- [ ] A unit test asserting strict per-agent recall: a memory written under agent X is NOT returned by `buildMemoryContext(..., { strictAgentId: 'aos' })` for agent `aos` sharing the same chat_id (cross-agent leakage guard). Extend `src/memory.test.ts`.
- [ ] A test (orchestrator or memory) asserting the delegation recall path passes `strictAgentId` (no leakage into the workspace agent's recall).

*MEM-01 needs no new schema/code per research (single store already PROJECT_ROOT-based); a structural/path assertion suffices.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A bot exchange is recallable in a later session | MEM-02 | Requires two live sessions + /newchat across a real bot restart/session boundary | Session A: `@aos: remember that I prefer taglines under 5 words`. Session B (new chat / later): `@aos: draft a tagline for X` and confirm it recalls the under-5-words preference. Capture transcript. |
| No cross-agent leakage into workspace recall | MEM-02 | Behavioral over chat | Confirm the workspace agent's recall does not surface another agent's chat memories for the same chat_id |

---

## Validation Sign-Off

- [x] Strict per-agent recall unit test green (04-01)
- [x] Delegation recall passes strictAgentId (test green) (04-01)
- [x] MEM-01 single-store assertion green (04-01)
- [x] Live two-session MEM-02 transcript captured (04-02-SUMMARY.md)
- [x] Full suite at baseline (544/545 pass; sole failure is the known
  `chat-task-tracker` ~1.25s timeout flake, unrelated to this work)
- [x] `nyquist_compliant: true` at sign-off

**Approval:** approved — 2026-06-15. MEM-01 + MEM-02 verified; full suite at baseline.
