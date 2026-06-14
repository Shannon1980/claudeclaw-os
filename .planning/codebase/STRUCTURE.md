# Codebase Structure

**Analysis Date:** 2026-06-14

## Directory Layout

```
claudeclaw/
├── src/                    # All TypeScript source (~100 modules)
├── web/                    # Preact SPA (dashboard frontend)
│   ├── src/
│   │   ├── pages/          # Route-level page components
│   │   ├── components/     # Shared UI components
│   │   ├── lib/            # Frontend utilities (api, sidebar, routes)
│   │   └── styles/         # CSS
│   └── public/             # Static assets
├── agents/                 # Sub-agent definitions
│   ├── _template/          # Template for new agents
│   ├── comms/              # Comms agent
│   ├── content/            # Content agent
│   ├── ops/                # Ops agent
│   └── research/           # Research agent
├── warroom/                # Python/Pipecat voice server
│   ├── server.py           # WebSocket voice entry point
│   ├── agent_bridge.py     # Agent SDK bridge (Python)
│   ├── router.py           # Voice routing logic
│   ├── personas.py         # Agent voice personas
│   ├── daily_agent.py      # Daily.co integration
│   ├── config.py           # Voice server config
│   └── .venv/              # Python venv (not committed)
├── launchd/                # macOS launchd plists for auto-start
├── migrations/             # Versioned schema migrations
│   └── version.json        # Migration registry (semver keys → [filename])
├── skills/                 # Project-local Claude Code skills
│   ├── gmail/
│   ├── google-calendar/
│   ├── slack/
│   ├── timezone/
│   └── tldr/
├── .claude/                # Claude Code project config
│   └── skills/
│       └── add-migration/  # Skill: create versioned DB migrations
├── .planning/              # GSD planning documents
│   └── codebase/           # Codebase map documents (this file)
├── store/                  # Runtime data (git-ignored, created on first run)
│   └── claudeclaw.db       # Single SQLite database file
├── dist/                   # Compiled JS output (git-ignored)
├── assets/                 # Static assets (logo, etc.)
├── docs/                   # Supplementary documentation
├── scripts/                # Shell scripts (notify.sh, setup helpers)
├── setup/                  # Interactive setup scripts
├── src/index.ts            # Main entry point
├── CLAUDE.md               # Bot personality (personal, not committed to repo)
├── CLAUDE.md.example       # Template for CLAUDE.md
├── package.json
├── tsconfig.json
├── vite.config.ts          # Vite config for SPA build
└── vitest.config.ts        # Vitest config for unit tests
```

## Directory Purposes

**`src/`:**
- Purpose: All Node.js TypeScript source. Compiled to `dist/` via `tsc`.
- Contains: ~100 modules covering every system concern
- Key files: `index.ts` (entry), `agent.ts` (SDK wrapper), `agent-config.ts` (agent identity), `message-core.ts` (pipeline), `db.ts` (all DB ops), `dashboard.ts` (Hono server), `scheduler.ts` (cron + mission worker), `memory.ts` / `memory-ingest.ts` / `memory-consolidate.ts` (memory system)

**`web/src/`:**
- Purpose: Preact SPA for the dashboard, built by Vite and served as static files by `src/dashboard.ts`
- Contains: Route pages (15+), shared components (14+), lib utilities
- Key files: `App.tsx` (router), `pages/Chat.tsx` (live chat), `pages/MissionControl.tsx` (kanban), `pages/Agents.tsx` (agent management), `pages/Memories.tsx` (memory viewer)

**`agents/`:**
- Purpose: Sub-agent definitions. Each sub-directory is one agent. The `_template/` directory is excluded from scanning (prefix `_`).
- Contains: `agent.yaml` (config) + `CLAUDE.md` (system prompt) per agent
- Scanned by: `listAgentIds()` in `src/agent-config.ts` (also scans `CLAUDECLAW_CONFIG/agents/`)

**`warroom/`:**
- Purpose: Python voice meeting server. Spawned as a subprocess by `src/index.ts` when `WARROOM_ENABLED=true`. Communicates with the dashboard over WebSocket (port `WARROOM_PORT`).
- Contains: Pipecat-based WebSocket server, Daily.co integration, agent voice routing
- Runtime: Python venv at `warroom/.venv/` (not committed, installed separately)

**`launchd/`:**
- Purpose: macOS LaunchAgent plist files for running each agent as a background service on login. One plist per agent (main + all sub-agents + sentinel + meta).
- Key constraint: Log paths must never contain spaces (macOS launchd exits code 78 for spaced log paths). Use `/tmp/claudeclaw-<agent>.log` or `~/Library/Logs/`.

**`migrations/`:**
- Purpose: Versioned DB migrations. `version.json` maps semver versions to arrays of migration filenames. `migrations.ts` checks `version.json` at startup and prints warnings for unapplied migrations.
- Pattern: Migrations are `.ts` files with a `run()` export. Not auto-applied — the operator runs them manually via `npm run migrate`.
- Only file: `version.json` (the migration `.ts` files themselves are in subdirectories named by semver)

