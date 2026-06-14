<!-- refreshed: 2026-06-14 -->
# Architecture

**Analysis Date:** 2026-06-14

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                         Transport Layer                               │
│  Telegram (grammy)          Slack (bolt)          Dashboard (HTTP)   │
│  `src/bot.ts`               `src/slack-bot.ts`    `src/dashboard.ts` │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ TransportCallbacks interface
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Message Core                                    │
│  `src/message-core.ts`  processUserMessage()                         │
│  kill-check → delegation detection → memory context → model routing  │
│  → agent query → exfiltration guard → file markers → TTS → logging  │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Agent Layer    │  │  Orchestrator    │  │  Scheduler       │
│  `src/agent.ts` │  │`src/orchestrat-  │  │`src/scheduler.ts`│
│  runAgent() via │  │ or.ts`           │  │  Cron tasks +    │
│  SDK query()    │  │  delegateToAgent │  │  mission tasks   │
└────────┬────────┘  └──────────────────┘  └──────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│           @anthropic-ai/claude-agent-sdk  query()                    │
│  Spawns `claude` CLI subprocess · settingSources: ['project','user'] │
│  Loads CLAUDE.md from cwd · permissionMode: 'bypassPermissions'      │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
┌──────────────┐    ┌───────────────────┐   ┌──────────────────────┐
│  SQLite DB   │    │  Memory System    │   │  Dashboard + SPA     │
│  `src/db.ts` │    │  `src/memory.ts`  │   │  `src/dashboard.ts`  │
│  better-     │    │  `src/memory-     │   │  Hono app on port    │
│  sqlite3     │    │   ingest.ts`      │   │  3141 · Preact SPA   │
│  store/      │    │  `src/memory-     │   │  `web/src/`          │
│  claudeclaw  │    │   consolidate.ts` │   └──────────────────────┘
│  .db         │    │  Gemini embeddings│
└──────────────┘    └───────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Transport (Telegram) | Grammy bot: inbound messages, commands, media, streaming edits | `src/bot.ts` |
| Transport (Slack) | Bolt app: Socket Mode events, slash commands, channel routing | `src/slack-bot.ts` |
| Message Core | Transport-agnostic pipeline: security, memory, model routing, agent call, response delivery | `src/message-core.ts` |
| Agent | SDK query() wrapper: MCP loading, event loop, usage tracking, retry logic | `src/agent.ts` |
| Agent Config | agent.yaml loader, agent dir resolution, Slack channel map, roster | `src/agent-config.ts` |
| Orchestrator | In-process agent delegation (@agentId: syntax), inter-agent tasks, hive mind logging | `src/orchestrator.ts` |
| Scheduler | Cron task execution (60s tick), mission task worker, message queue integration | `src/scheduler.ts` |
| Memory | Three-layer retrieval (semantic + importance + consolidation), conversation logging, decay | `src/memory.ts` |
| Memory Ingest | LLM-powered extraction via Claude Haiku (Gemini fallback), duplicate detection, embeddings | `src/memory-ingest.ts` |
| Memory Consolidate | Pattern synthesis across recent memories via Gemini, contradiction detection | `src/memory-consolidate.ts` |
| Database | All SQLite operations: single `better-sqlite3` connection, schema, migrations helper | `src/db.ts` |
| Dashboard | Hono HTTP server (port 3141): REST API for all management + SSE for live chat events | `src/dashboard.ts` |
| Dashboard SPA | Preact + Vite frontend: Mission Control, Agents, Memories, Chat, War Room UI | `web/src/` |
| War Room (text) | Multi-agent text meeting orchestration via SDK query() | `src/warroom-text-orchestrator.ts` |
| War Room (voice) | Python/Pipecat WebSocket voice server, auto-spawned by `src/index.ts` | `warroom/server.py` |
| State | Module-level process state: bot info, connection flags, SSE event bus, abort controllers | `src/state.ts` |
| Hooks | Plugin point: preMessage, postMessage, onSessionStart, onSessionEnd, onError | `src/hooks.ts` |
| Config | All env var reads (via `readEnvFile`), mutable agent overrides for --agent flag | `src/config.ts` |
| Entry Point | Process bootstrap: arg parsing, DB init, transports, scheduler, dashboard, war room | `src/index.ts` |

