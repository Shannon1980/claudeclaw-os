# Phase 5: Audit Log - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 05-audit-log
**Areas discussed:** Field coverage, Instrument scope, New event types, Retention (D10), Export shape, Placement & filters

---

## Field coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Honest-coverage, no write-path change | Render existing audit_log + approval_queue, state missing fields as uncaptured | |
| Hybrid: cheap joins + state the rest | Above + join token_usage for cost/model/session, state genuinely-missing | |
| Instrument the write path now | Add real columns + capture tool/target/project/session/model/cost/duration at write time | ✓ |

**User's choice:** Instrument the write path now.
**Notes:** Fullest fidelity; deliberately reopens the Phase 3/4 write path. Flagged as the largest-scope option and the bulk of phase work.

---

## Instrument scope

| Option | Description | Selected |
|--------|-------------|----------|
| Core events first (must-have) | Instrument trust-chain events fully; others partial + stated | |
| All event types, full fidelity | Every column + all fields across every audited event type; wire token_usage↔audit_log; add duration timing | ✓ |

**User's choice:** All event types, full fidelity.
**Notes:** Per-action audit rows vs per-turn cost/model/session (token_usage) resolution is a planner call; duration timing must be added where none exists.

---

## New event types

| Option | Description | Selected |
|--------|-------------|----------|
| Stick to existing + state gaps | No new emissions; honest chips for existing types only | |
| Add auth + routine + error too | Emit auth/routine/error at their sources so the full chip set has data | ✓ |

**User's choice:** Add auth + routine + error too.
**Notes:** config-change events are already audited; adds emissions at auth/session, routine-run, and error sources.

---

## Retention (D10)

| Option | Description | Selected |
|--------|-------------|----------|
| Archive-then-prune, stated | Roll old rows to archive file before removing; surface window + archive note | |
| State window, no auto-prune yet | Configurable + displayed window; no deletion this phase; defer enforcement | ✓ |
| Hard-prune oldest, stated | Delete past-window rows directly, window stated | |

**User's choice:** State window, no auto-prune yet.
**Notes:** Strictly honors append-only/no-delete. Disk-growth risk acknowledged; archive-then-prune enforcement logged as deferred follow-up.

---

## Export shape

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side, full filtered set | New endpoint streams complete set matching active filters/date-range, CSV+JSON download | ✓ |
| Server-side, entire log always | Export ignores filters, dumps whole log | |
| Client-side from loaded rows | Export only loaded page; incomplete | |

**User's choice:** Server-side, full filtered set.
**Notes:** Completeness answer for "what did the AI do with our data"; must not cap at page size; inherits dashboard token gate.

---

## Placement & filters

| Option | Description | Selected |
|--------|-------------|----------|
| Move under Settings/admin + honest chips | Relocate /audit out of main nav; chips only for event types with data | ✓ |
| Keep top-level route + honest chips | Leave /audit top-level; honest chips | |
| Move under Settings/admin + all spec chips | Relocate + show all four chips even when empty | |

**User's choice:** Move under Settings/admin + honest chips.
**Notes:** Spec says Audit is admin-facing, not in main nav. D-12's new event types make more chips real this phase. Keep dense/technical look, unlike Activity.

---

## Claude's Discretion

- Default retention window value (~90 days per spec) — must be stated wherever shown.
- How a per-action row resolves turn-level cost/model/session from token_usage.
- How duration is measured per event type (start/stop boundaries).
- Export file naming, CSV column order, JSON envelope shape.
- Settings/admin nav grouping + route/vocabKey for the relocated Audit page.
- Migration sequencing + backfill/defaults for rows predating the new columns.
- New columns on audit_log directly vs a companion detail table.

## Deferred Ideas

- Automatic retention enforcement (archive-then-prune / roll-up at the window boundary).
- Enterprise compliance wrapper — SSO-gated access, compliance formats, tamper-evidence/hash-chaining.
- Per-project filter UI (project field is captured this phase; filter UI can follow with Projects work).
- Scheduled/automated exports (on-demand only this phase).
