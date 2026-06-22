---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Operator Product
status: planning
last_updated: "2026-06-22T14:29:54.009Z"
last_activity: 2026-06-22
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A local-first desktop AI chief-of-staff for business operators — install with no terminal, runs the real Claude engine on the operator's own machine, keeps work moving and never lets anything fall through.
**Current focus:** Phase 1 — Desktop Shell & Onboarding (the gating prerequisite: zero-terminal install)

## Current Position

Phase: Not started (roadmap drafted)
Plan: —
Status: Roadmap created, awaiting phase planning
Last activity: 2026-06-22 — Milestone v2.0 roadmap created (8 phases)

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- D1 (locked): support both subscription OAuth and API-key auth, subscription-default; the app owns auth precedence (stale ANTHROPIC_API_KEY silently wins over OAuth — the known crash-loop trap) and shows the active source in Settings > Account. Belongs to Phase 1 (Desktop Shell & Onboarding).
- D4 (locked): four autonomy tiers by reversibility; modes shift the line between tiers 1/2/3; Tier 4 (irreversible) is locked to Ask-first in every mode. Belongs to Phase 3 (Permissions & Autonomy).
- Build sequence is gated by what ships, not what is fun: Electron shell first (no product until a non-developer can install with no terminal), then Routines, then the trust chain.
- Trust chain spine: Permissions (rules) → action → Activity (operator view) → Audit (technical truth), with Memory feeding the rules. Phases 3→4→5 build the chain in order; Phase 6 (Memory) depends on Phase 3.
- The reframe is mostly a view layer over data the engine already produces (audit_log, hive_mind, memories, scheduled_tasks, token_usage). Most operator surfaces are UI→API→DB vertical slices (mvp mode).

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1 (highest risk): the desktop app must own the `claude` CLI dependency — bundle/auto-install the CLI and drive `claude login` (browser OAuth) through an Electron window. The slickest installer still dead-ends at a terminal if this is not solved.
- Phase 1: Electron login-item registration replaces hand-written launchd plists; if any plist is still generated, keep StandardOutPath/StandardErrorPath free of spaces (launchd exits code 78 on spaces) and use a spaces-safe symlink for WorkingDirectory.
- Phase 3: the permission gate sits at the Agent SDK tool-call layer — before any external/irreversible tool runs it must consult the model, log the decision, and proceed/queue/block. New surface, not just a view.
- Phase 5: audit_log is encryption-adjacent and append-only; reads of any encrypted columns must go through ClaudeClaw's decryption path, not raw better-sqlite3 reads of ciphertext.
- All phases: schema changes go through versioned migrations (`migrations/<version>/`, `add-migration` skill) — never inline-edit the schema.

## Deferred Items

Items acknowledged and carried forward:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v1.0 consolidation | Per-Agent Soul (was v1.0 Phase 8) | Deferred to future milestone | v1.0 pivot 2026-06-22 |
| v1.0 consolidation | Command Centre Repoint (was v1.0 Phase 9) | Deferred to future milestone | v1.0 pivot 2026-06-22 |
| v1.0 consolidation | Compatibility Verification (was v1.0 Phase 10) | Deferred to future milestone | v1.0 pivot 2026-06-22 |

## Session Continuity

Last session: 2026-06-22
Stopped at: v2.0 roadmap created (8 phases)
Resume file: None

## Operator Next Steps

- Plan the first phase with /gsd-plan-phase 1