## Pattern Overview

**Overall:** Multi-transport personal AI agent with a transport-agnostic message pipeline, multi-agent delegation, and a persistent SQLite memory store.

**Key Characteristics:**
- Single Node.js process per agent (separate processes for `--agent <id>`), not a microservices mesh
- Transport-agnostic message pipeline via `TransportCallbacks` interface in `src/message-core.ts`
- Agent SDK runs as a `claude` CLI subprocess; this process coordinates, it does not execute tools
- All persistent state in one SQLite file at `store/claudeclaw.db` (no external DB)
- Memory extraction is always fire-and-forget; never blocks the user response

## Layers

**Transport Layer:**
- Purpose: Receive messages from users, deliver responses back. Owns chat-specific commands, typing indicators, media handling.
- Location: `src/bot.ts` (Telegram), `src/slack-bot.ts` (Slack)
- Contains: Transport SDK setup, command handlers (/model, /stop, /newchat, etc.), media download/upload, stream edit management
- Depends on: `src/message-core.ts`, `src/format.ts`, `src/db.ts`, `src/state.ts`
- Used by: `src/index.ts` via `createBot()` / `createSlackBot()`

**Message Core Layer:**
- Purpose: Transport-agnostic pipeline — the single place where all message logic lives.
- Location: `src/message-core.ts`
- Contains: `processUserMessage()`, context assembly, model routing, abort/timeout, exfiltration guard, cost footer, memory nudge
- Depends on: `src/agent.ts`, `src/memory.ts`, `src/orchestrator.ts`, `src/db.ts`, `src/config.ts`
- Used by: `src/bot.ts`, `src/slack-bot.ts`, `src/dashboard.ts` (dashboard chat relay)

**Agent Layer:**
- Purpose: Wrap the Claude Agent SDK `query()` call, load MCP servers, handle SDK events, retry transient failures.
- Location: `src/agent.ts`
- Contains: `runAgent()`, `runAgentWithRetry()`, `loadMcpServers()`, usage tracking, progress event emission
- Depends on: `@anthropic-ai/claude-agent-sdk`, `src/config.ts`, `src/security.ts`, `src/kill-switches.ts`
- Used by: `src/message-core.ts`, `src/orchestrator.ts`, `src/scheduler.ts`, `src/warroom-text-orchestrator.ts`, `src/memory-ingest.ts`

**Agent Config Layer:**
- Purpose: Resolve agent identities: directories, CLAUDE.md paths, model aliases, Slack channel routing map.
- Location: `src/agent-config.ts`
- Contains: `loadAgentConfig()`, `resolveAgentDir()`, `resolveAgentRuntime()`, `getSlackChannelMap()`, `listAgentIds()`, `refreshWarRoomRoster()`
- Depends on: `src/config.ts`, `src/models.ts`, `js-yaml`
- Used by: `src/index.ts`, `src/orchestrator.ts`, `src/dashboard.ts`, `src/slack-bot.ts`, `src/warroom-text-orchestrator.ts`

**Data / Memory Layer:**
- Purpose: All persistence. SQLite via `db.ts`. Memory extraction pipeline in `memory-ingest.ts`. Retrieval in `memory.ts`. Pattern synthesis in `memory-consolidate.ts`.
- Location: `src/db.ts`, `src/memory.ts`, `src/memory-ingest.ts`, `src/memory-consolidate.ts`, `src/embeddings.ts`
- Contains: Schema creation, all DB queries, memory extraction prompts, cosine similarity, consolidation
- Depends on: `better-sqlite3`, `@google/genai`, `@anthropic-ai/claude-agent-sdk` (Haiku extraction)
- Used by: Almost all other modules

**Dashboard / UI Layer:**
- Purpose: Management interface. Hono REST API + SSE. Preact SPA served as static bundle.
- Location: `src/dashboard.ts`, `src/dashboard-html.ts`, `web/src/`
- Contains: All `/api/*` routes (200+), SSE `/api/chat/stream`, agent management, memory viewer, mission control
- Depends on: `hono`, `src/db.ts`, `src/agent-config.ts`, `src/state.ts`
- Used by: Standalone (not imported by the message pipeline)

## Data Flow

### Primary Request Path (Telegram)

