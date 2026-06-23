# Phase 3: Permissions & Autonomy - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the autonomy engine and its operator controls: classify every external/irreversible
Agent SDK tool call into one of the four D4 reversibility tiers, gate it against a global
autonomy mode plus per-action overrides at the tool-call layer, and queue gated actions for
one-tap approval. Plus the Permissions section of the Settings screen.

**In scope:**
- Deterministic tool→tier classification registry (D4 model is locked; this phase classifies
  the concrete tools/MCP methods the engine exposes).
- The permission gate at the Agent SDK tool-call layer (`canUseTool`), returning proceed /
  queue-for-approval / block.
- Global autonomy mode (Cautious / Balanced / Autonomous) + per-action overrides
  (Always / Ask first), with Tier 4 locked.
- A `gated_action` queue (table + API): prepared payload persisted, surfaced as one-tap
  approvals.
- Surfacing: back Home's existing `NeedsYouCard` from the queue + Slack interactive
  Approve/Deny buttons.
- Permissions UI in `Settings.tsx` (mode dial + override list with locked rows).

**Out of scope (deferred to their owning phases):**
- Per-routine autonomy context (D7) → Routines phase.
- Memory-fed permission defaults (preference-level rules) → Memory phase.
- The full Activity feed / held-entry view and Audit technical record → Phase 4 (Activity &
  Audit). This phase writes to the existing `audit_log` table but does not build those screens.

</domain>

<decisions>
## Implementation Decisions

### Approval flow architecture
- **D-01 (Prepare-then-requeue):** When a gated tool call is reached mid-task, the gate denies
  the specific call via `canUseTool`. The assistant records the prepared action (tool name +
  input payload + context) as a queued `gated_action` and ends the turn cleanly. Nothing blocks
  the Claude subprocess waiting for approval. Survives restarts.
- **D-02 (Replay stored payload exactly):** On approval, the engine re-executes the exact stored
  tool name + input args directly — no model round-trip. Honors the spec's "approve this
  ready-to-send thing, not go do it from scratch." The model only re-enters if the direct
  re-execution fails.
- **D-03 (Continue non-gated work, queue each gated action):** The gate denies only the specific
  call; the assistant keeps doing other allowed work in the same turn and queues each gated
  action it reaches. A single task can produce multiple "Needs you" items, approved
  independently.

### Where gated actions surface
- **D-04 (Queue table backs Home + Slack):** Build a `gated_action` queue table + API. Point the
  existing `NeedsYouCard` (web/src/components/DailyLoop, consumed by Home.tsx) at this queue so
  approvals appear where the operator already looks. Activity (Phase 4) later reads the same
  table.
- **D-05 (Slack interactive buttons):** When an action queues, push a Slack Block Kit message
  with Approve/Deny buttons, handled over the existing Socket Mode connection. True one-tap from
  chat (Slack is the active transport). This satisfies PERM-04's one-tap approval bar.

### Tier classification mechanism
- **D-06 (Deterministic tool→tier map):** A hardcoded registry maps each concrete tool/MCP
  method to a tier. Auditable, zero latency, zero cost, and an irreversible action can never be
  silently misjudged. No LLM-in-the-loop for classification.
- **D-07 (Per-method granularity, fail-safe default):** Classify at the individual tool/MCP
  method level (e.g. `qbo_sales_create_payment_link` → Tier 4, QuickBooks read/report methods →
  Tier 1), with a per-server fallback default. Any tool/method not explicitly mapped floors at
  Ask-first (highest gated treatment). Required because one server (QuickBooks) spans Tier 1 and
  Tier 4.

### Tier-4 locked actions (irreversible — cannot be set to Always in any mode)
- **D-08:** The locked Tier-4 set for the current integrations is:
  - Send money / invoicing (QuickBooks): create/send invoice, create/send payment link,
    transaction import.
  - Sign / commit to contracts (DocuSign): signature requests, contract execution.
  - Permanent delete: QuickBooks delete invoice/estimate, calendar delete_event, deleting
    files/labels.
  - Make purchases: any tool that buys/spends externally (locked preemptively even before
    purchasing tools are wired).
- Tier 3 "reaches an external person" actions (Gmail send, Slack send to external, external
  calendar invites) are gated by mode but NOT locked — they remain overridable per spec.

### Claude's Discretion
- Storage shape of the tier registry (code module vs. config), the `gated_action` table schema,
  and the `canUseTool` wiring into `src/agent.ts` (which currently runs
  `permissionMode: 'bypassPermissions'` with no `canUseTool` callback — reconciling the gate
  with bypass mode is an implementation decision for research/planning).
- Where mode-change config events are recorded (existing `audit_log` / `dashboard_settings`
  tables are available).
