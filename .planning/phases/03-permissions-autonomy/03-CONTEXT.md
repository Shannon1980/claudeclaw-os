# Phase 3: Permissions & Autonomy - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** MVP (vertical slices)

<domain>
## Phase Boundary

Deliver the **autonomy dial + the four-tier permission gate** that checks every external/irreversible
tool call before it runs, plus a **"Needs you" approval queue** for gated actions. This is the front
half of the trust chain.

Concretely:
- A global autonomy mode — **Cautious / Balanced / Autonomous** — that changes what the team does
  unprompted, defined in terms of tiers (PERM-01).
- Per-action overrides moving individual Tier 2/3 capabilities between **Always** and **Ask first**
  (PERM-02).
- **Tier 4 (irreversible) actions locked to Ask-first** — cannot be set to Always in any mode, shown
  with a lock (PERM-03).
- A gated action is **fully prepared, then queued as a "Needs you" item** for one-tap approval
  (PERM-04).
- The gate is enforced at the **Agent SDK tool-call layer** for all runs (chat + routines + missions),
  and every decision is recorded in the audit pipeline.

**In scope:** the four-tier classification of this project's concrete tools; the gate engine
(`canUseTool` interceptor replacing `bypassPermissions`) with proceed / queue / deny outcomes;
the global mode + per-action override data model + Permissions settings UI (the "dial, not a checkbox
wall"); the **approval-queue data model + a minimal "Needs you" one-tap-approve surface on the existing
Home page**; recording each decision via the existing `audit()` pipeline; routines passing their
stored per-routine autonomy (Phase 2 D-07) into the same gate.

**Out of scope this phase (deferred):**
- The rich **Activity held-entry view** + "Ran on its own"/"You approved" feed — Phase 4 (reads the
  same approval queue/events this phase writes).
- The full immutable/exportable **Audit log** surface + its richer schema — Phase 5 (this phase records
  decisions via the existing `audit()`/`audit_log`; extend minimally only as needed).
- **Connected tools, Notifications, Billing** sections of Settings (spec 07 lists them, but Billing is
  Phase 8; tools/notifications are conventional and not gated by PERM-01..04). Build only the
  Permissions section of Settings this phase.
- Memory-derived preference rules feeding defaults — Phase 6.
</domain>

<decisions>
## Implementation Decisions

### Tier 4 — locked, irreversible (PERM-03)
- **D-01:** Locked Tier 4 = **money movement** (QuickBooks pay / pay-invoice, payment links that move
  money, purchases), **contract signing** (e.g. DocuSign-style), and **permanent data deletion**.
  These can never be set to Always, in any mode — always ask, shown with a lock icon.
- **D-02:** Everything else that reaches outside — Slack/Gmail external send, calendar create/move with
  external attendees, public posts — is **Tier 3** (asked in Cautious/Balanced, auto in Autonomous with
  notify-after), **not locked**. Tier 2 = low-stakes external (labels, Drive save, internal-only
  meetings). Tier 1 = read & prepare (research, read, draft, summarize, internal tasks) — always silent.
- **D-03:** The concrete tool→tier mapping for every tool the engine exposes (built-ins, Bash, MCP
  tools like QuickBooks/Gmail/Calendar/Drive/Slack, schedule/mission CLIs) is the planner/researcher's
  enumeration job, classified per D-01/D-02. Unknown/unclassified tools default to the **safe side**
  (treat as at least Tier 3 — ask — never silently auto-run an unclassified external tool).

### Interactive-chat gate behavior
- **D-04:** **Inline in chat, queue for background.** When a Tier 3/4 action arises during a live chat
  turn, the assistant **asks inline** ("Send this to X? yes/no") for instant approve/deny and runs the
  prepared action on yes. When the action arises in a **routine/mission/background** run, it is **queued
  as a "Needs you" item** (no one is watching). Matches where the operator's attention is.
- **D-05:** Tier 4 inline approval is **per-instance only** — approving once never sets it to Always
  (the lock holds). Approving means "approve this ready-to-send thing," not "go do it from scratch."

### Enforcement scope + approval surface
- **D-06:** Gate **all runs** — chat, routines, and missions — from the start (single gate, one policy).
  Routines pass their stored autonomy (Phase 2 `unattended` | `queue_approval`) into the same gate.
- **D-07:** Build the **approval-queue data model** (a persisted "Needs you" item = the prepared tool
  call + params + tier + originating run, with pending/approved/denied/expired state) and a **minimal
  one-tap approve/deny surface on the existing Home page**. The rich held-entry Activity view is Phase 4
  and reads this same queue.
- **D-08:** On **one-tap approval**, the prepared action is **replayed** (the captured tool call runs
  with its stored params). Exact replay mechanism (re-invoke the tool directly vs resume the agent
  turn) is the researcher's call — but the queued item must carry enough to execute without redoing
  the agent's reasoning.

### Gate enforcement mechanism
- **D-09:** Implement the gate as a **`canUseTool` callback on the Agent SDK `query()` call** (replacing
  `permissionMode: 'bypassPermissions'` in `src/agent.ts`). The callback classifies the tool → tier,
  evaluates against the current mode + per-action overrides, and returns **proceed / queue ("Needs
  you") / deny**. The researcher confirms the exact SDK affordance (`canUseTool` vs `PreToolUse` hooks
  vs `allowedTools`) against the installed `@anthropic-ai/claude-agent-sdk` version, but the intent is
  locked: a real interception point at the tool-call layer, not advisory.
- **D-10:** **Every decision is recorded** via the existing `audit()` pipeline / `audit_log` table
  (action, detail, blocked, agent_id, chat_id). Record the tool, resolved tier, mode, and outcome in
  `detail`. Extend the `audit_log` schema only minimally if needed; the rich, exportable Audit surface
  is Phase 5.

### Defaults & state
- **D-11:** Default mode is **Balanced** on first run (spec). Mode changes are themselves logged to the
  audit pipeline as config events. The global mode is **team-wide** (it governs "what the team does"),
  not per-teammate.

### Claude's Discretion
- The exact `canUseTool` vs hooks decision and the replay-on-approval mechanism (D-08/D-09) — researcher.
- The override list granularity (the spec shows ~6 capability rows: research/prepare, draft, send,
  book meetings, post publicly, send money-locked) — follow the spec's capability-level rows unless the
  tool enumeration suggests otherwise.
- Whether mode/override config lives in `dashboard_settings` vs a dedicated table; how the safe-default
  for unclassified tools is encoded.
- "Needs you" item expiry/TTL semantics and copy.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Operator-product design contract
- `specs/operator-product/07-permissions-settings.md` — THE design contract: the dial (Cautious/
  Balanced/Autonomous), the resolved **four-tier model (D4)** with default behavior per tier, locked
  Tier 4, per-action overrides, "Ask first is cheap" (prepared + queued), the engine (consulted at the
  Agent SDK tool-call layer; proceed/queue/block; recorded in Audit), and Settings structure.
- `specs/operator-product/01-foundations.md` — autonomy tiers by reversibility/externality (the D4
  source), distribution + vocabulary.
- `specs/operator-product/06-routines.md` — per-routine autonomy (D7) that this gate consumes; Phase 2
  stores `autonomy` ∈ {unattended, queue_approval} on the routine.
- `specs/operator-product/08-activity-audit.md` — Phase 4/5 surfaces that READ this phase's decisions
  and approval queue ("Needs you" held entries, "Ran on its own"/"You approved" tags, Audit record with
  "the rule that decided it"). Keep the queue + audit records shaped to be readable there.
- `specs/operator-product/03-home.md` — Home, where the "Needs you" approval items surface this phase.

### Existing engine to extend (read for integration points)
- `src/agent.ts` — the `query()` call site, currently `permissionMode: 'bypassPermissions'` (~:261).
  The gate replaces/augments this with a `canUseTool` interceptor. Read how `runAgent`/`runAgentWithRetry`
  build options and pass per-turn context (`opts.agentRuntime`).
- `src/security.ts` — existing `audit()` / `setAuditCallback()` pipeline (~:104-108), `getScrubbedSdkEnv`,
  and the security chokepoint patterns the gate should align with.
- `src/kill-switches.ts` — `requireEnabled()` chokepoint pattern (precedent for a single enforcement point).
- `src/db.ts` — `audit_log` table (~:322: action, detail, blocked, agent_id, chat_id, created_at);
  `dashboard_settings` table for storing mode/overrides; migration patterns (`addColumnIfMissing` +
  versioned `migrations/` + `version.json` dual-write — see Phase 2 `v1.2.2`).
- `src/routine-runner.ts` — `execContext.autonomy` (Phase 2 D-07) already threaded per step; this is the
  seam where routine actions enter the gate.
- `src/message-core.ts` — where chat turns run; inline-ask (D-04) for live-chat gated actions hooks here.
- `src/dashboard.ts` — Hono `/api/*` + the existing settings routes; add Permissions config + approval-
  queue endpoints. `web/src/pages/Settings.tsx`, `web/src/pages/Home.tsx`, `web/src/components/Toggle.tsx`,
  `Pill.tsx`, `ConfirmModal.tsx`, `web/src/lib/vocabulary.ts` — UI to extend.
- `.planning/codebase/` — STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/security.ts` `audit()` + `setAuditCallback()` + `audit_log` table: the decision-recording
  pipeline (D-10) already exists — extend `detail`, don't build a new logger.
- `src/kill-switches.ts` `requireEnabled()`: precedent for a single hard chokepoint; the tier gate is a
  richer sibling at the tool-call layer.
- `dashboard_settings` table: a home for global mode + per-action overrides without a new table (unless
  the override list warrants one).
- Phase 2 `routine-runner.ts` already carries `execContext.autonomy` per step — the routine→gate seam.
- UI: `Settings.tsx` (add the Permissions section), `Home.tsx` (the "Needs you" surface), `Toggle.tsx`,
  `Pill.tsx`, `ConfirmModal.tsx`, `vocabulary.ts`.

### Established Patterns
- Agent SDK `query()` in `src/agent.ts` currently runs `permissionMode: 'bypassPermissions'` and passes
  a scrubbed env. The gate introduces a `canUseTool` callback here (D-09) — the single most important
  new seam. Must respect `messageQueue` serialization and scrubbed-env rules.
- SQLite single-connection, synchronous; `addColumnIfMissing` + versioned `migrations/` dual-write
  (skipping the versioned file crash-loops the live service — Phase 2 v1.2.2 precedent).
- Per-turn agent identity via `opts.agentRuntime` (not mutable globals) — the gate context must travel
  the same per-turn path, not module globals.

### Integration Points
- `src/agent.ts` `query()` options ← `canUseTool` gate callback (the core change).
- Gate ← global mode + overrides (config store) + tool→tier map + per-run autonomy context (chat vs
  routine vs mission).
- Gate → `audit()` for every decision; → approval-queue table on "queue"; → inline-ask path in
  `message-core.ts` for live chat (D-04).
- New `/api/permissions*` (mode + overrides) and `/api/approvals*` (queue, approve/deny) routes in
  `src/dashboard.ts`; Permissions section in `Settings.tsx`; "Needs you" surface in `Home.tsx`.
- Approval queue is the seam Phase 4 (Activity) and Phase 5 (Audit) read.

</code_context>

<specifics>
## Specific Ideas

- "A dial, not a checkbox wall" — most operators pick one mode and never touch the override list.
  Balanced is the recommended default.
- Modes in terms of tiers: Cautious = auto Tier 1 only; Balanced = auto Tier 1+2; Autonomous = auto
  Tier 1+2+3 (notify after); Tier 4 always asks.
- The single locked Tier 4 row "builds more trust than any copy" — make the lock visible and explained.
- "Ask first is cheap": a gated action is fully prepared, then queued — approval is one tap on a
  ready-to-send thing.
- Undo-ability and permission tier are the same axis (links Phase 4 D9): if it can't be undone, it's
  Tier 4 and always asks.

</specifics>

<deferred>
## Deferred Ideas

- Rich Activity held-entry feed + "Ran on its own"/"You approved" tags + Undo — Phase 4.
- Immutable, exportable Audit log surface + richer audit schema — Phase 5.
- Connected tools / Notifications / Billing sections of Settings — Billing is Phase 8; the others are
  conventional, not part of PERM-01..04.
- Memory-derived preference rules feeding permission defaults — Phase 6.
- Per-teammate autonomy modes (this phase is team-wide global mode + per-action overrides only).

</deferred>

---

*Phase: 03-permissions-autonomy*
*Context gathered: 2026-06-23*
