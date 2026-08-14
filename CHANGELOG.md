# Changelog

All notable changes to ClaudeClaw will be documented here.

## [unreleased] - 2026-08-14

### Fixed — Mission Control failed to load
- Discord client `error` events had no listener, so a websocket drop threw and killed the Node process. The SPA stayed on screen while every `/api/*` call hit `net::ERR_CONNECTION_REFUSED` ("TypeError: Failed to fetch"). Guard the client, isolate constructor failures, and catch message-handler rejections so the dashboard stays up.
- Chat SSE no longer tight-loops reconnects when the backend is down (thousands of console errors). Exponential backoff after close.
- Vite's `/api` proxy honors `DASHBOARD_PORT` instead of hardcoding `:3141`, and warns if the backend is unreachable. Network failures render as "Can't reach the assistant" instead of a raw TypeError.

## [unreleased] - 2026-08-13

### Added — Discord channel
- Optional Discord DM front-end when `DISCORD_BOT_TOKEN` is set. Starts next to Slack or Telegram (does not replace them). First Discord sender is the operator; later senders pair with `/pair CODE`.
- Commands in DMs: `/whoami`, `/pair`, `/help`, `/newchat`, `/stop`. Requires the Message Content Intent.

## [unreleased] - 2026-08-13

### Added — channel pairing + ChannelPlugin seam
- Unknown Slack/Telegram senders get a short pairing code instead of a silent drop. The operator approves with `/pair CODE`, denies with `/pair deny CODE`, or lists with `/pair list`. Dashboard: `GET /api/pairings`, `POST /api/pairings/:id/approve|deny`.
- First sender on an unowned channel is auto-approved and written to `.env` (`ALLOWED_SLACK_USER_ID` / `ALLOWED_CHAT_ID`) so the scheduler still has a destination after restart. Existing env locks are seeded into `channel_pairings` on boot.
- `src/channel.ts` registry (`registerChannel` / `startChannels` / `stopChannels`) so Discord or a first-class WhatsApp adapter can plug in without touching `message-core`. Slack and Telegram register themselves on create.
- Dual-written `channel_pairings` table (`db.ts` createSchema + `migrations/v1.2.9/create-channel-pairings.ts`).

### Tests
- `channel.test.ts`, `pairing.test.ts`, and pairings API contract coverage. Approve/deny are status-guarded (second click is a no-op).

## [v1.1.1] - 2026-06-17

### Added
- Add aos-cron columns (source, job_path, model, timeout, notify, retry) to scheduled_tasks

## [unreleased] - 2026-06-10

### Added — multi-agent Slack channel routing
- A single Slack app now serves **all** agents. Map an agent to a channel with `slack_channel: C0XXXX` in its `agent.yaml`; every message in that channel runs that agent (its own `CLAUDE.md`, model, and MCP allowlist) on a persistent per-channel session. DMs still go to `main`, and `@agentId:` / `/delegate` keep working everywhere. No extra bot tokens — unlike Telegram's per-agent bots.
- Requires the Slack app to subscribe to `message.channels` (and `message.groups` for private channels); `channels:history` / `groups:history` scopes are already in the manifest. The bot logs the channel→agent map on startup. Conflicting claims resolve to the alphabetically-first agent (logged as a warning).
- `runAgent` / `runAgentWithRetry` / `processUserMessage` gained a per-call agent runtime (cwd + model + system prompt + MCP allowlist) so a routed sub-agent runs in-process without mutating the concurrency-unsafe process-global agent overrides. The SDK loads the routed agent's `cwd` (its `CLAUDE.md` + `.claude/settings.json`) for that turn.
- Slash commands are now channel-aware: `/model`, `/voice`, `/newchat`, `/forget`, `/respin`, `/memory`, `/dashboard`, `/stop`, and `/delegate` act on the routed agent's per-channel session when invoked in an agent channel (previously they always targeted the user's main DM session). `/model` reports and resets to the channel agent's own default model, and `/model opus` sets opus explicitly for agents that don't default to it.

