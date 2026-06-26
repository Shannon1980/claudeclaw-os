# Phase 6: Memory Surface - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the **operator-facing Memory surface** — "What I know about you" — a clean,
editable, provenance-tagged knowledge base over the **existing `memories` table**. The
operator can see what the assistant knows (grouped by category), see where each fact came
from, correct or delete any fact in place (without it being silently re-derived), and add
their own facts with a prominent local-storage assurance.

This is the **trust-surface reframe** of the existing developer memory view: the
consolidation/decay engine keeps running underneath; the operator sees the current state,
not the mechanics. It is the memory third of the connected trust system (Memory feeds
Permissions feeds Activity/Audit).

Requirements: **MEM-01** (view grouped by category), **MEM-02** (per-fact provenance +
edit/delete in place).

**Out of scope this phase (deferred):**
- The developer/Labs analytics view itself (brain graph, salience/decay visualization) is
  *relocated*, not redesigned or extended — keep it working, move it behind Labs.
- Changes to the consolidation/decay/ingestion *algorithms*. This phase adds a
  suppression/confirmation gate around them, it does not retune the engine.
- New email ingestion. "Learned from email" provenance is honored only if an email source
  already exists in the data (honest coverage); building an email→memory pipeline is its own work.
</domain>

<decisions>
## Implementation Decisions

### Surface strategy
- **D-01:** Build a **NEW operator-facing Memory page/route** (clean trust surface). Do
  **not** reframe the existing `web/src/pages/Memories.tsx` in place. This mirrors the
  Activity-vs-Audit precedent locked in Phase 4 (04 D-01) and Phase 5 (05 D-01): operator
  surface and developer surface look unlike each other so the two audiences are never
  confused.
- **D-02:** **Relocate the existing developer view** (`Memories.tsx`, `BrainGraph`/
  `BrainGraph3D`, salience/importance sort, decay) to a **hidden Labs area** — keep it
  working, move it off the operator's main nav. Do not delete the brain graph (spec: it
  goes to Labs, not the bin).

### Provenance (resolves spec open-decision D11)
- **D-03:** **Map the raw `source` signal to three operator-facing tags** — "You told me" /
  "Learned from your work" / "Learned from email". Note: existing `source` values are coarse
  (`'conversation'`, `'checkpoint'`, default `'conversation'`) and do **not** cleanly carry
  this distinction today — provenance must be *derived*, not read straight from the column.
  See code_context for the gap.
- **D-04:** **Inferred facts require operator confirmation before they influence behavior.**
  (User override of the lighter "no gating" option — chosen deliberately to honor the spec's
  "Memory feeds Permissions" connection.) Concretely: a machine-inferred fact lands in an
  **unconfirmed** state, is shown in the surface with a **"needs review"** marker, and does
  **NOT** inform permission defaults or assistant behavior until the operator confirms it.
  Operator-authored ("You told me") facts are confirmed by definition. Confirm / Edit /
  Delete are the row actions on an unconfirmed fact.
  - **Scope note for planner:** this is the larger-scope provenance path. It adds (a) a
    confirmed/unconfirmed state to facts and (b) the read-side rule that unconfirmed facts
    are excluded from anything that feeds Permissions/behavior. Size the plan accordingly.
- **D-05 (Claude's discretion):** Show the "Learned from email" tag **only if** an email
  source actually exists in the data; otherwise omit it rather than imply coverage that
  isn't there (honest-coverage pattern, matching Audit's "not yet captured", 05 D-13).

### Categorization
- **D-06:** **Stored `category` column + LLM backfill.** Add a nullable `category` column
  via a versioned migration; classify facts via Claude on ingest plus a one-time backfill of
  existing rows; the surface reads the column (stable, cheap reads, deterministic display,
  editable). Categories: **your business / your clients / how you like to work**.
