# Roadmap: Consolidate Agentic OS into ClaudeClaw

## Overview

This consolidation makes a terminal Claude Code session in the agentic-os workspace and the ClaudeClaw chat bot behave as one assistant — same identity, skills, memory, and scheduled jobs. ClaudeClaw is the host runtime; agentic-os becomes the workspace and skill library it runs against. The journey starts with a low-risk "afternoon win" (point an agent at the workspace, get skills working over Slack) to derisk everything before any bridge work. From there it sequences the bridges by risk: skills hardening, then the hardest bridge (memory: source-of-record, markdown projection, memsearch retirement), then scheduler, identity, and the Command Centre repoint. A final phase explicitly owns the cross-cutting compatibility guardrails — both modes always working, no fleet regression, tests green — though those guardrails are woven into every phase as success criteria too. All schema changes go through ClaudeClaw's versioned migration system (`migrations/<version>/`, see the `add-migration` skill).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Afternoon Win — Point Agent at Workspace** - Configure an agent's project_dir at agentic-os, auto-load its context, document the setup (completed 2026-06-14)
- [x] **Phase 2: Skills Over Chat** - Agentic-os methodology skills discoverable and invocable over Slack/Telegram, file outputs delivered via markers (completed 2026-06-15)
- [x] **Phase 3: Skill Hardening** - Command-Centre/hook/download-dependent skills degrade gracefully headless; skill self-improvement keeps working (completed 2026-06-15)
- [x] **Phase 4: Memory Source of Record** - ClaudeClaw SQLite is the single memory store; bot exchanges persist and recall across sessions (completed 2026-06-15)
- [x] **Phase 5: Memory Projection & Capture** - SQLite memories render to agentic-os daily markdown; terminal-session work captured back via hooks (completed 2026-06-15)
- [x] **Phase 6: memsearch Retirement** - Second semantic index disabled; recall runs entirely through ClaudeClaw embeddings (completed 2026-06-16)
- [ ] **Phase 7: Single Scheduler** - ClaudeClaw scheduler reads agentic-os cron/jobs/*.md and is the only runner; agentic-os cron disabled, no double-fire
- [ ] **Phase 8: Per-Agent Soul** - Every agent gets its own SOUL.md (voice) separate from its role CLAUDE.md; workspace agent's soul aligns with agentic-os SOUL.md
- [ ] **Phase 9: Command Centre Repoint** - Command Centre reads ClaudeClaw SQLite through the decryption path; its own cron/memory engines disabled
- [ ] **Phase 10: Compatibility Verification** - Both modes proven working end-to-end, no default-fleet regression, full test suite green

## Phase Details

### Phase 1: Afternoon Win — Point Agent at Workspace
**Goal**: A ClaudeClaw agent runs Claude Code with the agentic-os repo as its working directory, auto-loading that workspace's project context, with reproducible setup docs.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: WS-01, WS-02, WS-03, WS-04
**Success Criteria** (what must be TRUE):
  1. An agent configured with `project_dir` pointing at the agentic-os repo runs Claude Code with that directory as the SDK cwd, verifiable over Slack
  2. The agent's responses reflect agentic-os CLAUDE.md/AGENTS.md context (it knows the workspace's instructions without being told)
  3. A skill that requests `brand_context/` (voice, positioning, ICP) produces observably on-brand output over chat
  4. A setup doc exists that lets the user repoint an agent at any workspace without reading source
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Workspace agent config + WS-01 test gap + live WS-02/WS-03 verification
- [x] 01-02-PLAN.md — Reproducible workspace-agent setup doc (WS-04)

### Phase 2: Skills Over Chat
**Goal**: The agentic-os methodology skills are discoverable and invocable by the workspace agent, and a real brand/marketing skill runs end-to-end over chat including delivering any file output.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: SK-01, SK-02, SK-03
**Success Criteria** (what must be TRUE):
  1. The agent can list/invoke agentic-os methodology skills (mkt-*, str-*, viz-*, meta-*) when running in the workspace
  2. At least one representative brand/marketing skill triggered over Slack/Telegram produces a correct, on-brand result end-to-end
  3. A skill that produces a file (image, PDF, doc) delivers it as a chat attachment via `[SEND_FILE:]`/`[SEND_PHOTO:]` markers
  4. The existing default-fleet agents (not pointed at the workspace) behave exactly as before
**Plans**: 2 plans
**UI hint**: yes

Plans:
- [x] 02-01-PLAN.md — Delegation-path file-marker fix (mirror mission-files.ts) + Wave 0 unit tests (space-in-path, delegation extraction)
- [x] 02-02-PLAN.md — Pre-warm excalidraw venv, aos slack_channel config (human-action), live SK-01/SK-02/SK-03 transcripts

### Phase 3: Skill Hardening
**Goal**: Skills that assume the Command Centre, agentic-os hooks, or auto-download-to-Downloads no longer hard-fail headless, and skill self-improvement feedback keeps flowing.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: SK-04, SK-05
**Success Criteria** (what must be TRUE):
  1. A skill that normally relies on the Command Centre / agentic-os hooks / auto-download runs over chat without a hard failure (falls back or routes output through chat)
  2. File outputs that would have hit the Downloads folder are instead delivered through ClaudeClaw `[SEND_FILE:]` markers
  3. Skill self-improvement feedback written to agentic-os `learnings.md` is produced when a skill is invoked via the bot
  4. No regression to the default fleet and the test suite stays green
**Plans**: 1 plan

Plans:
- [x] 03-01-PLAN.md — aos agent-role overlay (SEND_FILE marker + inline learnings write) + live SK-04/SK-05 verification

### Phase 4: Memory Source of Record
**Goal**: ClaudeClaw's SQLite store is the single source of record for memory across both modes, and a bot exchange is durably written and recallable later.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: MEM-01, MEM-02
**Success Criteria** (what must be TRUE):
  1. A chat exchange handled by the bot is written to ClaudeClaw memory and retrieved as relevant context in a later, separate session
  2. Memory writes/reads are scoped correctly to the workspace agent (no cross-agent leakage into the workspace agent's recall)
  3. The memory pipeline (ingest, embeddings, recall) runs against `store/claudeclaw.db` with no second store involved
  4. Any schema change required is delivered as a versioned migration under `migrations/<version>/` and the test suite passes
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md — strictAgentId scoping on the delegated recall call + Wave 0 unit tests (strict per-agent recall, single-store path assertion, full suite)
- [x] 04-02-PLAN.md — deploy + restart, live two-session MEM-02 recall proof (human-verify)

### Phase 5: Memory Projection & Capture
**Goal**: Recent ClaudeClaw memories render into agentic-os daily `context/memory/*.md` as a derived projection (via the decryption-safe path), and terminal-session work is captured back into SQLite so the bot sees it.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: MEM-03, MEM-04, MEM-06
**Success Criteria** (what must be TRUE):
  1. A terminal Claude Code session started in the workspace reads a daily `context/memory/*.md` file that reflects recent ClaudeClaw memories
  2. Work done in a terminal session (captured via a Stop hook) appears in ClaudeClaw memory and surfaces in a later bot conversation
  3. The projection reads memory data through ClaudeClaw's own access/decryption path — never raw ciphertext reads of encrypted columns
  4. The hook wiring is connected into the message/session lifecycle (hooks actually fire, not dead code) and the test suite passes
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md — workspace-memory-key helper + delegation save/recall wiring + memory-projection.ts + capture-cli.ts + Wave 0 unit tests (MEM-03, MEM-04, MEM-06)
- [x] 05-02-PLAN.md — build + symlink + agentic-os Stop hook + SessionStart loader edit + live terminal/bot round-trip (MEM-03, MEM-04 human-verify)

### Phase 6: memsearch Retirement
**Goal**: The agentic-os memsearch semantic index is retired so only one semantic index runs, and memory recall still works entirely through ClaudeClaw's embeddings.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: MEM-05, MEM-04 (re-opened, folded in)
**Success Criteria** (what must be TRUE):
  1. The memsearch index/cron no longer runs (no second semantic index process or nightly job firing)
  2. Memory recall in both modes still returns relevant results using ClaudeClaw's embeddings only
  3. A terminal session that previously relied on memsearch now gets equivalent recall from the SQLite-backed path or the markdown projection
  4. No default-fleet regression and the test suite passes
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md — recall-cli.ts + recallForWorkspace wrapper + Wave 0 single-index test + build (MEM-05)
- [x] 06-02-PLAN.md — AGENTS.md Tier-1 rewrite + nightly cron disable + committed capture Stop hook (MEM-05, MEM-04)
- [x] 06-03-PLAN.md — full-suite regression gate + live bidirectional round-trip proof (MEM-05, MEM-04, human-verify)

### Phase 7: Single Scheduler
**Goal**: ClaudeClaw's scheduler is the only job runner: it reads agentic-os `cron/jobs/*.md` definitions, fires them on schedule with status/log parity, and the agentic-os cron engine is disabled with no double-firing.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: SCH-01, SCH-02, SCH-03, SCH-04
**Success Criteria** (what must be TRUE):
  1. ClaudeClaw's scheduler loads a job defined in an agentic-os `cron/jobs/*.md` file (YAML frontmatter + prompt body) and runs it on schedule
  2. A migrated job fires at its configured time and writes its result where the user expects (status/log parity with the old behavior)
  3. The agentic-os cron engine no longer schedules or fires any jobs
  4. A given job runs exactly once per trigger even with both a terminal workflow and the bot present (no double-fire), verified against the cross-process claim path
  5. Any scheduler schema change ships as a versioned migration and the test suite passes
**Plans**: 5 plans

Plans:
- [x] 07-01-PLAN.md — Versioned migration (aos-cron columns) + db.ts atomic claimDueTask + aos-row helpers
- [ ] 07-02-PLAN.md — src/aos-cron.ts: frontmatter+body parser, time/days->cron mapping, syncAosCronJobs lifecycle
- [ ] 07-03-PLAN.md — com.claudeclaw.aos launchd plist (spaces-safe /tmp logs, crash recovery)
- [ ] 07-04-PLAN.md — aos firing loop in scheduler.ts (atomic claim, prompt re-read, timeout/retry, notify, no preamble) + index.ts wiring
- [ ] 07-05-PLAN.md — Cutover + live proof: CRON_IN_PROCESS gate, migrate+restart, load aos service, no-double-fire human-verify (LAST)

### Phase 8: Per-Agent Soul
**Goal**: Introduce a per-agent `SOUL.md` that defines each named agent's personality/voice, loaded into its system prompt separately from its role (`CLAUDE.md`). Souls resolve like role files (`CLAUDECLAW_CONFIG/agents/<id>/SOUL.md` first, repo fallback), mirroring `resolveAgentClaudeMd` in `src/agent-config.ts`. The workspace agent's soul aligns with agentic-os `SOUL.md`; the existing named fleet (Bertha, Forge, Samantha, Sentinel, Skylar) each gain a distinct soul without losing role behavior.
**Mode:** mvp
**Depends on**: Phase 7
**Requirements**: IDENT-01, IDENT-02, IDENT-03
**Success Criteria** (what must be TRUE):
  1. `agent-config.ts` loads a per-agent `SOUL.md` into the system prompt, resolved from `CLAUDECLAW_CONFIG/agents/<id>/SOUL.md` (repo fallback), distinct from and in addition to the role `CLAUDE.md`
  2. The workspace agent's `SOUL.md` is sourced from / matches agentic-os `SOUL.md`, and its voice is observably consistent between a terminal session and a chat response for an equivalent prompt
  3. Personality rules from an agent's `SOUL.md` (tone, no-em-dash, etc.) are observably applied in that agent's responses
  4. `agents/_template/SOUL.md` scaffolds new agents; each existing named agent (Bertha, Forge, Samantha, Sentinel, Skylar) gets a distinct `SOUL.md`, and Skylar's existing inline `persona:` field is migrated into its `SOUL.md` with no role regression
**Plans**: TBD

### Phase 9: Command Centre Repoint
**Goal**: The agentic-os Command Centre survives as a desktop cockpit reading ClaudeClaw's SQLite through the correct decryption path, with its own cron and memory engines disabled.
**Mode:** mvp
**Depends on**: Phase 8
**Requirements**: CKPT-01, CKPT-02, CKPT-03
**Success Criteria** (what must be TRUE):
  1. The Command Centre displays current tasks and memory state read from ClaudeClaw's `store/claudeclaw.db` (through ClaudeClaw's decryption path, never raw ciphertext)
  2. The Command Centre's own cron and memory engines are disabled so it never double-runs against ClaudeClaw
  3. The Command Centre remains usable as a desktop view alongside the Slack/Telegram bot and terminal sessions
  4. The test suite passes and the default fleet is unaffected
**Plans**: TBD
**UI hint**: yes

### Phase 10: Compatibility Verification
**Goal**: Prove the consolidation end-to-end — both modes behave as one assistant, the default fleet is unregressed, and the full test suite is green — and own the cross-cutting compatibility guarantees explicitly.
**Mode:** mvp
**Depends on**: Phase 9
**Requirements**: COMPAT-01, COMPAT-02, COMPAT-03
**Success Criteria** (what must be TRUE):
  1. A terminal Claude Code session in the workspace and the chat bot both respond correctly to the same task, sharing identity, skills, memory, and scheduled jobs
  2. Existing ClaudeClaw behavior for agents NOT pointed at the workspace is verified unchanged (no default-fleet regression)
  3. The existing ClaudeClaw test suite passes with the consolidation in place
  4. There is exactly one scheduler and one memory store running across the whole system
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Afternoon Win | 2/2 | Complete   | 2026-06-14 |
| 2. Skills Over Chat | 2/2 | Complete   | 2026-06-15 |
| 3. Skill Hardening | 1/1 | Complete   | 2026-06-15 |
| 4. Memory Source of Record | 1/2 | In Progress|  |
| 5. Memory Projection & Capture | 1/2 | In Progress|  |
| 6. memsearch Retirement | 3/3 | Complete   | 2026-06-16 |
| 7. Single Scheduler | 1/5 | In Progress|  |
| 8. Per-Agent Soul | 0/TBD | Not started | - |
| 9. Command Centre Repoint | 0/TBD | Not started | - |
| 10. Compatibility Verification | 0/TBD | Not started | - |
