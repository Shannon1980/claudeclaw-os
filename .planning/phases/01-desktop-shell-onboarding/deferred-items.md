# Deferred Items — Phase 01

Out-of-scope discoveries logged during execution. NOT fixed (scope boundary: pre-existing failures in files not touched by the current plan).

## From Plan 01-01

- **`src/schedule-cli.test.ts` (4 tests) + `src/chat-task-tracker.test.ts` (2 tests) fail** in this worktree.
  - **Cause:** Both are CLI integration tests that `execSync` against `dist/schedule-cli.js` (and related compiled entrypoints). The worktree has no `dist/` build, so `node dist/schedule-cli.js` throws `MODULE_NOT_FOUND`.
  - **Pre-existing:** Neither file was modified by plan 01-01 (`git diff ecea5f6..HEAD` confirms). The failure is environmental (no build), not a regression.
  - **Resolution:** Run `npm run build` before `npm test` in CI/worktree, or gate these integration tests behind a built-dist precondition. Not a code defect.

## From Plan 01-02

- **BLOCKER — better-sqlite3 has no prebuilt for Electron 33's ABI (MED-4 / Assumption A2).**
  - **Finding:** `better-sqlite3@11.10.0` (the resolved version of the `^11.8.1` pin) publishes prebuilt Electron binaries starting at `electron-v116` (Electron 35+). The pinned `electron ^33.4.11` uses `NODE_MODULE_VERSION 115`. There is **no `electron-v115` prebuilt asset** in the v11.10.0 GitHub release (ABIs offered: 116, 118, 119, 121, 123, 125, 128, 130, 132, 133, 135).
  - **Consequence:** `electron-builder install-app-deps` (now wired into `electron:build` + `postinstall`) will find no matching prebuilt for Electron 33 and fall back to `prebuild-install || node-gyp rebuild` → a **source compile**. This machine's native toolchain is broken (Python 3.12 no-distutils + Node 25), so the compile fails. The W4 `.dmg` build will fail under the current pins. This is exactly the failure MED-4 asked to surface early — it is now surfaced in W2.
  - **Why not auto-fixed:** The only resolutions are version bumps the plan explicitly forbade 01-02 from making: (a) bump `electron` to 35+ (ABI 116, which has prebuilts) — changes the ABI and re-opens the rebuild story; or (b) bump/repin `better-sqlite3` to a release that publishes an `electron-v115` prebuilt; or (c) provision a working native toolchain to source-compile. All are architectural (Rule 4) and out of 01-02's scope.
  - **Not run here:** `electron-builder install-app-deps` was NOT executed in this worktree. `node_modules` is a symlink to the main checkout where the **live service runs on the system Node ABI**; rebuilding better-sqlite3 for Electron's ABI there would break the running service. `electron`/`electron-builder` are also not installed in this checkout. ABI coverage was proven non-destructively via the better-sqlite3 GitHub release asset list instead.
  - **Action required before plan 04:** decide on the version-bump path (recommended: bump `electron` to a version whose ABI has a better-sqlite3 prebuilt, e.g. 35.x → ABI 116, OR repin better-sqlite3), then run `electron-builder install-app-deps` on a checkout with its OWN node_modules (not the shared live one) and confirm a prebuilt is fetched with no source compile. Recorded as a STATE blocker.