### Tests
- New `agent-config.test.ts` covering `slack_channel` parsing, `getSlackChannelMap` (including deterministic conflict resolution), and `resolveAgentRuntime`; added `slackChannelChatId` and `resolveSlackCommandTarget` coverage to `slack-bot.test.ts`.

## [unreleased] - 2026-06-09

### Added — Slack front-end transport
- Run ClaudeClaw on **Slack** instead of Telegram: DM the bot or `@mention` it in channels and it drives the real `claude` CLI with full parity — text, voice notes, photos/docs/video, voice replies, streaming, and all slash commands. Set `TRANSPORT=slack` (auto-detected when both Slack tokens are present) to gate Telegram off entirely.
- Distinct from the existing `xoxp` Slack *integration* (read/reply on your behalf). The transport is the bot you talk to: `@slack/bolt` Socket Mode with `SLACK_BOT_TOKEN` (xoxb) + `SLACK_APP_TOKEN` (xapp).
- Fail-closed access control via `ALLOWED_SLACK_USER_ID`; DM `/whoami` to discover yours. Until set, the bot only answers `/whoami`.
- Full slash-command set ported (`/newchat`, `/respin`, `/voice`, `/model`, `/memory`, `/forget`, `/pin`, `/unpin`, `/dashboard`, `/stop`, `/agents`, `/delegate`, `/lock`, `/status`, `/help`, `/whoami`). **Note:** Slack drops undeclared slash commands client-side, so each must be listed in the app manifest (see README).

### Changed — transport-agnostic core
- Extracted the message pipeline into `message-core.ts` (`processUserMessage` + `TransportCallbacks`) and `format.ts` (`splitMessage`, `extractFileMarkers`, `formatForSlack`). Telegram's `handleMessage` is now a thin adapter over the shared core — behavior-preserving, gated by the existing tests.
- Sessions/memory namespaced `slack:<id>` via a new `PRIMARY_CHAT_ID`; scheduler, OAuth-health, War Room pings, and the dashboard chat relay all route to the active transport. Dashboard relay refactored to a generic `relayToUser` callback (no grammY dependency in Slack mode).
- Setup wizard now asks Telegram vs Slack and writes `TRANSPORT` + Slack tokens; `CLAUDE.md.example` made transport-neutral.

### Tests
- New `format.test.ts`, `slack-bot.test.ts`, and `message-core.test.ts` (mock-callback based). Caught and fixed two `formatForSlack` bugs (inline-code double-escape; headings clobbered by the italic pass). Full suite at 488 passing.

## [unreleased] - 2026-05-04

### Security
- Rotated `DASHBOARD_TOKEN` to a new cryptographically random 24-byte hex secret. No code changes; update your local `.env` if you have not already.

## [unreleased] - 2026-05-01

### Fixed — agent file-send awareness
- New agents created via the dashboard wizard now always include the
  `[SEND_FILE:...]` / `[SEND_PHOTO:...]` marker documentation in their
  CLAUDE.md, regardless of which template the user picked. The plumbing
  in `src/bot.ts:637` (`extractFileMarkers`) has always supported these
  for every agent — newly-created agents just didn't know the syntax
  existed and would say things like "I can't send files" when asked to
  attach an image they'd just generated.
- **Action required for existing agents:** after pulling this commit,
  run `bash scripts/upgrade-agent-claude-md.sh` once. It idempotently
  appends the section to any `agents/<id>/CLAUDE.md` (in either the
  repo or `$CLAUDECLAW_CONFIG`) that doesn't already mention
  `SEND_FILE`/`SEND_PHOTO`. Safe to re-run; skips already-patched
  files. Agents pick up the change on their next turn — no restart
  needed.

## [unreleased] - 2026-04-29

### Added — text war room
- Multi-agent text war room (`/warroom/text`) with real-time SSE streaming, sticky-addressee follow-ups, `/standup`, `/discuss`, ack short-circuit, and per-meeting persistence.
- Tool-call disclosure UX in agent bubbles — collapsed by default (`▸ N tool calls`), click to expand for full args + results.
- Prompt-injection delimiters wrapping every retrieved-from-DB block in war-room prompt assembly.