1. Grammy receives update (`src/bot.ts` message handler)
2. Access control check (ALLOWED_CHAT_ID filter)
3. Media download / voice transcription if needed (`src/voice.ts`, `src/media.ts`)
4. `messageQueue.enqueue(chatId, ...)` — serializes per-chat (`src/message-queue.ts`)
5. `processUserMessage(message, cb, opts)` called (`src/message-core.ts`)
6. Kill-phrase check (`src/security.ts`)
7. Delegation detection via `parseDelegation()` — if matched, `delegateToAgent()` and return (`src/orchestrator.ts`)
8. Memory context built: 5-layer retrieval (`src/memory.ts` → `src/db.ts`)
9. Smart model routing: complexity classifier → cheap model or default (`src/message-classifier.ts`)
10. `runAgentWithRetry()` → `runAgent()` → SDK `query()` call (`src/agent.ts`)
11. SDK spawns `claude` CLI subprocess; loads CLAUDE.md from `effectiveCwd`, `settingSources: ['project','user']`
12. SDK events streamed: tool activity → progress callbacks; `result` event captured
13. Exfiltration guard scans response (`src/exfiltration-guard.ts`)
14. File markers extracted (`src/format.ts` `extractFileMarkers()`)
15. Files sent via `cb.sendFile/sendPhoto`; text sent via `cb.sendFormatted()`
16. Token usage saved to SQLite; context warning checked (`src/db.ts`)
17. `saveConversationTurn()` → fires `ingestConversationTurn()` fire-and-forget (`src/memory-ingest.ts`)

### Slack Channel Routing Path

1. Slack message arrives in a mapped channel (`src/slack-bot.ts`)
2. `getSlackChannelMap()` resolves channel ID → agentId (`src/agent-config.ts`)
3. `resolveAgentRuntime(agentId)` resolves cwd (uses `project_dir` if set, else `agents/<id>`)
4. `processUserMessage()` called with `opts.agentRuntime` set — overrides cwd, model, mcpAllowlist for this turn
5. Agent SDK runs with that agent's `effectiveCwd`, loads that agent's CLAUDE.md
6. Single Slack app, multiple agents in-process, no extra bot tokens for sub-agents

### Scheduler Flow

1. `setInterval` fires every 60s in `src/scheduler.ts`
2. `getDueTasks(agentId)` queries SQLite for `status='active' AND next_run <= now`
3. `markTaskRunning(taskId, nextRun)` — DB lock prevents double-fire across restarts
4. Task enqueued to `messageQueue` (serializes with live user messages for same chatId)
5. `runAgent(task.prompt, undefined, ...)` — fresh session (no resume), no streaming
6. Result saved to `scheduled_tasks.last_result`; conversation turn injected into active session
7. Mission tasks: same loop, `claimNextMissionTask()` → `startMissionTask()` → `runAgent()` or `delegateToAgent()`

### Memory Ingestion Flow

1. After every agent response, `saveConversationTurn()` fires (`src/memory.ts`)
2. Conversation logged synchronously to `conversation_log` table
3. `ingestConversationTurn()` called fire-and-forget (`src/memory-ingest.ts`)
4. If quota backoff active (`_ingestSuspendedUntil`), returns immediately
5. Claude Haiku via OAuth `query()` runs `EXTRACTION_PROMPT` (no API key, no quota wall)
6. Falls back to Gemini if Claude extraction fails
7. Importance threshold: skip if < 0.5
8. Cosine similarity check against existing embeddings: skip if > 0.85 duplicate
9. `saveStructuredMemoryAtomic()` writes to `memories` table with embedding

### Memory Retrieval (Context Assembly)

1. `buildMemoryContext(chatId, userMessage, agentId)` called before each agent turn
2. Layer 1: `embedText(userMessage)` via Gemini → cosine similarity search over `memories` table
3. Layer 2: `getRecentHighImportanceMemories()` — importance >= 0.5, most recently accessed
4. Layer 3: Consolidation insights (semantic search over `consolidations` table)
5. Layer 4: `getOtherAgentActivity()` — hive mind entries from other agents last 24h
6. Layer 5: Keyword-triggered conversation history recall (`searchConversationHistory()`)
7. Assembled into `[Memory context]...[End memory context]` block prepended to message

### Text War Room Flow

