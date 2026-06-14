# External Integrations

**Analysis Date:** 2026-06-14

## APIs & External Services

**LLM / AI:**
- Anthropic Claude (via Claude Agent SDK subprocess) - Core intelligence, agentic tool use
  - SDK: `@anthropic-ai/claude-agent-sdk` ^0.2.34 (`src/agent.ts`)
  - Auth: `~/.claude/` OAuth (default, via `claude login`); optionally `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` in `.env`
  - The SDK spawns the `claude` CLI as a subprocess. Secrets are NOT passed via `process.env`; `src/security.ts` scrubs the env before handoff.
- Google Gemini - Memory extraction, message classification, embeddings, War Room live voice
  - SDK: `@google/genai` ^1.44.0 (`src/gemini.ts`, `src/embeddings.ts`)
  - Models: `gemini-2.5-flash` (default generation), `gemini-embedding-001` (vector embeddings)
  - Auth: `GOOGLE_API_KEY` in `.env`

**Speech-to-Text:**
- Groq Whisper - Primary STT provider (cloud, fast)
  - Endpoint: `https://api.groq.com/openai/v1/audio/transcriptions`
  - Model: `whisper-large-v3`
  - Auth: `GROQ_API_KEY` in `.env`
  - Implementation: `src/voice.ts` `transcribeAudioGroq()`
- whisper-cpp (local) - STT fallback when Groq is unavailable
  - Requires `WHISPER_CPP_PATH` and `WHISPER_MODEL_PATH` in `.env`
  - Requires ffmpeg for WAV conversion

**Text-to-Speech (cascade order):**
- ElevenLabs - Primary TTS
  - Endpoint: `https://api.elevenlabs.io/v1/text-to-speech/<VOICE_ID>`
  - Model: `eleven_turbo_v2_5`
  - Auth: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` in `.env`
  - Implementation: `src/voice.ts` `synthesizeSpeechElevenLabs()`
- Gradium AI - Secondary TTS
  - Endpoint: `https://eu.api.gradium.ai/api/post/speech/tts`
  - Auth: `GRADIUM_API_KEY`, `GRADIUM_VOICE_ID` in `.env`
  - Implementation: `src/voice.ts` `synthesizeSpeechGradium()`
- Kokoro (local OpenAI-compatible) - Tertiary TTS, no API key required
  - Configurable via `KOKORO_URL`, `KOKORO_VOICE`, `KOKORO_MODEL` in `.env`
  - Implementation: `src/voice.ts` `synthesizeSpeechKokoro()`
- macOS `say` + ffmpeg - Final fallback TTS (macOS only)
  - Voice configurable via `TTS_VOICE` in `.env` (default: `Thomas`)
  - Implementation: `src/voice.ts` `synthesizeSpeechLocal()`

**War Room Voice Pipeline (Python, `warroom/`):**
- Deepgram - STT in legacy War Room mode
  - Auth: `DEEPGRAM_API_KEY` in `.env`
- Cartesia - TTS in legacy War Room mode
  - Auth: `CARTESIA_API_KEY` in `.env`
- Pipecat-ai with Silero VAD - Audio pipeline framework (`warroom/requirements.txt`)
- Gemini Live - Real-time speech-to-speech in War Room live mode (`warroom/server.py`)
  - Reuses `GOOGLE_API_KEY`
  - Default voice: `Charon`; configurable via `WARROOM_LIVE_MODEL`, `WARROOM_LIVE_VOICE`

**Video Meetings:**
- Daily.co - WebRTC room provisioning for agent voice meetings
  - REST API: `https://api.daily.co/v1`
  - Auth: `DAILY_API_KEY` in `.env`
  - Client: `src/daily-client.ts` (thin wrapper: create/delete rooms, mint meeting tokens)
  - Spawns `warroom/daily_agent.py` as subprocess for Pipecat pipeline in Daily transport
- Pika (pikastream-video-meeting) - Avatar-based video meeting participation
  - Python script: `skills/pikastream-video-meeting/scripts/pikastreaming_videomeeting.py`
  - Auth: `PIKA_DEV_KEY` or `PIKA_API_KEY` in `.env`
  - Invoked by `src/meet-cli.ts`

