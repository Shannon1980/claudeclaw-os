---
phase: 01-desktop-shell-onboarding
plan: 04
subsystem: packaging-signing
tags: [electron, electron-builder, code-signing, notarization, hardened-runtime, entitlements, gatekeeper, deferred]

# Dependency graph
requires:
  - "01-02: CLAUDECLAW_DATA_DIR writable-state redirect + install-app-deps wiring + the MED-4 ABI blocker this plan inherits"
  - "01-03: setup-token capture + onb:verifyAuth real round-trip + login item (mainAppService) + minimumSystemVersion 13.0"
provides:
  - "build/entitlements.mac.plist: hardened-runtime entitlements for Electron + spawned claude/node (allow-jit, allow-unsigned-executable-memory, allow-dyld-environment-variables, disable-library-validation)"
  - "build/notarize.cjs: afterSign @electron/notarize hook (electron-builder 25.x path); no-ops without creds, never echoes secrets"
  - "package.json build.mac: hardenedRuntime + gatekeeperAssess:false + entitlements/entitlementsInherit + afterSign hook; @electron/notarize ^3.1.1 devDep"
  - "SMOKE-CHECKLIST.md: § 0 build preconditions (interactive find-identity recheck, notary creds, MED-4 resolution, isolated install-app-deps) + step 3.5 MED-3 real-auth round-trip"
affects: [packaging, gatekeeper, ship-readiness]

# Tech tracking
tech-stack:
  added:
    - "@electron/notarize ^3.1.1 (devDependency, build-time only) — verified official Electron-org package on npm (v3.1.1), github.com/electron/notarize, multi-year, high downloads"
  patterns:
    - "afterSign notarize hook degrades gracefully: skips on non-darwin and on absent APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID so a dev build still emits an unsigned .dmg instead of erroring; logs presence/absence only, never secret values"
    - "Hardened-runtime entitlements scoped to the minimum Electron + child-process needs; shared by entitlements + entitlementsInherit so the forked child inherits them"

key-files:
  created:
    - build/entitlements.mac.plist
    - build/notarize.cjs
  modified:
    - package.json
    - .planning/phases/01-desktop-shell-onboarding/SMOKE-CHECKLIST.md
    - .planning/phases/01-desktop-shell-onboarding/deferred-items.md

key-decisions:
  - "Operator decision (2026-06-23): LAND the version-agnostic signing config, DEFER the real signed/notarized .dmg build. The build was NOT attempted — running electron-builder / install-app-deps under the pinned Electron 33 (ABI 115) would source-compile better-sqlite3 (no v115 prebuilt) and FAIL on this machine's broken toolchain. No fabricated build/smoke."
  - "Task 1 (signing-identity checkpoint): RESOLVED by operator — Developer ID Application cert + notary creds confirmed available. Caveat recorded: an automated find-identity from the non-interactive orchestrator shell returned 0 identities (locked/sandboxed keychain, not a missing cert); SMOKE § 0.1 requires re-confirming in an unlocked interactive terminal before the signed build."
  - "Task 3 (@electron/notarize package-legitimacy gate): APPROVED — official Electron-org package, npm v3.1.1, github.com/electron/notarize source, mature + high downloads. Added as a build-time devDep."
  - "No version bumps: electron ^33.4.11, electron-builder ^25.1.8, better-sqlite3 ^11.8.1 unchanged (the MED-4 resolution is a separate, deferred decision)."
  - "afterSign chosen over electron-builder 26's notarize:true because the project is pinned to electron-builder 25.1.8 (RESEARCH A4)."

requirements-completed: []

# Metrics
duration: ~2min
completed: 2026-06-23
---

# Phase 01 Plan 04: Signed Installer Config (entitlements + notarize hook + build config) Summary

**Landed the version-agnostic Gatekeeper-clean-installer deliverables — hardened-runtime entitlements, an afterSign `@electron/notarize` hook that no-ops without creds, and the `package.json` `build.mac` sign/notarize config — and authored the clean-machine smoke checklist (find-identity precondition + MED-3 real-auth round-trip) with all build-dependent steps marked PENDING; the actual signed `.dmg` build and clean-machine smoke are DEFERRED on the carried MED-4 Electron-ABI blocker by explicit operator decision, so PKG-01 is NOT yet verified for real users.**

## Performance

