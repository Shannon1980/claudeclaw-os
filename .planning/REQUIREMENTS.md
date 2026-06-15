# Requirements: Consolidate Agentic OS into ClaudeClaw

**Defined:** 2026-06-14
**Core Value:** A terminal Claude Code session in the agentic-os workspace and the ClaudeClaw chat bot behave as one assistant — same identity, skills, memory, and scheduled jobs, with no divergence between modes.

## v1 Requirements

Requirements for this consolidation milestone. Each maps to roadmap phases.

### Workspace (the "afternoon win")

- [ ] **WS-01**: A ClaudeClaw agent can be configured with `project_dir` pointing at the agentic-os repo, and runs Claude Code with that directory as the SDK cwd
- [ ] **WS-02**: When pointed at the agentic-os workspace, the agent auto-loads that repo's CLAUDE.md/AGENTS.md as project context via SDK `settingSources`
- [ ] **WS-03**: The agent loads agentic-os `brand_context/` (voice, positioning, ICP) when a skill requests it, producing on-brand output over chat
- [ ] **WS-04**: The setup is documented so the user can reproduce or repoint an agent at any workspace without reading source

### Skills

- [ ] **SK-01**: Agentic OS's methodology skills (mkt-*, str-*, viz-*, meta-*) are discoverable and invocable by the agent running in the workspace
- [ ] **SK-02**: At least one representative brand/marketing skill produces a correct, on-brand result end-to-end when triggered over Slack/Telegram
- [ ] **SK-03**: Skills that produce file outputs (images, PDFs, docs) deliver them over chat via ClaudeClaw `[SEND_FILE:]`/`[SEND_PHOTO:]` markers
- [ ] **SK-04**: Skills that assume the Command Centre, agentic-os hooks, or auto-download-to-Downloads degrade gracefully when run headless (no hard failure; fall back or route through chat)
- [ ] **SK-05**: Skill self-improvement (feedback written to agentic-os `learnings.md`) continues to work when skills are invoked via the bot

### Memory