## Data Storage

**Databases:**
- SQLite via better-sqlite3 ^11.8.1
  - Path: `store/claudeclaw.db` (created at startup by `src/db.ts` `initDatabase()`)
  - File permissions: 0600 (owner-only read/write enforced at startup)
  - WAL journal mode enabled; `busy_timeout = 5000` for multi-agent concurrent writes
  - Field-level encryption on message bodies (AES-256-GCM) — key from `DB_ENCRYPTION_KEY` in `.env`
  - No SQLCipher; the encryption is custom at the application layer
  - Schema managed inline in `src/db.ts` `createSchema()` + `runMigrations()`
  - Stored at `store/claudeclaw.db` relative to `PROJECT_ROOT`

**Key tables:**
- `sessions` - Claude Code session IDs per (chat_id, agent_id)
- `memories` + `memories_fts` (FTS5 virtual) - Structured memory with embeddings
- `consolidations` - LLM-synthesized memory consolidations
- `scheduled_tasks` - Cron-based scheduled prompts
- `conversation_log` - Full message history per agent
- `token_usage` - Per-turn token/cost tracking
- `mission_tasks` - Async inter-agent task queue (Mission Control)
- `hive_mind` - Shared agent activity log
- `warroom_meetings` + `warroom_transcript` - Voice/text war room session history
- `meet_sessions` - Video meeting sessions (Daily.co / Pika)
- `slack_messages`, `wa_messages` - Ingested chat messages
- `audit_log` - Security audit trail
- `agent_file_history` - Version history for CLAUDE.md / agent.yaml edits

**File Storage:**
- Local filesystem only
- Uploads directory: `workspace/uploads/` (voice files, downloaded media)
- War Room assets: `warroom/avatars/` (agent avatar images for Pika)
- Agent configs: `~/.claudeclaw/` (external config dir; path set by `CLAUDECLAW_CONFIG`)
- War Room roster: `/tmp/warroom-agents.json` (written by Node on startup)

**Caching:**
- In-memory only (agent model overrides, session state, Obsidian note cache with 5-min TTL)
- No Redis or external cache

## Authentication & Identity

**Chat Auth:**
- Telegram: `ALLOWED_CHAT_ID` allowlist (numeric chat ID); single-user model
- Slack: `ALLOWED_SLACK_USER_ID` allowlist; only DMs from this user are processed

**Dashboard Auth:**
- Token-based: `DASHBOARD_TOKEN` in `.env`; passed as `Authorization: Bearer <token>` header or `?token=` query param
- Dashboard serves at `http://localhost:<DASHBOARD_PORT>` (default 3141)

**Claude Code Auth:**
- OAuth via `~/.claude/` (populated by `claude login`; standard Claude Code auth)
- Optional API key override via `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` in `.env`

**Google OAuth (Gmail / Calendar skills):**
- OAuth2 tokens stored at `~/.config/gmail/token.json` and `~/.config/calendar/token.json`
- Credentials file: `~/.config/gmail/credentials.json`
- Skill implementations: `skills/gmail/SKILL.md`, `skills/google-calendar/SKILL.md`
- Skills invoke Python scripts at `~/.config/gmail/gmail.py` and `~/.config/calendar/calendar.py`

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry or similar)

**Logs:**
- pino structured JSON to stdout; pretty-printed in dev (`NODE_ENV !== 'production'`)
- Telegram bot token values redacted in log output by `src/logger.ts` `redactLogText()`
- launchd plists redirect stdout/stderr to log files under `/tmp/claudeclaw-<agent>.log` or `~/Library/Logs/`

**Cost Tracking:**
- Per-turn token usage stored in `token_usage` table
- Dashboard `/api/usage/*` endpoints expose cost timelines
- Optional `SHOW_COST_FOOTER` config appends cost info to each chat response
- Optional `DAILY_COST_BUDGET` and `HOURLY_TOKEN_BUDGET` warn at 80% threshold

