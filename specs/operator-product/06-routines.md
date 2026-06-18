# 06 Routines (workflows + scheduler)

**Purpose:** multi-step work that runs on its own on a schedule. The automation surface.

**When used:** primary path. The operator's standing instructions to their team.

## Two reframes

1. **Routines, not workflows or cron jobs.** "Work that runs on its own." A business owner already
   has the concept: the Monday report, the morning check, the month-end invoice chase.
2. **Build by describing, not by wiring.** The AI-native advantage over Zapier-style node canvases.
   The operator types "every weekday at 8, check my calendar and inbox and send me a brief, then chase
   overdue invoices." The assistant assembles the steps and assigns each to a teammate. The operator
   reviews and edits a plain step list. Never a canvas, never cron syntax.

## Consolidation

This is where the three overlapping internal surfaces (scheduled task / mission task / workflow)
collapse for the operator. They only ever see two ways to get work done: **ask it now** (the Home
capture bar) or **make it a routine** (this page). The internal distinctions stay plumbing.

## List view

Header: "Routines", count line ("3 on, 1 off"), "New routine" button (conversational builder).

Each routine row:
- **Icon + name** ("Morning brief").
- **Plain-language schedule** ("Every weekday at 8:00am"). Never `0 8 * * 1-5`.
- **Step count + last/next run** ("3 steps · ran today, 8:00am").
- **On/off toggle** (primary control, non-destructive pause).
- **Expand** for detail.

## Routine detail (expanded)

- **When:** plain-language schedule with a Change action (plain-language or picker, never raw cron in
  the operator UI). Keep a raw-cron escape hatch behind an advanced toggle for the builder.
- **Steps:** ordered list, each step = an action + the assigned teammate (colored tag). Add step /
  reorder. This is where Routines and [Team](05-team.md) connect: a routine is standing instructions
  for the team on a clock.
- **Recent runs:** history with success/degraded/failed, timestamp, and View for output. **Show
  failures honestly** ("calendar not connected, sent partial"). Silent failure is how operators stop
  trusting automation.
- **Run now / Turn off.**

## New routine

Conversational builder: "Help me build a new routine. Ask me what should happen and when, then turn
it into steps I can review." The assistant proposes the schedule (translated to cron under the hood)
and the steps; the operator edits the plain list before saving.

## Data / engine

- Reuses `scheduler.ts` (30s wake loop), `scheduled_tasks` table, `schedule-cli.ts`. Cron stored
  internally, generated from the plain-language description.
- A routine is a multi-step scheduled task: steps stored as an ordered list, each with a teammate
  assignment and an action prompt. Execution runs steps in order, honoring per-step teammate.
- Run history stored with outcome (ok / degraded / failed) and a link to output.
- Routines respect per-routine autonomy (see D7) by passing the permission context into each step's
  tool-call gate.

## States

- On / off (paused). Off routines are visually dimmed.
- Run outcomes: ok (check), degraded (amber, partial), failed (red). Degraded and failed must be
  visible in history and should notify (see D8).

## Open decisions

- **D7:** per-routine autonomy. What a routine may do unattended (draft/prepare/notify) vs what it
  queues for approval (send/pay/commit). Make this choice visible at creation, not a buried default.
  Routines sharpen the autonomy question because they run while the operator is asleep.
- **D8:** failure notifications. Silent on success, but alert the operator when a routine breaks or
  degrades. Otherwise the first sign the morning brief stopped is its week-long absence.

## Cross-references

- Steps assign [teammates](05-team.md); paused teammates block their steps.
- Routine actions appear in [Activity](08-activity-audit.md) tagged "Ran on its own" and feed the
  per-action [permission](07-permissions-settings.md) checks.
- Routines scope to [Projects](04-projects.md).