### Added — security hardening
- Centralized kill switches with `requireEnabled()` enforced at every LLM-spawning boundary (`runAgent`, war-room orchestrator, router, gate, voice bridge, Gemini `generateContent`). Refusal counters surfaced via `/api/health.killSwitchRefusals`.
- Single dashboard mutation middleware that returns 503 on every non-GET when `DASHBOARD_MUTATIONS_ENABLED=false`. Replaces scattered per-route checks.
- War-room tool boundary: default-deny side-effect tools (`Bash`, `Write`, `Edit`, `Skill`, all MCPs) unless agent explicitly opts in via `warroom_tools:` in `agent.yaml`. `permissionMode: 'default'` (no bypass). Per-turn 8-tool budget. Audit log writes for every tool call.
- CSRF middleware rejects cross-origin mutating requests outside the allowlist (`localhost`, configured `DASHBOARD_URL`).
- Response headers: `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store` on `/api/`.
- Least-privilege SDK env scrubbing (`getScrubbedSdkEnv()`) drops `DASHBOARD_TOKEN`, third-party API keys, and pattern-matched secret-shaped vars before subprocess inheritance.
- Default bind address `127.0.0.1` (was `0.0.0.0`); `DASHBOARD_BIND` env opt-in for LAN exposure.
- Pre-migration backups written to `store/claudeclaw.db.pre-<version>.bak` with `chmod 0600`, 3-backup rotation, gitignored.

### Added — ops & reliability
- Memory ingestion swapped from Gemini to Claude Haiku via OAuth (no extra API key); Gemini retained as fallback. Quota-aware backoff (5-min cooldown on 429).
- `pruneWarRoomMeetings(retentionDays=90)` integrated into the daily decay sweep.
- `endTextMeeting` now clears SDK sessions tied to the meeting.
- `/api/warroom/voices/apply` 3s cooldown to prevent respawn-storm during voice config edits.
- Voice war room `agent_error` and `hand_down` RTVI frames on OAuth/timeout/bridge failures so the browser surfaces real reasons instead of vague Gemini stutter.

### Added — observability
- `/api/health` exposes `killSwitches`, `killSwitchRefusals`, `memoryIngestion`, `warroom.textOpenMeetings`.
- Audit log writes for every war-room tool call (table existed; now populated).
- Router classifier logs elapsed_ms + outcome (success / parse_failure / timeout_or_error) on every call.

### Tests
- `warroom-text-events.test.ts` (MeetingChannel + finalizedTurns guard).
- `warroom-text-db.test.ts` (saveWarRoomConversationTurn idempotency, multi-agent dedup, memory strict-agent isolation, retention prune).
- `kill-switches.test.ts` extended with `requireEnabled` + refusal-counter coverage.
- All 368+ tests pass.

### Docs
- `docs/release-smoke.md` — release runbook (10-step).
- `docs/incident-runbook.md` — kill switch playbook with symptom → action mapping.
- `docs/warroom-mcp-policy.md` — per-agent tool/MCP allowlist + opt-in via `agent.yaml`.
- `docs/redteam-results.md` — adversarial test results (5/5 PASS).
- `docs/voice-smoke-results.md` — voice fix verification.
- `scripts/audit-profile.sh` — isolated red-team harness with canary `.env`, fail-closed gates.
- `scripts/pre-commit-check.sh` — personal-reference scrub.

### Closes Codex adversarial review high findings
- LLM kill switch now enforced at every boundary, not just one route.
- Dashboard mutation kill switch enforced via single middleware on all non-GET routes.
- War-room tool authority restricted to per-agent allowlist; `permissionMode: 'bypassPermissions'` removed from war-room calls.

## [v1.1.1] - 2026-03-06

### Added
- Migration system with versioned migration files
- `add-migration` Claude skill for scaffolding new versioned migrations