1. Dashboard SPA sends `POST /api/warroom/text/:id/turn`
2. `messageQueue.enqueue("warroom-text:" + meetingId, ...)` serializes turns per-meeting
3. `handleTextTurn()` called (`src/warroom-text-orchestrator.ts`)
4. Primary agent selected: @mention → pinned agent → `routeMessage()` classifier
5. Agent turn: `query()` via SDK with that agent's cwd, memory context, tool policy
6. Chunks streamed to `MeetingChannel` SSE → SPA updates in real time
7. Up to 2 interveners: `interventionGate()` classifier → `runAgentTurn()` each
8. `turn_complete` event emitted; transcript saved to `warroom_transcript`

**State Management:**
- Session IDs: stored in `sessions` table keyed by `(chat_id, agent_id)`. SDK `resume` option reuses the session across messages, giving Claude persistent context.
- Processing state: module-level in `src/state.ts`. Single flag per chatId; not concurrency-safe across agents (per-chat serialization via `messageQueue` prevents conflicts).

## Key Abstractions

**TransportCallbacks:**
- Purpose: Decouples message pipeline from transport specifics (Telegram API vs Slack API)
- Location: `src/message-core.ts` (interface definition)
- Used by: `src/bot.ts` (builds Telegram callbacks), `src/slack-bot.ts` (builds Slack callbacks), `src/dashboard.ts` (dashboard chat relay)
- Pattern: Dependency injection — each transport creates a `TransportCallbacks` object and passes it to `processUserMessage()`

**AgentRuntime:**
- Purpose: Per-turn agent identity resolution for Slack channel routing. Avoids mutating module globals (which are not concurrency-safe for in-process multi-agent).
- Location: `src/agent-config.ts`
- Pattern: Resolved once per Slack message from `agent.yaml`; passed through `ProcessOptions.agentRuntime` to override cwd/model/mcpAllowlist for that turn only

**MessageQueue:**
- Purpose: Per-chatId FIFO serialization. Ensures one Claude process per chat at a time (sessions and abort controllers are per-chat, not per-process).
- Location: `src/message-queue.ts`
- Pattern: Promise chain per chatId. Different chatIds run in parallel; same chatId queues sequentially.

**MCP Server Loading:**
- Purpose: Load MCP server configs from user (`~/.claude/settings.json`) and project (`.claude/settings.json` in cwd) settings. Filter by per-agent allowlist from `agent.yaml`.
- Location: `src/agent.ts` `loadMcpServers()`
- Pattern: Loaded fresh on every `runAgent()` call using `effectiveCwd` so routed sub-agents pick up their own `.claude/settings.json`

## Entry Points

**Main Process:**
- Location: `src/index.ts`
- Triggers: `npm start` or `node dist/index.js [--agent <id>]`
- Responsibilities: Parse `--agent` flag, load agent config, init DB, init security, init orchestrator, start dashboard (main only), spawn war room Python process (main only), start transport (Telegram/Slack), init scheduler

**schedule-cli:**
- Location: `src/schedule-cli.ts` → `dist/schedule-cli.js`
- Triggers: Agents via Bash tool: `node dist/schedule-cli.js create|list|delete|pause|resume`
- Responsibilities: CRUD on `scheduled_tasks` table; auto-detects agent from `CLAUDECLAW_AGENT_ID` env

**mission-cli:**
- Location: `src/mission-cli.ts` → `dist/mission-cli.js`
- Triggers: Agents via Bash tool: `node dist/mission-cli.js create|list|result|cancel`
- Responsibilities: Creates `mission_tasks` records; target agent's scheduler picks them up within 60s

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop. Concurrency via promises and `messageQueue` per-chat serialization. The `claude` CLI subprocess runs separately (SDK-managed).
- **Global state:** `src/config.ts` exports mutable `AGENT_ID`, `activeBotToken`, `agentCwd`, `agentDefaultModel`, `agentSystemPrompt`, `agentMcpAllowlist` — set once at startup by `setAgentOverrides()`. Not safe to flip mid-process; Slack routing uses `opts.agentRuntime` instead.
- **Single DB connection:** `src/db.ts` holds one `better-sqlite3` Database instance. All DB calls are synchronous (SQLite is in-process). WAL mode assumed for concurrent reads.
- **War room Python process:** `warroom/server.py` is a child process spawned by `src/index.ts`. Communicates over WebSocket (port `WARROOM_PORT`, default 7860). Node respawns it up to 3 times on crash.
- **External config directory:** Personal files (CLAUDE.md, agent.yaml) live in `CLAUDECLAW_CONFIG` (default `~/.claudeclaw`) to avoid committing secrets to the repo. Agents in both `CLAUDECLAW_CONFIG/agents/` and `PROJECT_ROOT/agents/` are scanned and deduplicated.
- **Circular imports:** `src/db.ts` is imported by nearly every module; it imports only `src/config.ts` and `src/embeddings.ts`. `src/agent.ts` ← `src/memory-ingest.ts` (Haiku extraction uses `query()` directly).

