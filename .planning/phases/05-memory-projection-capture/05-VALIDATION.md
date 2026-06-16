---
phase: 5
slug: memory-projection-capture
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-15
validated: 2026-06-16
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/memory-projection.test.ts src/capture-cli.test.ts src/orchestrator.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30-120 seconds |

---

## Sampling Rate

- **After every task commit:** run the quick command for the touched module(s).
- **After every plan wave:** `npx vitest run`.
- **Before `/gsd-verify-work`:** full suite at the documented baseline (ignore the known unrelated/environmental failures).
- **Max feedback latency:** ~120 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 5-01-01 | 01 | 1 | unified key | unit | `src/agent-config.test.ts` (`workspaceMemoryKey('aos')==='ws:aos'`, `isWorkspaceAgent` cases) + `src/orchestrator.test.ts` (delegated recall keys on `ws:aos`, `strictAgentId` kept) | ✅ green |
| 5-01-02 | 01 | 1 | MEM-03 | unit | `npx vitest run src/memory-projection.test.ts` — renders recent aos memories to `{date}.claudeclaw.md`, no clobber of an existing daily log, `getRecentHighImportanceMemories('ws:aos',10,'aos')` | ✅ green |
| 5-01-03 | 01 | 1 | MEM-06 | unit | `src/memory-projection.test.ts` MEM-06 source guard (no decrypt path, sqlite driver, or `wa_`/`slack_messages` reads). *MEM-04 SQLite-capture half superseded — see note.* | ✅ green (MEM-06) |
| 5-02-01 | 02 | 2 | MEM-03 | manual (live) | n/a — terminal session reads `{date}.claudeclaw.md` projection. *MEM-04 capture half superseded — see Manual-Only.* | ✅ human-verified (05-02) |

*Status: ⬜ pending · ✅ green · ❌ red*

> **MEM-04 supersession (audit 2026-06-16):** The original 5-01-03 / 5-02-01 rows asserted a SQLite Stop-hook capture path (`src/capture-cli.ts` ingesting into `(ws:aos, aos)`, unit-tested by `src/capture-cli.test.ts`). The 05-02 SUMMARY CORRECTION already noted this capture was never durably wired and re-opened MEM-04 into Phase 6. Phase 6 then **rescoped MEM-04 to shared workspace markdown files** and **deleted both `src/capture-cli.ts` and `src/capture-cli.test.ts`** (commit `7f62a81`). So the SQLite-capture half of these rows no longer exists by design. What survives from Plan 01 — the unified `ws:aos` key, the MEM-03 projection writer, and the MEM-06 access-path guard — is fully automated and green. MEM-04 (shared-file capture) is manual-only and was human-verified in Phase 6 Plan 03.

---

## Wave 0 Requirements

- [x] Unit test: for a workspace agent (project_dir set), delegation save + recall key on the stable workspace memory id (`ws:aos`), not the caller chat_id. `src/agent-config.test.ts` + `src/orchestrator.test.ts`. Green.
- [x] Unit test: projection writer renders recent aos memories to `{date}.claudeclaw.md` (separate file, agent's own session log untouched) using in-process read functions. `src/memory-projection.test.ts`. Green.
- [x] ~~Unit/integration test: capture-cli writes a memory under (workspace-key, aos), idempotent on session_id.~~ **Superseded** — `capture-cli` deleted in the Phase 6 MEM-04 rescope (`7f62a81`); capture is now shared-file based and manual-only. MEM-06 access-path guard for the projection side remains green.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Status |
|----------|-------------|------------|-------------------|--------|
| Terminal reads a projection of bot memories | MEM-03 | Requires a live terminal Claude Code session in the workspace | After a bot @aos: turn, start a terminal session in agentic-os; confirm `context/memory/{date}.claudeclaw.md` reflects recent ClaudeClaw memories | ✅ verified 05-02 (`2026-06-15.claudeclaw.md` carried the tagline + oncall + Q3 facts) |
| Terminal work captured + bot recalls it (shared files) | MEM-04 | Rescoped — capture is shared workspace markdown written by a skill in a live session; the SQLite Stop-hook path was dropped (`7f62a81`) | In a terminal session, write work into `context/MEMORY.md` (meta-memory-write skill); confirm a later bot @aos: turn recalls it | ✅ verified in Phase 6 Plan 03 ("Demo ship date is Aug 9" round-trip) |
| Projection uses the decryption-safe access path | MEM-06 | Code review + behavior, backed by source-guard unit test | Projection calls `db.ts` read functions, never raw sqlite reads of encrypted columns (memory tables are plaintext anyway) | ✅ green (`memory-projection.test.ts` source guard) + verified 05-02 |

---

## Validation Sign-Off

- [x] Unified-key wiring test green (`agent-config.test.ts` + `orchestrator.test.ts`)
- [x] Projection render test green, no clobber (`memory-projection.test.ts`)
- [x] ~~Capture-cli test green~~ — superseded by Phase 6 MEM-04 rescope (capture-cli deleted `7f62a81`); MEM-06 projection access-path guard green in its place
- [x] Live terminal/bot round-trip captured (MEM-03 in 05-02; MEM-04 shared-file in Phase 6 Plan 03)
- [x] Full suite at baseline (surviving phase-05 suites 45/45 green; full-suite baseline failures are environmental/known, not phase-05 regressions)
- [x] `nyquist_compliant: true` at sign-off

**Approval:** validated 2026-06-16 (audit) — MEM-03 + MEM-06 + unified-key automated and green; MEM-04 manual-only by the Phase 6 rescope, human-verified.

---

## Validation Audit 2026-06-16

| Metric | Count |
|--------|-------|
| Gaps found | 1 |
| Resolved (already covered) | 0 |
| Superseded / reclassified manual-only | 1 (5-01-03 + MEM-04 half of 5-02-01 — `capture-cli` deleted in Phase 6 rescope `7f62a81`) |
| Escalated | 0 |

**Method:** State A audit. The VALIDATION.md was still `draft` / `nyquist_compliant: false` with all rows `⬜ pending`, despite Plan 01/02 completing. Cross-referenced the per-task map against tests on disk: `memory-projection.test.ts`, `agent-config.test.ts`, `orchestrator.test.ts` survive and pass (45/45); `capture-cli.test.ts` was deleted in the Phase 6 MEM-04 rescope (`7f62a81`). MEM-03 (projection), MEM-06 (access-path guard), and the unified `ws:aos` key are fully automated and green. The MEM-04 SQLite-capture rows were superseded by the rescope to shared workspace files — manual-only, human-verified in Phase 6 Plan 03. No fillable automated gap; no auditor spawn.
