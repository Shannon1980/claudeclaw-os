# Phase 1 — Manual Smoke Checklist (Desktop Shell & Onboarding)

The flows below are OS-/browser-/reboot-bound and cannot be unit-tested. Run
them on a **clean machine** (a second Mac, or a fresh user account) once the
phase's packaging plans land. Each item is cross-referenced to the phase
requirement it proves. Check the box and note the build + date when verified.

**Build under test:** `__________________`  **macOS:** `__________________`  **Date:** `__________________`

---

## 1. Install — no terminal (PKG-01)

- [ ] **1.1** Copy the signed/notarized `.dmg` to a clean machine that has never
      run ClaudeClaw or trusted this developer. (PKG-01)
- [ ] **1.2** Double-click the `.dmg`, drag `ClaudeClaw.app` to `/Applications`.
      No terminal, no `xattr`, no Homebrew. (PKG-01)
- [ ] **1.3** Launch the app. Gatekeeper does **NOT** show
      "ClaudeClaw can't be opened because Apple cannot check it…". The app opens
      directly. (PKG-01)
- [ ] **1.4** No `claude`/`node`/`npm` was pre-installed on this machine and the
      install still succeeded. (PKG-01, PKG-03)

## 2. App boots the service and shows the dashboard (PKG-02)

- [ ] **2.1** On first launch with no transport configured, the native
      onboarding window appears (not a raw dashboard, not a blank window). (PKG-02)
- [ ] **2.2** After onboarding completes, the app forks the Node service
      internally and the window loads the Preact dashboard at
      `http://127.0.0.1:3141/` — no separate browser, no terminal. (PKG-02)
- [ ] **2.3** The dashboard is fully loaded and interactive (not a spinner, not a
      "could not reach the dashboard" error). The SQLite DB opened without an
      ABI/`NODE_MODULE_VERSION` error. (PKG-02)
- [ ] **2.4** If the build shipped a pending migration, the boot shows an
      "updating…" state and proceeds — it does NOT die silently on
      `process.exit(1)`. (PKG-02)

## 3. First-run Claude CLI setup + sign-in, no terminal (PKG-03)

- [ ] **3.1** "Setting things up" step installs/sets up the Claude Code CLI via
      the **native installer** (`~/.local/bin/claude`), not `npm i -g`. Failure
      surfaces a real retry, not a dead spinner. (PKG-03)
- [ ] **3.2** "Sign in to Claude" step opens the browser OAuth flow and completes
      sign-in. The app reports success deterministically (token captured /
      status confirmed), not via a `~/.claude` directory guess. (PKG-03, PKG-05)
- [ ] **3.3** The six onboarding steps run in order to a loaded dashboard:
      welcome → setting things up → sign in → where to talk to it
      (Slack recommended / Telegram) → connect tools (skippable) → done. (PKG-03)
- [ ] **3.4** The "connect tools" step is skippable — the operator can reach the
      dashboard without connecting every integration. (PKG-03)

## 4. Login item / reboot persistence (PKG-04)

- [ ] **4.1** After install, `System Settings > General > Login Items` lists
      ClaudeClaw (set only when `app.isPackaged`). No launchd plist was
      installed by the app. (PKG-04)
- [ ] **4.2** Reboot the machine. ClaudeClaw relaunches automatically and goes
      straight to the dashboard (skips onboarding because `isConfigured` is
      true) — the service is running again. (PKG-04, PKG-02)
- [ ] **4.3** The app-generated `DASHBOARD_TOKEN` and `DB_ENCRYPTION_KEY`
      survived the reboot (encrypted columns are still readable). (PKG-04)

## 5. Auth source readout matches the chosen path (PKG-05, D1)

- [ ] **5.1** OAuth path: after subscription sign-in, `Settings > Account` shows
      the active auth source as **subscription/OAuth**, and `.env` contains
      `CLAUDE_CODE_OAUTH_TOKEN` with **no** `ANTHROPIC_API_KEY`. (PKG-05)
- [ ] **5.2** API-key path: choosing "Use an API key instead" stores
      `ANTHROPIC_API_KEY` and clears `CLAUDE_CODE_OAUTH_TOKEN`; the readout shows
      **API key**. The two auth vars never coexist. (PKG-05, D1)
- [ ] **5.3** Confirm a stale `ANTHROPIC_API_KEY` left over from an earlier
      experiment does NOT silently override an OAuth login (the crash-loop
      trap) — the onboarding auth write cleared it. (PKG-05)

---

## Notes / observed failures

_Record any deviation, the build hash, and the exact error text here:_

> …
