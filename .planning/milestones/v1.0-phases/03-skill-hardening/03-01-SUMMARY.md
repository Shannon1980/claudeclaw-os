---
phase: 03-skill-hardening
plan: 01
status: complete
requirements: [SK-04, SK-05]
---

# Plan 03-01 Summary — Skill hardening + delegated-write cwd fix

## What was done

Hardened the `aos` workspace agent so file-producing and self-improving skills work over chat, and fixed a cwd bug discovered during verification.

- **Task 1 (overlay):** Wrote a minimal operational `~/.claudeclaw/agents/aos/CLAUDE.md` (outside the repo; captured verbatim below) with two instructions — emit a bracketed `[SEND_FILE:]`/`[SEND_PHOTO:]` marker for any file a skill produces, and write a dated learning inline to `context/learnings.md` during the turn. Restarted the bot to load it.
- **SK-05 mechanism (SKILL.local.md):** The agent overlay alone did not make the learnings write fire — `mkt-copywriting`'s own SKILL.md gates logging behind an interactive feedback question (Step 10) that never answers in a one-shot turn, and the detailed skill procedure dominated the generic overlay. Fixed with a targeted `mkt-copywriting/SKILL.local.md` override (the agentic-os-native mechanism; local rules take precedence) that decouples logging from the feedback reply. Captured verbatim below.
- **Task 2 (SK-04, live):** `viz-interface-design`/`viz-nano-banana` invoked via `@aos:` produced a real PNG delivered as a chat attachment, no hard failure from CC Notify / humanizer / clickable paths / auto-download. **SK-04 met.**
- **Task 3 (SK-05, live):** After the SKILL.local override, full skill runs (Certly Prep headline, SignMeUp tagline, KindKiddos) each wrote a substantive dated entry to `learnings.md` inline, with no interactive feedback reply. **SK-05 mechanism met.**
- **cwd fix (the consequential find):** Verification revealed the agent's writes were landing in the ClaudeClaw repo root (`claudeclaw/context/learnings.md`, `claudeclaw/projects/...`), not the agentic-os workspace. Root cause: `delegateToAgent` (`src/orchestrator.ts`) called `runAgent` without passing the agent's `cwd`, so `runAgent`'s `effectiveCwd = cwd ?? agentCwd ?? PROJECT_ROOT` fell back to the bot's repo. Reads came from agentic-os (settingSources), but relative writes went to claudeclaw. Fix: resolve the delegated agent's cwd via `resolveAgentRuntime(agentId)` and pass it to `runAgent`. So writes now resolve against `project_dir` (agentic-os).

## Key files / changes

- `src/orchestrator.ts` — delegated runs now pass the agent's resolved `cwd` to `runAgent` (the only in-repo code change).
- `~/.claudeclaw/agents/aos/CLAUDE.md` — operational overlay (outside repo; verbatim below).
- `/Users/shannongueringer/App Repo/agentic-os/.claude/skills/mkt-copywriting/SKILL.local.md` — headless logging override (outside repo; verbatim below).

## Verification

- SK-04: PNG delivered as a chat attachment, no hard fail (live).
- SK-05 mechanism: real dated learnings entries produced inline from bot turns, decoupled from the interactive gate (live; content confirmed).
- cwd fix: builds clean, full suite at baseline (519 pass, same 4 pre-existing failures — 3 environmental `schedule-cli`, 1 known `dashboard` chatId bug). No new ClaudeClaw source beyond the orchestrator one-liner.
- **Pending post-deploy:** confirm that after deploying the cwd fix, a fresh `@aos:` skill turn writes its learning to `agentic-os/context/learnings.md` (not `claudeclaw/`). This closes SK-05's literal "agentic-os learnings.md" wording.

## Deviations / notes

- The overlay's "mandatory checklist" framing alone did not force the learnings write; the SKILL.local.md override (fixing the skill's own gated step) is what made SK-05 fire. Both are kept.
- The agent narrates nothing falsely — it genuinely wrote files; they just landed in the wrong root until the cwd fix. The stray `claudeclaw/context/` and `claudeclaw/projects/` dirs (untracked test artifacts) should be cleaned up post-deploy; do not commit them (tracked in `task_63f94aa5`).
- `task_63f94aa5` filed for the broader cwd-correctness work (regression test, stray-file cleanup, moving the real learnings to agentic-os).

## Overlay verbatim (`~/.claudeclaw/agents/aos/CLAUDE.md`)

```markdown
# AOS Agent Operational Overlay

You run headless under the ClaudeClaw bot, reached via `@aos:` delegation. Your replies go to a chat user (Slack or Telegram), not a terminal. Two operational rules make workspace skills behave correctly in this mode. These are operational only; your voice and personality come from the workspace files.

## Deliver files over chat
When a skill produces a file (image, PDF, HTML, doc, diagram), the chat user cannot see it just because it was saved or copied to ~/Downloads. You MUST also emit a marker in your final message so the bot uploads it as an attachment: [SEND_FILE:<absolute path>] (document), [SEND_PHOTO:<absolute path>] (image), [SEND_FILE:<absolute path>|short caption] (with caption). Use the bracketed form with the full absolute path the skill already printed (the workspace path contains a space, so a bare path truncates). Skills that copy output to ~/Downloads still do that copy; the marker is what reaches the chat user.

## Write learnings inline
Whenever you run a skill, you will not get an interactive feedback reply or session-end wrap-up in this mode, so the skill's own feedback/learnings step never fires. Record the learning yourself during the same turn: append a short dated bullet `- <YYYY-MM-DD>: <one-line learning>` to context/learnings.md under the skill's `## <skill-name>` section (Edit or Write). On-disk write is enough; no commit needed.

## Mandatory end-of-turn checklist
Before sending your final reply on ANY turn that ran a skill, you MUST have already: (1) appended the dated learnings bullet (a real file write), then (2) emitted a SEND_FILE/SEND_PHOTO marker for any file produced. Treat the learnings write as the last required action before replying, every time.
```

## SKILL.local.md verbatim (`mkt-copywriting/SKILL.local.md`)

```markdown
# mkt-copywriting Local Overrides
User-owned customizations. Loaded alongside SKILL.md. Local rules take precedence over the base.

## Rules
- 2026-06-15: HEADLESS LOGGING OVERRIDE. When this skill runs without an interactive user (delegated via the ClaudeClaw bot / @aos:, or any one-shot run), Step 10's feedback question never gets a reply, so the base "Log feedback" step never fires. In that mode, do NOT gate logging on the feedback reply. Before finishing, write the learning yourself: append a dated bullet to context/learnings.md under ## mkt-copywriting. On-disk write is sufficient.

## Step 10: Collect Feedback (override)
Headless / one-shot run: do not wait for a feedback reply. Append the dated learning bullet to context/learnings.md under ## mkt-copywriting during this turn, before the final reply. Interactive run: keep base behavior (ask, then log).
```

## Self-Check: PASSED (with one post-deploy confirmation)

SK-04 met live. SK-05 mechanism met live (real inline learnings). The cwd fix makes those writes land in the agentic-os workspace; the final on-disk location is confirmed after deploy.
