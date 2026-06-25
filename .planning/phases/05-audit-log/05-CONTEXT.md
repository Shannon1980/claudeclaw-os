# Phase 5: Audit Log - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning
**Mode:** MVP (vertical slice)

<domain>
## Phase Boundary

Deliver the **admin-facing technical Audit log** — the immutable, append-only, complete record of
every event, with full technical detail per row, an honest statement of what is and isn't captured,
**CSV/JSON export**, and a **bounded, configurable, stated retention window** (D10). It is the
back-half *technical* surface of the trust chain whose operator-facing front (Activity) shipped in
Phase 4, closing the **Permissions → action → Activity → Audit** trace.

Phase 4 deliberately left the gate/agent **write path** closed and deferred the "richer audit schema"
to here. **This phase reopens the write path on purpose** (per D-01) to capture the spec's full
per-event detail at the source.

**In scope this phase:**
- A reworked **technical Audit surface** (formalizing the existing raw `web/src/pages/Audit.tsx` /
  `/audit`), relocated **under Settings > Security / admin** and out of the operator's main nav (D-13).
- A **richer `audit_log` schema** with real columns for the spec's per-event fields (tool, target,
  project, permission decision + who/when, result, duration, cost, session, model, event type),
  dual-written (createSchema + versioned `migrations/`).
- **Write-path instrumentation at full fidelity** across every audited event type so those columns
  carry real data (D-01/D-11), including **duration timing** and a **`token_usage` ↔ `audit_log`
  join/capture** for cost/model/session.
- **Emitting the spec's missing event types** — auth (session refresh/auth), routine runs, and caught
  errors — at their sources, so the spec's full type-chip set has backing data (D-12).
- A dense, technical row layout (monospace timestamps, actor badge, event-type tag, outcome icon,
  expand-for-detail) with filter bar: search + honest type chips + date range (D-13).
- **Server-side export** (`/api/audit/export`) of the **complete filtered set** as CSV and JSON,
  delivered as a file download (D-21).
- A **configurable, displayed retention window** (D-31): the window is set and stated in the UI;
  **no automatic deletion this phase** (enforcement deferred) so the append-only/no-delete hard rule
  is strictly honored.

**Out of scope this phase (deferred):**
- **Automatic retention enforcement** (archive/roll-up/prune at the window boundary) — policy is
  configured and stated now; the actual pruning job is a follow-up (D-31).
- The enterprise compliance wrapper — SSO-gated audit access, compliance export formats,
  tamper-evidence/hash-chaining (spec calls these the deferred enterprise layer).
- Any change to the Activity surface or the Phase 3 permission **decision logic** — this phase changes
  what the write path *records*, not whether/how the gate *decides*.
</domain>

<decisions>
## Implementation Decisions

### Field coverage & schema (the central decision)
- **D-01:** **Instrument the write path now, full fidelity.** Do not settle for honest-coverage of the
  current thin schema. Add the spec's per-event fields as real captured data so rows show tool, target,
  project, permission decision + who/when approved, result, duration, cost, session, model, and a
  proper event-type tag. This reopens the gate/agent write path that Phase 3/4 left closed — that is
  intentional and is the bulk of this phase's work.
