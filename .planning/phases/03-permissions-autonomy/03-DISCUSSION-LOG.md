# Phase 3: Permissions & Autonomy - Discussion Log

> **Audit trail only.** Not consumed by downstream agents — decisions live in CONTEXT.md.

**Date:** 2026-06-23
**Phase:** 3-Permissions & Autonomy
**Areas discussed:** Tool→tier classification (locked Tier 4), Interactive-chat gate behavior, Phase 3 scope + approval surface, Gate enforcement mechanism

---

## Tool→tier classification (locked Tier 4)

| Option | Description | Selected |
|--------|-------------|----------|
| Payments + signing + permanent delete | Lock money movement, signing, permanent delete; everything else Tier 3 | ✓ |
| Above + all external sends | Also lock external email/message sends and public posts | |
| Payments only | Lock only money movement | |

**User's choice:** Payments + signing + permanent delete locked Tier 4. Slack/Gmail send, calendar w/ external, public posts are Tier 3 (asked, overridable, auto in Autonomous). Unclassified tools default to the safe side (>= Tier 3).

---

## Interactive-chat gate behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in chat, queue for background | Live chat asks inline; routine/background queues as 'Needs you' | ✓ |
| Always queue as 'Needs you' | Even chat goes to async queue | |
| Always ask inline | Everything synchronous, background would stall | |

**User's choice:** Inline ask during live chat (instant yes/no), async 'Needs you' queue for routine/mission/background runs. Tier 4 inline approval is per-instance only (lock holds).

---

## Phase 3 scope + approval surface

| Option | Description | Selected |
|--------|-------------|----------|
| Gate all runs + queue + Home surface | Enforce chat+routines+missions; queue model + minimal Home 'Needs you'; rich Activity view deferred to P4 | ✓ |
| Routines/autonomous-first | Gate background runs only this phase | |
| Gate all, inline-only (no queue yet) | Enforce everywhere but no persistent queue | |

**User's choice:** Gate all runs now; build approval-queue data model + minimal one-tap 'Needs you' surface on Home; defer rich held-entry Activity view to Phase 4 (reads the same queue).

---

## Gate enforcement mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| canUseTool callback + audit_log | Replace bypassPermissions with canUseTool on query(); classify→check→proceed/queue/deny; record via audit() | ✓ |
| Let research choose the SDK mechanism | Lock intent, let researcher pick canUseTool vs hooks vs allowedTools | |

**User's choice:** canUseTool callback on the Agent SDK query() (replacing bypassPermissions), recording every decision in the existing audit_log via audit(). Researcher confirms exact SDK affordance + replay-on-approval detail.

---

## Claude's Discretion
- canUseTool vs PreToolUse hooks; replay-on-approval mechanism.
- Override-list granularity (follow spec's ~6 capability rows).
- Config storage (dashboard_settings vs dedicated table); 'Needs you' TTL semantics.

## Deferred Ideas
- Activity held-entry feed + Undo — Phase 4.
- Exportable Audit log + richer schema — Phase 5.
- Connected tools / Notifications / Billing settings — Billing is Phase 8.
- Memory-derived permission defaults — Phase 6.
- Per-teammate autonomy modes (this phase is team-wide global mode only).
