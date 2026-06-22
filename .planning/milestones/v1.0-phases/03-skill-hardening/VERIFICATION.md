---
phase: 3
slug: skill-hardening
status: passed
verified: 2026-06-15
method: live transcripts + deployed cwd fix confirmation + suite baseline
---

# Phase 3 — Verification

**Goal:** Skills that assume the Command Centre / agentic-os hooks / auto-download no longer hard-fail headless, and skill self-improvement feedback keeps flowing.

**Result: PASSED (2/2 requirements).**

| Req | Criterion | Verdict | Evidence |
|-----|-----------|---------|----------|
| SK-04 | A file-producing skill runs over chat with no hard failure and delivers its file as an attachment | PASS | `viz-interface-design` via `@aos:` delivered a PNG as a Slack attachment, no crash from CC Notify / humanizer / clickable paths / auto-download |
| SK-05 | Skill self-improvement feedback is written to agentic-os `learnings.md` when a skill is invoked via the bot | PASS | After the SKILL.local.md override + cwd fix, a `@aos:` mkt-copywriting run wrote a dated Sidelines entry to `agentic-os/context/learnings.md` (mtime advanced Jun 12 → Jun 15 08:37; entry present), with no interactive feedback reply |
| COMPAT | No default-fleet regression; suite green | PASS | Full suite at baseline (519 pass, 4 pre-existing failures unrelated to this phase) |

## What it took

SK-04 was straightforward (a `[SEND_FILE:]` marker instruction in the `aos` overlay). SK-05 required three layers:
1. The `aos` agent-role overlay alone did not make the learnings write fire (the skill's own interactive-gated Step 10 dominated the generic instruction).
2. A targeted `mkt-copywriting/SKILL.local.md` override decoupled logging from the never-answered feedback question.
3. A cwd bug fix (`src/orchestrator.ts`): delegated agents were writing relative paths into the ClaudeClaw repo instead of their `project_dir`. `delegateToAgent` now passes the resolved `cwd` to `runAgent`. This is what made the learning land in `agentic-os/context/learnings.md` rather than `claudeclaw/`.

## Significance of the cwd fix

Beyond SK-05, this fix is foundational to the consolidation: a workspace agent now READS and WRITES in its `project_dir`, so a terminal Claude Code session in agentic-os and the bot share the same `context/learnings.md` and `projects/`. Without it, the "both modes share state" core value would have been silently broken — and Phases 4-5 (the memory bridge) build directly on this.

## Cleanup

- Stray `claudeclaw/context/` and `claudeclaw/projects/` directories (bug artifacts from before the cwd fix) were removed from the main checkout; the real learnings content is preserved in `agentic-os/context/learnings.md`.

## Follow-ups filed

- `task_63f94aa5` — broader cwd-correctness: add a regression test that a delegated run resolves writes to `project_dir`.
- `task_4d545e7e` — error classifier should distinguish claude.ai session-limit from credential errors (the misleading message hit twice during this phase's verification, both times an account session cap, not credentials).

**Verified by:** live transcript + deployed-fix confirmation + suite baseline.
