# Phase 4: Activity Feed - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-24
**Phase:** 04-activity-feed
**Areas discussed:** Surface & nav, Plain-language rendering, Undo scope (D9), Tags + Summarize

---

## Surface & nav

| Option | Description | Selected |
|--------|-------------|----------|
| New /activity route | Add Activity.tsx at /activity; re-point nav.activity; leave /audit raw for Phase 5 | ✓ |
| Repurpose existing /audit page | Turn current Audit.tsx into the Activity feed now, split Audit out later | |

**User's choice:** New /activity route (D-01/D-02).

| Option | Description | Selected |
|--------|-------------|----------|
| One click from Home + nav item | Activity nav item AND a link/preview from Home | ✓ (both) |
| Nav item only | Sidebar nav only, skip Home entry for MVP | |

**User's choice:** "can you do both" — nav item **and** one-click entry from Home (D-03).

---

## Plain-language rendering

| Option | Description | Selected |
|--------|-------------|----------|
| Render-time tool→phrase map | Deterministic tool+params → phrase, extend summarize() in gate.ts; no LLM | ✓ |
| Enrich at decision time | Gate writes plain summary for all allowed actions; touches Phase 3 write path | |
| On-demand LLM summarize | Generate phrasing live per row; cost/latency, non-deterministic | |

**User's choice:** Render-time tool→phrase map (D-04).

| Option | Description | Selected |
|--------|-------------|----------|
| Honest generic phrase | Show "Ran <tool>" with detail on View; never fabricate | ✓ |
| Hide unmapped rows | Only show describable rows; violates completeness | |

**User's choice:** Honest generic phrase, never hide rows (D-05).

---

## Undo scope (D9)

| Option | Description | Selected |
|--------|-------------|----------|
| Allowlist of reversible tools | Mirror replay-executor: small allowlist with safe inverse; rest = no undo | ✓ |
| Generic undo framework | General reversible-action abstraction; over-scoped for MVP | |
| Mark-undone only (no real inverse) | Flag row undone without reversing; dishonest | |

**User's choice:** Allowlist of reversible tools (D-07).

| Option | Description | Selected |
|--------|-------------|----------|
| Drafts (delete draft) | Undo created draft by deleting | ✓ (target) |
| Meetings (cancel/decline) | Undo created calendar event by cancelling | ✓ (target) |
| Labels (remove label) | Undo applied label by removing | ✓ (target) |
| At least one, others honest no-undo | Ship ≥1 real undo end-to-end; honest no-undo for the rest | ✓ (floor) |

**User's choice:** All three selected as targets PLUS the "at least one" floor. Interpreted as: target
drafts + meetings + labels via the allowlist; hard must-have is ≥1 real undo working end-to-end, with
honest "no undo" for any that prove hard this phase (D-08). Tier 4 never undoable (D-09).

---

## Tags + Summarize

| Option | Description | Selected |
|--------|-------------|----------|
| Derive from queue + audit | Read-side derivation from approval_queue.status + audit outcome | ✓ |
| Add explicit tag column | Store a tag at decision time; touches Phase 3 write path | |

**User's choice:** Derive read-side from queue + audit (D-06).

| Option | Description | Selected |
|--------|-------------|----------|
| Defer Summarize | Ship feed + tags + undo; leave LLM digest for later | |
| Include Summarize | Add the LLM daily-digest button this phase | ✓ |

**User's choice:** Include Summarize this phase (D-10).

| Option | Description | Selected |
|--------|-------------|----------|
| All / Ran on its own / Needs you / per-teammate | Full spec chip set; per-teammate via agent_id + roster | ✓ |
| Minimal: All / Needs you only | Thinnest filter set | |

**User's choice:** Full spec chip set (D-11).

---

## Claude's Discretion

- New `/api/activity*` endpoint vs reusing existing audit/approvals endpoints.
- Day-grouping/timezone boundaries, empty-state copy, pagination/infinite-scroll.
- The exact Home entry-point affordance (card vs link vs mini-preview).
- The Summarize prompt, model, and digest format.
- The precise `vocabKey` naming for the demoted `/audit` route.
- Which of drafts/meetings/labels is the "first" guaranteed-working undo.

## Deferred Ideas

- Dense immutable/exportable technical Audit log + richer schema + CSV/JSON export + retention (D10) — Phase 5.
- General registerable reversible-action framework — later.
- Per-project filtering of Activity — with Projects work.
- Richer Summarize (per-teammate/per-project, scheduled) — beyond the one on-demand daily digest.
- Any undo target lacking a clean inverse ships as honest "no undo" and is logged for follow-up.
