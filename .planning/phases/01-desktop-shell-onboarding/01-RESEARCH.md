# Phase 1: Desktop Shell & Onboarding - Research

**Researched:** 2026-06-22
**Domain:** Electron desktop packaging of a heavy Node service (native modules + subprocess CLI) + zero-terminal first-run onboarding
**Confidence:** HIGH (codebase + official Claude Code auth docs verified; packaging patterns verified against electron-builder/native-module docs)

## Summary

This is **not a greenfield phase**. A working first-draft Electron shell already exists in `electron/` (`main.cjs`, `preload.cjs`, `config.cjs`, `boot.html`, `onboarding.html`) wired through `package.json` `main: electron/main.cjs` with an `electron-builder` `build` block. `package.json` already pins `electron ^33.4.11` and `electron-builder ^25.1.8`. The phase work is to **harden and complete** this draft into a signable, install-once-and-it-just-works `.dmg`, not to design from scratch. The planner should treat the existing files as the baseline and plan edits/additions, flagging where the draft is wrong.

The four highest-risk areas, in priority order: **(1)** the native-module ABI trap — `better-sqlite3` is compiled against the dev machine's Node 25 ABI and will not load under Electron's bundled Node ABI unless rebuilt (`@electron/rebuild` / `electron-builder install-app-deps`), and this project has a *known-broken native build toolchain* (Python 3.12 no-distutils + Node 25) so the safe path is prebuilt binaries, not source compilation; **(2)** the `claude` dependency — the existing draft uses the **deprecated** `npm i -g @anthropic-ai/claude-code` install path and drives `claude login` interactively with a fragile filesystem heuristic for success, when the current correct approach is the **native installer** (`~/.local/bin/claude`, the way it is installed on this machine right now) plus **`claude setup-token`** to mint a 1-year `CLAUDE_CODE_OAUTH_TOKEN` the app captures and stores (far more robust than detecting keychain state); **(3)** auth precedence — official docs confirm the exact resolution order and the stale-`ANTHROPIC_API_KEY`-wins trap; **(4)** the migration gate — the spawned service calls `process.exit(1)` on pending migrations, which under Electron silently kills the service so the dashboard never binds and the user sees a generic "could not start."

**Primary recommendation:** Keep Electron + electron-builder (locked). Run the existing `dist/index.js` service as a **forked child process** (already done in `main.cjs`). Rebuild `better-sqlite3` for Electron's ABI via prebuilt binaries (no source compile). Replace the `npm i -g` CLI install with the native installer script and replace interactive `claude login` with `claude setup-token` capture writing `CLAUDE_CODE_OAUTH_TOKEN`. Own auth precedence per the verified order. Add an explicit migration-run step before/at service boot so the exit(1) trap can never fire. Use `app.setLoginItemSettings({ openAtLogin: true })` (already drafted) for reboot persistence — drop the launchd plists for the desktop product.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Local-first desktop app.** Execution stays on the user's machine; cloud control plane is thin.
- **Electron, not Tauri** — dashboard is already Preact/Vite, backend is heavy Node (better-sqlite3 native, subprocess spawning, Agent SDK). Electron runs the Node service in its main process and loads the dashboard in the renderer with near-zero porting.
- **Shell responsibilities:** launch with no terminal; bootstrap the existing Node service internally; open the dashboard as the app window; first-run install + login; register as a login item.
- **The dependency landmine:** the product spawns the real `claude` CLI. The desktop app must OWN this dependency: bundle or auto-install the Claude Code CLI, and drive `claude login` (browser OAuth) through an Electron window. Highest-risk piece — first-run must surface failure-and-retry states per step, not just spinners.
- **Auth — D1:** Support BOTH subscription OAuth ("Sign in with Claude") and API keys; default onboarding to subscription OAuth, with the API-key path one link away (recommended for heavy automation). The app must OWN auth precedence: resolution order is `explicit key > ANTHROPIC_API_KEY > ANTHROPIC_AUTH_TOKEN > OAuth profile`, and a stale `ANTHROPIC_API_KEY` silently overrides an OAuth login (known crash-loop trap). Surface the active auth source in Settings > Account.
- **Onboarding order (6 steps):** welcome → setting things up (auto: engine + Claude Code install) → sign in to Claude → where to talk to it (Slack recommended / Telegram) → connect tools (optional, skippable) → done. Setup runs before sign-in so the first real action is one OAuth click and install failures surface early. Tools step is skippable; never a 12-app wall.
- **launchd / login-item:** Register as a login item so the service persists across reboots (replaces hand-managed launchd plists). If any launchd plist is still generated, keep `StandardOutPath`/`StandardErrorPath` free of spaces (use `/tmp/` or `~/Library/Logs/`); launchd exits 78 on spaces in log paths. `WorkingDirectory` tolerates spaces.

### Claude's Discretion
- Electron project layout, build/packaging tooling (electron-builder vs forge), code-signing/notarization specifics.
- Exact mechanism for bundling vs auto-installing the Claude Code CLI; where the OAuth window is hosted.
- Service-bootstrap lifecycle (spawn vs in-process), health checks, crash recovery.
- IPC between renderer (dashboard) and main (service), and how the existing Hono server is reached.

