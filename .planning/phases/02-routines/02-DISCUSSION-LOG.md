# Phase 2: Routines - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-23
**Phase:** 2-Routines
**Areas discussed:** Step execution & failure semantics, Conversational builder placement, Autonomy at creation (D7) scope, Failure notifications (D8)

---

## Step execution & failure semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Continue, mark degraded | Remaining steps run; degraded if some fail + some succeed, failed only if nothing useful completed | |
| Halt on first error, mark failed | Stop at first failing step, mark whole run failed | |
| Per-step continue/stop flag | Each step marked continue-on-error or stop-on-error at creation | ✓ |

**User's choice:** Per-step continue/stop flag
**Notes:** Run outcome (ok/degraded/failed) is derived from per-step results combined with each step's
error-flag — a failed stop-on-error step → run failed; failures only on continue-on-error steps with
some useful output → degraded. Default new steps to continue-on-error so partial value survives.

---

## Conversational builder placement

| Option | Description | Selected |
|--------|-------------|----------|
| Embedded on Routines page, draft-first | Conversation panel on the page; assistant proposes editable draft; confirm before save | ✓ |
| Main chat, draft-first | Build in existing Chat surface; confirm; routine appears on page | |
| Embedded, auto-save then edit | Save immediately (paused), edit after | |

**User's choice:** Embedded on Routines page, draft-first
**Notes:** Operator stays on the Routines page. Nothing persists until the operator confirms the
proposed plain-language schedule + ordered step list.

---

## Autonomy at creation (D7) scope

| Option | Description | Selected |
|--------|-------------|----------|
| Capture choice now, enforce in P3 | Build at-creation selector + store choice; enforcement gate in Phase 3 | ✓ |
| Safe default now, full model in P3 | Draft/notify-only this phase, no selector; all of it in Phase 3 | |
| Full autonomy model now | Build complete tier model in Phase 2 (scope creep) | |

**User's choice:** Capture choice now, enforce in P3
**Notes:** Selector (unattended draft/prepare/notify vs queue send/pay/commit) is built and the choice
stored on the routine + passed into execution context. Phase 3 (Permissions) owns the enforcement gate.

---

## Failure notifications (D8)

| Option | Description | Selected |
|--------|-------------|----------|
| Active transport, on state change | Notify via Slack on ok → failed/degraded transition (first break only) | ✓ |
| Active transport, every failed/degraded run | Alert on every non-ok run | |
| In-app only (history + badge) | No push; failures show in history + page badge | |

**User's choice:** Active transport, on state change
**Notes:** Reuse the existing notify path (scripts/notify.sh / transport send). Silent on success.
Alert on the first break/degrade, not on every recurrence of an already-broken routine. Recovery-to-ok
notification is optional (Claude's discretion).

---

## Claude's Discretion

- Concrete multi-step execution model and how earlier-step output threads to later steps.
- Routine data model shape (extend `scheduled_tasks` vs companion tables) per `src/db.ts` migration patterns.
- Plain-language → cron translation approach and how the advanced raw-cron escape hatch is surfaced.
- Whether recovery-to-ok emits a notification.
- Routine row iconography and count-line copy.

## Deferred Ideas

- Full autonomy tier enforcement engine + Permissions/Settings surface — Phase 3.
- Activity & audit views ("Ran on its own" feed) — later phase (08).
- Notification preferences / digest batching / multi-channel routing — future.
- Routines scoping to Projects — future tie-in unless trivially free.