- **Duration:** ~2 min
- **Tasks:** 4 (Task 1 checkpoint — pre-resolved; Task 2 auto — executed; Task 3 checkpoint — pre-resolved; Task 4 checkpoint/build — DEFERRED)
- **Files created:** 2
- **Files modified:** 3 (package.json, SMOKE-CHECKLIST.md, deferred-items.md)

## Accomplishments

### Task 1 — Signing identity & notary creds (checkpoint, pre-resolved)
Operator confirmed a Developer ID Application certificate and notary credentials are available. Recorded the caveat: an automated `security find-identity -v -p codesigning` from this non-interactive orchestrator shell returned "0 valid identities found" — consistent with a locked/sandboxed keychain in that shell, not a missing cert. SMOKE-CHECKLIST § 0.1 now requires re-confirming the identity in an unlocked interactive terminal immediately before the signed build.

### Task 2 — Entitlements + notarize hook + signing build config (auto, executed)
- `build/entitlements.mac.plist`: `com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory` (Electron V8 JIT), `allow-dyld-environment-variables` (the forked child runs with `ELECTRON_RUN_AS_NODE` + a scrubbed env), and `disable-library-validation` (spawned `claude` CLI + native `.node` addons). Validated with `plutil -lint`.
- `build/notarize.cjs`: an afterSign hook calling `@electron/notarize` with `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` from env. Skips on non-darwin and skips with a clear log line when any cred is absent (so a dev build still produces an unsigned `.dmg` instead of erroring). Only credential presence/absence is logged — values are never echoed (threat T-04-02).
- `package.json`: `build.mac` gains `hardenedRuntime: true`, `gatekeeperAssess: false`, `entitlements` + `entitlementsInherit` → `build/entitlements.mac.plist`; `build.afterSign` → `build/notarize.cjs`; `@electron/notarize ^3.1.1` added as a devDependency. `build.files` + `extraResources` (dist + migrations) untouched. No electron/electron-builder/better-sqlite3 version bumps.

### Task 3 — @electron/notarize legitimacy gate (checkpoint, pre-resolved)
Verified `@electron/notarize` is the official Electron-org package: npm reports v3.1.1, source at github.com/electron/notarize, multi-year age, high download counts. Approved and retained as a build-time devDep.

### Task 4 — Signed `.dmg` build + clean-machine smoke (checkpoint/build, DEFERRED)
**The build was NOT attempted, by explicit operator decision.** Authored the smoke checklist instead:
- Added **§ 0 build preconditions**: 0.1 interactive find-identity recheck (with the sandboxed-shell caveat), 0.2 notary creds in build env, 0.3 MED-4 ABI resolution (PENDING), 0.4 `install-app-deps` proven on an isolated checkout (PENDING).
- Added **step 3.5 — MED-3 real-auth round-trip**: after onboarding, a real agent message must round-trip through the spawned `claude` subprocess authenticated only from the data-dir `.env` via `getScrubbedSdkEnv`, returning a model reply on exit 0 — proving the credential authenticates, not just that the active-source string rendered.
- Marked SMOKE-CHECKLIST sections 1–5 **PENDING (build deferred, MED-4)**.

## PKG-01 status: DEFERRED — NOT verified for real users

**PKG-01 ("a signed + notarized `.dmg` opens on a clean Mac with no Gatekeeper block") is NOT satisfied in this run.** The signing *configuration* is in place and correct, but the actual signed/notarized `.dmg` and the clean-machine end-to-end smoke (install → onboarding → dashboard → reboot → real-auth round-trip) were deliberately not produced/run.

**Blocker:** the carried 01-02 **MED-4 ABI gap** — pinned `electron ^33.4.11` (NODE_MODULE_VERSION 115) has no matching `better-sqlite3` prebuilt (lowest is electron-v116), so `electron-builder install-app-deps` / the real build falls back to a source compile that fails on this machine's toolchain (Python 3.12 no-distutils + Node 25). Running the build here would either fail or require destructive changes to the shared/symlinked live `node_modules`.

**To close PKG-01:** (1) resolve MED-4 — bump `electron` to >=35 (ABI 116) then run `install-app-deps` on an isolated checkout, OR repin better-sqlite3 to a release shipping electron-v115; (2) run `npm run electron:build` with notary creds in env; (3) execute SMOKE-CHECKLIST §§ 0–5 incl step 3.5 (MED-3) on a clean Mac. Tracked in `deferred-items.md` and as a STATE blocker for /gsd-verify-work.

