---
phase: 01-desktop-shell-onboarding
plan: 03
subsystem: onboarding-auth
tags: [electron, onboarding, setup-token, native-installer, oauth, auth-precedence, cjs-esm-interop, login-item, sdk-roundtrip]

# Dependency graph
requires:
  - "01-01: src/desktop-config.ts (resolveAuthWrite, activeAuthSource) — re-exported by config.cjs via the compiled dist ESM"
  - "01-02: CLAUDECLAW_DATA_DIR redirect + ENV_PATH in main.cjs — the writable .env the captured token lands in and verifyAuth reads"
provides:
  - "config.cjs: native-installer command + ~/.local/bin/claude detection; captured-token auth detection (no ~/.claude readdir); async re-exports of resolveAuthWrite/activeAuthSource from compiled dist/desktop-config.js (MED-1 lazy await import)"
  - "main.cjs: onb:installCli (native installer), onb:claudeLogin (setup-token spawn+capture), onb:saveAuth (delegates to resolveAuthWrite), onb:getAuthSource (D1), onb:verifyAuth (real claude round-trip via getScrubbedSdkEnv, MED-3)"
  - "onboarding.html: native-install copy, setup-token sign-in, active-source confirmation, Continue gated on a verified round-trip"
  - "login item registered with type:'mainAppService'; macOS 13.0 pinned as minimumSystemVersion (A5, PKG-04)"
affects: [01-04, electron-shell, auth-settings, settings-account]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CJS→compiled-ESM interop (MED-1): config.cjs and main.cjs lazily `import(pathToFileURL(dist/*.js))` and cache the module promise; callers await an async accessor. No bundler; package.json stays type:module."
    - "setup-token spawn+capture: stream the CLI's OAuth prompts to the wizard log, capture stdout, regex-match the sk-ant-oat token, persist via resolveAuthWrite — success = token captured, never a filesystem heuristic."
    - "Real auth verification: build the SDK subprocess env via getScrubbedSdkEnv(secrets) (only the chosen auth var present, every other secret stripped), spawn `claude -p` on a trivial prompt, ok only on exit 0 + a model reply."
    - "Credential hygiene: token returned to caller for parsing/persistence only; never echoed to the wizard log or commits; written 0600 via writeEnv."

key-files:
  created: []
  modified:
    - electron/config.cjs
    - electron/main.cjs
    - electron/preload.cjs
    - electron/onboarding.html
    - package.json
  deleted:
    - electron/spike-setup-token.cjs

key-decisions:
  - "MED-1 interop mechanism: chose (a) lazy `await import()` of the compiled dist ESM, cached, behind async accessors (loadAuthHelpers / loadSecurity) — NOT a CommonJS shim file. config.cjs's resolveAuthWrite/activeAuthSource and main.cjs's getScrubbedSdkEnv are therefore async; all callers in this plan await them."
  - "A5 / PKG-04: setLoginItemSettings now passes type:'mainAppService' and the build pins mac.minimumSystemVersion='13.0' (Ventura), so the SMAppService path is always in effect for this build and the param is never a no-op on the supported floor."
  - "Native installer command: `/bin/sh -c 'curl -fsSL https://claude.ai/install.sh | bash'` (curl-based, lands ~/.local/bin/claude, auto-updates) — replaces the deprecated `npm i -g @anthropic-ai/claude-code`."
  - "Spike harness electron/spike-setup-token.cjs deleted (plan 01-01 disposition): build.files includes electron/** so it would otherwise ship; the production mechanism is now wired. It persisted nothing and remains in history under 3051107."

patterns-established:
  - "Pattern: one auth-precedence implementation shared by the shell (config.cjs re-export) and the unit tests (src/desktop-config) via the compiled dist output — no second copy of the never-coexist rule."
  - "Pattern: the wizard never advances on a credential that has not been proven to authenticate — verifyAuth gates Continue."

requirements-completed: [PKG-03, PKG-04, PKG-05]

# Metrics
duration: ~5min
completed: 2026-06-23
---

# Phase 01 Plan 03: No-Terminal Claude Setup, Owned Auth Precedence, Verified Round-Trip Summary

**Replaced the deprecated npm CLI install with the native installer and the fragile interactive `claude login` + `~/.claude` heuristic with `claude setup-token` spawn+capture, routed every auth write through the tested `resolveAuthWrite` (consumed from the compiled ESM via a lazy `await import` so the shell and unit tests share one never-coexist implementation), added a queryable active auth source for Settings > Account, and gated the wizard's Continue on a real `claude` subprocess round-trip authenticated from the data-dir .env via `getScrubbedSdkEnv` — plus confirmed login-item registration with `mainAppService` and a pinned macOS 13.0 floor.**

