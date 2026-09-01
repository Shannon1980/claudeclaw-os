---
name: new-agent
description: Create a new ClaudeClaw specialist agent from a template using the non-interactive CLI. Use when the user asks to add an agent, create a new agent, or scaffold comms/content/ops/research/sentinel/social.
disable-model-invocation: true
allowed-tools: Read, Write, Bash, Grep, Glob
---

# new-agent

Scaffold a ClaudeClaw specialist agent. Be direct. No em dashes. No "Certainly!", "Great question!", or sycophancy.

This product already ships templates under `agents/`:

- `_template` (blank)
- `comms`
- `content`
- `ops`
- `research`
- `sentinel`
- `social`
- `aos`

Confirm what is actually on disk with `--templates` after the CLI is built. Do not invent a template that is not listed.

## Collect these first

If any of these are missing, ask one short question. Do not guess.

| Field | Rule |
|-------|------|
| agent id | lowercase, no spaces (`^[a-z][a-z0-9_-]{0,29}$`) |
| display name | human-readable |
| description | one line |
| template | one of the templates above, default `_template` |
| model | default `claude-sonnet-4-6` |

## Tokens stay out of chat

NEVER write a Telegram or Slack token into the skill output, a file you echo, or a command you paste back.

If the user has not given a token:

- Create the files without calling the CLI with `--token`, **or**
- Tell them to run the CLI themselves.

Prefer documenting the command over pasting secrets into chat. They type the token locally.

Do not use `scripts/agent-create.sh`. That script is interactive and writes tokens into `.env`.

## How to scaffold

Resolve the repo root. Never use `find`.

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

If `dist/agent-create-cli.js` is missing:

```bash
npm run build:server
```

Non-interactive CLI (no `--token` in anything you print or run unless the user is running it themselves):

```bash
node "$PROJECT_ROOT/dist/agent-create-cli.js" --id ID --name NAME --description DESC --template TEMPLATE
```

Optional: `--model claude-sonnet-4-6`.

Do **not** pass `--activate`. That installs launchd and is a deploy.

List templates:

```bash
node "$PROJECT_ROOT/dist/agent-create-cli.js" --templates
```

If you cannot call the CLI without a token, copy the chosen template into the config dir yourself (see below). Same hard rules apply.

## Where files live

Personal agent configs belong in `CLAUDECLAW_CONFIG` (default `~/.claudeclaw/agents/<id>`).

They are **not** committed to this public repo. Do not write `agents/<id>/CLAUDE.md` or `agents/<id>/agent.yaml` into the worktree unless the user explicitly asked to add a public `*.example` template.

## Hard rules for any yaml or md you write

- Obsidian vault paths stay commented-out examples
- No real names, no absolute personal paths
- `telegram_bot_token_env` is an ENV VAR NAME only (e.g. `RESEARCH_BOT_TOKEN`), never the token value
- launchd/plist paths must keep `__PROJECT_DIR__` and `__HOME__` placeholders

## After scaffolding

Print:

1. Where the files live (`$CLAUDECLAW_CONFIG/agents/<id>` or `~/.claudeclaw/agents/<id>`)
2. The env var **name** they need to add to `.env` themselves (e.g. `RESEARCH_BOT_TOKEN`). Never a value.
3. How to start: `npm start -- --agent <id>`

Document this command if they want a token later. They run it. You do not paste a token:

```bash
node "$PROJECT_ROOT/dist/agent-create-cli.js" --id ID --name NAME --description DESC --template TEMPLATE --token '<they type this locally>'
```

## Do not

- Start the agent unless the user asked
- Install launchd / pass `--activate`
- Write tokens into `.env`, chat, or files
- Commit personal agent configs to this repo
