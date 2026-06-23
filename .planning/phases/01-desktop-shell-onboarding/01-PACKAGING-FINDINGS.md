# Phase 01 — macOS .dmg Packaging: Findings & Status

Date: 2026-06-22
Branch: `claude/competent-napier-d35e22` (merged with main after PR #58 landed)

## TL;DR

1. **MED-4 is a misdiagnosis.** Electron 33's ABI is **130**, not 115 (115 is the
   *bundled Node 20* ABI; native modules build against Electron's own ABI).
   better-sqlite3 11.10.0 ships a working `electron-v130` prebuilt, so
   `electron-builder install-app-deps` **downloads a prebuilt and never compiles** —
   the broken Python/Node toolchain is irrelevant, and **no Electron bump is needed**
   (kept `^33.4.11`). Verified: `@electron/rebuild … buildFromSource=false → finished`,
   and the result loads under `ELECTRON_RUN_AS_NODE` (ABI 130).
2. **The data-dir refactor, migration runner, signing config, and entitlements
   landed via PR #58 (main).** This branch was merged with main; those pieces are
   main's. What remains unique here are the two build-config fixes below, which
   main lacks and which block the `.dmg` from building/running at all.

## What this PR contributes (after merging main)

Running `electron-builder` for real surfaced two bugs that block every `.dmg` build,
neither fixed on main:

- **Bug 1 — output-dir recursion.** electron-builder's default output dir is `dist/`,
  but `build.extraResources` copies `dist/**` into the app bundle, so it swept its own
  in-progress output (`dist/mac-arm64/ClaudeClaw.app`) into itself → `ENAMETOOLONG`.
  Fixed with `build.directories.output = "dist_electron"` (already gitignored; it was
  the intended output dir per `.gitignore`).
- **Bug 2/3 — service can't resolve its node_modules; asar manifest check fails.**
  The service runs (via `ELECTRON_RUN_AS_NODE`) from `resourcesPath/app/dist/index.js`
  with cwd `resourcesPath/app`, but the default asar layout leaves `node_modules` only
  inside `app.asar` (and the explicit `files` allowlist + gitignored `dist/` also drop
  `package.json` from the asar, failing electron-builder's sanity check). Fixed with
  `build.asar = false`, which lays the app out unpacked at `resourcesPath/app/` so
  `node_modules` sits next to `dist/` and `require('better-sqlite3' | '@slack/bolt' | …)`
  resolves. (This is required for main's run-from-extraResources design to work at
  runtime; with `asar:true` the service can't reach its deps.)

Both fixes are in `package.json`. The full investigation history (including the
data-dir reasoning that PR #58 independently implemented) is in git.

## Verification

- `tsc --noEmit` clean.
- Unsigned `.dmg` (`CSC_IDENTITY_AUTO_DISCOVERY=false … -c.mac.notarize=false`) builds
  end to end → `dist_electron/ClaudeClaw-<ver>-arm64.dmg`. `better-sqlite3` native is
  present at `Resources/app/node_modules/…` and loads under `ELECTRON_RUN_AS_NODE`.
- ABI matrix (node-abi registry × better-sqlite3 11.10.0 GitHub assets): Electron
  27–36 all have prebuilts (33→v130, 36→v135); 37+ would need better-sqlite3 12.x.

## How to build

Unsigned dev build:
```
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64 -c.mac.notarize=false
```
Signed + notarized (operator, once creds exist; uses main's afterSign hook + entitlements):
```
export APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=…
export CSC_LINK=/path/to/DeveloperID.p12 CSC_KEY_PASSWORD=…
npm run electron:build
```
In an **isolated** checkout (never the live-service checkout — rebuilding
better-sqlite3 for Electron's ABI there breaks the launchd service's system-Node binary):
```
npm install --ignore-scripts && node node_modules/electron/install.js && npx electron-builder install-app-deps
```

## Remaining / deferred

- **Signing credentials (operator-only, BLOCKING for PKG-01).** `security find-identity
  -v -p codesigning` = 0 identities here. Need a Developer ID Application identity +
  notary creds. Without them only the unsigned dev build is possible.
- **Clean-Mac smoke test (PKG-01..05).** Still pending real signing creds.
- **`asar:false` is "strongly not recommended"** (ships raw JS, larger, no tamper-
  resistance). The production-grade path is `asar:true` + running the service from
  inside the asar (natives auto-unpacked); now that main externalized the writable
  data dir, that path is unblocked as a follow-up.
- **Writable paths main left under the read-only code root** (worth a follow-up since
  they fail from `/Applications`): `media.ts` uploads (`workspace/uploads`),
  `dashboard.ts:592` (`warroom/music.mp3`), and `checkPendingMigrations(PROJECT_ROOT)`
  writing `.applied.json` into the bundle on a fresh packaged install (main's
  `migrate-runner` handles the data-dir migrate path, but the in-process guard in
  `index.ts` still points at PROJECT_ROOT — verify on a packaged fresh install).
- App icon not set (default Electron icon).