**`skills/`:**
- Purpose: Project-local Claude Code skills (gmail, google-calendar, slack, timezone, tldr). Loaded by the Claude SDK via `settingSources: ['project', 'user']`.
- Key convention: Each skill has a `SKILL.md` (lightweight index) and `rules/` subdirectory for detailed rule files

**`store/` (runtime, git-ignored):**
- Purpose: All runtime state. Created by the app on first run.
- Key files: `claudeclaw.db` (single SQLite file with all tables), `claudeclaw.pid` / `agent-<id>.pid` (process lock files), `avatars/` (uploaded agent avatars)

**`dist/` (git-ignored):**
- Purpose: TypeScript compiler output. `src/` compiles to `dist/` via `tsc`.
- Key CLI entry points after build: `dist/index.js`, `dist/schedule-cli.js`, `dist/mission-cli.js`

## Key File Locations

**Entry Points:**
- `src/index.ts`: Main process bootstrap (start everything)
- `src/schedule-cli.ts` → `dist/schedule-cli.js`: Scheduled task CRUD (invoked by agents via Bash)
- `src/mission-cli.ts` → `dist/mission-cli.js`: Mission task CRUD (invoked by agents via Bash)
- `src/agent-create-cli.ts` → `dist/agent-create-cli.js`: Agent provisioning wizard

**Configuration:**
- `src/config.ts`: All env var reads and mutable agent overrides. Import `AGENT_ID`, `PROJECT_ROOT`, `STORE_DIR`, etc. from here.
- `src/env.ts`: `readEnvFile()` — reads `.env` without polluting `process.env`
- `.env`: Environment variables (git-ignored; use `.env.example` as template)
- `CLAUDECLAW_CONFIG` (default `~/.claudeclaw`): External personal config dir (CLAUDE.md, agents)

**Core Pipeline:**
- `src/message-core.ts`: `processUserMessage()` — the transport-agnostic pipeline
- `src/agent.ts`: `runAgent()`, `runAgentWithRetry()`, `loadMcpServers()`
- `src/agent-config.ts`: `loadAgentConfig()`, `resolveAgentDir()`, `resolveAgentRuntime()`, `getSlackChannelMap()`
- `src/orchestrator.ts`: `delegateToAgent()`, `parseDelegation()`, `initOrchestrator()`
- `src/scheduler.ts`: `initScheduler()`, `computeNextRun()`
- `src/message-queue.ts`: `messageQueue` singleton (per-chatId FIFO)

**Memory System:**
- `src/memory.ts`: `buildMemoryContext()`, `saveConversationTurn()`, `runDecaySweep()`
- `src/memory-ingest.ts`: `ingestConversationTurn()`, `extractViaClaude()`, `getIngestionQuotaStatus()`
- `src/memory-consolidate.ts`: `runConsolidation()`
- `src/embeddings.ts`: `embedText()`, `cosineSimilarity()` (Gemini embedding-001)

**Database:**
- `src/db.ts`: All SQLite operations, schema creation, `initDatabase()`. Single module, single connection. All queries here.

**Dashboard:**
- `src/dashboard.ts`: Hono app, all `/api/*` routes, SSE stream at `/api/chat/stream`
- `src/dashboard-html.ts`: Returns the SPA HTML shell
- `web/src/App.tsx`: Preact SPA router
- `web/src/pages/`: One file per dashboard page/route

**Transports:**
- `src/bot.ts`: Telegram transport (grammy). `createBot()` factory.
- `src/slack-bot.ts`: Slack transport (bolt). `createSlackBot()` factory.

**Security / Safety:**
- `src/security.ts`: Kill phrase check, emergency kill, audit logging, `getScrubbedSdkEnv()`
- `src/kill-switches.ts`: `requireEnabled()` gatekeeper for LLM spawning
- `src/exfiltration-guard.ts`: Scan response for leaked secrets before sending
- `src/hooks.ts`: Plugin hook registry and runner

**War Room (Text):**
- `src/warroom-text-orchestrator.ts`: `handleTextTurn()` — multi-agent text meeting driver
- `src/warroom-text-router.ts`: Agent routing classifier for text war rooms
- `src/warroom-text-events.ts`: SSE channel management for text war room streaming
- `src/warroom-tool-policy.ts`: Per-agent tool allowlists for war room SDK calls

**War Room (Voice):**
- `warroom/server.py`: Python WebSocket server (Pipecat)
- `warroom/agent_bridge.py`: Bridges Python voice loop to the Node agent SDK
- `warroom/router.py`: Voice-side agent routing

**Agents:**
- `agents/_template/agent.yaml.example`: Canonical template for new agent.yaml files
- `agents/_template/CLAUDE.md`: Template CLAUDE.md for sub-agents
- `agents/<id>/agent.yaml`: Live agent config (copied from template)
- `agents/<id>/CLAUDE.md`: Live agent system prompt

