# Phase 5: Audit Log - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning
**Mode:** MVP (vertical slice)

<domain>
## Phase Boundary

Deliver the **admin-facing technical Audit log** — the dense, immutable, append-only, exportable
record of *every* event that closes the **Permissions → action → Activity → Audit** trace. This
formalizes the existing raw `/audit` page (`web/src/pages/Audit.tsx`) that Phase 4 deliberately left
in place for this phase. Audit is the technical back half of the trust chain whose operator-facing
front (Activity) shipped in Phase 4; both read the same `audit_log` event stream.

The governing promise (spec 08, "Hard rules"): **read-only and complete, or worthless.** Append-only,
no delete, no silent dropping. If a category is not captured, the surface must *say so* rather than
imply full coverage. An editable or lossy audit log provides negative trust.

**In scope this phase:**
- An enriched `audit_log` schema carrying real technical detail per event (see D-01).
- Genuine capture of all four event categories — Actions · Permissions · Auth · Errors (D-03).
- Integrity tracking so a failed audit write can never silently shrink the record (D-04).
- A bounded, **configurable, stated** retention window (D10): 90 days live → on-disk archive (D-05).
- Archived events queryable on demand and includable in export (D-06, D-08).
- Export of the audit log as **CSV and JSON**, reflecting the active filter, with an include-archived
  option, delivered as a browser download (D-08).
- A formalized **dense technical viewer** (search + type chips Actions/Permissions/Auth/Errors +
  date range + expandable per-row detail), relocated **off the main nav into Settings > Security**
  (D-09).

**Out of scope this phase (deferred):**
- The operator-facing **Activity** surface — shipped in Phase 4; Audit must look unlike it.
- Any change to the Phase 3/4 permission-gate or Undo logic — Audit is a read + capture + retention
  concern, not a decision path.
- The deferred **enterprise security wrapper** — SSO-gated access, compliance export formats,
  tamper-evidence/cryptographic chaining. Export is the *foundation* for this, not the wrapper itself.
- Access-control / "who is an admin" gating beyond the existing dashboard token — see Deferred.
</domain>

<decisions>
## Implementation Decisions

