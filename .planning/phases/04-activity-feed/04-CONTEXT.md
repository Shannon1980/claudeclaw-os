# Phase 4: Activity Feed - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning
**Mode:** MVP (vertical slice)

<domain>
## Phase Boundary

Deliver the **operator-facing Activity feed** — a reverse-chronological, plain-language view of what
the team did, attributed by teammate, with each item tagged **Ran on its own** / **You approved** /
**Needs you**, and **Undo** for reversible actions. It is the back-half operator view of the trust
chain whose front half (the permission gate + approval queue) shipped in Phase 3.

Activity is a **curated read over the same event stream Phase 3 writes** — `audit_log` permission
decisions + the `approval_queue` table. No new decision/write path on the gate side; the new work is
the read-side derivation, the plain-language rendering, the surface/UI, the daily Summarize digest,
and the **Undo** machinery (the one genuinely new capability — a safe *inverse* of an action, where
Phase 3 only built forward *replay*).

**In scope this phase:**
- A new `/activity` route + `Activity.tsx` operator surface (curated, plain-language), visually
  distinct from the technical audit view.
- Reverse-chronological feed grouped by day, reading `audit_log` + `approval_queue`.
- Per-row plain-language description, teammate attribution (color dot + name), and a tag
  (Ran on its own / You approved / Needs you).
- Filter chips: All · Ran on its own · Needs you · per-teammate.
- A header **Summarize** action (LLM daily digest).
- **Undo** for reversible actions via an allowlist of tool families (drafts, meetings, labels);
  honest "no undo" for everything else; Tier 4 never undoable (D9).
- Nav item for Activity **and** a one-click entry point from Home.

**Out of scope this phase (deferred):**
- The dense, immutable, exportable **technical Audit log** surface + richer audit schema + CSV/JSON
  export + retention window (D10) — Phase 5 (it formalizes the existing raw `/audit` page).
- Any change to the Phase 3 permission gate / audit *write* path — Activity derives everything
  read-side; the gate stays as shipped.
- A general/registerable reversible-action framework — this phase ships a bounded allowlist only.
</domain>

<decisions>
## Implementation Decisions

### Surface & navigation
- **D-01:** Build a **new `/activity` route with a new `Activity.tsx`** page — operator-facing,
  curated, plain-language. Do **not** repurpose the existing `Audit.tsx`/`/audit` page; that stays as
  the raw technical view for Phase 5 to formalize. The spec requires the two surfaces look unlike each
  other so nobody confuses them.
- **D-02:** **Re-point `vocabKey: nav.activity`** (currently on the `/audit` route in
  `web/src/lib/routes.ts`) to the new `/activity` route. The existing `/audit` route gets its own
  builder/technical label (e.g. an `nav.audit` vocab key) so it no longer masquerades as Activity.
  Resolve this naming collision as part of this phase.
