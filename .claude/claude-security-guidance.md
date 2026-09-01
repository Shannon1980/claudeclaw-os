# ClaudeClaw security guidance

Project rules for the `security-guidance` plugin. ClaudeClaw-specific only. No secrets in this file.

- `store/` and `store/waweb/` are credentials. They hold WhatsApp Web session keys plus Slack and WhatsApp message bodies. Never read, commit, copy, or query them from an agent prompt.
- Never commit `.env`, `*.db`, `*.db-wal`, or `*.db-shm`. Those are tokens and the live SQLite store.
- This repo is a public template. Keep `CLAUDE.md`, `agents/*/agent.yaml`, and `launchd/*.plist` generic: placeholders only, no real names, home paths, or Obsidian vault paths.
- Ship and deploy are operator-only. Do not run `npm run electron:build`, live `npm run migrate`, `launchctl bootstrap` / `bootout`, `npm publish`, `gh release create`, `git push` to `main`, `--no-verify`, or edits to `.githooks` / `core.hooksPath`.
- Every code change goes through a PR. Never commit on `main`. Never deploy. Opening the PR is the end of the agent's shipping job.
- Outbound agent text follows the `src/exfiltration-guard.ts` mindset: no `sk-ant-`, `xoxb-` / `xoxp-`, `ghp_` / `gho_`, or Telegram bot tokens in logs or chat.
- Do not disable `runDecaySweep()` 3-day purge on `wa_messages`, `wa_outbox`, `wa_message_map`, or `slack_messages`.
- Do not add an MCP server or tool that queries live `store/claudeclaw.db` from an agent session. Tests use `_initTestDatabase` only.
- Do not bypass the permission gate or kill switches (`src/gate.ts`, `src/kill-switches.ts`) to force a command through. Tier 4 stays `ask` even in Autonomous mode.
- New dashboard `/api/` routes stay behind `DASHBOARD_TOKEN`. Do not add an unauthenticated path that dumps messages, tokens, or the DB.
