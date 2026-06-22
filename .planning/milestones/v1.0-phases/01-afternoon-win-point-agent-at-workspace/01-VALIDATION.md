---
phase: 1
slug: afternoon-win-point-agent-at-workspace
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-14
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/agent-config.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30-90 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/agent-config.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | WS-01 | — | `project_dir` resolves to SDK cwd; missing dir falls back safely | unit | `npx vitest run src/agent-config.test.ts` | ✅ | ⬜ pending |
| 1-01-02 | 01 | 1 | WS-02 | — | cwd `CLAUDE.md`/`AGENTS.md` loaded via `settingSources:['project']` | manual | captured chat transcript | ❌ W0 (manual) | ⬜ pending |
| 1-01-03 | 01 | 1 | WS-03 | — | text-only brand skill (`mkt-copywriting`) returns on-brand output over chat | manual | captured chat transcript | ❌ W0 (manual) | ⬜ pending |
| 1-01-04 | 01 | 1 | WS-04 | — | setup doc lets user repoint an agent without reading source | manual | doc review | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `src/agent-config.test.ts` — assert both `project_dir` branches (existing dir → cwd; missing dir → fallback + warning) for WS-01

*Existing vitest infrastructure covers the automated portion; WS-02/WS-03/WS-04 are manual smoke/doc checks (see below).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Workspace agent reflects agentic-os CLAUDE.md/AGENTS.md without being told | WS-02 | Requires a live bot exchange against the configured agent | Configure the new agent's `project_dir`, restart the bot, ask it a question whose answer is only in agentic-os AGENTS.md; capture transcript |
| Text-only brand skill returns on-brand output over chat | WS-03 | Brand-voice judgment + chat round-trip not unit-testable | Trigger `mkt-copywriting` over Slack/Telegram; confirm output matches `brand_context/voice-profile.md`; capture transcript |
| Setup doc is reproducible | WS-04 | Doc quality is a human judgment | Follow the doc from scratch to repoint an agent; confirm no source reading required |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies or are listed as Manual-Only
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (acceptable here — phase is config/docs with one automated unit task; rest are inherently manual)
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