## Performance

- **Duration:** ~5 min
- **Tasks:** 3 (all auto) + 1 cleanup (spike removal)
- **Files modified:** 5
- **Files deleted:** 1

## Accomplishments

### Task 1 — config.cjs: native install + captured-token detection + auth-helper re-export
- `claudeBinaryPath()` resolves `~/.local/bin/claude` (native install) first, then PATH; `checkClaudeCli()` runs `--version` against it.
- `nativeInstallCommand()` returns the curl-based native installer (`/bin/sh -c 'curl -fsSL https://claude.ai/install.sh | bash'`) — no `npm -g` anywhere.
- `checkLogin(envPath)` now detects auth via a captured `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` in the data-dir .env, NOT a `readdirSync` of `~/.claude` (wrong on macOS where creds live in the Keychain).
- **MED-1 interop:** `loadAuthHelpers()` lazily `import()`s the compiled `dist/desktop-config.js` (cached promise); `resolveAuthWrite`/`activeAuthSource` are re-exported as async wrappers. One precedence implementation shared with the unit tests.

### Task 2 — main.cjs/preload.cjs: rewired IPC + active source + real round-trip + login item
- `onb:installCli` runs `cfg.nativeInstallCommand()` via `runStreaming`, re-checks the CLI, keeps the per-row retry contract.
- `onb:claudeLogin` runs `claude setup-token`, streams the OAuth prompts to the wizard log, captures the printed token (`extractOauthToken`), and persists it via `cfg.resolveAuthWrite('oauth', token)` → `writeEnv`. Success = token captured.
- `onb:saveAuth` delegates entirely to `resolveAuthWrite(mode, credential)` — OAuth and API key can never coexist.
- `onb:getAuthSource` returns `activeAuthSource(readEnv)` (D1).
- `onb:verifyAuth` (MED-3) reads the credential from the data-dir .env, builds the subprocess env via `getScrubbedSdkEnv(secrets)` (lazy-imported from compiled `dist/security.js`), spawns the native `claude -p` on a trivial prompt with a 60s timeout, and returns `{ok:true}` only on exit 0 + a non-empty reply; otherwise `{ok:false, error}` with the stderr reason. The token is never logged.
- `preload.cjs` bridges `getAuthSource` + `verifyAuth` (no raw ipcRenderer); stale install/login doc comments updated.
- **Login item (A5/PKG-04):** `setLoginItemSettings({ openAtLogin: true, type: 'mainAppService' })` retained under `app.isPackaged`; `package.json` build pins `mac.minimumSystemVersion: '13.0'`.

### Task 3 — onboarding.html: native-install copy + setup-token + verified active source
- Setup step copy reflects the native installer (no npm language anywhere in the file).
- Sign-in keeps "Sign in with Claude" (now setup-token) and "Use an API key instead" one link away.
- On success, `confirmAndVerify()` calls `getAuthSource()` to name the live source ("Signed in with your Claude subscription" vs "Using your API key"), then `verifyAuth()` and only enables Continue when the real round-trip succeeds; a clear retry message shows on `ok:false`.
- API key trimmed before `saveAuth` (V5); CSP meta tag preserved.

### Cleanup — spike harness removed
- Deleted `electron/spike-setup-token.cjs` (plan 01-01 disposition) so it does not ship via `build.files: electron/**`.

## MED-1 interop mechanism chosen

**Lazy `await import()` of the compiled ESM, cached, behind async accessors** — option (a), NOT a CommonJS shim. `config.cjs` exposes `loadAuthHelpers()` + async `resolveAuthWrite`/`activeAuthSource`; `main.cjs` exposes `loadSecurity()` for `getScrubbedSdkEnv`. Verified at runtime: `node -e` loading `config.cjs` and calling the accessors returns the helpers with no `ERR_REQUIRE_ESM`; the same proven for `dist/security.js`.

## MED-3 verifyAuth round-trip result

The `onb:verifyAuth` handler is fully wired and statically verified (`node --check`, grep). The live end-to-end round-trip (a real `claude -p` reply authenticated from the data-dir .env) is an **OS/browser-bound manual step** — it requires the operator to complete the `setup-token` browser OAuth so a real token exists to verify. This is the manual smoke in `SMOKE-CHECKLIST.md` / plan 04. The interop that builds the subprocess env (`getScrubbedSdkEnv` injecting only the chosen auth var, stripping all other secrets) was proven via a non-Electron node smoke. The handler returns `{ok:true}` only on exit 0 + a model reply, never on mere token presence.

## Pinned minimum macOS (A5)

**macOS 13.0 (Ventura)** — set as `build.mac.minimumSystemVersion`. With this floor, `setLoginItemSettings({ type: 'mainAppService' })` always routes through SMAppService (the reliable path on macOS 13+), so the login item is never a silent no-op on a supported OS.

