# Phase 3: Permissions & Autonomy - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-23
**Phase:** 3-permissions-autonomy
**Areas discussed:** Approval flow architecture, Where gated actions surface, Tier classification mechanism, Tier-4 locked actions

---

## Approval flow architecture

### Q1 — Gate behavior on "Ask first"
| Option | Description | Selected |
|--------|-------------|----------|
| Prepare-then-requeue | Gate denies via canUseTool, assistant records prepared action and ends turn; approval re-executes stored payload | ✓ |
| Block-and-wait | Turn pauses inside the gate until approval; holds subprocess, fights timeouts, dies on restart | |
| Hybrid by tier | Short block window then fall back to requeue | |

**User's choice:** Prepare-then-requeue

### Q2 — Re-execution fidelity
| Option | Description | Selected |
|--------|-------------|----------|
| Replay stored payload exactly | Persist exact tool name + input args; approval runs that call directly, no model round-trip | ✓ |
| Re-run the model with approval context | Fresh agent run told "operator approved X" | |

**User's choice:** Replay stored payload exactly

### Q3 — Rest of the task after a gate
| Option | Description | Selected |
|--------|-------------|----------|
| Continue non-gated work, queue each gated action | Gate denies only the specific call; keep working, queue each gated action independently | ✓ |
| Stop at first gate | First gated action ends the turn with one queued item | |

**User's choice:** Continue non-gated work, queue each gated action

---

## Where gated actions surface

### Q1 — Surfacing location for this slice
| Option | Description | Selected |
|--------|-------------|----------|
| Back Home's "Needs you" card + chat | gated_action queue + API, point NeedsYouCard at it, push chat approve/deny | ✓ |
| Minimal approvals list in Permissions | Self-contained list inside Permissions settings screen | |
| Chat-only one-tap | Slack/desktop only, no dashboard surface this phase | |

**User's choice:** Back Home's "Needs you" card + chat

### Q2 — Chat approval mechanism
| Option | Description | Selected |
|--------|-------------|----------|
| Slack interactive buttons | Block Kit Approve/Deny over Socket Mode, true one-tap | ✓ |
| Notification + dashboard link | Chat notifies, tap happens in dashboard | |

**User's choice:** Slack interactive buttons

---

## Tier classification mechanism

### Q1 — How the gate decides an action's tier
| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic tool→tier map | Hardcoded registry, auditable, fail-safe, no LLM in loop | ✓ |
| LLM-judged at gate time | Model classifies each call; latency/cost, can misjudge irreversible | |
| Map first, LLM fallback | Deterministic map + model for unknowns | |

**User's choice:** Deterministic tool→tier map

### Q2 — Classification granularity
| Option | Description | Selected |
|--------|-------------|----------|
| Per-method, with server-level default | Map individual tool/MCP method names; unmapped floors at Ask-first | ✓ |
| Per-server only | Classify whole MCP servers to one tier | |

**User's choice:** Per-method, with server-level default

---

## Tier-4 locked actions

### Q1 — Which categories are hard-locked (multi-select)
| Option | Description | Selected |
|--------|-------------|----------|
| Send money / invoicing (QuickBooks) | create/send invoice, payment links, transaction import | ✓ |
| Sign / commit to contracts (DocuSign) | signature requests, contract execution | ✓ |
| Permanent delete | qbo delete, calendar delete_event, deleting files/labels | ✓ |
| Make purchases | any tool that buys/spends externally | ✓ |

**User's choice:** All four locked. Tier 3 "send to external person" actions (Gmail/Slack/calendar invites) gated by mode but NOT locked, per spec.

---

## Claude's Discretion

- Tier registry storage shape (code module vs. config).
- `gated_action` table schema and `canUseTool` wiring in `src/agent.ts` (reconciling with `permissionMode: 'bypassPermissions'`).
- Where mode-change config events are recorded (existing `audit_log` / `dashboard_settings`).
- Slack Block Kit layout and action-handler routing.

## Deferred Ideas

- Per-routine autonomy context (D7) → Routines phase.
- Memory-fed permission defaults → Memory phase.
- Activity feed + Audit screens → Phase 4.
- Billing/Usage screen → billing phase.
