---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Operator Product
status: planning
last_updated: "2026-06-23T20:30:51.386Z"
last_activity: 2026-06-23
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 4
  completed_plans: 4
  percent: 13
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A local-first desktop AI chief-of-staff for business operators — install with no terminal, runs the real Claude engine on the operator's own machine, keeps work moving and never lets anything fall through.
**Current focus:** Phase 2 — routines

## Current Position

Phase: 2
Plan: Not started
Status: Ready to plan
Last activity: 2026-06-23

## Performance Metrics

**Velocity:**

- Total plans completed: 4
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 30 | 2 tasks | 5 files |
| Phase 01 P02 | ~25min | 3 tasks | 11 files |
| Phase 01 P03 | ~5min | 3 tasks | 5 files |
| Phase 01 P04 | ~2min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- D1 (locked): support both subscription OAuth and API-key auth, subscription-default; the app owns auth precedence (stale ANTHROPIC_API_KEY silently wins over OAuth — the known crash-loop trap) and shows the active source in Settings > Account. Belongs to Phase 1 (Desktop Shell & Onboarding).
- D4 (locked): four autonomy tiers by reversibility; modes shift the line between tiers 1/2/3; Tier 4 (irreversible) is locked to Ask-first in every mode. Belongs to Phase 3 (Permissions & Autonomy).
- Build sequence is gated by what ships, not what is fun: Electron shell first (no product until a non-developer can install with no terminal), then Routines, then the trust chain.
- Trust chain spine: Permissions (rules) → action → Activity (operator view) → Audit (technical truth), with Memory feeding the rules. Phases 3→4→5 build the chain in order; Phase 6 (Memory) depends on Phase 3.
- The reframe is mostly a view layer over data the engine already produces (audit_log, hive_mind, memories, scheduled_tasks, token_usage). Most operator surfaces are UI→API→DB vertical slices (mvp mode).
- [Phase ?]: A1 resolved: claude setup-token captures a token from a non-TTY Electron subprocess; plan 03 uses spawn+capture path.
- [Phase ?]: MED-2: desktop service logs via pino to stdout/stderr only (no file/log-dir) — no log-path redirect needed for the launchd space trap
- [Phase ?]: MED-4 BLOCKER: better-sqlite3 11.10.0 has no Electron-v115 prebuilt (lowest v116); pinned electron ^33.4.11 = ABI 115 forces a source compile the broken toolchain can't do — needs a version-bump decision before plan 04 build
- [Phase 01]: 01-03: MED-1 interop = lazy await import of compiled dist ESM (cached, async accessors), not a CJS shim; config.cjs/main.cjs auth+security helpers are async
- [Phase 01]: 01-03: setup-token spawn+capture wired (success=token captured); onb:verifyAuth proves a real claude round-trip via getScrubbedSdkEnv; login item pinned macOS 13.0 with type:mainAppService (A5)
- [Phase ?]: [Phase 01]: 01-04: landed version-agnostic signing config (entitlements.mac.plist, notarize.cjs afterSign hook that no-ops without creds, package.json build.mac hardenedRuntime+entitlements+afterSign); @electron/notarize ^3.1.1 official Electron org; no version bumps
- [Phase ?]: [Phase 01]: 01-04: operator DEFERS the real signed .dmg build on MED-4 (electron 33 ABI 115 has no better-sqlite3 prebuilt); PKG-01 NOT verified for real users; SMOKE checklist authored, build steps PENDING + interactive find-identity precondition + MED-3 real-auth round-trip step

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1 (highest risk): the desktop app must own the `claude` CLI dependency — bundle/auto-install the CLI and drive `claude login` (browser OAuth) through an Electron window. The slickest installer still dead-ends at a terminal if this is not solved.
- Phase 1: Electron login-item registration replaces hand-written launchd plists; if any plist is still generated, keep StandardOutPath/StandardErrorPath free of spaces (launchd exits code 78 on spaces) and use a spaces-safe symlink for WorkingDirectory.
- Phase 3: the permission gate sits at the Agent SDK tool-call layer — before any external/irreversible tool runs it must consult the model, log the decision, and proceed/queue/block. New surface, not just a view.
- Phase 5: audit_log is encryption-adjacent and append-only; reads of any encrypted columns must go through ClaudeClaw's decryption path, not raw better-sqlite3 reads of ciphertext.
- All phases: schema changes go through versioned migrations (`migrations/<version>/`, `add-migration` skill) — never inline-edit the schema.
- ABI gap (01-02 MED-4): better-sqlite3 11.10.0 has no Electron-v115 prebuilt (lowest v116); pinned electron ^33.4.11 = ABI 115, so install-app-deps falls back to a source compile the broken toolchain cannot do. W4 .dmg build will fail under current pins. Needs a version-bump decision (electron 35+ for ABI116, or a better-sqlite3 version publishing v115) before plan 04.
- PKG-01 DEFERRED: signed/notarized .dmg build blocked on MED-4 (electron ^33.4.11 ABI 115 has no better-sqlite3 prebuilt; lowest is electron-v116). 01-04 landed the signing config (entitlements + notarize hook + build.mac); the real build + clean-machine smoke (SMOKE §§0-5 incl MED-3 round-trip) are deferred until electron is bumped >=35 (ABI 116) + install-app-deps on an isolated checkout, OR better-sqlite3 repinned. PKG-01 NOT verified for real users.

## Deferred Items

Items acknowledged and carried forward:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v1.0 consolidation | Per-Agent Soul (was v1.0 Phase 8) | Deferred to future milestone | v1.0 pivot 2026-06-22 |
| v1.0 consolidation | Command Centre Repoint (was v1.0 Phase 9) | Deferred to future milestone | v1.0 pivot 2026-06-22 |
| v1.0 consolidation | Compatibility Verification (was v1.0 Phase 10) | Deferred to future milestone | v1.0 pivot 2026-06-22 |

## Session Continuity

Last session: 2026-06-23T20:30:51.382Z
Stopped at: Phase 3 context gathered
Resume file: .planning/phases/03-permissions-autonomy/03-CONTEXT.md

## Operator Next Steps

- Plan the first phase with /gsd-plan-phase 1
