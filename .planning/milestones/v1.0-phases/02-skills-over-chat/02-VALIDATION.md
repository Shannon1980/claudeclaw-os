---
phase: 2
slug: skills-over-chat
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-14
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/format.test.ts src/message-core.test.ts src/orchestrator.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30-90 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched module(s)
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite green (modulo the 4 pre-existing failures documented in Phase 1, which are unrelated and environmental/known)
- **Max feedback latency:** ~90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 0 | SK-03 | — | `[SEND_FILE:]` marker with a space-containing absolute path is parsed intact (bracketed form) | unit | `npx vitest run src/format.test.ts` | ✅ | ⬜ pending |
| 2-01-02 | 01 | 1 | SK-03 | — | delegation path (`@id:`) extracts file markers and delivers attachments (no raw-text leak) | unit | `npx vitest run src/orchestrator.test.ts src/message-core.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 2 | SK-01, SK-02, SK-03 | — | aos lists/invokes workspace skills; mkt-copywriting on-brand; excalidraw PNG delivered as attachment | manual | captured chat transcripts | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/format.test.ts` — add a case asserting a `[SEND_FILE:/abs/path with spaces/file.png|caption]` marker parses to the full path (not truncated at the space) for SK-03
- [ ] `src/orchestrator.test.ts` (or `message-core.test.ts`) — add a case asserting the delegation path extracts file markers from a delegated agent's response and routes them to the file-send path (no marker text leaks into the chat reply)

*Existing vitest infra covers these; the live SK-01/SK-02/SK-03 end-to-end proof is manual (chat transcript).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| aos lists/invokes workspace methodology skills | SK-01 | Live discovery over chat | Ask aos to list its available mkt-/str-/viz-/meta- skills; confirm workspace skills appear |
| A brand skill returns on-brand output end-to-end | SK-02 | Brand-voice judgment + chat round-trip | Trigger a representative brand skill over chat; confirm on-brand (fresh transcript; Phase 1 already showed mkt-copywriting) |
| A file-producing skill delivers a chat attachment | SK-03 | Real file render + transport upload | Trigger `viz-excalidraw-diagram` via aos; confirm a PNG arrives as a Slack/Telegram attachment (not a raw `[SEND_PHOTO:]` text) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies or are listed Manual-Only
- [ ] Sampling continuity: no 3 consecutive implementation tasks without automated verify
- [ ] Wave 0 covers the space-in-path and delegation-extraction gaps
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter at sign-off

**Approval:** pending
