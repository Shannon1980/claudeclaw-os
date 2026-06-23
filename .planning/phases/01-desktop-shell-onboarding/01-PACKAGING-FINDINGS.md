# Phase 01 — macOS .dmg Packaging: Findings & Status

Date: 2026-06-22
Branch: `claude/competent-napier-d35e22`
Session goal: unblock MED-4 and produce a signed+notarized `.dmg`.

## TL;DR

1. **MED-4 is a misdiagnosis.** Electron 33's ABI is **130**, not 115 (115 is the
   *bundled Node 20* ABI; native modules build against Electron's own ABI).
   better-sqlite3 11.10.0 ships a working `electron-v130` prebuilt, so
   `electron-builder install-app-deps` **downloads a prebuilt and never compiles**
   — the broken Python/Node toolchain is irrelevant. Proven on both Electron 33
   and 36: `@electron/rebuild … buildFromSource=false → finished`, and the
   resulting better-sqlite3 loads under `ELECTRON_RUN_AS_NODE` (ABI 130 on E33).
2. **No Electron bump needed.** Reverted to `^33.4.11` (matches reviewed plan 01-04).
3. **Running the build for real exposed config bugs** (plan 01-04 was never
   executed). Three found; all fixed enough to produce a working **unsigned**
   `.dmg`: `dist_electron/ClaudeClaw-1.2.1-arm64.dmg` (178 MB, APFS).
4. **Signing is the only remaining gate, and it needs operator credentials** —
   `security find-identity -v -p codesigning` = 0 valid identities on this machine.

## Authoritative ABI / prebuilt matrix

Source: `electron/node-abi` registry, cross-checked against the better-sqlite3
v11.10.0 GitHub release assets (the `electron-v130-darwin-arm64` asset downloads,
HTTP 200, 941 KB).

| Electron | ABI | better-sqlite3 11.10.0 prebuilt |
|---|---|---|
| 33.4.11 (chosen) | 130 | ✅ electron-v130 |
| 35.7.5 | 133 | ✅ electron-v133 |
| 36.9.5 | 135 | ✅ electron-v135 (highest) |
| 37+ | 136+ | ❌ none under better-sqlite3 ≤ 11.x |

The service spawns with `ELECTRON_RUN_AS_NODE=1` but is still the Electron binary,
so its natives use **Electron's** ABI — the install-app-deps rebuild is correct for
both the main process and the run-as-node service. Verified: `ELECTRON_RUN_AS_NODE=1
electron -e "require('better-sqlite3')…"` → loads, `ABI=130 node=20.18.3 electron=33.4.11`.

## Changes made (this worktree; NOT committed)

- `package.json`
  - `build.directories.output = "dist_electron"` — **fix** (was defaulting to
    `dist/`, which `extraResources: dist/**` then swept into itself → ENAMETOOLONG
    recursion). `dist_electron/` is already gitignored and was the intended dir.
  - `build.asar = false` — **fix** for Bugs 2 & 3 (see below). Pragmatic; see the
    "Production hardening (deferred)" note.
  - `build.mac`: `hardenedRuntime`, `gatekeeperAssess:false`,
    `entitlements`/`entitlementsInherit`, `notarize.teamId = ${env.APPLE_TEAM_ID}`.
  - `"package.json"` added to `build.files`.
  - Electron left at `^33.4.11` (no bump).
- `build/entitlements.mac.plist` (new) — allow-jit, allow-unsigned-executable-memory,
  allow-dyld-environment-variables (ELECTRON_RUN_AS_NODE + spawning claude/npm),
  disable-library-validation (loading the native .node + child binaries).
- `build/entitlements.mac.inherit.plist` (new) — helper-process hardened-runtime
  exceptions (not App-Sandboxed → no `com.apple.security.inherit`).

Deviation from plan 01-04: the plan specified a `build/notarize.cjs` afterSign hook
+ `@electron/notarize` devDep. electron-builder 25 has native notarytool support via
`mac.notarize`, so the config approach is used instead (less code, no double-notarize
hazard, no new dependency to vet). Switch to the hook if you prefer the planned shape.

## Build bugs found by the first real `electron-builder` run

- **Bug 1 — output-dir recursion (FIXED).** Default output `dist/` + `extraResources:
  dist/**` copied the in-progress app bundle into itself. Fixed via `directories.output`.
- **Bug 2 — asar had no `package.json` (FIXED via asar:false).** The explicit
  `files` allowlist + electron-builder honoring `.gitignore` (which ignores `dist/`)
  left the asar with only `electron/` + `node_modules/`; the manifest sanity check
  aborted. `asar:false` removes the asar entirely so the check no longer applies.
