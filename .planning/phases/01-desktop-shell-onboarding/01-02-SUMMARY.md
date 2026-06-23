---
phase: 01-desktop-shell-onboarding
plan: 02
subsystem: packaging
tags: [electron, packaging, native-abi, better-sqlite3, migrations, data-dir, userData, vitest, tdd]

# Dependency graph
requires:
  - "01-01: auth-precedence + .env-merge contract (desktop-config.ts) — unchanged here, but the same writable .env this plan relocates"
provides:
  - "CLAUDECLAW_DATA_DIR redirect: STORE_DIR + readEnvFile resolve writable state (store/, db, .env) under a per-user dir when the shell sets it; byte-identical dev path when unset (PKG-02)"
  - "src/migrate-runner.ts runMigrations({assumeYes,projectRoot,dataDir}) — non-interactive core: never reads stdin, never process.exit, returns a status; preserves backup + 3-deep rotation"
  - "electron/main.cjs: migrations applied via the runner BEFORE forking the service; child gets CLAUDECLAW_DATA_DIR=userData; migrating/migrating-failed boot states + Retry"
  - "package.json: electron:build + postinstall wired to electron-builder install-app-deps (prebuilt native rebuild, no source compile, no version bump)"
  - "MED-4 ABI proof: better-sqlite3 11.10.0 has NO Electron-v115 prebuilt (lowest v116) — pinned Electron 33 = ABI 115 — surfaced as a W4-build blocker in W2"
affects: [01-04, electron-shell, packaging, native-module-abi]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Packaged-app writable-state redirect: shell sets CLAUDECLAW_DATA_DIR=app.getPath('userData'); service config.ts/env.ts honor it; PROJECT_ROOT (code/CLAUDE.md/skills) does NOT move"
    - "Migration gate defused by applying migrations before fork via a returns-a-status runner (no stdin, no process.exit), so the service's checkPendingMigrations process.exit(1) can never silently kill the boot"
    - "Interactive CLI keeps its prompts; the non-interactive runner is the shared apply core both the CLI and the shell call"
    - "ABI proof without mutating shared/live node_modules: read the better-sqlite3 GitHub release asset list to confirm prebuilt coverage per Electron ABI"

key-files:
  created:
    - src/config.test.ts
    - src/migrate-runner.ts
    - src/migrate-runner.test.ts
  modified:
    - src/config.ts
    - src/env.ts
    - src/env.test.ts
    - scripts/migrate.ts
    - electron/main.cjs
    - electron/config.cjs
    - electron/preload.cjs
    - electron/boot.html
    - package.json
    - .planning/phases/01-desktop-shell-onboarding/deferred-items.md

key-decisions:
  - "MED-2 (service logs): NO redirect needed. src/logger.ts uses pino to stdout/stderr only — no file writes, no repo-relative logs/ dir. The space-in-log-path launchd trap does not apply to the desktop service."
  - "MED-4 (ABI proof) BLOCKER: better-sqlite3@11.10.0 publishes prebuilt Electron binaries starting at electron-v116 (Electron 35+); the pinned electron ^33.4.11 is ABI 115 — NO v115 prebuilt exists. install-app-deps would fall back to a source compile the broken toolchain cannot do. Recorded as a STATE blocker; needs a version-bump decision before plan 04's build. NOT auto-fixed (Rule 4: version bumps the plan forbade)."
  - "install-app-deps was NOT executed in this worktree: node_modules is symlinked to the main checkout where the LIVE service runs on the system Node ABI; rebuilding better-sqlite3 for Electron's ABI there would break the running service. ABI coverage proven non-destructively via the GitHub release asset list."
  - "PROJECT_ROOT deliberately stays at the code dir even when CLAUDECLAW_DATA_DIR is set — only writable state moves — so the SDK still loads CLAUDE.md + skills from the bundle."

patterns-established:
  - "Non-interactive runner returns a discriminated-union status ({status:'applied'|'none-pending'|'fresh-init'|'failed', ...}); callers own exit codes / UI"
  - "Boot-screen Retry via a minimal preload bridge (boot.retryMigration) re-invoking bootDashboard from main"

requirements-completed: [PKG-02]

# Metrics
duration: ~25min
completed: 2026-06-22
---

# Phase 01 Plan 02: Packaging-Correctness Fixes (writable state, migration gate, native ABI) Summary

**Routed all writable state (.env/store/db) under CLAUDECLAW_DATA_DIR so a read-only signed bundle can boot, replaced the service-killing migration gate with a non-interactive runner that applies migrations before fork and surfaces a real retry state, and wired the Electron-ABI native rebuild into the build — while proving in W2 that better-sqlite3 ships no prebuilt for the pinned Electron 33 ABI (a W4-build blocker now surfaced early).**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 (Task 1 auto/TDD, Task 2 auto/TDD, Task 3 auto)
- **Files created:** 3
- **Files modified:** 8 (+ deferred-items.md)

