# Phase 6: Memory Surface - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-26
**Phase:** 6-memory-surface
**Areas discussed:** Surface strategy, Provenance taxonomy (D11), Categorization, Delete-no-rederive

---

## Surface strategy

| Option | Description | Selected |
|--------|-------------|----------|
| New page, Labs old | New clean operator Memory surface; relocate dev Memories.tsx/BrainGraph/salience/decay to a hidden Labs area. Matches Activity-vs-Audit precedent. | ✓ |
| Reframe in place | Rewrite existing Memories.tsx, hide dev widgets there. Mixes audiences on one route. | |
| New page, drop dev view | Build new surface, delete brain graph. Spec says keep it in Labs. | |

**User's choice:** New page, Labs old
**Notes:** Consistent with the operator-vs-technical surface split locked in Phases 4 and 5.

---

## Provenance taxonomy (D11)

| Option | Description | Selected |
|--------|-------------|----------|
| Map + honest gaps, no gating | Map source→3 tags; email tag only if email source exists; inferred facts get a 'new' marker but are NOT gated before influencing behavior. (Claude's recommendation.) | |
| Map + require confirmation | Inferred facts must be operator-confirmed before they influence permissions/behavior. Adds a confirmation pipeline (bigger scope). | ✓ |
| Map, all 3 tags always | Always show all three tags even with no email source. Risks implying coverage that isn't there. | |

**User's choice:** Map + require confirmation (override of Claude's recommendation)
**Notes:** Chosen deliberately to honor the spec's "Memory feeds Permissions" connection. Captured as CONTEXT D-04 with a scope note for the planner: adds confirmed/unconfirmed fact state + a read-side rule excluding unconfirmed facts from behavior-influencing reads. Honest-email-coverage (the strong part of the rejected option) retained as Claude's discretion D-05.

---

## Categorization

| Option | Description | Selected |
|--------|-------------|----------|
| Stored column + LLM backfill | Nullable `category` column (migration), classify via Claude on ingest + one-time backfill; display reads the column. Stable, cheap, editable. | ✓ |
| Classify at display time | LLM/heuristic groups on every load, no schema change. Slower, non-deterministic. | |
| Topics/entities heuristic | Derive category from existing topics/entities, no LLM. Cheap but crude. | |

**User's choice:** Stored column + LLM backfill
**Notes:** Empty buckets hidden per spec; uncategorized facts stay in data without a forced visible "Other" group (D-07).

---

## Delete-no-rederive

| Option | Description | Selected |
|--------|-------------|----------|
| Tombstone table | Deletes write a tombstone (text hash/embedding); ingestion + consolidation check it and skip re-deriving. Real enforcement of success criterion 3. | ✓ |
| Soft-delete flag | Status column on the row; doesn't catch re-derivation from fresh raw text. | |
| Hard delete only | Just remove the row; consolidation could re-derive. Fails criterion 3. | |

**User's choice:** Tombstone table
**Notes:** The one genuinely new mechanism this phase adds around the existing consolidation/decay engine.

---

## Claude's Discretion

- Provenance label copy, "needs review"/"new" marker styling, operator-fact salience values.
- Whether a low-key miscellaneous group is shown (D-07; default hide).
- Tombstone matching strategy (hash vs embedding vs both), provided it provably blocks re-derivation.
- Which chat_id/agent scope the operator surface reads (single-operator product).

## Deferred Ideas

- Email → memory ingestion pipeline (would make "Learned from email" real).
- Redesigning/extending the relocated Labs analytics view.
- Retuning consolidation/decay algorithms (this phase gates them, doesn't retune them).