- **Bug 3 — service couldn't resolve node_modules (FIXED via asar:false).**
  `APP_ROOT = resourcesPath/app` (the extraResources dir) had `dist/ agents/
  migrations/ warroom/ package.json` but **no `node_modules`**; the run-as-node
  service at `…/app/dist/index.js` could not `require('better-sqlite3' | '@slack/bolt'
  | …)`. With `asar:false`, the packaged app (incl. node_modules) lands at
  `Resources/app/`, co-located with `dist/`, so resolution works. Verified the
  native `better_sqlite3.node` is present at `Resources/app/node_modules/…`.

## How to build

Unsigned dev build (what was verified this session):
```
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64 -c.mac.notarize=false
# → dist_electron/ClaudeClaw-<ver>-arm64.dmg
```
Signed + notarized (operator, once creds exist):
```
export APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=…
export CSC_LINK=/path/to/DeveloperID.p12 CSC_KEY_PASSWORD=…   # or a keychain identity
npm run electron:build
```
First, in an **isolated** checkout (not the live-service checkout — rebuilding
better-sqlite3 for Electron's ABI there would break the launchd service's
system-Node binary):
```
npm install --ignore-scripts        # avoids the broken system-Node native compile
node node_modules/electron/install.js
npx electron-builder install-app-deps   # fetches the electron-vXXX prebuilt, no compile
```

## Remaining work (NOT done this session)

- **Signing credentials (operator-only, BLOCKING for PKG-01).** 0 valid codesigning
  identities here. Need a Developer ID Application identity + notary creds. Without
  them, only the unsigned dev build above is possible (PKG-01 unmet for end users).
- **Clean-Mac smoke test (deferred).** `SMOKE-CHECKLIST.md` / `01-HUMAN-UAT.md` do
  not exist in this branch (plans 03/04 unexecuted). PKG-01..05 remain empirically
  unverified.
- **Writable data dir (DONE this session).** Onboarding wrote `.env` to `APP_ROOT`,
  and the service wrote `store/`, uploads, and migration state under the code root —
  all read-only in a `/Applications` install. Fixed with a `DATA_DIR` abstraction:
  - `src/config.ts`: `DATA_DIR = CLAUDECLAW_DATA_DIR ?? PROJECT_ROOT`; `STORE_DIR`
    and the new `ENV_PATH` derive from it. Default = PROJECT_ROOT, so the launchd
    service and dev are byte-for-byte unchanged.
  - `src/env.ts` (inlined, no cycle), `src/media.ts` (uploads), `src/migrations.ts`
    (split read-only defs at the code root from the writable `.applied.json`/store at
    DATA_DIR), `src/index.ts` (passes DATA_DIR), and the `.env` writers (`bot.ts`,
    `dashboard.ts`, `agent-create.ts`) now use `ENV_PATH`. `scripts/migrate.ts` is
    DATA_DIR-aware too.
  - `electron/main.cjs`: `DATA_DIR = app.isPackaged ? app.getPath('userData') : APP_ROOT`,
    creates it, points `.env` there, and passes `CLAUDECLAW_DATA_DIR` to the spawned
    service. APP_ROOT stays the code root so bundled agents/migrations/warroom resolve.
  - Verified at runtime (under ELECTRON_RUN_AS_NODE, ABI-matched): with
    `CLAUDECLAW_DATA_DIR` set, `.env` is read from there, the DB is created there, and
    the code root is untouched; without it, everything resolves to the code root as
    before. 666/669 tests pass (the 3 failures are pre-existing: schedule-cli tests
    spawn a subprocess that needs a real `.env`, absent in this worktree).
- **Still deferred:**
  - `asar:false` is "strongly not recommended" (ships raw JS, larger, no tamper-
    resistance). With the data dir now externalized, the production-grade path
    (`asar:true` + run the service from inside the asar, natives auto-unpacked) is
    unblocked and is the natural next step.
  - One unfixed writable-in-readonly edge: `dashboard.ts:592` writes
    `warroom/music.mp3` into the code root (non-boot; the "set background music"
    feature). Move under DATA_DIR when touched.
  - App icon not set (electron-builder uses the default Electron icon).
  - Clean-Mac smoke test (PKG-01..05) still pending real signing creds.

## Status vs the brief's 6 steps

1. Bump Electron + verify prebuilt — done, then **reverted** (bump not needed; 33's
   prebuilt confirmed). API ripple 33↔36 reviewed: only stable APIs used, clean.
2. install-app-deps on isolated checkout — done (this worktree). Prebuilt, no compile. ✅
3. Signed/notarized `.dmg` — **blocked on operator creds.** Unsigned `.dmg` builds. ✅(unsigned)
4. Clean-Mac smoke — not started (checklist file absent in this branch).
5. Update 01-HUMAN-UAT.md PKG-01..04 — file absent in this branch.
