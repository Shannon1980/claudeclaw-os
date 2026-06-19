---
phase: 07-single-scheduler
plan: 03
subsystem: launchd-deployment
tags: [launchd, aos, scheduler, service, plist]
requires:
  - "agents/aos: aos agent identity with project_dir at agentic-os (existing)"
provides:
  - "launchd/com.claudeclaw.aos.plist: standalone aos service definition (--agent aos)"
affects:
  - "07-05 cutover: this plist is loaded to give aos its own initScheduler(send, 'aos') loop"
tech-stack:
  added: []
  patterns:
    - "Per-agent standalone launchd service mirroring com.claudeclaw.comms.plist"
    - "Spaces-safe log paths in /tmp to avoid launchd exit 78 (EX_CONFIG)"
key-files:
  created:
    - "launchd/com.claudeclaw.aos.plist"
  modified: []
decisions:
  - "Log paths forced to /tmp/claudeclaw-aos.log (no spaces) because the live project path contains a space (App Repo); launchd exits 78 on spaced StandardOut/ErrorPath."
  - "WorkingDirectory keeps the __PROJECT_DIR__ placeholder so install tooling substitutes the spaces-safe ~/.claudeclaw-app symlink, matching the other plists' house style."
  - "Service left unloaded; loading/cutover deferred to 07-05 after the new path is proven."
metrics:
  duration: "1m"
  completed: 2026-06-17
  tasks: 1
  files: 1
---

# Phase 07 Plan 03: Standalone aos launchd Service Summary

Created `launchd/com.claudeclaw.aos.plist`, a standalone `--agent aos` service definition mirroring the per-agent comms template, with spaces-safe `/tmp/claudeclaw-aos.log` log paths and full crash-recovery keys; left unloaded for the 07-05 cutover.

## What Was Built

- **`launchd/com.claudeclaw.aos.plist`** — a per-agent launchd service for the `aos` workspace agent, which today is delegation-only with no process of its own. The plist promotes it to a standalone service so SCH-01 (ClaudeClaw as the single runner) can fire the aos jobs from a real process with its own `initScheduler(send, 'aos')` loop (D-04/D-05).
  - `Label` = `com.claudeclaw.aos`; `ProgramArguments` runs `__NODE_PATH__ dist/index.js --agent aos`.
  - `RunAtLoad`, `KeepAlive`, `ThrottleInterval 30` carried over for network-not-ready crash recovery.
  - `WorkingDirectory` keeps the `__PROJECT_DIR__` placeholder (install tooling substitutes the spaces-safe `~/.claudeclaw-app` symlink), matching every other plist in `launchd/`.
  - `EnvironmentVariables` (PATH + `__HOME__`) carried over verbatim from the comms template.

## Critical Divergence from the Template

The comms template uses `__PROJECT_DIR__/logs/comms.log` for its log paths. That form is unsafe here: the live ClaudeClaw project path (`/Users/shannongueringer/App Repo/claudeclaw`) contains a space, and macOS launchd silently exits with code 78 (`EX_CONFIG`) when `StandardOutPath`/`StandardErrorPath` contain spaces (CLAUDE.md launchd rules). Both log paths are therefore set to `/tmp/claudeclaw-aos.log` — no spaces, no exit-78 trap (mitigates T-07-07).

## Verification

- `plutil -lint launchd/com.claudeclaw.aos.plist` → OK (well-formed XML plist).
- `Label` and the `--agent` argument both resolve to `aos`.
- Both `StandardOutPath` and `StandardErrorPath` are exactly `/tmp/claudeclaw-aos.log`; no occurrence of "App Repo" or any space in either log-path value.
- `RunAtLoad`, `KeepAlive` true, `ThrottleInterval 30` present.
- `launchctl print gui/$(id -u)/com.claudeclaw.aos` confirms the service is NOT loaded by this plan.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Known Stubs

None. The plist is a complete service definition. It is intentionally left unloaded; loading is the explicit responsibility of the 07-05 proof/cutover plan, not a stub.

## Self-Check: PASSED

- FOUND: launchd/com.claudeclaw.aos.plist
- FOUND commit: f8ddca0
