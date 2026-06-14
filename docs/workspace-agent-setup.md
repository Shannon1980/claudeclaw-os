# Workspace Agent Setup

How to point a ClaudeClaw agent at a workspace repo so it runs Claude Code with that repo as its working directory. The SDK then auto-loads the repo's `CLAUDE.md`/`AGENTS.md` and `.claude/skills` via `settingSources:['project','user']`. Use this to give an agent a whole project (its instructions, brand context, and skills) without writing any code.

You can set this up, or repoint an existing agent, using only this doc. You do not need to read `src/agent-config.ts`.

## Where agents live

Fleet agents live in the external config dir, not the repo:

```
~/.claudeclaw/agents/<id>/agent.yaml
```

`CLAUDECLAW_CONFIG` defaults to `~/.claudeclaw`. The repo's `agents/` dir holds examples and `_template/` only. The runtime checks `CLAUDECLAW_CONFIG/agents/<id>` first, then falls back to the repo. The `<id>` must match `[a-z0-9_-]` (e.g. `aos`, `workspace`).

## agent.yaml keys

| Key | Required | Meaning |
|-----|----------|---------|
| `name` | yes | Display name for the agent. |
| `description` | no | One line on what the agent is for. |
| `project_dir` | no | Absolute path to the workspace repo. Becomes the SDK working directory. Quote it if the path contains a space. |
| `slack_channel` | no | A Slack channel id routed to this agent. Omit for delegation-only. |
| `model` | no | Model override (alias like `opus` or a full id). |
| `mcp_servers` | no | Allowlist that FILTERS MCP servers already defined in `~/.claude/settings.json`. It does not define new servers. |

Minimal example (delegation-only workspace agent):

```yaml
name: AOS
description: Agentic OS workspace agent.
project_dir: "/Users/you/path with spaces/agentic-os"
```

## CLAUDE.md for the agent: skip it

Do not add a `CLAUDE.md` under the agent dir for a workspace agent. The agent's own role prompt stacks on top of the workspace `CLAUDE.md` the SDK loads, and a second one just competes with it. Leave it out, or keep it to a single line. Full per-agent identity (SOUL.md) is handled in a later phase.

## Restart is mandatory

Editing `agent.yaml` has no effect on a running bot. The Slack channel map and the runtime cache are built once at startup. After any change, restart the process:

```
launchctl kickstart -k gui/$(id -u)/com.claudeclaw.app
```

(Use your service label; the main bot is `com.claudeclaw.app`.)

## How to reach the agent

- Routed channel: set `slack_channel` and message that channel directly.
- Delegation: leave the channel off and prefix a message with `@<id>:` (for example `@aos: <your request>`). An unprefixed message goes to the channel's default agent, not your workspace agent.

## Headless caveats

These apply when the agent runs under the bot (headless), not in a terminal:

- Workspace `.claude` hooks fire on bot turns. The repo's SessionStart/Stop/PostToolUse hooks run.
- The workspace deny list still applies even under bypassPermissions. `Bash(curl ...)`, `Bash(rm ...)`, and `Read(.env)` stay blocked. Deny always wins.
- Secrets are scrubbed. `*_API_KEY` and `*_TOKEN` are stripped from the SDK env, so API and Downloads style skills will not work headless yet. Use text-only skills for now.
- Paths with spaces are fine for `project_dir` and the cwd. They are passed as a single value. The one exception is a standalone launchd service, which needs a no-space symlink for `WorkingDirectory` and `/tmp` log paths.
- Only point at a TRUSTED repo. Its `CLAUDE.md`, skills, and hooks run under the bot. Treat pointing an agent at a repo like running that repo's code.

## Repoint to a different workspace

1. Edit `project_dir` in `~/.claudeclaw/agents/<id>/agent.yaml` to the new repo path.
2. Restart the bot (see above).
3. Verify: send `@<id>: what is your current working directory?` and confirm it reports the new path.
