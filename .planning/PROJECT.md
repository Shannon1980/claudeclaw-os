# ClaudeClaw

> **Milestone history:** v1.0 "Agentic OS Consolidation" (Phases 1-7) shipped 2026-06-19. The
> project has since pivoted to the operator-product direction; v2.0 "Operator Product" is in
> planning. The "What This Is" / "Core Value" below describe the v1.0 consolidation framing and are
> evolved by `/gsd-new-milestone` for v2.0.

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

<!-- Delivered in milestone v1.0 (Agentic OS Consolidation), Phases 1-7. -->

- ✓ A ClaudeClaw agent points its `project_dir` at the agentic-os repo so the SDK auto-loads its CLAUDE.md/AGENTS.md, SOUL identity, brand_context, and `.claude/skills/` — v1.0 (Phase 1)
- ✓ Agentic OS's ~22 methodology skills (mkt-*, str-*, viz-*, meta-*) are available and work end-to-end over Slack/Telegram — v1.0 (Phase 2)
- ✓ Skills that assume the Command Centre, hooks, or auto-download degrade gracefully when run headless, or route file outputs through `[SEND_FILE:]` markers — v1.0 (Phase 3)
- ✓ ClaudeClaw SQLite is the single source of record for memory; memsearch is retired — v1.0 (Phases 4, 6)
- ✓ Agentic OS daily `context/memory/*.md` files are rendered as a derived projection from SQLite via hooks — v1.0 (Phase 5)
- ✓ ClaudeClaw's scheduler is the single job runner and reads agentic-os `cron/jobs/*.md`; the agentic-os cron engine is disabled — v1.0 (Phase 7)
- ✓ Shipped the "afternoon win" first (workspace + skills over chat) before bridge work — v1.0 (Phase 1)

### Active

<!-- v2.0 (Operator Product) requirements are defined by /gsd-new-milestone from specs/operator-product/. -->

(Defining v2.0 requirements — see `specs/operator-product/`.)

### Deferred (v1.0 cut — backlog)

<!-- Planned under v1.0 but not executed; deferred at the pivot to the operator-product direction. -->

- [ ] A single persona: the bot's identity is driven by the agentic-os SOUL.md rather than a separate ClaudeClaw CLAUDE.md persona (was Phase 8 — Per-Agent Soul)
- [ ] The Command Centre survives as a desktop cockpit, repointed to read ClaudeClaw's SQLite, with its own cron and memory engines disabled (was Phase 9 — Command Centre Repoint)
- [ ] Both modes proven working end-to-end, no default-fleet regression, full test suite green (was Phase 10 — Compatibility Verification)

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
| Every named agent gets its own `SOUL.md` (voice), separate from role `CLAUDE.md` | The fleet is named characters (Bertha, Forge, Samantha, Sentinel, Skylar); soul ≠ role. agentic-os SOUL.md is the workspace agent's soul, not a fleet-wide override | — Pending |

**Fleet location:** the real fleet lives in `CLAUDECLAW_CONFIG/agents/<id>/` (default `~/.claudeclaw/agents/`): Bertha, Forge, Samantha, Sentinel, Skylar — each with `agent.yaml` + `CLAUDE.md`. The repo's `agents/` (comms, content, ops, research, _template) are examples/templates. `agent-config.ts` resolves `CLAUDECLAW_CONFIG` first, repo as fallback. Skylar's `agent.yaml` already has an inline `persona:` field to migrate into `SOUL.md`.

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
*Last updated: 2026-06-22 after v1.0 (Agentic OS Consolidation) milestone close; pivoting to v2.0 Operator Product*