- **D-03:** Activity is reachable **both** from a sidebar nav item **and** via a one-click entry point
  from Home (the spec's "one click from Home" daily-glance affordance). Exact Home affordance
  (a card / link / mini-preview) is Claude's discretion.

### Plain-language rendering
- **D-04:** Produce row descriptions with a **render-time tool→phrase map** — a deterministic mapping
  from tool name + key params to a plain phrase ("Sent follow-up to 3 leads"). Extend the existing
  `summarize()` helper pattern in `src/gate.ts` (already used for queue summaries) rather than calling
  an LLM per row. No new write path, no per-row LLM cost, fully testable.
- **D-05:** Unmapped tools render an **honest generic phrase** ("Ran <tool>" / "Used Gmail") with the
  technical detail available behind View. **Never fabricate** a description and **never hide** a real
  row — completeness over polish (matches the audit honesty rules carried from Phase 3 / spec 08).

### Tags (Ran on its own / You approved / Needs you)
- **D-06:** Derive tags **read-side** from existing data, no explicit tag column and no re-opening the
  Phase 3 write path:
  - **Needs you** (amber) = `approval_queue.status = 'pending'`.
  - **You approved** (green) = `approval_queue.status = 'approved'` (an action that went through the
    queue or inline ask and was approved).
  - **Ran on its own** (neutral) = a permission decision in `audit_log` that was allowed and never
    queued.
  - Denied / expired held items surface as their own honest state ("Skipped: waiting on your ok" /
    expired), not silently dropped.

### Undo (D9)
- **D-07:** Implement Undo as a **bounded allowlist of reversible tool families**, mirroring the
  Phase 3 `src/replay-executor.ts` allowlist + honest-rejection pattern. Each allowlisted family maps
  the captured `tool_input` (already stored on the approval/audit record for replay) to a known **safe
  inverse** operation. Anything not on the allowlist shows **no undo**.
- **D-08:** Target inverse operations: **drafts** (delete the created draft), **meetings**
  (cancel/decline the created event), **labels** (remove the applied label). **Phase floor / must-have:
  at least one of these works end-to-end** (whichever is cleanest in this codebase, likely label or
  draft); the others may ship as honest "no undo" if their inverse proves hard, and are then captured
  as deferred follow-ups — not faked.
- **D-09:** **Permission tier ↔ undo-ability are the same axis** (carried from Phase 3 / spec D9).
  Tier 4 (irreversible: money movement, contract signing, permanent deletion, external sends) shows
  **no undo, ever**. Undo never silently no-ops: it either performs a real inverse or is absent.

### Summarize
- **D-10:** The header **Summarize** daily-digest action is **in scope this phase**. It produces an
  LLM summary of a day's activity. This is the one acceptable on-demand LLM use on this surface
  (explicitly operator-invoked, not per-row). Exact prompt/model/grouping is Claude's discretion;
  reuse existing agent/LLM plumbing rather than a new path.

### Filters
- **D-11:** Ship the full spec chip set: **All · Ran on its own · Needs you · per-teammate**. The
  per-teammate chips use `agent_id` from `audit_log`/`approval_queue` joined to the existing team
  roster for color + name. All filtering is read-side.

### Claude's Discretion
- Whether Activity reads via a new `/api/activity*` endpoint (curated join over `audit_log` +
  `approval_queue`) vs reusing/extending existing audit/approvals endpoints — researcher/planner call.
- Day-grouping boundaries (timezone), empty-state copy, pagination/infinite-scroll for the feed.
- The exact Home entry-point affordance (card vs link vs mini-preview).
- The Summarize prompt, model, and digest format.
- The precise `vocabKey` naming for the demoted `/audit` route.
- Which of drafts/meetings/labels is the "first" guaranteed-working undo.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Operator-product design contract
- `specs/operator-product/08-activity-audit.md` — THE design contract for this phase: Activity layout
  (header + "What your team did" subtitle + Summarize action), filter chips, per-row anatomy
  (teammate color dot, plain-language action, who+when, the tag, View/Review/Undo), the Undo (D9)
  rule (tier ↔ undo-ability), and the explicit split from the technical Audit surface (Phase 5).
- `specs/operator-product/07-permissions-settings.md` — the front half of the trust chain; the tier
  model, the "Needs you" / "You approved" / "Ran on its own" semantics, and why the tags matter.
- `specs/operator-product/01-foundations.md` — autonomy tiers by reversibility/externality (the D4
  source feeding D9's tier↔undo axis), vocabulary.
- `specs/operator-product/03-home.md` — Home, the one-click entry point into Activity (D-03).
- `specs/operator-product/05-team.md` — teammate roster used for per-teammate attribution + colors.
- `specs/operator-product/06-routines.md` — routine runs appear in Activity ("6:00pm routine").

### Phase 3 carryover (the event stream Activity reads — read for the data contract)
- `.planning/phases/03-permissions-autonomy/03-CONTEXT.md` — Phase 3 locked decisions; the approval
  queue + audit recording were explicitly "shaped for Phase 4/5 readers".
- `.planning/phases/03-permissions-autonomy/03-04-SUMMARY.md` — what the operator-facing slice
  shipped (`/api/approvals`, the "Needs you" Home surface, replay executor).

### Existing code to read (integration points)
- `src/db.ts` — `audit_log` table (~:332: action, detail, blocked, agent_id, chat_id, created_at) and
  `approval_queue` table (~:352: tool_name, tool_input, tier, mode_at_decision, summary, status,
  decided_at, result, run_id, routine_id). The two read sources for the feed.
- `src/gate.ts` — `summarize()` (plain-language helper to extend for D-04) and `encodeDecision()` /
  decision detail format stored in `audit_log.detail` (tool/tier/mode/outcome). Read to decode rows.
- `src/security.ts` — `audit()` / `AuditAction` (`'permission'` and the other action types); the
  decision-recording pipeline. Read-only for Activity.
- `src/approval-queue.ts` — `listPending` / `approve` / `deny` and the queue state machine; Activity's
  "Review" on held items reuses this.
- `src/replay-executor.ts` — the allowlist + honest-rejection pattern that Undo (D-07) mirrors as an
  *inverse* executor.
- `src/dashboard.ts` — Hono `/api/*` routes (existing `/api/approvals*`); where a new `/api/activity*`
  (and an undo endpoint) would mount, behind the same token gate + mutations kill-switch.
- `web/src/lib/routes.ts` — the nav/route table + `vocabKey` mapping to edit (D-01/D-02).
- `web/src/lib/vocabulary.ts` — `nav.activity` term + where a new `nav.audit` term lands.
- `web/src/pages/Audit.tsx` — the existing raw audit viewer (the surface NOT to repurpose; Phase 5).
- `web/src/pages/Home.tsx` — the existing `NeedsYouCard` and where the Activity entry-point lands.
- `web/src/components/` — `Pill.tsx` (tags), `ConfirmModal.tsx` (destructive undo confirm),
  `PageHeader.tsx` / `PageState.tsx`, plus `lib/format.ts` (relative time) to reuse.
- `.planning/codebase/` — STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `audit_log` + `approval_queue` tables: the complete read source — no new write path needed for the
  feed itself (Undo is the only new write).
- `src/gate.ts` `summarize()`: existing plain-language helper for queue items; extend into the
  render-time tool→phrase map (D-04).
- `src/replay-executor.ts`: allowlist + honest-rejection template for the Undo *inverse* executor (D-07).
- `src/approval-queue.ts` `listPending/approve/deny`: powers "Review" on held items in the feed.
- UI: `Pill.tsx` (status tags), `ConfirmModal.tsx` (undo confirmation), `PageHeader.tsx`,
  `PageState.tsx`, `lib/format.ts` (relative timestamps), team roster colors.

### Established Patterns
- Hono `/api/*` routes are token-gated and inherit the mutations kill-switch; new `/api/activity*` +
  undo endpoint follow the same chokepoint (see `src/dashboard.ts`).
- SQLite single-connection, synchronous; `addColumnIfMissing` + versioned `migrations/` dual-write —
  required ONLY if Undo needs to persist an "undone" marker; prefer read-side derivation otherwise.
- Per-turn agent identity via `opts.agentRuntime` (not globals); any Undo that re-invokes a tool must
  travel the same per-turn/scrubbed-env path the gate established.
- Nav/route/vocab is a single source of truth in `web/src/lib/routes.ts` + `vocabulary.ts`.

### Integration Points
- New `/activity` route + `Activity.tsx`; re-point `nav.activity`, demote `/audit` to its own label.
- New `/api/activity*` read endpoint (curated join over `audit_log` + `approval_queue`).
- New undo endpoint → an allowlisted inverse executor (sibling of `replay-executor.ts`).
- Home entry-point linking into `/activity`.
</code_context>

<specifics>
## Specific Ideas

- "Two screens, deliberately different" — Activity (operator, plain language) must look unlike the
  technical Audit (Phase 5). Don't let the new feed inherit the dense monospace audit styling.
- Row example to aim for: teammate color dot + "Sent follow-up to 3 leads" + "Comms · 9:12am" + a
  green/neutral/amber tag + View/Review/Undo.
- "Ran on its own" is the accountability tag that lets an operator flip to Autonomous without anxiety —
  it's the emotional point of the whole surface; make it legible.
- A held "Skipped: waiting on your ok" row is the system working, not an error — present it that way.
- Undo honesty: an Undo button must perform a real inverse or not exist. No mark-as-undone theater.
</specifics>

<deferred>
## Deferred Ideas

- The dense, immutable, exportable **technical Audit log** + richer schema + CSV/JSON export + bounded
  configurable retention window (D10) — Phase 5 (formalizes the existing raw `/audit` page).
- A general, registerable reversible-action framework so future tools declare their own inverses —
  later; this phase ships a bounded allowlist only.
- Any drafts/meetings/labels undo target that proves to have no clean inverse this phase ships as
  honest "no undo" and is logged here for a follow-up.
- Per-project filtering of Activity (spec mentions filter by project) — fold in with Projects work;
  per-teammate is the attribution filter this phase.
- Richer Summarize (per-teammate / per-project digests, scheduled summaries) — beyond the single
  on-demand daily digest shipping this phase.

None of the above are in this phase's scope — captured so they aren't lost.
</deferred>

---

*Phase: 04-activity-feed*
*Context gathered: 2026-06-24*