**Testing:**
- `src/*.test.ts`: Co-located unit/integration tests (vitest)
- `src/test-env-setup.ts`: Test environment bootstrap
- `vitest.config.ts`: Vitest configuration

## Naming Conventions

**Files:**
- Source modules: `kebab-case.ts` (e.g., `message-core.ts`, `agent-config.ts`)
- Test files: co-located, same name + `.test.ts` suffix (e.g., `agent.test.ts`, `hooks.test.ts`)
- CLI entry points: `<noun>-cli.ts` (e.g., `schedule-cli.ts`, `mission-cli.ts`)
- HTML generators: `<name>-html.ts` (e.g., `dashboard-html.ts`, `warroom-html.ts`)
- War room modules: prefixed `warroom-text-` for text-meeting subsystem
- Web components: `PascalCase.tsx` (e.g., `MissionControl.tsx`, `AgentDetail.tsx`)

**Directories:**
- Agents: lowercase, alphanumeric + hyphens (e.g., `research`, `comms`)
- Excluded from agent scan: prefix `_` (e.g., `_template`)
- External config: `~/.claudeclaw/` by default (configurable via `CLAUDECLAW_CONFIG`)

**TypeScript:**
- Interfaces: PascalCase with no `I` prefix (e.g., `AgentConfig`, `TransportCallbacks`)
- Exported functions: camelCase (e.g., `loadAgentConfig`, `processUserMessage`)
- Constants: UPPER_SNAKE_CASE for config exports (e.g., `AGENT_ID`, `PROJECT_ROOT`)
- Mutable config exports: use `export let` + `setAgentOverrides()` pattern

## Where to Add New Code

**New message pipeline feature (affects all transports):**
- Primary code: `src/message-core.ts` — add logic to `processUserMessage()`
- If adding a new callback: extend `TransportCallbacks` interface in `src/message-core.ts`
- Transport implementations: update `src/bot.ts` and `src/slack-bot.ts` to implement the new callback

**New agent.yaml field:**
- Add to `AgentConfig` interface in `src/agent-config.ts`
- Parse in `loadAgentConfig()` in `src/agent-config.ts`
- Consume in callers (most likely `src/index.ts`, `src/orchestrator.ts`, or `src/warroom-text-orchestrator.ts`)

**New database table or column:**
- Add column/table to `createSchema()` in `src/db.ts`
- Create a migration: use the `add-migration` skill (`.claude/skills/add-migration/SKILL.md`)
- Add query functions to `src/db.ts`

**New dashboard API route:**
- Add route to `buildDashboardApp()` in `src/dashboard.ts`
- Add corresponding page component to `web/src/pages/` if UI is needed
- Register route in `web/src/App.tsx`

**New sub-agent:**
- Copy `agents/_template/` to `agents/<new-id>/`
- Rename `agent.yaml.example` to `agent.yaml` and fill in values
- Edit `CLAUDE.md` with agent personality and role
- Add bot token to `.env` if using Telegram
- Copy launchd plist from `launchd/com.claudeclaw.main.plist`, update paths, agent ID

**New CLI tool (invokable by agents):**
- Create `src/<name>-cli.ts` with `#!/usr/bin/env node` header
- Add to `package.json` `bin` or ensure it compiles to `dist/`
- Follow `schedule-cli.ts` pattern: call `initDatabase()`, parse argv, operate on DB

**New utility/helper:**
- Add to relevant existing module if it fits a clear category
- Or create new `src/<name>.ts` with named exports (avoid default exports)
- Add co-located test: `src/<name>.test.ts`

**New war room text feature:**
- Orchestration logic: `src/warroom-text-orchestrator.ts`
- Routing/classification: `src/warroom-text-router.ts`
- Tool policy: `src/warroom-tool-policy.ts`
- SSE events: `src/warroom-text-events.ts`

## Special Directories

**`store/` (runtime):**
- Purpose: SQLite database, PID files, uploaded media, agent avatars
- Generated: Yes (created by `initDatabase()` on first run)
- Committed: No (git-ignored)

**`dist/` (build output):**
- Purpose: TypeScript compiler output
- Generated: Yes (`npm run build` or `tsc`)
- Committed: No (git-ignored)

**`warroom/.venv/` (Python venv):**
- Purpose: Python dependencies for the voice war room server
- Generated: Yes (user runs `python3 -m venv warroom/.venv && pip install -r warroom/requirements.txt`)
- Committed: No

**`.planning/codebase/` (GSD maps):**
- Purpose: Codebase analysis documents used by planning and execution tools
- Generated: Yes (written by `/gsd-map-codebase`)
- Committed: Yes (part of planning workflow)

**`migrations/` (schema migrations):**
- Purpose: Versioned migration scripts and registry
- Generated: Partially (`version.json` is manually maintained; migration `.ts` files are written per-change)
- Committed: Yes

---

*Structure analysis: 2026-06-14*
