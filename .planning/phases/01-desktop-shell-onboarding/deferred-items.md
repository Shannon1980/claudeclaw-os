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

## From Plan 01-04

- **DEFERRED — PKG-01 ("signed+notarized .dmg opens on a clean Mac") is NOT verified for real users in this run.**
  - **What landed:** the version-agnostic signing deliverables only — `build/entitlements.mac.plist` (hardened-runtime entitlements), `build/notarize.cjs` (afterSign @electron/notarize hook that no-ops without creds), and the `package.json` `build.mac` config (`hardenedRuntime: true`, `gatekeeperAssess: false`, `entitlements`/`entitlementsInherit`, `afterSign`) + `@electron/notarize ^3.1.1` devDep. No version bumps.
  - **What is DEFERRED:** the actual `npm run electron:build` (sign → notarize → staple → `.dmg`) and the entire clean-machine smoke (SMOKE-CHECKLIST §§ 1–5). These are PENDING.
  - **Why:** the carried 01-02 **MED-4 ABI blocker** — pinned `electron ^33.4.11` (ABI 115) has no matching `better-sqlite3` prebuilt (lowest is electron-v116), so `electron-builder install-app-deps` / the real build would source-compile and FAIL on this machine's broken toolchain (Python 3.12 no-distutils + Node 25). Operator decision (2026-06-23): **land config, DEFER the real build.** The build was deliberately NOT attempted — no fabricated success.
  - **Signing-identity caveat:** an automated `security find-identity -v -p codesigning` from the non-interactive orchestrator shell returned "0 valid identities found" — expected from a locked/sandboxed keychain in that shell, NOT a missing cert. The operator confirmed a Developer ID Application cert + notary creds ARE available. SMOKE-CHECKLIST § 0.1 records that this must be re-confirmed in an unlocked interactive terminal immediately before the signed build.
  - **Action required to close PKG-01:** resolve MED-4 (bump electron to >=35 / ABI 116, then `install-app-deps` on an isolated checkout), then run `npm run electron:build` with notary creds in env, then execute SMOKE-CHECKLIST §§ 0–5 incl the MED-3 real-auth round-trip (step 3.5) on a clean Mac. Tracked for /gsd-verify-work.
