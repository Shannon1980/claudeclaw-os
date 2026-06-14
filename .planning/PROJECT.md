# Consolidate Agentic OS into ClaudeClaw

## What This Is

A consolidation of two of Shannon's personal-assistant projects into one tool. ClaudeClaw (this repo, a persistent TypeScript/Node service that runs Claude Code and exposes it over Slack/Telegram with multi-agent, scheduling, SQLite memory, and a dashboard) becomes the single host runtime. Agentic OS (`/Users/shannongueringer/App Repo/agentic-os`, a Claude Code workspace template providing personality, brand context, and ~22 self-improving methodology skills) becomes the workspace and skill library that ClaudeClaw runs against. The end state is one assistant, usable identically from a terminal Claude Code session and from the Slack/Telegram bot, sharing one memory store and one scheduler.

## Core Value

A terminal Claude Code session in the agentic-os workspace and the ClaudeClaw chat bot must behave as one assistant: same identity, same skills, same memory, same scheduled jobs. No divergence between the two modes.

## Requirements

### Validated

<!-- Inferred from existing ClaudeClaw code — already shipped and relied upon. -->

- ✓ Runs Claude Code via the Agent SDK `query()` against a configurable cwd — existing (`src/agent.ts`, `settingSources: ['project','user']`)
- ✓ Per-agent `project_dir` in `agent.yaml` becomes the SDK cwd — existing (`src/agent-config.ts`)
- ✓ Slack (Socket Mode) and Telegram (grammy) transports with unified message pipeline — existing (`src/slack-bot.ts`, `src/bot.ts`, `src/message-core.ts`)
- ✓ Multi-agent fleet with delegation and mission tasks — existing (`src/orchestrator.ts`, `src/mission-cli.ts`)
- ✓ SQLite-backed scheduler (cron + one-shot), recovers stuck tasks — existing (`src/scheduler.ts`, `src/schedule-cli.ts`)
- ✓ SQLite memory with embeddings, ingestion, consolidation, decay; field-level AES-GCM encryption — existing (`src/memory.ts`, `src/memory-ingest.ts`, `src/memory-consolidate.ts`, `src/db.ts`)
- ✓ Preact dashboard (Mission Control) over a Hono server — existing (`src/dashboard.ts`, `web/`)
- ✓ User hooks around message processing — existing (`src/hooks.ts`)
- ✓ `[SEND_FILE:]` / `[SEND_PHOTO:]` markers deliver generated files over chat — existing
- ✓ launchd deployment as a persistent service — existing (`launchd/`)

### Active

<!-- This consolidation. Hypotheses until shipped and validated. -->

- [ ] A ClaudeClaw agent points its `project_dir` at the agentic-os repo so the SDK auto-loads its CLAUDE.md/AGENTS.md, SOUL identity, brand_context, and `.claude/skills/`
- [ ] Agentic OS's ~22 methodology skills (mkt-*, str-*, viz-*, meta-*) are available and work end-to-end over Slack/Telegram
- [ ] Skills that assume the Command Centre, hooks, or auto-download degrade gracefully when run headless, or route file outputs through ClaudeClaw `[SEND_FILE:]` markers
- [ ] ClaudeClaw SQLite is the single source of record for memory; memsearch is retired
- [ ] Agentic OS daily `context/memory/*.md` files are rendered as a derived projection from SQLite (via SessionStart/Stop hooks) so terminal sessions stay informed
- [ ] ClaudeClaw's scheduler is the single job runner and can read agentic-os `cron/jobs/*.md` definitions; the agentic-os cron engine is disabled
- [ ] A single persona: the bot's identity is driven by the agentic-os SOUL.md rather than a separate ClaudeClaw CLAUDE.md persona
- [ ] The Command Centre survives as a desktop cockpit, repointed to read ClaudeClaw's SQLite, with its own cron and memory engines disabled
- [ ] An "afternoon win" milestone ships first: point an agent at the workspace + make skills available, testable over Slack, before any bridge work

### Out of Scope

