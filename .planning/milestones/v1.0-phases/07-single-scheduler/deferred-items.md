# Phase 07 — Deferred / Out-of-Scope Items

Logged during execution. NOT fixed in the originating plan (SCOPE BOUNDARY: only
auto-fix issues directly caused by the current task's changes).

## 07-01

- **`src/schedule-cli.test.ts` — 3 failing integration tests (pre-existing, env gap).**
  The tests shell out to `node dist/schedule-cli.js`, which boots the full app and
  requires `DB_ENCRYPTION_KEY` from a `.env`. This worktree has no `.env` (per project
  memory: worktrees have no `.env`/`store`), so the CLI process exits with
  "DB_ENCRYPTION_KEY is missing or too short". Unrelated to the db.ts changes in 07-01
  (`src/db.test.ts` passes 58/58; `src/scheduler.test.ts` passes 27/27). The plan's own
  Task 2 verify targets `src/db.test.ts`. No action taken.
