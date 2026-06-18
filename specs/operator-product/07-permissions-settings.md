# 07 Permissions & settings

**Purpose:** set the rules for what teammates may do on their own. The answer to the act-unprompted
question that hangs over Home, Routines, and Activity. The first half of the trust chain.

**When used:** Settings is occasional. Permissions is set once early, revisited as trust grows.

## Settings structure

Left-rail sections: Account · Connected tools · Permissions · Notifications · Billing. Permissions is
the centerpiece; the rest are conventional.

- **Account:** identity, Claude sign-in status, workspace name.
- **Connected tools:** the OAuth connections (Slack, Gmail, Calendar, Drive). Add/remove. This is where
  tools skipped in onboarding get connected later.
- **Notifications:** how/where the operator is alerted, including routine failures (D8).
- **Billing:** see below.

## Permissions: a dial, not a checkbox wall

Most operators pick one mode and never touch the rest.

- **Global autonomy mode** (pick one):
  - **Cautious:** prepares and drafts, asks before anything leaves.
  - **Balanced (recommended, default):** acts on low-risk things, asks to send or commit.
  - **Autonomous:** acts on its own, tells you after.
- **Fine-tune by action** (the override list, secondary): each capability is `Always` or `Ask first`.
  - Research and prepare -> Always
  - Draft messages and docs -> Always
  - Send emails and messages -> Ask first
  - Book or move meetings -> Ask first
  - Post publicly -> Ask first
  - **Send money / pay invoices -> Always ask (locked)**
- **Locked rails:** irreversible actions cannot be set to Always, even in Autonomous mode. Show a lock
  icon. This single locked row builds more trust than any copy, because it proves the product has
  judgment about what should never be fully automated. Identify the 2-3 genuinely irreversible actions
  and lock them.
- **Permission tier tracks undo-ability:** reversible actions can default to Always; irreversible ones
  to Ask first or locked.

### Action tiers (D4, resolved)

Every action the assistant can take is classified into one of four tiers by **reversibility** and
**externality** (does it reach the outside world). Tiers, not individual actions, are what the modes
move. This is the rule everything in the trust chain enforces.

| Tier | What it is | Examples | Default behavior |
|------|------------|----------|------------------|
| 1 — Read & prepare | Internal, fully reversible | research, read inbox/calendar/files, draft messages and docs, summarize, create internal tasks | Always allowed, every mode. Silent. |
| 2 — Low-stakes external | Reaches outside but easily reversible | apply labels, save files, internal notes, schedule an internal-only meeting | Auto in Balanced/Autonomous; ask in Cautious |
| 3 — Consequential external | Reaches other people; hard or awkward to unwind | send email/message to an external person, book/move a meeting with external attendees, post publicly | Ask in Cautious/Balanced; auto in Autonomous (tells you after) |
| 4 — Irreversible / high-stakes | Cannot be undone | send money / pay invoices, sign or commit to contracts, permanently delete data, make purchases | **Always ask. Locked — cannot be set to Always in any mode.** |

**Modes are defined in terms of tiers:**
- **Cautious:** auto Tier 1 only; ask for Tier 2+.
- **Balanced (default):** auto Tier 1 + 2; ask for Tier 3 + 4.
- **Autonomous:** auto Tier 1 + 2 + 3 (notify after); ask for Tier 4.

Per-action overrides move individual Tier 2/3 actions between Always and Ask first. **Tier 4 is locked
regardless of mode or override.** Mode shifts the line between tiers 1/2/3; the irreversible tier is
fixed.

**"Ask first" is cheap by design.** A gated action is fully prepared, then queued as a "Needs you"
item on [Home](03-home.md) and a held entry in [Activity](08-activity-audit.md) for one-tap approval.
Asking means "approve this ready-to-send thing," not "go do it from scratch."

**Undo tracks tier (links D9).** Tier 3 actions that are genuinely reversible (cancel a booking,
remove a label) get an Undo affordance in Activity. Anything that cannot be undone belongs in Tier 4
and therefore always asks first. Undo-ability and permission tier are the same axis.

## How it works (engine)

- The model is consulted at the Agent SDK tool-call layer before any external/irreversible tool runs.
- Outcomes: **proceed** (allowed), **queue for approval** (surfaces as "Needs you" on
  [Home](03-home.md) and a held entry in [Activity](08-activity-audit.md)), or **block**.
- Every check is recorded in [Audit](08-activity-audit.md) with the rule that decided it.
- Routines pass per-routine autonomy context (D7) into the same gate.
- Memory can hold preference-level rules ("approve client-facing work before sending") that inform
  defaults; see [Memory](09-memory.md).

## Billing (folded in; do not build a separate Usage screen)

For an operator, "usage" as token counts and cache-hit rates is a developer dashboard. The operator
version is **outcomes plus spend**: "142 tasks done, 6 routines running, $— this month." One screen.

- Plan and price at top (flat per-seat subscription, per the local-first distribution model).
- "This month" stated as outcomes + cost, reusing daily-loop language.
- Detailed token telemetry lives in the hidden Labs/advanced area, for the builder debugging the
  product, not for a paying operator.

## States

- Default Balanced on first run. Mode changes are logged to Audit (config events).
- Locked rows are visibly non-editable.

## Open decisions

- **D4 (resolved):** the silent-vs-ask boundary is the four-tier model above. Remaining
  implementation work is classifying every concrete tool the engine exposes into a tier (and
  confirming exactly which actions are locked Tier 4 for your integrations) — but the policy is set.

## Cross-references

- Drives "Needs you" on [Home](03-home.md), held entries and "Ran on its own" tags in
  [Activity](08-activity-audit.md), per-routine autonomy in [Routines](06-routines.md).
- Memory preferences feed defaults ([Memory](09-memory.md)).