## Accomplishments

### Task 1 — Writable-state redirect (TDD)
- `src/config.ts`: `STORE_DIR` resolves under `CLAUDECLAW_DATA_DIR/store` when the shell sets the var, else `PROJECT_ROOT/store` (unchanged). `PROJECT_ROOT` itself does not move — only writable state.
- `src/env.ts`: `readEnvFile` reads `<data-dir>/.env` when `CLAUDECLAW_DATA_DIR` is set, else `process.cwd()/.env` (unchanged). The var is read from the shell env only (it locates the .env), preserving the no-secrets-in-process.env behavior.
- Tests: `src/config.test.ts` (3) + extended `src/env.test.ts` (2 new) assert the override AND the no-regression default.

### Task 2 — Non-interactive migration runner + migration-before-fork (TDD)
- `src/migrate-runner.ts`: `runMigrations({assumeYes, projectRoot, dataDir})` factored from `scripts/migrate.ts`. It **never reads stdin** (no readline), **never calls process.exit**, and **returns a status** (`applied` / `none-pending` / `fresh-init` / `failed`). Pre-migration backup + 3-deep rotation preserved; store/db/backups resolve under `dataDir` when supplied.
- `scripts/migrate.ts`: keeps its interactive dry-run summary + `[y/N]` prompt, then delegates the apply to `runMigrations({assumeYes:true})` and owns the CLI exit codes.
- `electron/main.cjs`: `DATA_DIR = app.getPath('userData')` when packaged (else `APP_ROOT`); `ENV_PATH` is `DATA_DIR/.env`; the forked child gets `CLAUDECLAW_DATA_DIR=DATA_DIR`. `bootDashboard()` now `mkdir -p DATA_DIR`, shows `migrating`, awaits `runMigrationsStep()` (runs the runner in a short-lived child — `dist/migrate-runner.js` under Electron's Node when packaged, `src/migrate-runner.ts` via tsx in dev), and only calls `startService()` on a non-failed status. A `failed` status renders a `migrating-failed` state with a Retry that re-runs the boot.
- `electron/config.cjs`: `resolveEnvPath()` honors `CLAUDECLAW_DATA_DIR`; `readEnv`/`writeEnv`/`isConfigured` fall back to it when no path is passed.
- `electron/preload.cjs`: `boot.retryMigration` bridge. `electron/boot.html`: `migrating` + `migrating-failed` copy entries and a "Try again" button.

### Task 3 — Native-ABI rebuild wiring + W2 ABI proof
- `package.json`: `electron:build` is now `npm run build && electron-builder install-app-deps && electron-builder`; added `postinstall: electron-builder install-app-deps`. No version bumps; `migrations/**` still in `extraResources`.

## MED-2 — Service logs disposition

**No redirect needed.** `src/logger.ts` uses `pino` writing to **stdout/stderr only** (dev uses `pino-pretty`; prod is the default transport). There is no file-based log target and no repo-relative `logs/` directory the service writes to. The launchd space-in-log-path exit-78 trap therefore does not apply to the desktop service path. Documented here per the Task 2 acceptance criterion.

## MED-4 — W2 install-app-deps ABI outcome (BLOCKER)

**Outcome: prebuilt NOT available for the pinned Electron ABI — install-app-deps would force a source compile that the broken toolchain cannot do.**

- `better-sqlite3@11.10.0` (resolves the `^11.8.1` pin) publishes prebuilt Electron binaries starting at **`electron-v116`** (Electron 35+). ABIs offered: 116, 118, 119, 121, 123, 125, 128, 130, 132, 133, 135.
- The pinned **`electron ^33.4.11` uses `NODE_MODULE_VERSION 115`** (Node 20.18.x). **No `electron-v115` prebuilt asset exists** in the v11.10.0 release.
- Therefore `electron-builder install-app-deps` (via `prebuild-install`) finds no match and falls back to `node-gyp rebuild` — a source compile. This machine's toolchain is broken (Python 3.12 no-distutils + Node 25), so the build fails. **The W4 `.dmg` build will fail under the current pins.** This is exactly the failure MED-4 asked to surface in W2 — now surfaced.
- **`install-app-deps` was deliberately NOT run in this worktree:** `node_modules` is a symlink to the main checkout where the **live service runs on the system Node ABI**; rebuilding better-sqlite3 for Electron's ABI there would break the running service. `electron`/`electron-builder` are also not installed in this checkout. ABI coverage was proven non-destructively via the better-sqlite3 GitHub release asset list (read-only API call), not by mutating shared node_modules.
- **Resolution (deferred to a decision before plan 04, Rule 4):** bump `electron` to a version whose ABI has a better-sqlite3 prebuilt (e.g. 35.x → ABI 116), OR repin `better-sqlite3` to a release publishing `electron-v115`, OR provision a working native toolchain. All are version-bump/architectural changes the plan forbade 01-02 from making. Recorded as a STATE blocker and in `deferred-items.md`.

## Task Commits

1. **Task 1 (RED):** failing CLAUDECLAW_DATA_DIR tests — `6400519` (test)
2. **Task 1 (GREEN):** STORE_DIR + readEnvFile data-dir redirect — `3a120ec` (feat)
3. **Task 2:** non-interactive runner + migration-before-fork + boot states — `9640a91` (feat)
4. **Task 3:** install-app-deps wiring (electron:build + postinstall) — `b0f058a` (chore)

_Task 1 & 2 are TDD (test → feat). No refactor commits were needed (GREEN was clean)._

## Verification

- **Plan tests:** `npx vitest run src/config.test.ts src/env.test.ts src/migrate-runner.test.ts` → **22 passed (3 files)**. Green.
- **Typecheck:** `npm run typecheck` (`tsc --noEmit`) → **clean**.
- **Syntax:** `node --check` on `electron/main.cjs`, `electron/config.cjs`, `electron/preload.cjs` → all OK.
- **Greps:** `CLAUDECLAW_DATA_DIR` in config.ts/env.ts/main.cjs; `runMigrations` + `getPath('userData')` (x2) in main.cjs; `migrating`/`migrating-failed` in boot.html. All present.
- **Runner invariants:** no `process.exit` and no `readline`/stdin in `src/migrate-runner.ts` code (only in explanatory comments); a spy proves readline is never invoked on the `assumeYes` path.
- **CLI smoke:** `echo n | tsx scripts/migrate.ts` runs (fresh-init path) — the refactored CLI loads and the runner import resolves.
- **Full suite (`npm test`):** NOT run for self-verification — per the run instructions it has 6 pre-existing dist/-dependent CLI integration failures unrelated to this plan; scoping was to the touched test files (above).

## Deviations from Plan

### [Rule 4 - Architectural] MED-4 ABI gap surfaced as a blocker instead of running install-app-deps
- **Found during:** Task 3 (the MED-4 W2 ABI proof).
- **Issue:** The pinned Electron 33 (ABI 115) has no matching better-sqlite3 prebuilt; running `install-app-deps` would source-compile (broken toolchain) and also would mutate the shared, live node_modules (symlinked to the main checkout running the service on the system ABI).
- **Action:** Wired the package.json scripts as specified (the correct, version-neutral deliverable), then surfaced the ABI gap as a STATE blocker + `deferred-items.md` entry rather than (a) running a destructive/failing install-app-deps, or (b) bumping versions the plan forbade. The verify command's literal `install-app-deps` invocation was intentionally not executed for the node_modules-isolation reason above; ABI coverage was proven read-only.
- **Files:** `package.json`, `.planning/phases/01-desktop-shell-onboarding/deferred-items.md`; STATE blocker recorded.
- **Commit:** `b0f058a` (scripts); blocker via `gsd-sdk state.add-blocker`.

Otherwise the plan executed as written: writable-state redirect, the non-interactive runner + migration-before-fork wiring, and the boot states all match the task specs.

## Threat Surface

- **T-02-01 (Info disclosure, userData .env/db):** mitigated — only the *location* moved; `electron/config.cjs:writeEnv` still writes `0600` and `src/db.ts` still `chmod 0700`s the store dir. No perms changed.
- **T-02-02 (DoS, migration gate):** mitigated — migrations now apply before fork via a runner that returns a status (no stdin, no process.exit); failure shows a Retry state, never a silent exit.
- **T-02-03 (Tampering, native .node):** partially mitigated / **blocked** — the build is wired to use install-app-deps prebuilt binaries with no version bump, but the pinned Electron 33 has no prebuilt (see MED-4). No new attack surface introduced.
- No new network endpoints, auth paths, or schema changes introduced.

## Issues Encountered

- The MED-4 ABI gap (documented above) is the one substantive issue — a real, build-blocking finding, surfaced early exactly as the plan intended.

## Next Plan Readiness

- **Plan 04 (end-to-end launch test) is BLOCKED on the ABI decision.** Before the `.dmg` build can succeed, the Electron-or-better-sqlite3 version pin must be resolved (Rule 4 decision) and `install-app-deps` proven on a checkout with its own node_modules.
- Tasks 1 & 2 (data-dir redirect, migration-before-fork) are complete and independently correct — they do not depend on the ABI resolution.

## Self-Check: PASSED

All declared created files exist (`src/config.test.ts`, `src/migrate-runner.ts`, `src/migrate-runner.test.ts`); all task commits (`6400519`, `3a120ec`, `9640a91`, `b0f058a`) are present in git history.

---
*Phase: 01-desktop-shell-onboarding*
*Completed: 2026-06-22*
