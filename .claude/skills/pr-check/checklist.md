# pr-check checklist

Score every item PASS or FAIL. Evidence is a file path.

## Branch

- Current branch is not `main` or `master`.

## Secrets and runtime data

- No `store/` or `store/waweb/` contents.
- No `.env` (`.env.example` is allowed).
- No `*.db`, `*.db-wal`, `*.db-shm`.

## Public template placeholders

- `CLAUDE.md`, `agents/*/CLAUDE.md`, `launchd/*.plist`, and `scripts/` stay generic.
- Placeholders still present: `[YOUR NAME]`, `[YOUR ASSISTANT NAME]`, `[YOUR_OBSIDIAN_VAULT_PATH]`, `__PROJECT_DIR__`, `__HOME__`.
- If `CLAUDE.md` is in the diff, it still contains `[YOUR NAME]`.

## Agent configs

- Only `agents/_template/` and `agents/*/*.example` may be committed.
- No personal `agents/*/CLAUDE.md` or `agents/*/agent.yaml`.

## No working-doc filenames

Refuse added/modified files matching the pre-commit hook:

- Repo root: `PLAN*`, `SHIP*`, `TESTING*`, `AUDIT*`, `REPORT*`, `CHECKLIST*`, `REDTEAM*`, `SMOKE*`, `SCRATCH*`, `NOTES*` as `*.md`
- `test_plan.md`, `update_plan.md`, `execute_plan_prompt.md`, `*_tldr.md`, `*_TLDR.md`, `PR[0-9]*_(NOTES|TESTING)*.md`
- `docs/*-results.md`, `docs/*-smoke.md`, `docs/redteam-*.md`, `docs/scratch-*.md`, `docs/internal/`

Deletions of those files are fine.

## No deploy/ship in the change

FAIL if the diff **adds** any of these as something an agent should run unattended:

- `npm run electron:build`
- `npm run migrate` against the live store
- `launchctl bootstrap` / `launchctl bootout`
- `npm publish`
- `gh release create`
- `git push` to `main` / `master`
- `--no-verify`

Build and test in a checkout is fine.

## Tests

- If `src/` changed with new behavior, a matching test exists (or this change is docs/types/comments only).
- Missing tests for new behavior is FAIL.

## PR will be opened, not merged

- Job ends at `gh pr create`.
- Do not merge. Do not deploy.
