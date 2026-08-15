# AGENTS.md

## Cursor Cloud specific instructions

ClaudeClaw is a self-hosted personal AI assistant (Node.js 20+/TypeScript, ESM). The
single Node process (`src/index.ts`) runs the chat transport (Slack/Telegram/Discord),
orchestrator, scheduler, SQLite memory, and the **web dashboard** (a Preact SPA served by a
Hono server). See `README.md` for the full product tour and `package.json` for all scripts.

The dependency-refresh update script runs `npm install` on startup (this also runs the
`postinstall` `electron-builder install-app-deps`, which rebuilds `better-sqlite3` — it still
works under plain Node/`tsx`, no action needed). Everything below is startup/run guidance that
is NOT handled by the update script.

### Local `.env` is required to run or fully test (gitignored, not committed)

`src/config.ts` reads secrets from a repo-root `.env` (kept out of `process.env` on purpose).
On a fresh VM there is no `.env`, so create a dev one with generated keys. **Non-obvious
gotcha:** `src/index.ts` calls `process.exit(1)` if no chat transport token is set. Use a
dummy Telegram token so the server boots the dashboard + local services without real Slack/
Telegram credentials — the Telegram poll fails with a 401 but that error is caught and the
dashboard stays up.

```bash
cat > .env <<EOF
TRANSPORT=telegram
TELEGRAM_BOT_TOKEN=0000000000:DEV_DUMMY_TOKEN_FOR_LOCAL_DASHBOARD_ONLY
DB_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
DASHBOARD_TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
DASHBOARD_PORT=3141
EOF
```

- `DASHBOARD_TOKEN` must be set or the dashboard is disabled entirely (server never binds).
  All `/api/*` routes require `?token=<DASHBOARD_TOKEN>`; static/HTML pass through.
- To exercise real chat/agent replies (not needed for dashboard work) set `ANTHROPIC_API_KEY`
  (or `CLAUDE_CODE_OAUTH_TOKEN`) plus real Slack/Telegram tokens.

### Lint / typecheck / test / build

- **Lint = typecheck.** There is no ESLint/Prettier config; use `npm run typecheck`
  (`tsc --noEmit`).
- **`npm test` requires a prior `npm run build`.** `vitest` is green (~1059 passing) only after
  `dist/` exists: `src/schedule-cli.test.ts` shells out to `dist/schedule-cli.js` and
  `src/dashboard.contract.test.ts` reads `dist/web/index.html`. Without a build, 5 tests fail
  environmentally (unrelated to code). `schedule-cli` tests also need `.env` (`DB_ENCRYPTION_KEY`).
- **Build:** `npm run build` (= `vite build` → `dist/web/`, then `tsc` → `dist/*.js`). `dist/`
  is gitignored, so build after every fresh checkout before running the full suite.

### Migrations gotcha

`checkPendingMigrations()` in `src/index.ts` hard-exits (`process.exit(1)`) when `store/`
already exists but migrations are pending. On a truly fresh checkout (no `store/`) it
auto-initializes and the server boots fine. If you run tests/CLIs first (they create
`store/claudeclaw.db`), the next `npm run dev` will exit until you migrate. The migrate CLI is
interactive with no `--yes` flag, so pipe confirmation:

```bash
printf 'y\n' | npm run migrate
```

### Running the app in dev mode

Two long-running processes (run each in its own tmux window/terminal):

- Backend: `npm run dev` (`tsx src/index.ts`) — Hono dashboard + API on `127.0.0.1:3141`.
- Frontend: `npm run dev:web` (Vite) on **`localhost:5174`**, proxying `/api`, `/ws`,
  `/warroom/*` to `DASHBOARD_PORT`. Vite binds to `localhost`/IPv6 (`::1`), so use
  `http://localhost:5174` — `http://127.0.0.1:5174` will refuse the connection.

Open `http://localhost:5174/?token=<DASHBOARD_TOKEN>`. Alternatively, hit the backend-served
built SPA directly at `http://127.0.0.1:3141/?token=<DASHBOARD_TOKEN>` after `npm run build:web`.

Optional/experimental services (War Room voice via Python venv, WhatsApp daemon, Discord,
voice STT/TTS, Electron desktop shell) are off by default and need extra keys/setup — see
`README.md` and `.env.example`. The Electron app must NOT be built/shipped from here.

### Git / workflow

`.githooks/pre-commit` and `.githooks/pre-push` refuse commits/pushes on `main` once installed
(`scripts/install-hooks.sh`). Always work on a feature branch and open a PR; never push to
`main`, never deploy (see `CLAUDE.md`).
