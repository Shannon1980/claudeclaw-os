# 03 Home (the daily loop)

**Purpose:** the operator's morning glance. What needs me, what's moving, what shipped. The landing
screen, replacing the current feature-list sidebar as the thing the eye lands on.

**When used:** every session open. Primary surface.

## Core principle: one skeleton, two states

Day-one and steady-state are the **same layout**. The slots fill in as work accumulates; nothing
rearranges. The operator learns the screen once. Day-one is an activation screen wearing the daily
loop's clothes; by ~day three it is the working loop with no layout change.

Skeleton (top to bottom):
1. Greeting + one-line status
2. Activation / "teach me more" strip
3. "Today" / "Needs you" card
4. Three zones: On my plate · Waiting on others · Shipped
5. Capture bar (always present)

## Day-one state

The honest state on day one is empty. Never render literal zeros; that reads as "this does nothing."

1. **Status line, honest:** "I'm set up and running. I don't know much about your work yet." Plus a
   Running pill.
2. **Activation block (day-one only), the most important element.** Three actions that make the
   assistant useful in ~2 minutes: tell it what you're working on, finish connecting tools you
   skipped, give it a one-paragraph business brief. Large on day one, retires once done (see D3).
3. **"Today" as suggested moves, not counts.** Drawn from whatever is connected: "3 meetings today,
   want prep docs?", "14 unread from clients, want a triage?" If nothing connected, starter prompts.
   Rule: never show a zero where you can show a next action.
4. **Three zones, empty but labeled.** Each shows a one-line hint of what lands there, teaching the
   model before real items arrive.
5. **Capture bar** is the primary day-one CTA: "Tell me anything, forward an email, drop a voice note."
   Fastest path to a populated dashboard is the operator dumping what's in their head.

## Steady-state

1. **Status line becomes the dashboard in one sentence:** "2 things need you, 2 waiting on others, 6
   shipped this week." If they read nothing else, they know where things stand.
2. **Activation block shrinks to a thin "connect more / teach me more" strip** (see D3).
3. **"Today" becomes "Needs you": decisions only the operator can make.** This is the most important
   change. The operator's job is the decisions that unblock work, not the work itself. The assistant
   does everything up to the decision point and stops. Examples: approve a proposal before it sends,
   pick from a shortlist. The next calendar item appears here too as context.
4. **Three zones populate with real items:**
   - **On my plate:** active items, each tagged with the teammate working it ("Comms drafting",
     "Research, due 2pm") or "You". Attribution uses teammate colors; the words "agent"/"delegation"
     never appear.
   - **Waiting on others:** blocked items with who and how long ("Sarah, legal, 2d"; "client payment,
     4d"). Quietly the most valuable zone, because this work is invisible everywhere else.
   - **Shipped this week:** completed items + count. Social proof for the product; do not bury it.
5. **Capture bar** unchanged.

## Data / engine

- "Needs you" = permission-gated actions queued for approval (see
  [permissions](07-permissions-settings.md)) + items explicitly flagged for the operator.
- Zones map to `mission_tasks` / `scheduled_tasks` status, filtered and grouped. "On my plate" =
  running/queued, "Waiting" = blocked-on-external, "Shipped" = completed in the last 7 days.
- Teammate attribution = `assigned_agent`.
- Today suggestions = derived from connected tools (calendar events, unread counts) via existing MCP
  integrations.
- All of the above is filterable by project once [Projects](04-projects.md) exists; Home is the
  all-projects view.

## States

- Day-one (empty), steady (populated), and the morph between them as work accrues.
- Loading: skeleton rows, never a spinner over the whole screen.
- Disconnected tools: Today falls back to starter prompts rather than empty.

## Anti-patterns (do not)

- Open to the 10-section sidebar.
- Lead with Hive Mind / cost charts.
- Show empty kanban columns with no guidance.

## Open decisions

- **D2:** how aggressively Today pulls from connected sources unprompted (scan inbox vs wait to be
  asked). Real privacy/trust line. If aggressive, the action must be visibly bounded so it does not
  feel like rummaging.
- **D3:** does the activation block fully retire or persist as a thin "teach me more" affordance so the
  assistant keeps getting smarter without the user hunting in settings.

## Cross-references

- Teammate tags link to [Team](05-team.md). "Needs you" decisions reference
  [permissions](07-permissions-settings.md). Capture routes work that shows in [Activity](08-activity-audit.md).
- Same data, scoped, appears per project in [Projects](04-projects.md).