- [ ] **MEM-01**: ClaudeClaw's SQLite store is the single source of record for memory across both modes
- [ ] **MEM-02**: A chat exchange handled by the bot is written to ClaudeClaw memory and is retrievable in a later session
- [ ] **MEM-03**: Recent ClaudeClaw memories are rendered into agentic-os daily `context/memory/*.md` files as a derived projection a terminal session reads on startup
- [ ] **MEM-04**: Work done in a terminal Claude Code session is visible to the bot. (Re-scoped 2026-06-15: both modes run in the agentic-os workspace and share its native memory files (`context/MEMORY.md` + daily logs), so terminal work the agent records there is read by the bot's workspace agent on its next turn. Proven live. The earlier Stop-hook SQLite capture was dropped as fragile/redundant; the workspace files are the shared layer, and the projection (MEM-03) carries the bot->terminal direction.)
- [ ] **MEM-05**: memsearch is retired — no second semantic index runs, and memory recall still works through ClaudeClaw's embeddings
- [ ] **MEM-06**: The projection respects field-level encryption — markdown projections are produced through ClaudeClaw's decryption path, never raw ciphertext reads

### Scheduler

- [ ] **SCH-01**: ClaudeClaw's scheduler is the single job runner; the agentic-os cron engine no longer schedules or fires jobs
- [ ] **SCH-02**: ClaudeClaw's scheduler can read job definitions from agentic-os `cron/jobs/*.md` (YAML frontmatter + prompt body) and run them on schedule
- [ ] **SCH-03**: A migrated `cron/jobs/*.md` job fires at its configured time and writes its result where the user expects (status/log parity)
- [ ] **SCH-04**: No double-firing — a given job runs once per trigger even with both a terminal workflow and the bot present

### Identity

- [ ] **IDENT-01**: Each named fleet agent (Bertha, Forge, Samantha, Sentinel, Skylar, + future) has its own `SOUL.md` (personality/voice) loaded into its system prompt from `CLAUDECLAW_CONFIG/agents/<id>/SOUL.md`, separate from its role definition (`CLAUDE.md`); the workspace agent's `SOUL.md` is sourced from / aligned with the agentic-os `SOUL.md`
- [ ] **IDENT-02**: Personality rules from an agent's `SOUL.md` (tone, no-em-dash, etc.) are observably applied in that agent's responses, and are consistent between terminal and chat for the workspace agent
- [ ] **IDENT-03**: Soul is decoupled from role and resolved like role files (CLAUDECLAW_CONFIG first, repo fallback): `agents/_template/SOUL.md` scaffolds new agents, each existing named agent gains a distinct `SOUL.md`, and Skylar's existing inline `persona:` field is migrated into its `SOUL.md`

### Cockpit (Command Centre)

- [ ] **CKPT-01**: The agentic-os Command Centre reads ClaudeClaw's SQLite (through the correct decryption path) and displays current tasks/memory state
- [ ] **CKPT-02**: The Command Centre's own cron and memory engines are disabled so it never double-runs against ClaudeClaw
- [ ] **CKPT-03**: The Command Centre remains usable as a desktop view alongside the Slack/Telegram bot and terminal sessions

### Compatibility (cross-cutting)

- [ ] **COMPAT-01**: After each phase, both modes still work — a terminal Claude Code session in the workspace and the chat bot both respond correctly
- [ ] **COMPAT-02**: Existing ClaudeClaw behavior for agents NOT pointed at the workspace is unchanged (no regression to the default fleet)
- [ ] **COMPAT-03**: The existing ClaudeClaw test suite passes after each phase's changes

## v2 Requirements

Deferred — acknowledged but not in this milestone.

### Multi-client

- **MC-01**: Map agentic-os multi-client workspaces to per-client ClaudeClaw agents (one agent per client `project_dir`)
- **MC-02**: Per-client brand_context and memory isolation across the fleet

### Consolidation cleanup

- **CLN-01**: Remove now-dead agentic-os scheduling/memory code paths after the bridges are proven in production
- **CLN-02**: Single unified dashboard story (decide long-term whether Command Centre or Mission Control is primary)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Rebuilding ClaudeClaw runtime inside Agentic OS | Agentic OS has no transport/service; would be a rewrite of the harder half |
| Markdown/memsearch as memory source of record | SQLite is richer and always-on; markdown becomes a projection instead |
| Running two schedulers or two memory indexes | The whole point is to collapse duplication |
| Porting the Next.js Command Centre into the Preact dashboard | Command Centre is kept and repointed, not migrated |
| Cloud/hosted deployment | Both tools are local-first by design; unchanged here |

## Traceability

Mapped during roadmap creation (2026-06-14). COMPAT-* are cross-cutting and woven as success criteria into every phase; Phase 10 owns them explicitly for end-to-end verification.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WS-01 | Phase 1 | Pending |
| WS-02 | Phase 1 | Pending |
| WS-03 | Phase 1 | Pending |
| WS-04 | Phase 1 | Pending |
| SK-01 | Phase 2 | Pending |
| SK-02 | Phase 2 | Pending |
| SK-03 | Phase 2 | Pending |
| SK-04 | Phase 3 | Pending |
| SK-05 | Phase 3 | Pending |
| MEM-01 | Phase 4 | Pending |
| MEM-02 | Phase 4 | Pending |
| MEM-03 | Phase 5 | Pending |
| MEM-04 | Phase 5 | Pending |
| MEM-06 | Phase 5 | Pending |
| MEM-05 | Phase 6 | Pending |
| SCH-01 | Phase 7 | Pending |
| SCH-02 | Phase 7 | Pending |
| SCH-03 | Phase 7 | Pending |
| SCH-04 | Phase 7 | Pending |
| IDENT-01 | Phase 8 | Pending |
| IDENT-02 | Phase 8 | Pending |
| IDENT-03 | Phase 8 | Pending |
| CKPT-01 | Phase 9 | Pending |
| CKPT-02 | Phase 9 | Pending |
| CKPT-03 | Phase 9 | Pending |
| COMPAT-01 | Phase 10 (woven into all) | Pending |
| COMPAT-02 | Phase 10 (woven into all) | Pending |
| COMPAT-03 | Phase 10 (woven into all) | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-14*
*Last updated: 2026-06-14 after roadmap creation (traceability populated)*
