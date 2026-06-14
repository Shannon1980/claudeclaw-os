# Technology Stack

**Analysis Date:** 2026-06-14

## Languages

**Primary:**
- TypeScript 5.7+ - All Node.js server code and web frontend (`src/`, `web/src/`)

**Secondary:**
- Python 3.10+ - War Room voice pipeline (`warroom/*.py`)
- JavaScript (ESM) - War Room browser client (`warroom/client.js`)

## Runtime

**Environment:**
- Node.js >=20 (required, `package.json` engines field; current dev environment: v25.9.0)
- Python 3.10+ for `warroom/` voice pipeline (Pipecat requirement)

**Package Manager:**
- npm (lockfile: `package-lock.json` present)

## Frameworks

**Core:**
- Hono 4.12.3 - HTTP server for the dashboard API (`src/dashboard.ts`), served via `@hono/node-server`
- `@slack/bolt` 4.7.3 - Slack Socket Mode event handling (`src/slack-bot.ts`)
- grammy 1.34.0 - Telegram Bot API client (`src/bot.ts`)

**Frontend (Mission Control Dashboard):**
- Preact 10.29.1 - Component rendering (`web/src/main.tsx`, built to `dist/web/`)
- `@preact/signals` 2.9.0 - Reactive state
- Tailwind CSS 4.2.4 - Utility-first CSS (`@tailwindcss/vite` plugin)
- wouter-preact 3.9.0 - Client-side routing
- lucide-preact 1.14.0 - Icons
- marked 18.0.2 - Markdown rendering in chat view
- monaco-editor 0.55.1 + `@monaco-editor/react` 4.7.0 - Code editor in AgentFiles view

**War Room (Python voice pipeline):**
- pipecat-ai 0.0.108 with extras `[websocket,deepgram,cartesia,silero,google]` - Audio pipeline orchestration (`warroom/requirements.txt`)
- python-dotenv 1.0.0 - Env var loading in Python stack

**Testing:**
- vitest 2.0.0 - Test runner (configured inline in `package.json` `"vitest"` block)
- `@vitest/coverage-v8` 2.0.0 - Coverage reports

**Build/Dev:**
- Vite 5.4.21 + `@preact/preset-vite` - Bundles `web/` into `dist/web/` (`vite.config.ts`)
- tsc 5.7+ - Compiles `src/` to `dist/` (`tsconfig.json`, target ES2022, module NodeNext)
- tsx 4.19.0 - TypeScript execution for dev mode and scripts
- esbuild 0.28.0 - Bundles War Room browser client (`warroom/client.bundle.js`)

## Key Dependencies

**Critical:**
- `@anthropic-ai/claude-agent-sdk` ^0.2.34 - Spawns and drives the `claude` CLI subprocess; the core intelligence layer (`src/agent.ts`)
- `better-sqlite3` ^11.8.1 - Synchronous SQLite driver; all persistence (`src/db.ts`)
- `@google/genai` ^1.44.0 - Gemini API client for memory extraction, message classification, embeddings, and War Room voice (gemini-2.5-flash default) (`src/gemini.ts`, `src/embeddings.ts`)

**Infrastructure:**
- `pino` ^9.6.0 + `pino-pretty` ^13.0.0 - Structured JSON logging with redaction (`src/logger.ts`)
- `js-yaml` ^4.1.1 - Parses `agent.yaml` config files (`src/agent-config.ts`)
- `cron-parser` ^5.5.0 - Cron expression parsing for the scheduler (`src/scheduler.ts`)
- `whatsapp-web.js` ^1.34.6 - WhatsApp integration via Puppeteer (`src/whatsapp.ts`)
- `qrcode-terminal` ^0.12.0 - QR code display during WhatsApp auth
- `three` ^0.184.0 + `@types/three` ^0.184.0 - 3D rendering for War Room avatar visualization
- `@pipecat-ai/client-js` ^1.7.0 + `@pipecat-ai/websocket-transport` ^1.6.2 - War Room WebSocket client (devDependencies, bundled into `warroom/client.bundle.js`)
- `dompurify` ^3.0.5 - XSS sanitization in dashboard HTML rendering

## Configuration

**Environment:**
- `.env` file at `PROJECT_ROOT` — parsed by `src/env.ts` via `readEnvFile()`, intentionally NOT loaded into `process.env` to prevent secret leakage to child processes
- `CLAUDECLAW_CONFIG` env var (default: `~/.claudeclaw`) — external config directory for personal `CLAUDE.md`, agent configs, and OAuth tokens that should never be committed

**Key required env vars (from `src/config.ts`):**
```
DB_ENCRYPTION_KEY       AES-256-GCM key for field-level message encryption
TELEGRAM_BOT_TOKEN      or SLACK_BOT_TOKEN + SLACK_APP_TOKEN (transport selection)
ALLOWED_CHAT_ID         or ALLOWED_SLACK_USER_ID
GOOGLE_API_KEY          Gemini (memory extraction, embeddings, War Room live mode)
```

**Optional env vars:**
```
GROQ_API_KEY            STT via Groq Whisper
ELEVENLABS_API_KEY      TTS primary provider
ELEVENLABS_VOICE_ID
GRADIUM_API_KEY         TTS secondary provider
GRADIUM_VOICE_ID
KOKORO_URL              TTS local OpenAI-compatible server
DAILY_API_KEY           Daily.co meeting rooms
PIKA_DEV_KEY            Pika avatar video meetings
ANTHROPIC_API_KEY       Optional API key override (SDK uses OAuth by default)
CLAUDE_CODE_OAUTH_TOKEN Optional OAuth override
```

**Build:**
- `tsconfig.json` - Server compilation (ES2022, NodeNext modules, strict)
- `web/tsconfig.json` - Frontend compilation (ES2022, bundler resolution, Preact JSX, noEmit)
- `vite.config.ts` - Frontend build (root: `web/`, output: `dist/web/`, dev proxy to `:3141`)

## Platform Requirements

**Development:**
- macOS or Linux (macOS required for local TTS via `say` + ffmpeg)
- Node.js >=20
- Python 3.10+ with a virtualenv at `warroom/.venv` (for War Room features)
- ffmpeg (optional, needed for audio conversion in voice features)
- Claude Code CLI (`claude`) installed and authenticated via `claude login`

**Production:**
- macOS or Linux daemon via launchd plists (`launchd/com.claudeclaw.*.plist`)
- SQLite database at `store/claudeclaw.db` (owner-only permissions, 0600)
- No external database required — everything in the local SQLite file

---

*Stack analysis: 2026-06-14*