- Rebuilding ClaudeClaw's runtime inside Agentic OS — Agentic OS has no transport or persistent service; this would be a rewrite of the harder half
- Replacing ClaudeClaw's SQLite memory with markdown/memsearch as the source of record — SQLite is the richer, always-on engine; markdown becomes a projection instead
- Running two schedulers or two memory indexes simultaneously — the entire point is to collapse duplication
- Cloud/hosted deployment changes — both tools are local-first by design; this project does not change that
- Migrating agentic-os's Next.js Command Centre into the Preact dashboard — the Command Centre is kept and repointed, not ported

## Context

- Two independent analyses (one in-session, one from "claude co-work") converged on the same direction: ClaudeClaw as host, Agentic OS as consumed workspace, with overlapping subsystems de-duplicated. The only divergence was memory-store direction, resolved as: SQLite = source of record, markdown = derived projection.
- ClaudeClaw already spawns Claude Code in any working directory with `settingSources: ['project','user']`, so pointing it at the agentic-os workspace loads that repo's CLAUDE.md/AGENTS.md and `.claude/skills/` with near-zero glue. This is why the "afternoon win" is mostly configuration.
- Constraint from the user: terminal-first, both modes (terminal Claude Code sessions AND the bot) must share memory and scheduling. The agentic-os brand/marketing skill packs are core to the user's work, not a nice-to-have.
- Codebase map for ClaudeClaw lives in `.planning/codebase/` (STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS). Agentic OS architecture was mapped in-session and will be supplied to planning agents directly.
- Key integration touchpoints in ClaudeClaw: `src/agent-config.ts` (cwd/project_dir), `src/memory.ts` + `src/memory-ingest.ts` + `src/db.ts` (memory source of record + projection), `src/scheduler.ts` (single runner reading external job files), `src/hooks.ts` (SessionStart/Stop projection hooks), and the dashboard/Command Centre data boundary.
- Risk areas flagged during mapping: field-level AES-GCM encryption complicates any external process reading the same SQLite DB (the Command Centre repoint must use ClaudeClaw's decryption path); scheduler concurrency/locking when adding an external job source; agent-config cwd resolution edge cases.

## Constraints

- **Tech stack**: TypeScript/Node (ClaudeClaw) is the host. Agentic OS contributes bash + a Next.js Command Centre + markdown skills. No rewrite of either runtime in the other's language.
- **Compatibility**: Both modes (terminal Claude Code session and chat bot) must keep working throughout; never leave the user without a working assistant between phases.
- **Data**: ClaudeClaw memory DB is encrypted (AES-GCM). Anything reading it (Command Centre, projections) must go through ClaudeClaw's decryption, not raw better-sqlite3 reads of ciphertext.
- **Single source of truth**: exactly one scheduler and one memory store after consolidation.
- **Sequencing**: ship the low-risk "afternoon win" (workspace + skills over chat) before building the memory/scheduler/identity bridges, to derisk.
- **Locality**: remains local-first; no new cloud dependencies.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| ClaudeClaw is the host; Agentic OS is the consumed workspace | ClaudeClaw is the harder-to-rebuild engine (transports, fleet, persistent service, tests); Agentic OS value is portable content/skills | — Pending |
| Point an agent's `project_dir` at the agentic-os repo | SDK `settingSources:['project','user']` auto-loads its CLAUDE.md/AGENTS.md + skills with near-zero glue | — Pending |
| SQLite = memory source of record; markdown = derived projection; retire memsearch | SQLite is richer (embeddings, consolidation, decay, encryption) and always-on; terminal stays informed via projection hooks | — Pending |
| ClaudeClaw scheduler is the single runner, reads `cron/jobs/*.md`; disable agentic-os cron | One scheduler avoids double-firing and double memory writes | — Pending |
| Keep Command Centre as desktop cockpit, repointed at ClaudeClaw SQLite | Already uses better-sqlite3; gives terminal-first desktop UI without duplication | — Pending |
| Ship the "afternoon win" as the first milestone | Validates skills-over-chat before committing to bridge work | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-14 after initialization*