## Task Commits

1. **Task 1:** native installer + captured-token detection + auth-helper re-export — `f4b9938` (feat)
2. **Task 2:** native installer + setup-token capture + real auth round-trip IPC + login item — `293436e` (feat)
3. **Task 3:** wizard native install + setup-token sign-in + verified active source — `cd42c83` (feat)
4. **Cleanup:** remove throwaway setup-token spike harness — `3591455` (chore)

_Plan metadata (this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md) committed separately._

## Verification

- **Build:** `npm run build` → produces `dist/desktop-config.js` and `dist/security.js`. Green.
- **Typecheck:** `npm run typecheck` (`tsc --noEmit`) → clean.
- **Syntax:** `node --check` on `main.cjs`, `config.cjs`, `preload.cjs` → all OK.
- **MED-1 smoke:** `node -e` loads `config.cjs`, calls `resolveAuthWrite`/`activeAuthSource` → no `ERR_REQUIRE_ESM`; same proven for `dist/security.js` `getScrubbedSdkEnv` (only chosen auth var injected, others absent).
- **Greps:** `local/bin/claude`, `CLAUDE_CODE_OAUTH_TOKEN`, `desktop-config` in config.cjs; `setup-token`, `resolveAuthWrite`, `getScrubbedSdkEnv`, `verifyAuth` in main.cjs; `getAuthSource`+`verifyAuth` in preload.cjs; `getAuthSource`+`verifyAuth`, CSP present, no `npm` in onboarding.html. No `readdirSync` on `.claude`; no `npm i -g` install path (only explanatory comments).
- **Auth-precedence tests:** `npx vitest run src/desktop-config.test.ts src/env.test.ts` → **39 passed (2 files)**. Green — the module config.cjs now consumes is unchanged and still proven.
- **Full suite:** not run for self-verification per the run instructions (6 pre-existing dist/-dependent CLI integration failures unrelated to this plan).

## Deviations from Plan

### [Rule 2 - Critical config] Pinned macOS 13.0 minimumSystemVersion
- **Found during:** Task 2 (A5 login-item decision).
- **Issue:** The plan requires recording the pinned minimum macOS for the `mainAppService` param, but the build had no `minimumSystemVersion`, so the pin would be undocumented/unenforced and `type:'mainAppService'` could silently no-op on macOS < 13.
- **Fix:** Added `build.mac.minimumSystemVersion: '13.0'` so the supported floor matches the API requirement.
- **Files:** `package.json`. **Commit:** `293436e`.

Otherwise the plan executed as written: native installer, setup-token spawn+capture, resolveAuthWrite delegation, getAuthSource, the verifyAuth round-trip, and the spike cleanup all match the task specs.

## Threat Surface

- **T-03-01 (auth precedence):** mitigated — both `onb:saveAuth` and `onb:claudeLogin` write via `resolveAuthWrite` (the compiled, tested helper); OAuth and API key can never coexist.
- **T-03-02 (token disclosure):** mitigated — the token is captured for persistence only, never logged; `writeEnv` writes 0600; `verifyAuth` builds the subprocess env via `getScrubbedSdkEnv` so only the chosen auth var reaches the spawned `claude` and every other secret is stripped.
- **T-03-03 (API-key input):** mitigated — the pasted key is trimmed before `saveAuth`.
- **T-03-04 (renderer EoP):** mitigated — contextIsolation/nodeIntegration unchanged; preload exposes only `onb:*` (incl. the two new bridges); CSP kept on onboarding.html.
- **T-03-SC (installer fetch):** mitigated — uses the official native installer with per-row failure/retry; no auto-npx of unverified packages.
- No new network endpoints, schema changes, or trust boundaries introduced beyond those the plan's threat model already anticipated.

## Issues Encountered

None blocking. The verifyAuth live round-trip is OS/browser-bound (manual smoke), as expected for a real OAuth flow.

## Next Plan Readiness

- **Plan 04 (end-to-end launch test):** the no-terminal install/sign-in/verify path is wired and statically green. The live setup-token + verifyAuth round-trip is the headline item for plan 04's manual smoke on a real machine. Note the pre-existing 01-02 MED-4 ABI blocker (Electron 33 ABI 115 has no better-sqlite3 prebuilt) still gates the `.dmg` build and needs the version-bump decision before plan 04's packaged run.

## Self-Check: PASSED

All modified files exist on disk; the spike file is deleted; all four task commits (`f4b9938`, `293436e`, `cd42c83`, `3591455`) are present in git history.

---
*Phase: 01-desktop-shell-onboarding*
*Completed: 2026-06-23*