**OAuth Health:**
- `src/oauth-health.ts` — periodic check that Claude Code OAuth is still valid; warns in chat if stale

## CI/CD & Deployment

**Hosting:**
- macOS launchd (primary deployment target)
- launchd plist templates: `launchd/com.claudeclaw.*.plist` (main, research, comms, content, ops, sentinel, social, meta agents)
- Each agent runs as a separate `node dist/index.js --agent <id>` process
- `KeepAlive` + `ThrottleInterval` for auto-recovery on crash

**CI Pipeline:**
- None detected (no `.github/workflows/` CI files; only issue templates in `.github/ISSUE_TEMPLATE/`)

**Process Management:**
- PID files: `store/claudeclaw.pid` (main) and `store/agent-<id>.pid` (agents)
- Setup scripts: `scripts/setup.ts`, `scripts/agent-create.sh`, `scripts/uninstall.sh`
- Status script: `scripts/status.ts`
- Notify script: `scripts/notify.sh` (sends chat notifications for long-running tasks)

## Webhooks & Callbacks

**Incoming:**
- Slack Socket Mode — bot connects outbound to Slack's WebSocket gateway (no inbound port needed)
  - `SLACK_APP_TOKEN` (xapp-prefixed) authorizes Socket Mode
  - `SLACK_BOT_TOKEN` (xoxb-prefixed) authorizes API calls
  - Events: `app_mention`, `message.channels`, `message.groups`, `message.im`
  - Implementation: `src/slack-bot.ts` using `@slack/bolt`
- Telegram long-polling — grammy polls `getUpdates` (no webhook endpoint)
  - Implementation: `src/bot.ts` using grammy

**Outgoing:**
- Dashboard SSE stream at `/ws` (Server-Sent Events) — pushes chat events to the Mission Control UI
  - Implementation: `src/dashboard.ts` using Hono `streamSSE`
- War Room WebSocket server at `ws://localhost:<WARROOM_PORT>` (default 7860) — browser connects to Python Pipecat pipeline
  - Implementation: `warroom/server.py`

## MCP Servers

MCP (Model Context Protocol) servers are loaded at runtime per-agent from two config files:
- `~/.claude/settings.json` (user-level)
- `.claude/settings.json` in the agent's cwd (project-level)

Both are merged and passed to the Claude Agent SDK `mcpServers` option. Each agent can optionally restrict which MCPs are available via `mcp_servers` in its `agent.yaml`. See `src/agent.ts` `loadMcpServers()`.

MCP servers are external processes defined by the user; no specific servers are bundled in the repo. The `agents/_template/CLAUDE.md` references a `plugin:telegram:telegram` MCP skill as an example.

## Obsidian Vault

Obsidian notes are read directly from the local filesystem (no Obsidian API). Configuration per agent via `agent.yaml` `obsidian` block:
- `vault`: absolute path to vault root
- `folders`: writable folders the agent gets context from
- `readOnly`: folders included in context but write-protected

Implementation: `src/obsidian.ts` `buildObsidianContext()` — scans markdown files for open tasks (`- [ ]`), injects them into system prompt. Cache TTL: 5 minutes.

## Environment Configuration

**Required env vars (minimum viable setup):**
```
DB_ENCRYPTION_KEY           32+ char hex string (AES-256-GCM key)
TELEGRAM_BOT_TOKEN          OR SLACK_BOT_TOKEN + SLACK_APP_TOKEN
ALLOWED_CHAT_ID             OR ALLOWED_SLACK_USER_ID
```

**Strongly recommended:**
```
GOOGLE_API_KEY              Gemini (memory extraction disabled without it)
EMERGENCY_KILL_PHRASE       Safety kill switch
DASHBOARD_TOKEN             Dashboard auth
```

**Secrets location:**
- `.env` file at project root — never committed (in `.gitignore`)
- External personal config: `~/.claudeclaw/` (path set by `CLAUDECLAW_CONFIG`)
- Google OAuth tokens: `~/.config/gmail/` and `~/.config/calendar/`

---

*Integration audit: 2026-06-14*
