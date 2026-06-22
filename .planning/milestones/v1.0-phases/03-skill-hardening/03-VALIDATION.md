---
phase: 3
slug: skill-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-15
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/format.test.ts src/message-core.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30-90 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run the quick command if any ClaudeClaw source changed (likely none this phase).
- **After every plan wave:** `npx vitest run`.
- **Before `/gsd-verify-work`:** Full suite at the documented baseline (519 pass; 4 pre-existing failures unrelated to this work).
- **Max feedback latency:** ~90 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 3-01-01 | 01 | 1 | SK-04, SK-05 | manual+structural | `test -f ~/.claudeclaw/agents/aos/CLAUDE.md && grep -qi 'SEND_FILE' ... && grep -qi 'learnings' ...` | ⬜ pending |
| 3-01-02 | 01 | 2 | SK-04 | manual | live chat transcript (auto-download skill delivers via [SEND_FILE:]) | ⬜ pending |
| 3-01-03 | 01 | 2 | SK-05 | manual | live: a bot-invoked skill appends a dated entry to context/learnings.md | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements

- [ ] No new ClaudeClaw unit tests required: the `[SEND_FILE:]`/`[SEND_PHOTO:]` marker path (delegation + main) is already covered by Phase 2's `format.test.ts` + `message-core.test.ts`. This phase adds an agent-role instruction overlay (a CLAUDE.md doc) and relies on live verification.

*If any ClaudeClaw source changes during execution, add the matching unit test before that task.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A skill that normally auto-downloads delivers its file over chat instead | SK-04 | Live skill run + transport upload | Invoke `viz-interface-design` (local, no MCP) via `@aos:`; confirm the generated file arrives as a `[SEND_FILE:]` attachment, no hard failure |
| Skill self-improvement persists from a bot turn | SK-05 | Requires a live one-shot delegated run + on-disk check | Invoke a skill that logs feedback via `@aos:`; confirm a new dated entry appears in agentic-os `context/learnings.md` (mtime advances past 2026-06-12) |
| No QoL feature hard-fails headless | SK-04 | Behavioral over chat | Confirm the run completes with no crash from CC Notify / humanizer / clickable-paths |

---

## Validation Sign-Off

- [ ] Structural check on the aos overlay (file exists, mentions SEND_FILE + learnings)
- [ ] Live SK-04 transcript: file delivered as attachment, no hard fail
- [ ] Live SK-05: learnings.md gained a dated entry from a bot turn
- [ ] Full suite at baseline (no new failures)
- [ ] `nyquist_compliant: true` set at sign-off

**Approval:** pending
