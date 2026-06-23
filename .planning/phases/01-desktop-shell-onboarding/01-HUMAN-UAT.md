---
status: partial
phase: 01-desktop-shell-onboarding
source: [01-VERIFICATION.md]
started: 2026-06-22T00:00:00Z
updated: 2026-06-22T00:00:00Z
---

## Current Test

[awaiting human testing — gated on MED-4 resolution + a produced .dmg]

## Prerequisite (blocks all items below)

MED-4: bump `electron` to >=35 (ABI >=116), run `electron-builder install-app-deps` on an
isolated checkout (not the live-service checkout), then `npm run electron:build` with notary
creds to produce a signed + notarized `.dmg`. See SMOKE-CHECKLIST.md §0 (incl. the interactive
`security find-identity -v -p codesigning` recheck).

## Tests

### 1. PKG-01 — Clean-machine install, no Gatekeeper block
expected: Double-clicking the `.dmg`/installed `.app` on a clean Mac (one that never ran the dev toolchain) launches with no "Apple cannot check it for malicious software" dialog. Signing config (entitlements, hardenedRuntime, afterSign notarize hook) is landed and correct; only the build itself is deferred.
result: [pending]

### 2. PKG-02 — Packaged service boots + dashboard loads
expected: Launching the packaged `.app` boots the Node service internally (migrations run before fork, `CLAUDECLAW_DATA_DIR` under userData), real SQLite ABI loads, and the dashboard opens as the app window. Tests the `app.isPackaged` paths a dev run cannot.
result: [pending]

### 3. PKG-03 — Browser OAuth via setup-token, no terminal
expected: First run installs/sets up the Claude CLI (native binary, curl installer), drives `claude setup-token` through an Electron-spawned browser OAuth, captures the token (A1 confirmed: length 108), and the wizard's Continue gates on a real `claude -p` round-trip (MED-3, SMOKE §3.5). No terminal touched.
result: [pending]

### 4. PKG-04 — Login item + reboot persistence
expected: Packaged app registers as a login item (`setLoginItemSettings({type:'mainAppService'})`) and keeps running across a real reboot.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

None at code level. All 4 items are OS/runtime-bound and verified-as-built in code; empirical confirmation is gated on the deferred `.dmg` build (MED-4).