- Exact Slack Block Kit layout and action-handler routing.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Permission / autonomy model (D4)
- `specs/operator-product/07-permissions-settings.md` — Full Permissions UI + the resolved D4
  four-tier table, mode definitions, locked-rail rules, the engine outcomes (proceed / queue /
  block), and the "Ask first is cheap" prepared-and-queued model.
- `specs/operator-product/01-foundations.md` §"Autonomy / permission model" + §"Trust chain" —
  Cross-cutting statement that the gate sits at the Agent SDK tool-call layer, tier-tracks
  undo-ability, and feeds the Permissions → action → Activity → Audit chain.

### Adjacent surfaces (for integration, not to build here)
- `specs/operator-product/03-home.md` §"Needs you" — How queued approvals are meant to surface
  on Home (the `NeedsYouCard` target).
- `specs/operator-product/08-activity-audit.md` — Downstream consumer of the gate's decisions and
  queue (Phase 4); this phase writes to the shared event/`audit_log` record it will read.
- `specs/operator-product/README.md` §vocabulary — Operator-facing wording: no "agent", "MCP",
  "tool", "permission prompt" in user copy.

### Requirements / roadmap
- `.planning/REQUIREMENTS.md` — PERM-01..04.
- `.planning/ROADMAP.md` §"Phase 3: Permissions & Autonomy" — Goal + 4 success criteria + Mode: mvp.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/warroom-tool-policy.ts` — Closest existing tool-gating pattern: builds
  allowedTools/disallowedTools/MCP allowlists with a default-deny side-effect set and per-agent
  opt-in. The tier registry can mirror its structure (hardcoded safety list + extensible map).
- `web/src/components/DailyLoop.tsx` (`NeedsYouCard`) — Already rendered on `Home.tsx` from
  `data.needsYou`; repoint at the new queue rather than building new approval UI.
- `web/src/pages/Settings.tsx` — Exists (theme + kill-switch oriented); add the Permissions
  section here. `Toggle`, `Pill`, `ConfirmModal`, `Modal` components available.
- `audit_log` and `dashboard_settings` tables already exist in `src/db.ts` — reuse for
  mode-change logging and persisting autonomy mode / overrides.
- Slack Socket Mode transport (`src/slack-bot.ts`) — already connected; extend with a Block Kit
  interactive action handler for Approve/Deny.

### Established Patterns
- Main agent (`src/agent.ts`) runs `query()` with `permissionMode: 'bypassPermissions'` and
  `allowDangerouslySkipPermissions: true`, and currently has NO `canUseTool` callback. The gate
  must reconcile with this — introducing `canUseTool` for tier gating while keeping the bot
  non-prompting for allowed tiers. This is the central wiring problem.
- Config/state persisted in SQLite via `src/db.ts`; field-level AES-GCM encryption is in play
  for memory (not necessarily for settings).
- No `needs_you` / approval / pending-action table or endpoint exists yet — `NeedsYouCard` is
  currently fed by some other summary source; the real gated-action queue is new in this phase.

### Integration Points
- `src/agent.ts` `query()` options → add `canUseTool` (the gate).
- New `gated_action` table in `src/db.ts` + API route in the Hono server (`src/dashboard.ts`).
- `NeedsYouCard` data source → new queue endpoint.
- `src/slack-bot.ts` → interactive Block Kit Approve/Deny + action callback.
- Tier-decision events → existing `audit_log`.

</code_context>

<specifics>
## Specific Ideas

- Unknown/unmapped tools must fail safe to Ask-first — an operator should never discover a new
  irreversible integration auto-ran because it wasn't in the registry yet.
- The single visibly-locked Tier-4 row in the UI is the trust signal (per spec) — render it
  non-editable with a lock icon, not just disabled.
- Approval re-execution must preserve the reviewed payload byte-for-byte (e.g. the exact drafted
  email body), so the queue stores the serialized tool input, not a regenerated version.

</specifics>

<deferred>
## Deferred Ideas

- **Per-routine autonomy context (D7)** — Routines pass their own autonomy context into the same
  gate. Belongs to the Routines phase; the gate should be designed to accept an optional
  per-invocation autonomy context, but wiring routines into it is out of scope here.
- **Memory-fed permission defaults** — Preference-level rules ("approve client-facing work before
  sending") informing gate defaults. Belongs to the Memory phase.
- **Activity feed + Audit screens** — The operator Activity view (held entries, "Ran on its own"
  tags, Undo affordances) and the admin Audit record are Phase 4. This phase only emits the
  underlying events/records.
- **Billing/Usage screen** — `07-permissions-settings.md` folds billing into Settings, but it is
  not part of the PERM-01..04 scope; defer to a billing phase.

</deferred>

---

*Phase: 03-permissions-autonomy*
*Context gathered: 2026-06-23*