### Capture completeness (the "complete or worthless" promise)
- **D-01:** **Enrich the `audit_log` schema** with real columns rather than packing everything into
  the freeform `detail` field or deriving via fragile joins. Target columns (final set is
  researcher/planner's to confirm against sources): `event_type`, `target`, `project_id`, `outcome`,
  `duration_ms`, `cost_usd`, `session_id`, `model` — in addition to today's `agent_id`, `chat_id`,
  `action`, `detail`, `blocked`, `created_at`. Cleanest queries and export; existing rows that
  predate the new columns carry NULLs and **must be honestly shown as "not captured before vN"**, not
  silently treated as zero/empty.
- **D-02:** Schema change follows the project's **dual-write migration discipline** — both the
  `createSchema` block in `src/db.ts` (for the in-memory test DB) **and** a versioned `migrations/`
  file for the live store, never only one (the P-4 migration-drift landmine; mirrors how
  `approval_queue` was added at v1.2.3). Run `npm run migrate` before any restart.
- **D-03:** **Genuinely capture all four spec categories this phase — Actions · Permissions · Auth ·
  Errors.** Today only `message | command | delegation | kill | blocked | permission` action types
  are logged (`src/security.ts:87`) and config changes are audited (Phase 3 D-11). New write sites
  are in scope for: **Auth** events (login / token refresh / auth-source changes) and **Errors**
  (tool failures, recovered API timeouts). Routine runs (already flowing via `run_id`/`routine_id`)
  surface under Actions. The `AuditAction` union and the event-type taxonomy expand to match the
  filter chips — no chip should exist with nothing behind it, and no real event category should be
  absent without an explicit statement.
- **D-04:** **Fix the silent-drop in the audit writer.** `audit()` in `src/security.ts:109` currently
  swallows write failures (`catch { /* don't let audit failures block operations */ }`) — that is
  exactly the "silent dropping" the hard rule forbids. Keep operations **non-blocking**, but on a
  failed audit write, increment a failure counter / emit an `audit-write-failed` marker, and the
  Audit page shows a **prominent integrity-warning banner** ("integrity warning: N writes failed —
  this log may be incomplete") whenever the counter is non-zero. Honesty over the appearance of
  completeness.

### Retention (D10)
- **D-05:** Default window **90 days of full detail kept live**, then **roll older events into an
  on-disk archive** — **nothing is deleted.** A stated, configurable retention *policy* (not silent
  dropping). Disk-growth is bounded for the live table while the complete record is preserved.
- **D-06:** Archived events are **queryable on demand** — a date-range / "load archived" affordance
  reads the archive back into the viewer. The archive is not a dead end; the live view stays bounded
  and fast by default, the full history is still reachable.
- **D-07:** The window is **configurable in Settings > Security** *and* **stated inline in the Audit
  page header** (e.g. "Complete record — full detail for 90 days, archived after"). The promise is
  visible exactly where the data is read, not buried in config alone.

### Export
- **D-08:** Export produces a file in **both CSV and JSON**, reflects the **currently active
  filters / date range** (WYSIWYG — matches the investigative "what exactly did it do" use), offers
  an **include-archived** option, and is delivered as a **browser download**. This is the foundation
  for the deferred enterprise compliance-export work, not that work itself.

### Surface & placement
- **D-09:** **Relocate the Audit log off the main nav into a Settings > Security / admin section**,
  per spec 08 ("not in the operator's main nav … opened deliberately when something is wrong"). The
  formalized viewer is the **dense, technical** one: search + event-type chips
  (Actions · Permissions · Auth · Errors) + date range, dense rows with monospace timestamps, and
  an **expand-for-detail** row (tool, target, project, permission decision + who/when approved,
  result + duration + cost, session id + model). It must look deliberately *unlike* the Phase 4
  Activity surface.

### Claude's Discretion
- The exact final column set and types for the enriched `audit_log` (validated against real sources:
  `token_usage` already records cost/model/session; `approval_queue` holds the approval who/when;
  the permission decision is JSON-encoded in `audit_log.detail` today).
- The archive file format and on-disk location, and whether the prune/archive job runs on the
  **single existing scheduler** (it MUST NOT spawn a second cron path — see code_context / the
  CRON_IN_PROCESS landmine).
- Exact event-type taxonomy mapping (how `AuditAction` values map onto the four UI chips).
- The Settings > Security sub-route shape, page layout, empty/loading states, and pagination vs
  infinite scroll for the dense feed.
- Export endpoint shape (streaming vs in-memory) and filename/timestamp convention.
- Whether the demoted `/audit` route is removed entirely or kept as an internal redirect into
  Settings (resolve the Phase 4 `nav.audit` label accordingly).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Operator-product design contract
- `specs/operator-product/08-activity-audit.md` — THE design contract for this phase. The "Audit —
  the immutable record" section (purpose, Settings>Security placement, dense layout, row anatomy,
  "Records everything", the **Hard rules** on read-only/append-only/no-silent-drop/state-the-gaps,
  Export as compliance foundation, and **D10** retention). Read in full.
- `specs/operator-product/07-permissions-settings.md` — the front half of the trust chain; the tier
  model and the permission decision each audit row ties back to. Settings is where retention config
  and the relocated Audit entry land.
- `specs/operator-product/01-foundations.md` — autonomy tiers by reversibility/externality and the
  product vocabulary; grounds the permission_decision detail shown per row.
- `specs/operator-product/06-routines.md` — routine runs ("6:00pm routine") appear in the audit feed.
- `specs/operator-product/05-team.md` — teammate roster for the actor badge / `agent_id` attribution.
- `specs/operator-product/README.md` §D10 — decision register entry for retention.

### Phase 3 / Phase 4 carryover (the event stream this phase reads + enriches)
- `.planning/phases/04-activity-feed/04-CONTEXT.md` — Phase 4 explicitly deferred this phase's work
  (richer schema, CSV/JSON export, retention D10) and demoted `/audit` to its own technical label
  while keeping `Audit.tsx` "for Phase 5 to formalize". The data contract Activity reads is the same
  one Audit enriches.
- `.planning/phases/03-permissions-autonomy/03-CONTEXT.md` — the permission gate + `approval_queue`
  were explicitly "shaped for Phase 4/5 readers"; defines the decision-recording pipeline Audit reads.

### Existing code to read (integration points)
- `src/db.ts` — `audit_log` table (~:332: currently `agent_id, chat_id, action, detail, blocked,
  created_at` + indexes) and `getAuditLog` / `getAuditLogCount` / `getRecentBlockedActions`; the
  `approval_queue` table (~:352) for approval who/when. The schema this phase enriches (D-01/D-02).
- `src/security.ts` — `AuditAction` union (:87), `AuditEntry`, `audit()` (:109, the silent-catch to
  fix per D-04), `setAuditCallback`. The capture pipeline that must expand to all four categories.
- `src/gate.ts` — `encodeDecision()` (:169, the JSON in `audit_log.detail` carrying tool/tier/mode/
  outcome) and `summarize()` (:135). Read to decode permission rows into the enriched columns.
- `src/dashboard.ts` — `/api/audit` + `/api/audit/blocked` (~:3545) and the config setters that audit
  a config-change event (~:3479, D-11). Where new audit/export/retention endpoints mount, behind the
  same dashboard token + mutations kill-switch.
- `web/src/pages/Audit.tsx` — the existing raw viewer (currently `all | blocked` + per-agent filter);
  the surface to **formalize** into the dense technical viewer and **relocate** to Settings>Security.
- `web/src/lib/routes.ts` + `web/src/lib/vocabulary.ts` — the nav/route table and the `nav.audit`
  label Phase 4 created; edit to remove Audit from main nav and mount it under Settings (D-09).
- `token_usage` table (referenced in CLAUDE.md `convolife`) — already records cost / model / session /
  duration-relevant data; the source to join/copy for D-01's cost/model/session columns.
- `.planning/codebase/` — STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS.

### Operational landmines (memory)
- **Single scheduler / CRON_IN_PROCESS** — the aos service is the single cron runner; any
  retention prune/archive job must hook the existing scheduler, never spawn a second in-process timer
  (double-fire risk). See `aos-single-scheduler-cron-in-process` memory.
- **Migration discipline** — `npm run migrate` before restart; dual-write schema (createSchema +
  versioned migration) or the test DB and live store drift (P-4). See
  `claudeclaw-deploy-migration-and-worktree` memory.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `audit_log` table + `getAuditLog`/`getAuditLogCount`/`getRecentBlockedActions` in `src/db.ts`: the
  read source to enrich and query; export reads from the same accessors.
- `src/security.ts` `audit()` + `setAuditCallback` + `AuditAction`: the single capture chokepoint —
  expanding categories (D-03) and fixing the silent-catch (D-04) happen here, once.
- `src/gate.ts` `encodeDecision()`: existing JSON encoding of the permission decision in `detail`;
  the decoder for the permission_decision column / expandable row detail.
- `token_usage` table: already holds cost / model / session / context data per turn — the source for
  D-01's `cost_usd` / `model` / `session_id` rather than re-capturing them.
- `web/src/pages/Audit.tsx` + `PageHeader`/`PageState`/`Pill`/`lib/format` components: the page to
  formalize; reuse the existing dashboard component kit for the dense viewer.

### Established Patterns
- Hono `/api/*` routes are token-gated and inherit the mutations kill-switch; new audit/export/
  retention endpoints follow the same chokepoint in `src/dashboard.ts`.
- SQLite single-connection, synchronous; `addColumnIfMissing` + versioned `migrations/` dual-write is
  the required path for the schema enrichment (D-02).
- Nav/route/vocab is a single source of truth in `web/src/lib/routes.ts` + `vocabulary.ts` — the
  relocation to Settings>Security edits this table.
- Audit honesty rules already carried in Phase 4 (D-05: never fabricate, never hide a row) extend
  here as the no-silent-drop integrity banner.

### Integration Points
- Enriched `audit_log` schema (createSchema + migration) — D-01/D-02.
- Expanded capture in `src/security.ts` + new Auth/Error write sites across the codebase — D-03.
- Audit-write failure counter + integrity banner endpoint/field — D-04.
- Retention prune/archive job on the **existing scheduler** + an archive store/format — D-05/D-06.
- Retention config field in Settings>Security + header line — D-07.
- `/api/audit/export` (CSV + JSON, filter-aware, include-archived) → browser download — D-08.
- Audit viewer relocated under Settings>Security; main-nav `nav.audit` removed/redirected — D-09.
</code_context>

<specifics>
## Specific Ideas

- "Complete, read-only, or worthless." The header promise is a contract — the integrity banner (D-04)
  and the "not captured before vN" NULL handling (D-01) exist so the log never *implies* coverage it
  doesn't have.
- "Records everything, including the boring and the failed" — session refreshes, config changes,
  recovered API timeouts, held permission requests. The value is precisely the events Activity hides.
- Two screens, deliberately different: the dense monospace technical viewer must not look like the
  Phase 4 Activity feed. Monospace timestamps precise to the second signal "technical."
- Each row ties back to the permission rule that allowed it — the expandable detail closes the
  Permissions → action → Activity → Audit trace visibly.
- Retention archives, it doesn't shred: "nothing lost" was the explicit call. Archive stays queryable
  and exportable, not a write-only safe.
</specifics>

<deferred>
## Deferred Ideas

- **Enterprise security wrapper** — SSO-gated audit access, compliance-specific export formats,
  tamper-evidence / cryptographic hash-chaining of rows. Export this phase is the foundation; the
  wrapper is later (spec 08 explicitly defers it).
- **Admin vs operator access control** — "who counts as an admin" beyond the existing dashboard
  token. This phase relies on the current token gate + Settings>Security placement; real role-based
  access is a later concern (likely with Billing/licensing or the enterprise wrapper).
- **Per-project filtering of Audit** — spec mentions filter by project; `project_id` is captured
  this phase (D-01) but a dedicated project filter chip can fold in with Projects work.
- **Configurable archive destinations** (external storage, log shipping) — local on-disk archive
  only this phase.

None of the above are in this phase's scope — captured so they aren't lost.

</deferred>

---

*Phase: 05-audit-log*
*Context gathered: 2026-06-24*