- **D-07:** **Empty categories are hidden** (per spec — don't render an empty bucket).
  Facts that don't classify into the three buckets stay in the data but are not forced into a
  visible "Other" group on the operator surface (Claude's discretion on whether a low-key
  "miscellaneous" affordance is warranted; default is hide).

### Delete without re-derivation (success criterion 3)
- **D-08:** **Tombstone / suppression table.** A delete writes a tombstone (e.g. text
  hash and/or embedding of the deleted fact); the **ingestion and consolidation paths check
  the tombstone set and skip re-deriving** a matching fact. This is real enforcement of "a
  deleted fact is not silently re-derived," not a soft-delete that only hides the row. This
  is the one genuinely new mechanism this phase adds around the existing engine.

### Add a fact
- **D-09:** Add inserts a **high-salience, operator-authored, confirmed** fact (source =
  "you told me"), with the category chosen/confirmed by the operator. The Add affordance
  carries the **prominent local-storage assurance** ("Stored on this machine. Edit or delete
  anything.") — success criterion 4.

### Claude's Discretion
- Exact provenance label copy, the "needs review" / "new" marker styling, salience/importance
  values for operator-authored facts, and whether a low-key miscellaneous group is shown
  (D-07). Tombstone matching strategy (hash vs embedding vs both) is an implementation choice
  for research/planning, as long as it provably blocks re-derivation (D-08).
- Which `chat_id` / agent scope the operator surface reads (single-operator product —
  default to the operator's primary agent/chat; confirm during planning against how prior
  operator surfaces scoped their reads).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase spec (the design source)
- `specs/operator-product/09-memory.md` — the Memory surface spec: reframe rationale,
  layout, the three categories, provenance-as-hero (D11), data/engine notes, states, and
  the open decision this phase resolves.
- `specs/operator-product/07-permissions-settings.md` — where preference-level facts feed
  permission defaults; relevant to D-04 (unconfirmed facts must not influence these).
- `specs/operator-product/README.md` — milestone PRD / trust-system framing.

### Prior-phase precedent (operator-vs-technical surface pattern)
- `.planning/phases/04-activity-feed/04-CONTEXT.md` §decisions D-01 — new operator route,
  visually distinct from the technical view (the pattern D-01 here follows).
- `.planning/phases/05-audit-log/05-CONTEXT.md` §decisions D-01, D-13 — same new-surface
  precedent + the honest-coverage / "not yet captured" pattern reused in D-05.
- `.planning/phases/03-permissions-autonomy/03-CONTEXT.md` — the permission gate/defaults
  that D-04's confirmation rule protects.

### Roadmap / requirements
- `.planning/ROADMAP.md` §"Phase 6: Memory Surface" — goal + 4 success criteria.
- `.planning/REQUIREMENTS.md` — MEM-01, MEM-02.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/db.ts:132` — `memories` table: `source`, `raw_text`, `summary`, `entities`,
  `topics`, `connections`, `importance`, `salience`, `consolidated`, `embedding`,
  `created_at`, `accessed_at`, plus `agent_id` (and a `pinned` flag surfaced in the API).
  This is the table the surface reads — no new store needed, only a `category` column
  (D-06), confirmed/unconfirmed state (D-04), and a tombstone table (D-08).
- `src/dashboard.ts` — existing memory API routes are **read-only today**:
  `GET /api/memories`, `/api/memories/pinned`, `/api/memories/list`. **No edit / delete /
  add routes exist** — they are net-new this phase.
- `web/src/pages/Memories.tsx` (321 lines) + `web/src/components/BrainGraph.tsx` /
  `BrainGraph3D.tsx` — the developer view to relocate to Labs (D-02), not the operator
  surface.
- `web/src/pages/Activity.tsx`, `web/src/pages/Audit.tsx` — closest UI analogs for the new
  operator surface (grouped read-over-a-table, plain-language rows, per-row actions).
- `src/db.ts:958`/`:1118` — `saveStructuredMemory` / memory-save path: where ingest sets
  `source` and where the tombstone check (D-08) and category classification (D-06) hook in.
- `src/memory-ingest.ts`, `src/memory-consolidate.ts` — the ingestion + consolidation
  paths that must consult the tombstone set (D-08) and must exclude unconfirmed facts from
  behavior-influencing reads (D-04).
- `migrations/` — versioned migrations live here; the `category` column + tombstone table +
  confirmed-state column go through this path (CONVENTIONS: dual-write createSchema +
  versioned migration, per 05 precedent).

### Established Patterns
- **Operator surface ≠ technical surface** (04 D-01, 05 D-01): new route, plain language,
  visually distinct. D-01/D-02 follow this exactly.
- **Honest coverage** (05 D-13): show only what the data backs; state gaps rather than imply
  coverage. Drives D-05.
- **Trust chain**: Permissions → action → Activity → Audit, now with Memory feeding
  Permissions. D-04's confirmation gate is the join.

### Integration Points
- New operator Memory route in the Preact dashboard (`web/`) + new mutation API routes in
  `src/dashboard.ts`.
- Provenance derivation + category classification + tombstone enforcement land in the
  memory-save / ingest / consolidate paths in `src/`.
- D-04's "unconfirmed facts excluded" rule touches wherever memory feeds permission defaults
  / agent behavior (see `specs/operator-product/07-permissions-settings.md`).

### Known gap to resolve in research
- `source` is coarse today (`'conversation'`, `'checkpoint'`, default `'conversation'`); it
  does not distinguish operator-authored vs inferred-from-work vs email. The provenance
  mapping (D-03) must be *derived* (e.g. from `source` + agent/ingest path + author), not a
  straight column read. Research should pin the exact mapping from real `source` values.
</code_context>

<specifics>
## Specific Ideas

- Header copy direction from spec: **"What I know about you"** with the local-storage
  assurance line **"Stored on this machine. Edit or delete anything."** (exact wording is
  Claude's discretion).
- Provenance is the hero of this surface — the per-fact tag is not decoration, it is the
  reason the surface earns trust. Treat it as first-class in the row design.
- Recently-learned / unconfirmed facts carry a subtle "new" / "needs review" marker so the
  operator can review what was inferred (ties to D-04).
</specifics>

<deferred>
## Deferred Ideas

- **Email → memory ingestion pipeline** — would make "Learned from email" provenance real;
  out of scope this phase (D-05 only honors it if data already exists). Its own future work.
- **Redesigning / extending the Labs analytics view** (decay visualization, brain graph
  interactions) — relocated as-is this phase (D-02); any rework is later.
- **Retuning consolidation/decay algorithms** — this phase gates them (tombstone +
  confirmation), it does not change how they score or merge.

</deferred>

---

*Phase: 6-memory-surface*
*Context gathered: 2026-06-26*
