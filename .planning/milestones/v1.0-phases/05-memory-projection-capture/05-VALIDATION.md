---
phase: 5
slug: memory-projection-capture
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-15
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
| 5-01-01 | 01 | 1 | unified key | unit | delegation save+recall use the stable workspace memory key for a project_dir agent | ⬜ pending |
| 5-01-02 | 01 | 1 | MEM-03 | unit | `memory-projection` renders recent aos memories to a `{date}.claudeclaw.md` file in a temp workspace, no clobber of an existing daily log | ⬜ pending |
| 5-01-03 | 01 | 1 | MEM-04, MEM-06 | unit | `capture-cli` ingests stdin/session text into SQLite under (workspace-key, aos) via the in-process db access path; dedup by session_id | ⬜ pending |
| 5-02-01 | 02 | 2 | MEM-03, MEM-04 | manual | live: terminal session in workspace reads projection file; terminal work captured + recalled by a later bot @aos: turn | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements

- [ ] Unit test: for a workspace agent (project_dir set), delegation memory save + recall key on the stable workspace memory id (unified pool), not the caller chat_id.
- [ ] Unit test: projection writer renders recent aos memories to `{date}.claudeclaw.md` (separate file, agent's own session log untouched) using the in-process read functions.
- [ ] Unit/integration test: capture-cli writes a memory under (workspace-key, aos) and is idempotent on the same session_id.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Terminal reads a projection of bot memories | MEM-03 | Requires a live terminal Claude Code session in the workspace | After a bot @aos: turn, start a terminal session in agentic-os; confirm `context/memory/{date}.claudeclaw.md` reflects recent ClaudeClaw memories |
| Terminal work captured + bot recalls it | MEM-04 | Two-mode live round-trip | In a terminal session do a small task; confirm the Stop hook captured it into SQLite; then a later bot @aos: turn recalls it |
| Projection uses the decryption-safe access path | MEM-06 | Code review + behavior | Confirm the projection calls db.ts read functions, never raw sqlite reads of encrypted columns (memory tables are plaintext anyway) |

---

## Validation Sign-Off

- [ ] Unified-key wiring test green
- [ ] Projection render test green (no clobber)
- [ ] Capture-cli test green (idempotent)
- [ ] Live terminal/bot round-trip captured
- [ ] Full suite at baseline
- [ ] `nyquist_compliant: true` at sign-off

**Approval:** pending