- **D-11:** **All event types, full fidelity** (not just the trust-chain core). Every audited event
  type gets the new columns and captures all applicable fields. Wire `token_usage` ↔ `audit_log`
  (cost/model/session are per-turn in `token_usage`; audit events are per-action — the planner must
  define how a per-action row resolves its turn's cost/model/session) and add **duration timing**
  where none exists today.
- **D-12:** **Add the missing event types** — emit **auth** (session refresh / auth events),
  **routine** runs, and caught **errors** at their source modules, in addition to the existing
  `message | command | delegation | kill | blocked | permission` types (config-change events are
  already audited). After this, the spec's `Actions · Permissions · Auth · Errors` chip set has real
  backing data.

### Retention (D10)
- **D-31:** **State the window, do not auto-prune this phase.** Make the retention window
  **configurable** and **display it** in the Audit UI ("retaining 90 days"), but **do not delete**
  rows in this phase. This strictly honors the "append-only, no delete, no silent dropping" hard rule;
  actual boundary enforcement (archive-then-prune) is an explicit deferred follow-up. Default window
  value is Claude's discretion (spec suggests ~90 days), but it MUST be stated wherever shown.

### Export (CSV/JSON)
- **D-21:** **Server-side export of the complete filtered set.** Add a new `/api/audit/export`
  endpoint that streams **every** row matching the active filters / search / date-range (not just the
  loaded page), in both **CSV and JSON**, delivered as a **file download**. This is the
  "what did the AI do with their data" completeness answer; it must not silently cap at the page size.
  Export inherits the same dashboard token gate as other `/api/*` routes.

### Surface placement & filters
- **D-13:** **Relocate the Audit surface under Settings > Security / admin**, out of the operator's
  main nav (spec: Audit is admin-facing, opened deliberately). Show **honest type chips** — only for
  event types that actually exist in the data; any spec chip with no backing data is stated as
  "not yet captured" rather than shown as an empty filter implying coverage. With D-12 emitting
  auth/routine/error, more chips become real this phase. Keep the dense/technical look (monospace
  timestamps + detail) deliberately unlike Activity.

### Claude's Discretion
- The exact default retention window value (spec suggests ~90 days) — but it must be stated.
- How a per-action audit row resolves its turn-level cost/model/session from `token_usage`
  (join key, nearest-turn, or capture-at-write) — researcher/planner call.
- How duration is measured for each event type (where the start/stop boundaries sit).
- Export file naming, CSV column order, and JSON envelope shape.
- The precise Settings/admin nav grouping and route/`vocabKey` for the relocated Audit page.
- Migration sequencing and any backfill/default behavior for existing rows that predate the new columns.
- Whether new columns are added to `audit_log` directly vs a companion detail table — planner's call,
  guided by the existing `addColumnIfMissing` + versioned `migrations/` dual-write pattern.

### Sequencing note for the planner (MVP reconciliation)
- This is the **largest-scope** field-coverage option chosen deliberately. To stay true to MVP
  (vertical slice), the plan should land a **thin end-to-end slice first** (schema + one fully
  instrumented event type → richer `/api/audit` → reworked surface → export of that), then widen
  instrumentation to all event types and add the new auth/routine/error emissions. The phase floor
  must be a working, complete-for-what-it-claims technical Audit surface — not a half-wired schema.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Operator-product design contract
- `specs/operator-product/08-activity-audit.md` — THE design contract for this phase. The "Audit — the
  immutable record" half: purpose (technical truth for debugging autonomy; deferred enterprise
  wrapper), placement (under Settings > Security/admin, not main nav), dense layout, per-row anatomy
  (monospace timestamp, actor badge, event-type tag, outcome icon, expand-for-detail), the
  "Records everything" completeness mandate, the **Hard rules** (append-only/no-delete/no-silent-drop,
  state uncaptured categories, Export CSV/JSON), the Data/engine field list, and **D10** (retention).
- `specs/operator-product/01-foundations.md` — autonomy tiers, vocabulary; the trust-chain framing.
- `specs/operator-product/07-permissions-settings.md` — the front half of the trust chain; where the
  audited permission decisions originate; Settings is where the relocated Audit surface lands.
- `specs/operator-product/06-routines.md` — routine runs must appear in Audit (D-12 routine events).
- `specs/operator-product/04-projects.md` / `specs/operator-product/05-team.md` — project + teammate
  used for the `project` field and actor attribution / filters.

### Phase carryover (the event stream this phase formalizes — read for the data contract)
- `.planning/phases/04-activity-feed/04-CONTEXT.md` — Phase 4's decisions; explicitly defers the
  richer audit schema + export + retention (D10) to this phase, and the deliberate Activity/Audit
  split (do not repurpose Activity styling).
- `.planning/phases/03-permissions-autonomy/03-CONTEXT.md` — Phase 3 locked decisions; the gate write
  path + `audit_log`/`approval_queue` recording, "shaped for Phase 4/5 readers" — this is the write
  path D-01 reopens.

### Existing code to read (integration points)
- `src/db.ts` — `audit_log` table (~:332: action, detail, blocked, agent_id, chat_id, created_at — the
  schema to enrich), `approval_queue` (~:352: tier, mode_at_decision, status, decided_at, result —
  the who/when-approved + result source), `token_usage` (~:202: session_id, input/output_tokens,
  cost_usd, model is NOT a column here — note), and the `audit()` writer (~:3121). Also
  `addColumnIfMissing` + versioned `migrations/` dual-write pattern (P-4 drift rule).
- `src/security.ts` — `AuditAction` union (~:87: the event-type enum to extend for D-12) and the
  `audit()` / `AuditEntry` recording pipeline (the write path to instrument).