## Anti-Patterns

### Setting agentCwd/agentDefaultModel globals for per-request routing

**What happens:** `src/config.ts` exports mutable module-level variables. If a new code path wrote to `agentCwd` per-request to route Slack channel messages, concurrent turns on different channels would race.
**Why it's wrong:** Node.js single-thread means writes to module globals between `await` points are visible to all concurrent promise chains.
**Do this instead:** Pass `opts.agentRuntime` to `processUserMessage()` and use `effectiveCwd = runtime?.cwd ?? agentCwd ?? PROJECT_ROOT` in `src/message-core.ts` and `src/agent.ts`.

### Calling runAgent() outside the messageQueue

**What happens:** Direct `runAgent()` calls that bypass `messageQueue.enqueue()` can start a second Claude subprocess on the same sessionId simultaneously.
**Why it's wrong:** Two SDK processes resuming the same session produce conflicting writes to the `sessions` table and can corrupt conversation context.
**Do this instead:** Always route through `messageQueue.enqueue(chatId, ...)` as done in `src/bot.ts` and `src/scheduler.ts`.

### Reading secrets via process.env inside an agent subprocess

**What happens:** The SDK subprocess inherits a scrubbed env (via `getScrubbedSdkEnv()`). If code passes the full `process.env` to the SDK's `env` option, all secrets (tokens, API keys) are visible to prompt-injected tool calls.
**Why it's wrong:** A prompt injection can run `env` or `cat .env` via Bash tool and exfiltrate credentials.
**Do this instead:** Always use `getScrubbedSdkEnv(secrets)` from `src/security.ts` as the `env` option in `src/agent.ts`.

## Error Handling

**Strategy:** Classified errors via `AgentError` with `category` (auth, overloaded, context_limit, crash, timeout, unknown) and `recovery` (shouldRetry, shouldSwitchModel, userMessage).

**Patterns:**
- `src/errors.ts` `classifyError()` normalizes SDK subprocess errors into `AgentError`
- `runAgentWithRetry()` retries only when `recovery.shouldRetry === true`, with exponential backoff (2s, 8s base), up to 2 retries
- Result-level API errors (`is_error` flag in SDK result event) surfaced via `classifyError()` and thrown — prevents silent failure disguised as a normal reply
- Memory ingestion errors are always swallowed (fire-and-forget); quota errors trigger a 5-minute backoff
- Hook failures (`src/hooks.ts`) are caught per-hook with a 5s timeout; do not block execution

## Cross-Cutting Concerns

**Logging:** pino logger (`src/logger.ts`). Structured JSON. All modules import `logger` from here. No `console.log` in production paths (only in setup/CLI helpers).
**Validation:** Agent IDs validated against `AGENT_ID_RE = /^[a-z0-9_-]+$/i` in `src/agent-config.ts`. Upload paths validated against `UPLOADS_DIR` prefix in `src/dashboard.ts`. Token checked on every dashboard request.
**Authentication:** Dashboard auth via `DASHBOARD_TOKEN` bearer token or cookie. Transport auth via `ALLOWED_CHAT_ID` (Telegram) or `ALLOWED_SLACK_USER_ID` (Slack) — single-user bot, hard-blocks all other senders.
**Kill switches:** `src/kill-switches.ts` `requireEnabled('LLM_SPAWN_ENABLED')` is the single chokepoint for all SDK spawns. `EMERGENCY_KILL_PHRASE` check is the first thing in `processUserMessage()`.

---

*Architecture analysis: 2026-06-14*