### Deferred Ideas (OUT OF SCOPE)
- OAuth connect-buttons for Slack/Google beyond the initial transport pick (later phase).
- Billing/licensing gating — Phase 8.
- Windows/Linux installers — Mac-first; design so the shell is portable but ship Mac first.
- Managed cloud-box hosting tier — Future Requirements.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PKG-01 | Non-technical user installs as a desktop app by double-clicking an installer, no terminal | electron-builder `.dmg` target (already configured in `build.mac`); code-signing + notarization section makes the `.dmg` open without Gatekeeper blocks |
| PKG-02 | App boots the existing Node service internally and opens the dashboard as its window | `electron/main.cjs` already forks `dist/index.js` as a child, polls port 3141, loads the Hono dashboard URL. Renderer↔service section documents the wiring + the migration-gate crash trap to fix |
| PKG-03 | First run installs/sets up the Claude Code CLI and completes `claude login` without a terminal | "Owning the claude CLI" section: native installer replaces deprecated `npm i -g`; `claude setup-token` replaces fragile interactive `claude login`; per-row retry already drafted in `onboarding.html` |
| PKG-04 | App registers as a login item and keeps running across reboots | Login-item section: `app.setLoginItemSettings({ openAtLogin: true })` (already drafted) is the correct API; drop launchd plists for the desktop product |
| PKG-05 | Authenticate with Claude subscription (OAuth) by default, API-key path for heavy automation (D1) | Auth section: verified precedence order from official docs; `onb:saveAuth` already clears `ANTHROPIC_API_KEY` on OAuth path; recommend storing `CLAUDE_CODE_OAUTH_TOKEN` from `setup-token` and surfacing active source |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Double-click install / no terminal | Installer (electron-builder `.dmg`) | OS Gatekeeper | Packaging + signing is a build-time concern, not runtime |
| Boot Node service internally | Electron main process | Forked child (`dist/index.js`) | Service is heavy Node; main process owns its lifecycle, spawns it as a child so a service crash doesn't take down the window |
| Render dashboard | Electron renderer (BrowserWindow) | Hono server in the child service | Dashboard is an existing Preact SPA served over HTTP by the child; renderer just loads the URL |
| First-run wizard UI | Electron renderer (`onboarding.html`) | IPC → main | Native HTML wizard talks to main via the `preload.cjs` bridge; main runs the privileged subprocess/file work |
| Install/auth the `claude` CLI | Electron main process | OS shell (installer script, `claude setup-token`) | Spawning installers and capturing OAuth tokens is privileged main-process work |
| Auth precedence ownership | Electron main + the Node service | `.env` / config storage | The shell writes config; the service (`src/agent.ts`/`src/security.ts`) consumes it when spawning the SDK subprocess |
| Login-item / reboot persistence | Electron main (`setLoginItemSettings`) | macOS LaunchServices | OS-registered state; Electron's API is the supported path for a `.app` |
| Code-signing / notarization | Build pipeline (electron-builder `afterSign`) | Apple notary service | Build-time, requires Developer ID cert + hardened runtime |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `electron` | `^33.4.11` (pinned; latest is 42.4.1) | Desktop shell, main+renderer processes, login-item API | Locked decision; already in devDependencies |
| `electron-builder` | `^25.1.8` (pinned; latest is 26.15.3) | Packages `.dmg`/`.app`, handles native deps, signing, notarization | Already configured in `package.json` `build` block; mature, declarative config |
| `@electron/rebuild` | `4.0.4` | Rebuilds `better-sqlite3` against Electron's Node ABI | The canonical native-module rebuild tool; invoked by `electron-builder install-app-deps` |
| `better-sqlite3` | `^11.8.1` (pinned; latest 12.11.1) | Existing persistence layer the shell wraps | Already the engine's DB driver; ships prebuilt binaries for Electron ABIs |
| `@anthropic-ai/claude-agent-sdk` | `^0.2.34` | Spawns the `claude` CLI subprocess (the engine's brain) | Already the core intelligence layer (`src/agent.ts`) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Claude Code CLI (native install) | 2.1.185 (current on this machine) | The `claude` binary the SDK drives | First-run must install it; **use the native installer, not the npm package** (see below) |
| `@electron/notarize` | latest | Notarize the signed `.app` via Apple notary service | Called from electron-builder `afterSign` hook (electron-builder 26 has built-in `notarize: true`, but the pinned 25.x may need the explicit hook) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| electron-builder | electron-forge 7.11.2 | Forge is more modular/plugin-based, but the repo already has a working electron-builder config and a `build` block. Switching costs more than it saves. **Stay on electron-builder.** |
| Forked child service | Run service in-process in main | In-process avoids a second Node, but couples a service crash to the window and complicates the native-module ABI story (main process already is Electron's ABI). Current draft forks via `ELECTRON_RUN_AS_NODE=1` running `process.execPath` against `dist/index.js` — keep it; it isolates crashes and lets the child reuse the rebuilt native module. |
| `app.setLoginItemSettings` | Generate a LaunchAgent plist | The Electron API is the supported, sandbox-safe path for a `.app` and avoids the space-in-log-path exit-78 trap entirely. **Drop the launchd plists for the desktop product.** Only keep plists for the legacy multi-agent CLI deployment, not the operator app. |

**Installation:** No new runtime dependencies required for the core shell — `electron`, `electron-builder`, `better-sqlite3` are already present. Add at build/dev time only:
```bash
npm install --save-dev @electron/notarize   # if pinned electron-builder 25.x needs the explicit afterSign hook
```

**Version verification (performed this session, npm registry):**
- `electron` latest 42.4.1 (repo pins ^33.4.11 — keep the pin; do not bump mid-phase)
- `electron-builder` latest 26.15.3 (repo pins ^25.1.8)
- `@electron/rebuild` 4.0.4
- `@electron-forge/cli` 7.11.2 (not adopted)
- `better-sqlite3` latest 12.11.1 (repo pins ^11.8.1)
- `@anthropic-ai/claude-code` (npm) latest 2.1.185 — **but the npm package is deprecated as of v2.1.15 (2026-01-21) in favor of the native installer**
- `auto-launch` 5.0.6 (NOT recommended — the built-in Electron API is sufficient and avoids a dependency)

## Package Legitimacy Audit

> No new external runtime packages are introduced by this phase. All packaging tooling is already in `devDependencies` and was installed before this milestone. slopcheck was not run because no new install is proposed; if the planner adds `@electron/notarize`, gate it behind a `checkpoint:human-verify` task per the protocol.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `electron` | npm | 10+ yrs | very high | github.com/electron/electron | not run (already installed) | Approved (incumbent) |
| `electron-builder` | npm | 9+ yrs | very high | github.com/electron-userland/electron-builder | not run (already installed) | Approved (incumbent) |
| `better-sqlite3` | npm | 7+ yrs | very high | github.com/WiseLibs/better-sqlite3 | not run (already installed) | Approved (incumbent) |
| `@electron/rebuild` | npm | 5+ yrs | high | github.com/electron/rebuild | not run | Approved (official Electron org) |
| `@electron/notarize` | npm | 4+ yrs | high | github.com/electron/notarize | not run — gate if added | Pending — planner adds checkpoint if introduced |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
  double-click .dmg │              Electron main process          │
        │           │              (electron/main.cjs)            │
        ▼           │                                             │
  ┌───────────┐     │  app.whenReady()                            │
  │  .app     │────▶│    ├─ setLoginItemSettings(openAtLogin) ────┼──▶ macOS LaunchServices (reboot persist)
  │ (Gatekeep │     │    ├─ isConfigured(.env)?                   │
  │  notarzd) │     │    │     NO ──▶ load onboarding.html ────────┼──┐
  └───────────┘     │    │     YES ─▶ bootDashboard()             │  │
                    │    │                                        │  │ first run only
                    │    └─ bootDashboard():                      │  │
                    │         spawn(dist/index.js) as child ──────┼──┼──▶ ┌──────────────────────────┐
                    │         waitForDashboard(port 3141)         │  │    │  Node service (child)     │
                    │         loadURL(http://127.0.0.1:3141/?tok) │  │    │  (dist/index.js)          │
                    └─────────────────────────────────────────────┘  │    │   ├─ checkPendingMigr ⚠   │
                              ▲                  │                     │    │   ├─ Hono dashboard :3141 │
                              │ IPC (preload)    │ HTTP                │    │   ├─ Slack/Telegram bot   │
                              │                  ▼                     │    │   └─ Agent SDK ──▶ claude │
                    ┌─────────┴──────────────────────────┐            │    └──────────┬───────────────┘
                    │     Electron renderer (window)      │            │               │ spawns subprocess
                    │  ┌────────────────────────────────┐ │            │               ▼
                    │  │ onboarding.html (first run) ────┼─┼────────────┘    ┌──────────────────────────┐
                    │  │  step2: install claude CLI      │ │   IPC: onb:*     │ claude CLI (~/.local/bin)│
                    │  │  step3: claude setup-token ─────┼─┼─────────────────▶│  auth via                │
                    │  │  step4: pick transport          │ │                  │  CLAUDE_CODE_OAUTH_TOKEN │
                    │  └────────────────────────────────┘ │                  │  or ANTHROPIC_API_KEY    │
                    │  OR Preact dashboard SPA (configured)│                  └──────────────────────────┘
                    └──────────────────────────────────────┘
```

Trace the primary use case: double-click `.dmg` → Gatekeeper allows (signed+notarized) → main process registers login item, sees no transport configured → loads `onboarding.html` → wizard drives main-process IPC to install the CLI and mint a token → writes `.env` → `finish()` forks the Node service → service runs migrations + binds Hono on 3141 → main loads the dashboard URL in the same window. On every subsequent launch (including post-reboot via login item), `isConfigured()` is true so it skips straight to `bootDashboard()`.

### Recommended Project Structure
The existing layout is correct; do not restructure. Relevant pieces:
```
electron/
├── main.cjs          # main process: service lifecycle, IPC handlers, login item  (EXISTS — harden)
├── preload.cjs       # contextBridge surface for the wizard                        (EXISTS — extend for settings later)
├── config.cjs        # .env read/write, isConfigured, checkClaudeCli, checkLogin   (EXISTS — fix CLI install + login detection)
├── boot.html         # splash / error states                                       (EXISTS — add a migration-failed state)
└── onboarding.html   # 6-step wizard                                               (EXISTS — swap install + login mechanisms)
build/                # NEW: entitlements.mac.plist, notarize hook, icons
dist/                 # tsc output the child service runs (built by `npm run build`)
migrations/           # versioned migrations the service gate checks
```

### Pattern 1: Forked-child service with Electron's bundled Node
**What:** Run `dist/index.js` as a child process using `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, cwd = app root, so the child is plain Node (Electron's bundled V8/Node) and reuses the ABI-matched native module.
**When to use:** This is the existing approach in `main.cjs:resolveServiceCommand()`. Keep it.
**Example:**
```js
// Source: electron/main.cjs (existing, lines 58-98)
const distEntry = path.join(APP_ROOT, 'dist', 'index.js');
if (fs.existsSync(distEntry)) {
  return { cmd: process.execPath, args: [distEntry], runAsNode: true };
}
// runAsNode => childEnv.ELECTRON_RUN_AS_NODE = '1'
```
**Pitfall the planner must close:** because the child runs `dist/index.js`, `better-sqlite3` must be rebuilt for **Electron's** Node ABI, not the system Node ABI. See Pitfall 1.

### Pattern 2: `claude setup-token` instead of interactive `claude login`
**What:** During onboarding "Sign in", run `claude setup-token`, which walks the user through browser OAuth and prints a 1-year `CLAUDE_CODE_OAUTH_TOKEN` to stdout. Capture that token in the main process and write it to the app-managed config. The service then authenticates deterministically via the env var — no dependence on detecting keychain state.
**When to use:** The subscription-OAuth happy path (PKG-03, PKG-05).
**Why it beats the current draft:** `onb:claudeLogin` currently runs `claude login` and then guesses success by checking whether `~/.claude` has more than one entry (`config.cjs:checkLogin`). On macOS, `claude login` stores credentials in the **encrypted macOS Keychain**, NOT in `~/.claude` `[CITED: code.claude.com/docs/en/authentication]`, so the filesystem heuristic is unreliable. `setup-token` returns the token directly, so success = "we captured a token," which is unambiguous and also gives an always-on service a stable long-lived credential (D1's stated reason for preferring tokens for automation).
**Example:**
```js
// Replace onb:claudeLogin. Capture stdout, extract the token line, store it.
const res = await runStreaming('claude', ['setup-token']);   // streams OAuth prompts
// parse the printed token, then:
cfg.writeEnv(ENV_PATH, { CLAUDE_CODE_OAUTH_TOKEN: token, ANTHROPIC_API_KEY: null });
```

### Anti-Patterns to Avoid
- **Installing the CLI via `npm i -g @anthropic-ai/claude-code`** — deprecated since v2.1.15 (2026-01-21) and requires a global npm + Node on the user's machine, which the operator may not have. The existing `onb:installCli` does exactly this. Replace with the native installer.
- **Detecting login by inspecting `~/.claude` contents** — wrong on macOS (creds live in the Keychain). Detect via the captured `setup-token` output or `claude` exit status, not directory contents.
- **Letting the spawned service `process.exit(1)` on pending migrations with no UI feedback** — the user sees a bare "could not start." Run migrations before/at boot and surface a real retry state.
- **Bumping `electron`/`electron-builder`/`better-sqlite3` mid-phase** — the pins are load-bearing for the native-module ABI match. Changing Electron changes the ABI and re-opens the rebuild problem.
- **Source-compiling native modules** — this machine's toolchain is broken (Python 3.12 no-distutils + Node 25). Always use prebuilt binaries.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Login at startup / reboot persistence | A generated launchd plist + installer | `app.setLoginItemSettings({ openAtLogin: true })` | Built-in, sandbox-safe, avoids the space-in-log-path exit-78 trap; already drafted in `main.cjs` |
| Rebuild native module for Electron ABI | Manual `node-gyp` invocation | `electron-builder install-app-deps` (wraps `@electron/rebuild`) | Pulls prebuilt binaries, handles ABI matching declaratively |
| Code-sign + notarize the `.dmg` | Manual `codesign` + `xcrun notarytool` scripting | electron-builder `mac.notarize` / `afterSign` + `@electron/notarize` | electron-builder orchestrates sign→notarize→staple |
| OAuth callback capture for `claude login` | A localhost HTTP server catching the OAuth redirect | `claude setup-token` (the CLI owns the OAuth flow and prints a token) | The CLI already runs its own callback server; don't reimplement it |
| `.env` parsing/writing | New config format | `electron/config.cjs` (exists) mirroring `src/env.ts` format | Already keeps the desktop and terminal paths interchangeable |

**Key insight:** Almost every hard problem in this phase already has a first-class solution either in the existing codebase (config.cjs, service-fork pattern, login-item call) or in the tooling (electron-builder for native deps + signing, `claude setup-token` for headless-friendly auth). The phase is about wiring the *correct* mechanisms, not inventing them.

## Runtime State Inventory

> Rename/refactor phase? No — this is additive packaging. But there IS critical runtime state the packaged app must own that a code-only view misses. Documented below.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | SQLite DB at `store/claudeclaw.db` (0600); the app root must be writable in the packaged build. In a `.app`, `process.resourcesPath/app` is **read-only** under Gatekeeper. The service's cwd-relative `store/`, `.env`, and `logs/` paths will fail to write. | Code edit: the packaged build must point `store/`, `.env`, and config at a writable per-user dir (e.g. `app.getPath('userData')` / `~/Library/Application Support/ClaudeClaw/`), not `resourcesPath/app`. The current `main.cjs` sets `APP_ROOT = resourcesPath/app` and writes `.env` there — this WILL break in a signed build. HIGH-priority fix. |
| Live service config | Claude Code credentials: on macOS stored in the **encrypted macOS Keychain** (`Claude Code-credentials`), not in `~/.claude/`. The `claude` binary lives at `~/.local/bin/claude` → `~/.local/share/claude/versions/` (native install), NOT a global npm path. `[CITED: code.claude.com/docs/en/authentication]` | Code edit: detect the CLI at `~/.local/bin/claude` and on PATH; detect auth via `setup-token` capture, not `~/.claude` contents. |
| OS-registered state | Login item via `app.setLoginItemSettings`. Legacy `launchd/com.claudeclaw.*.plist` (9 plists) are the OLD multi-agent CLI persistence. | The desktop app uses the login item; do NOT install the launchd plists from the app. They remain only for the legacy CLI/fleet deployment. |
| Secrets/env vars | App-generated `DASHBOARD_TOKEN` and `DB_ENCRYPTION_KEY` (created in `onb:finish`). `DB_ENCRYPTION_KEY` is load-bearing for field-level message encryption — if it changes or is lost, encrypted columns become unreadable. | Code edit: persist these in the writable user-data dir (same fix as Stored data) so they survive app updates and are not lost when the read-only bundle is replaced. |
| Build artifacts | `dist/` (tsc output) must be present and current in the packaged bundle (`build.extraResources` already copies `dist/**`). `better-sqlite3`'s `.node` in `node_modules` must be the Electron-ABI build, not the Node-25 build currently on disk. | Build step: `npm run build` then `electron-builder install-app-deps` (rebuild native) before `electron-builder`. The current `electron:build` script does `npm run build && electron-builder` and is MISSING the native-deps rebuild. |

**The canonical question — after every file is updated, what runtime systems still have old/wrong state cached?**
1. The DB and `.env` location (read-only bundle vs writable user dir) — the single biggest packaging correctness bug.
2. The `better-sqlite3` `.node` binary's ABI.
3. The login item registration (only set when `app.isPackaged`).

## Common Pitfalls

### Pitfall 1: `better-sqlite3` ABI mismatch under Electron
**What goes wrong:** The service child loads `better_sqlite3.node`, gets `NODE_MODULE_VERSION` mismatch (compiled against Node 25's ABI, Electron 33 expects a different one), throws on first DB call, the service exits, the dashboard never binds, the window shows "Could not reach the dashboard." `[VERIFIED: better-sqlite3 GitHub issues #704/#736 + @electron/rebuild docs]`
**Why it happens:** `node_modules/better-sqlite3/build/Release/better_sqlite3.node` on this machine was built against Node v25.9.0. The packaged child runs Electron's bundled Node (different ABI).
**How to avoid:** Add `electron-builder install-app-deps` (or a `postinstall`/rebuild step) to the build so the module is rebuilt/prebuilt-fetched for Electron's ABI. **Critically, fetch prebuilt binaries — do NOT source-compile** because this machine's native toolchain is broken (Python 3.12 no-distutils + Node 25; better-sqlite3 source rebuilds fail — documented project constraint). `better-sqlite3` publishes prebuilt binaries per Electron ABI; `prebuild-install` runs before any source build.
**Warning signs:** `Error: The module '...better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION X. This version requires NODE_MODULE_VERSION Y.`

### Pitfall 2: Read-only app bundle breaks the writable-state paths
**What goes wrong:** `main.cjs` sets `APP_ROOT = process.resourcesPath/app` and writes `.env`, the SQLite DB, and logs relative to it. In a signed/notarized `.app`, that path is read-only — writes throw `EROFS`/`EACCES`, onboarding "finish" fails to persist secrets, the DB can't open.
**Why it happens:** The dev path (`__dirname/..`, a normal repo) is writable; the packaged path is not. The draft was written for dev.
**How to avoid:** In the packaged build, route all writable state (`.env`, `store/`, `logs/`) to `app.getPath('userData')` and pass that to the child service (via env or by changing its cwd/config base). The service already supports an external config dir via `CLAUDECLAW_CONFIG`; the planner must extend the same idea to `.env` and `store/`.
**Warning signs:** Works in `npm run electron:dev`, fails only in the installed `.app`. Errors mention `resources/app/.env` or `resources/app/store`.

### Pitfall 3: Pending-migration `process.exit(1)` silently kills the service
**What goes wrong:** `src/migrations.ts:checkPendingMigrations()` calls `process.exit(1)` if migrations are pending (e.g. after an app update that ships new migrations). The forked child dies instantly; `waitForDashboard()` times out; user sees a generic error with no mention of migrations.
**Why it happens:** The gate was designed for a CLI user who would read the stderr message and run `npm run migrate`. There is no terminal in the desktop product.
**How to avoid:** Run `tsx scripts/migrate.ts` (or the migrate logic) from the main process **before** forking the service, or have the service auto-run migrations instead of exiting. Surface a "updating your assistant…" boot state and a real retry on failure.
**Warning signs:** Dashboard fails to load only on the first launch after an update that added a migration.

### Pitfall 4: Stale `ANTHROPIC_API_KEY` silently overrides OAuth (the crash-loop trap)
**What goes wrong:** A user signs in with their subscription (OAuth/`setup-token`), but a stale `ANTHROPIC_API_KEY` remains in `.env`/env. Per the verified precedence, the API key wins; if it belongs to a disabled/expired org, every request fails and the service crash-loops. `[CITED: code.claude.com/docs/en/authentication]`
**Why it happens:** `ANTHROPIC_API_KEY` outranks `CLAUDE_CODE_OAUTH_TOKEN` and subscription OAuth in the resolution order.
**How to avoid:** The app must own precedence. `onb:saveAuth` already clears `ANTHROPIC_API_KEY` when the OAuth path is chosen — keep and harden that. Surface the *active* auth source in Settings > Account (D1 requirement). When the user picks API-key, clear `CLAUDE_CODE_OAUTH_TOKEN` and vice versa, so the two never coexist.
**Warning signs:** Auth works in terminal but fails in the app, or fails after the user previously experimented with an API key. `claude /status` shows a different method than the user selected.

### Pitfall 5: Notarization missing → Gatekeeper blocks the `.dmg`
**What goes wrong:** An unsigned/un-notarized `.dmg` triggers "ClaudeClaw can't be opened because Apple cannot check it for malicious software" — the exact terminal-style dead-end PKG-01 exists to eliminate.
**How to avoid:** Sign with a Developer ID Application cert, set `hardenedRuntime: true` and the right entitlements (`com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory` are commonly needed for Electron + spawning `claude`/`node`), notarize via `@electron/notarize` from an `afterSign` hook (or electron-builder 26's `notarize: true`), and staple. `[VERIFIED: electron-builder notarization guides, multiple sources]`
**Warning signs:** The `.dmg` opens fine on the build machine (already trusted) but is blocked on a clean machine.

## Code Examples

### Verified auth precedence (from official docs)
```
# Source: https://code.claude.com/docs/en/authentication  (Authentication precedence)
1. Cloud provider creds (CLAUDE_CODE_USE_BEDROCK / _VERTEX / _FOUNDRY)
2. ANTHROPIC_AUTH_TOKEN          (Authorization: Bearer — for gateways/proxies)
3. ANTHROPIC_API_KEY             (X-Api-Key — direct API; in -p mode always used when present)
4. apiKeyHelper script output
5. CLAUDE_CODE_OAUTH_TOKEN       (from `claude setup-token`, 1-year, inference-only)
6. Subscription OAuth from /login (default for Pro/Max/Team/Enterprise)
```
Note: the CONTEXT.md shorthand (`explicit key > ANTHROPIC_API_KEY > ANTHROPIC_AUTH_TOKEN > OAuth`) is *slightly* out of order versus the official list (auth-token actually outranks api-key). The app must implement the **official** order. `[CITED: code.claude.com/docs/en/authentication]`

### Login item (already correct in the draft)
```js
// Source: electron/main.cjs (existing) — keep
if (app.isPackaged) {
  app.setLoginItemSettings({ openAtLogin: true });
}
```

### Build script gap to fix
```jsonc
// package.json — current:
"electron:build": "npm run build && electron-builder"
// needs a native-deps rebuild between build and package:
"electron:build": "npm run build && electron-builder install-app-deps && electron-builder"
// and a postinstall so dev installs match the Electron ABI:
"postinstall": "electron-builder install-app-deps"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `npm i -g @anthropic-ai/claude-code` | Native installer (`curl`-based, installs to `~/.local/bin/claude`, auto-updates) | npm method deprecated v2.1.15, 2026-01-21 | The existing `onb:installCli` uses the deprecated path; switch to native installer (it's already how `claude` is installed on this machine) `[CITED: code.claude.com/docs/en/setup]` |
| Interactive `claude login` + heuristic success detection | `claude setup-token` → capture 1-year `CLAUDE_CODE_OAUTH_TOKEN` | setup-token is the documented headless/automation auth path | Deterministic success; stable long-lived credential for an always-on service `[CITED: code.claude.com/docs/en/authentication]` |
| launchd plist for persistence | `app.setLoginItemSettings` | Standard for `.app` distribution | No plist generation, no exit-78 space trap |

**Deprecated/outdated:**
- `npm i -g @anthropic-ai/claude-code` install path (in `electron/main.cjs:onb:installCli` and `onboarding.html` step 2) — replace.
- `config.cjs:checkLogin()` filesystem heuristic — replace with token-capture or `claude` status check.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `claude setup-token` output can be cleanly captured from stdout in a non-TTY Electron subprocess (it may require a TTY for its interactive prompts) | Pattern 2 | If it demands a TTY, the app may need a pty wrapper (e.g. `node-pty`) or fall back to driving the browser flow + reading the keychain. Verify empirically during planning. |
| A2 | `better-sqlite3` 11.x publishes prebuilt binaries for Electron 33's ABI (so no source compile is needed despite the broken toolchain) | Pitfall 1 | If no matching prebuild exists, a source compile is forced and the broken toolchain blocks the build. Mitigation: bump better-sqlite3 to a version with the prebuild, or pin Electron to an ABI that has one. |
| A3 | The packaged child service can be redirected to a writable user-data dir for `.env`/`store`/`logs` without deeper refactor of `src/config.ts` path resolution | Pitfall 2 / Runtime State | If config paths are hard-coded to `process.cwd()` in many places, the fix is larger than a single env var. Grep `src/config.ts`/`src/env.ts` confirms `.env` is read from `process.cwd()` — the child's cwd can be set to the user-data dir, but `store/` resolution must be checked. |
| A4 | electron-builder 25.x can notarize with the `afterSign` + `@electron/notarize` hook (vs needing the 26.x `notarize: true`) | Pitfall 5 | If 25.x notarization is flaky, may need to bump electron-builder, which is otherwise low-risk (build-time only). |
| A5 | Setting `app.setLoginItemSettings({ openAtLogin: true })` is sufficient on the targeted macOS version (some versions/MAS builds have known quirks per electron issues #45672, #37560) | Login item | If it silently no-ops on the target macOS, may need the `type`/`mainAppService` parameter (macOS 13+) — verify on the actual target OS. |

## Open Questions

1. **Does `claude setup-token` work in a non-interactive Electron subprocess?**
   - What we know: it walks the user through OAuth in the browser and prints a token to the terminal; designed for "environments where interactive browser login isn't available."
   - What's unclear: whether it needs a TTY for its own prompts when spawned by Electron (not a real terminal).
   - Recommendation: Plan a spike task early in the phase to run `claude setup-token` via `child_process.spawn` from a throwaway Electron main and confirm token capture. Have a fallback (pty wrapper, or browser-flow + keychain read) ready.

2. **Where exactly should writable state live, and how invasive is the change to `src/config.ts`?**
   - What we know: `.env` is read from `process.cwd()` (`src/env.ts`); the child's cwd is set by the shell; `CLAUDECLAW_CONFIG` already externalizes some config.
   - What's unclear: every cwd-relative write path in the service (`store/`, `logs/`, agent dirs).
   - Recommendation: Plan a grep audit of cwd-relative paths in `src/` as a planning input; decide whether to set the child cwd to user-data or thread an explicit base dir.

3. **Does the targeted macOS version honor `setLoginItemSettings` without the `type` param?**
   - Recommendation: verify on the actual minimum-supported macOS; add `type: 'mainAppService'` if needed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node` | building `dist/`, dev shell | ✓ | v25.9.0 | — (note: too new for source-compiling native modules) |
| `electron` (binary) | running the shell | ✗ (node_modules/electron not installed in this checkout) | pinned ^33.4.11 | `npm install` restores it |
| `electron-builder` | packaging | declared | ^25.1.8 | — |
| `claude` CLI | the engine | ✓ | 2.1.185 (native install at `~/.local/bin/claude`) | first-run native installer for end users |
| macOS Keychain | claude OAuth credential storage | ✓ | — | `setup-token` env var avoids depending on it |
| Apple Developer ID cert + notary creds | signing/notarizing the `.dmg` | ✗ (not verified present) | — | **BLOCKING for PKG-01 ship** — must be provisioned; an un-notarized build is blocked by Gatekeeper |
| Native build toolchain (for source-compiling better-sqlite3) | only if no prebuilt binary | ✗ BROKEN (Python 3.12 no-distutils + Node 25) | — | Use prebuilt binaries via `install-app-deps`; do not source-compile |

**Missing dependencies with no fallback:**
- Apple Developer ID Application certificate + notarization credentials (App Store Connect API key or app-specific password). Without these, PKG-01 (no-terminal install) cannot ship to other machines. The planner must include a task to confirm/provision signing identity, or explicitly scope this phase to an unsigned dev build with signing deferred (which would violate PKG-01 for real users).

**Missing dependencies with fallback:**
- `node_modules/electron` not installed in this checkout — `npm install` restores it.
- Broken native toolchain — fall back to prebuilt binaries (the recommended path anyway).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.0.0 |
| Config file | inline in `package.json` (`vitest` block: `environment: node`, `include: src/**/*.test.ts`) |
| Quick run command | `npx vitest run src/<file>.test.ts` |
| Full suite command | `npm test` (= `vitest run`) |

Note: the Electron shell files (`electron/*.cjs`) are CommonJS and outside the `src/**/*.test.ts` include glob. Most of this phase's logic is glue (subprocess spawning, file writes, OS calls) that is integration/manual in nature. Pure helpers (env parse/write, isConfigured, auth-precedence resolution) are unit-testable and should be extracted so they can be.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PKG-02 | `isConfigured(.env)` gates onboarding vs dashboard correctly | unit | `npx vitest run electron/__tests__/config.test.cjs` (after extracting testable helpers) | ❌ Wave 0 |
| PKG-05 | Auth precedence: OAuth path clears `ANTHROPIC_API_KEY`; API-key path clears `CLAUDE_CODE_OAUTH_TOKEN`; never coexist | unit | same suite — test a pure `resolveAuthWrite(mode, key)` helper | ❌ Wave 0 |
| PKG-05 | `.env` round-trip: write then parse preserves keys, deletes on null | unit | `npx vitest run src/env.test.ts` (exists) + new cases | ✅ (extend) |
| PKG-03 | CLI/login detection logic (binary-present, token-captured) | unit | new helper test (pure function over fixture inputs) | ❌ Wave 0 |
| PKG-03 | Native install + `setup-token` capture works in a real Electron subprocess | manual / spike | run `npm run electron:dev` with `CLAUDECLAW_FORCE_ONBOARDING=1` | manual-only (browser OAuth) |
| PKG-02 | Service boots, migration gate doesn't kill it, dashboard binds | integration / manual | launch packaged build on a clean macOS, observe dashboard loads | manual-only |
| PKG-01 | Signed+notarized `.dmg` opens on a clean machine without Gatekeeper block | manual | install on a second Mac | manual-only |
| PKG-04 | Login item registered; survives reboot | manual | check `System Settings > General > Login Items` after install; reboot | manual-only |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test file>`
- **Per wave merge:** `npm test` (full vitest suite)
- **Phase gate:** Full suite green + a manual smoke checklist (clean-machine install, onboarding to dashboard, reboot persistence) before `/gsd-verify-work`. The manual checklist is unavoidable here — install/sign/OAuth/reboot are not unit-testable.

### Wave 0 Gaps
- [ ] `electron/__tests__/config.test.cjs` (or extract helpers into a `src/`-testable module) — covers PKG-02, PKG-05 auth precedence
- [ ] Extract pure auth-precedence resolution into a testable function (currently inline in `onb:saveAuth`)
- [ ] Extend `src/env.test.ts` for null-deletes and the managed-header format `config.cjs` writes
- [ ] A documented manual smoke checklist (clean-machine install → onboarding → dashboard → reboot) since the core flows are OS/browser-bound

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high` — section required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Own the Claude auth precedence (verified order); never let API key + OAuth token coexist; store credentials in app-managed config with `0600` (already done by `config.cjs:writeEnv`) |
| V3 Session Management | partial | Dashboard auth uses `DASHBOARD_TOKEN` bearer/query param on `127.0.0.1:3141` — local-only; ensure the token is generated (already in `onb:finish`) and the renderer only loads the localhost URL (window-open handler in `main.cjs` already enforces this) |
| V4 Access Control | yes | `contextIsolation: true`, `nodeIntegration: false` (already set in `main.cjs`); preload exposes only the explicit `onb:*` surface — keep the bridge minimal; never expose raw `ipcRenderer` |
| V5 Input Validation | yes | Validate/trim tokens pasted in onboarding (Slack/Telegram/API key) before writing `.env`; the API-key field is user input that becomes a credential |
| V6 Cryptography | yes (don't hand-roll) | `DB_ENCRYPTION_KEY` (AES-256-GCM) generated via `crypto.randomBytes` (already in `config.cjs:generateHex` / `onb:finish`) — must be persisted to writable user-data, never regenerated on update (would orphan encrypted data) |

### Known Threat Patterns for Electron + spawning a CLI

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer RCE via `nodeIntegration` | Elevation of Privilege | `contextIsolation: true`, `nodeIntegration: false` (already set); CSP in `boot.html` (already present `default-src 'none'`) — add equivalent CSP to `onboarding.html` |
| Secret leakage to the `claude` subprocess | Information Disclosure | `src/security.ts:getScrubbedSdkEnv` already strips secret-shaped env vars before the SDK spawn, preserving only the chosen auth var — preserve this behavior when the shell sets auth |
| Loading remote content in the BrowserWindow | Tampering / Spoofing | `setWindowOpenHandler` already denies non-localhost URLs and routes them to the external browser — keep |
| Writing tokens to a world-readable `.env` | Information Disclosure | `writeEnv` already uses `mode: 0o600` — ensure it stays 0600 in the user-data location |
| Unsigned binary / supply-chain (Gatekeeper bypass) | Tampering | Code-sign + notarize + hardened runtime; pin Electron version; don't auto-`npx` unverified packages |
| OAuth token (1-year) at rest | Information Disclosure | `CLAUDE_CODE_OAUTH_TOKEN` is long-lived; store 0600 in user-data; consider the macOS Keychain for it later (deferred — `.env` 0600 is acceptable for v1, matching the engine's existing model) |

## Sources

### Primary (HIGH confidence)
- `code.claude.com/docs/en/authentication` — auth precedence order, credential storage location (macOS Keychain), `claude setup-token` behavior, stale-API-key trap (fetched and quoted)
- `code.claude.com/docs/en/setup` — native installer vs deprecated npm install (deprecated v2.1.15)
- Existing codebase: `electron/main.cjs`, `electron/config.cjs`, `electron/preload.cjs`, `electron/boot.html`, `electron/onboarding.html`, `src/agent.ts`, `src/security.ts`, `src/env.ts`, `src/migrations.ts`, `scripts/setup.ts`, `scripts/install-launchd.sh`, `package.json`, `.planning/codebase/STACK.md|CONCERNS.md|INTEGRATIONS.md`
- Live environment probes: `claude --version` (2.1.185, native install path), `better-sqlite3` build artifact ABI, npm registry version checks

### Secondary (MEDIUM confidence)
- electron-builder native-module + notarization guides (multiple: bigbinary, kilianvalkhof, philo.dev, christarnowski) — cross-referenced for `afterSign`/`hardenedRuntime`/`@electron/notarize`
- `@electron/rebuild` + better-sqlite3 GitHub issues (#704, #736) — ABI mismatch symptoms and `install-app-deps` fix
- Electron `app` API docs — `setLoginItemSettings`, macOS 13+ `type` parameter

### Tertiary (LOW confidence)
- `claude setup-token` TTY behavior in an Electron subprocess (assumption A1 — verify by spike)
- macOS-version-specific `setLoginItemSettings` quirks (electron issues #45672, #37560)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all incumbent, versions verified against npm
- Architecture (service fork, IPC, dashboard wiring): HIGH — read from existing working draft
- Auth (precedence, setup-token, storage location): HIGH — quoted from official docs
- Native-module packaging: MEDIUM-HIGH — pattern verified; prebuild availability for the exact Electron 33 ABI is assumption A2
- Onboarding mechanics (setup-token in Electron subprocess): MEDIUM — needs the A1 spike
- Signing/notarization: MEDIUM — standard pattern, but Apple credentials are not confirmed present (potential ship blocker)

**Research date:** 2026-06-22
**Valid until:** 2026-07-06 (Claude Code CLI moves fast — re-verify install/auth mechanics in ~2 weeks; Electron/electron-builder pins are stable)