- `src/gate.ts` — `encodeDecision()` (~:169: the JSON detail format {tool, tier, mode, outcome,
  queueId} stored in `audit_log.detail`) and `summarize()` (~:135). Where permission-event detail is
  produced; the place to add tool/target/result/duration capture.
- `src/dashboard.ts` — `/api/audit` (~:3548) + `/api/audit/blocked` (~:3557) endpoints to enrich, and
  where `/api/audit/export` mounts (behind the same token gate); the config-change audit pattern
  ("each setter audits a config-change event").
- `web/src/pages/Audit.tsx` — the existing raw audit viewer to rework into the dense technical surface
  (AuditEntry interface, paginated load of 100, filter chips, agent filter).
- `web/src/lib/routes.ts` + `web/src/lib/vocabulary.ts` — nav/route table + `vocabKey` map; relocate
  `/audit` under Settings/admin (D-13); the `nav.audit` term Phase 4 created for the demoted route.
- `src/scheduler.ts` / routine-run code — source for D-12 routine events.
- `src/agent.ts` — Agent SDK `query()` turn boundary; the natural place to capture duration + resolve
  cost/model/session for D-11.
- `.planning/codebase/` — STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `audit_log` + `approval_queue` + `token_usage` tables — the existing data spine; this phase enriches
  `audit_log` and joins `token_usage` rather than inventing a new store.
- `audit()` writer in `src/db.ts`/`src/security.ts` — the single choke point to extend so new fields
  are captured everywhere events are recorded.
- `addColumnIfMissing` + versioned `migrations/` dual-write — the established, drift-safe way to add
  the new columns (must build for BOTH the in-memory test DB and the live store — P-4).
- `web/src/pages/Audit.tsx` + `PageHeader`/`PageState`/`Pill`/`lib/format.ts` — the surface and UI
  primitives to rework (dense/technical variant, distinct from Activity).
- Dashboard token gate + mutations kill-switch on `/api/*` — the export endpoint inherits this.

### Established Patterns
- Hono `/api/*` routes are token-gated; `/api/audit/export` follows the same chokepoint.
- SQLite single-connection, synchronous; schema changes go through dual-write migrations.
- Per-turn agent identity via `opts.agentRuntime` (no module globals) — any new capture on the turn
  boundary (duration/cost/model/session) must travel that same per-turn path.
- `detail` is currently a JSON-encoded free-text blob (capped 2000 chars); moving fields to real
  columns is the schema enrichment, with `detail` retained for anything unstructured.

### Integration Points
- `audit_log` schema enrichment + `audit()` writer instrumentation (the write-path reopening).
- New event-type emissions (auth/routine/error) at their source modules.
- `token_usage` ↔ `audit_log` cost/model/session resolution at the turn boundary.
- Enriched `/api/audit` read + new `/api/audit/export` write-out endpoint.
- Reworked, relocated Audit surface under Settings/admin in `routes.ts`/`vocabulary.ts`.
</code_context>

<specifics>
## Specific Ideas

- "Two screens, deliberately different" — Audit must stay dense/technical (monospace timestamps,
  expand-for-detail), visually unlike the operator Activity feed. Don't soften it into Activity.
- Honesty over polish: "complete, read-only" is a promise. If a field or category isn't captured,
  the surface must SAY so, not imply full coverage. This is success criterion 2, verbatim.
- Export is the answer to "what did the AI do with our data" — it must cover the full filtered set,
  not just what's on screen.
- Retention must be a stated number, not an unbounded silent log; but stating-and-not-deleting beats
  deleting, this phase. The disk-growth risk is acknowledged and the enforcement follow-up is logged.
- Every action should tie back to the permission rule that allowed it — the row detail should make the
  Permissions → action → Activity → Audit trace legible.
</specifics>

<deferred>
## Deferred Ideas

- **Automatic retention enforcement** — archive-then-prune (or roll-up) at the window boundary. Window
  is configured + stated this phase; the actual pruning/archiving job is the follow-up (D-31).
- **Enterprise compliance wrapper** — SSO-gated audit access, compliance export formats, and
  tamper-evidence / hash-chaining of the append-only log (spec's explicitly-deferred enterprise layer).
- **Per-project filtering** of Audit (spec mentions filter by project) — the `project` field is
  captured this phase, but a dedicated project filter UI can follow alongside Projects work; honest
  type chips + date range + search are the filter set this phase.
- Scheduled/automated exports — this phase ships on-demand export only.

None of the above are in this phase's scope — captured so they aren't lost.
</deferred>

---

*Phase: 05-audit-log*
*Context gathered: 2026-06-25*