## Task Commits

1. **Task 2:** entitlements + notarize hook + signing build config — `bcdb54d` (feat)
2. **Task 4 (checklist authoring):** smoke preconditions + MED-3 round-trip; build steps PENDING — `7f99efa` (docs)

_Task 1 and Task 3 are checkpoints pre-resolved by the operator (no code). Task 4's actual build is DEFERRED — no build commit, no dist/*.dmg._

## Verification

- **`node --check build/notarize.cjs`** → OK.
- **`plutil -lint build/entitlements.mac.plist`** → OK; contains `allow-jit` + `allow-unsigned-executable-memory`.
- **`node -e` on package.json** → `build.mac.hardenedRuntime: true`, `build.afterSign: build/notarize.cjs`, `devDependencies['@electron/notarize']: ^3.1.1`.
- **Version pins unchanged** → electron `^33.4.11`, electron-builder `^25.1.8`, better-sqlite3 `^11.8.1`.
- **`npm run typecheck`** (`tsc --noEmit`) → clean.
- **NOT run (deliberate):** `npm run electron:build`, `electron-builder install-app-deps`, any sign/notarize/staple — would fail on the MED-4 ABI source compile; deferred by operator decision. No fabricated build output.
- **Full `npm test`:** not run for self-verification per run instructions (6 pre-existing dist/-dependent CLI failures unrelated to this plan).

## Deviations from Plan

### [Operator decision] Task 4 build DEFERRED; PKG-01 not verified
- **Found during:** plan setup (carried 01-02 MED-4 blocker).
- **Issue:** the pinned Electron 33 (ABI 115) has no better-sqlite3 prebuilt, so the real `.dmg` build would source-compile and fail on this machine's broken toolchain; resolving it requires a version bump (Rule 4 / architectural) the operator chose to defer.
- **Action:** landed the version-agnostic signing deliverables and authored the smoke checklist; did NOT run the build or fabricate a passed smoke. Recorded PKG-01 as DEFERRED in SUMMARY + `deferred-items.md` + STATE blocker.
- **Files:** build/entitlements.mac.plist, build/notarize.cjs, package.json, SMOKE-CHECKLIST.md, deferred-items.md.

### [Caveat recorded] find-identity returned 0 in the orchestrator shell
- Automated `security find-identity -v -p codesigning` from the non-interactive shell returned 0 identities (locked/sandboxed keychain), but the operator confirmed the cert IS present. Recorded as SMOKE § 0.1 precondition to re-confirm interactively before the signed build — not treated as a missing-cert failure.

Otherwise Task 2 executed exactly as written.

## Threat Surface

- **T-04-01 (Tampering, unsigned .dmg):** config in place (hardened runtime + entitlements + afterSign notarize). Actual mitigation (signed+notarized .dmg) DEFERRED with the build — Gatekeeper protection not yet realized for shipped users.
- **T-04-02 (Info disclosure, notary creds):** mitigated — `notarize.cjs` reads creds from env only, never echoes values, no-ops cleanly when absent; nothing committed.
- **T-04-03 (EoP, hardened-runtime entitlements):** accepted — entitlements scoped to the minimum Electron + spawned node/claude needs.
- **T-04-SC (Tampering, @electron/notarize install):** mitigated — package-legitimacy gate (Task 3) confirmed the official Electron-org package before it stayed installed.
- No new network endpoints, auth paths, or schema changes introduced.

## Threat Flags

None — no new security-relevant surface beyond the plan's threat model.

## Known Stubs

None. The notarize hook's no-op-without-creds path is intentional graceful degradation (documented), not a placeholder.

## Issues Encountered

The MED-4 ABI blocker (carried from 01-02) is the one substantive issue — it forces the real-build deferral. Honestly recorded; not worked around.

## Next Plan Readiness

- **PKG-01 remains OPEN.** Before the phase can claim a real no-terminal install for end users, MED-4 must be resolved and SMOKE §§ 0–5 (incl the MED-3 round-trip) run on a clean Mac. This is the headline follow-up for /gsd-verify-work.
- The signing config itself is complete and version-neutral — it will apply unchanged once the build runs.

## Self-Check: PASSED

Created files (`build/entitlements.mac.plist`, `build/notarize.cjs`) exist on disk; both task commits (`bcdb54d`, `7f99efa`) are present in git history.

---
*Phase: 01-desktop-shell-onboarding*
*Completed: 2026-06-23*
