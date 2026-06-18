# ClaudeClaw operator product specs

These specs turn ClaudeClaw from a power-user tool into a product for business operators:
people running a business, building products, chasing work, and keeping delivery moving.

The engine already exists (transports, agents, scheduler, memory, dashboard, SQLite). The work
these specs describe is **packaging, trust, and distribution**, not new capability. Most of it is
relabeling existing internals into operator-facing surfaces and adding the trust controls that make
autonomous action safe to rely on.

## Product in one line

An AI chief of staff that runs on your own Mac, reachable from Slack or your phone, that keeps your
work moving and never lets anything fall through.

## Audience

The operator. A founder or business owner who measures the product by whether work moved forward,
not by how many agents are running. Non-technical. Will abandon at the first terminal prompt.

The builder (you) is a second user who needs deeper config. The design serves both through
**progressive disclosure**: the operator sees plain surfaces, the builder opens drawers.

## Distribution decision (locked)

**Local-first desktop app + thin cloud control plane.** The engine runs on the user's machine
(preserves the differentiator, zero compute cost to us, their data stays local). A desktop installer
removes the terminal entirely. The cloud piece is thin: auth, remote dashboard tunnel, billing,
licensing. See [01-foundations.md](01-foundations.md).

Not hosted SaaS (kills the local-file differentiator, adds liability and compute cost). Managed
cloud boxes are a possible future premium tier, not v1.

Pricing follows from this: flat subscription per seat, not metered usage. Metering local compute we
do not pay for makes no sense and punishes heavy users.

## Vocabulary (internal to operator-facing)

The single most important consistency rule. Every screen uses the right column, never the left.

| Internal / builder term        | Operator-facing term            |
|--------------------------------|---------------------------------|
| agent                          | teammate                        |
| agent registry / fleet         | your team                       |
| model                          | brain                           |
| CLAUDE.md / system prompt      | instructions                    |
| MCP servers                    | connected tools                 |
| project_dir / workspace        | workspace                       |
| scheduled task / cron job      | routine                         |
| cron expression                | plain-language schedule         |
| mission task / delegation      | (hidden; it is just work)       |
| hive_mind activity             | team pulse                      |
| audit_log                      | activity (operator) / audit log (admin) |
| memories / salience / decay    | what your assistant knows       |

## The trust chain

Four surfaces form one connected system. This is the spine of the product.

1. **Permissions** set the rules for what teammates may do alone. ([07](07-permissions-settings.md))
2. The assistant **acts** within those rules.
3. **Activity** shows the operator the work that happened, autonomous or approved. ([08](08-activity-audit.md))
4. **Audit** records the complete immutable technical truth for debugging and compliance. ([08](08-activity-audit.md))

**Memory** ([09](09-memory.md)) feeds the rules (it stores preferences like "approve client-facing
work before sending"). Every autonomous action traces back through Activity to the permission rule
in Audit that allowed it. Build the chain, not the screens in isolation.

## Screen map

**Primary daily path** (non-technical operator lives here):
- [Onboarding](02-onboarding.md) — first run, zero terminal
- [Home](03-home.md) — the daily loop (day-one and steady-state)
- [Projects](04-projects.md) — the container everything hangs off
- [Team](05-team.md) — manage teammates
- [Routines](06-routines.md) — work that runs on its own

**Trust system:**
- [Permissions & settings](07-permissions-settings.md)
- [Activity & audit](08-activity-audit.md)
- [Memory](09-memory.md)

**Power surfaces** (kept, reframed, off the daily path):
- [War room & team pulse](10-war-room-and-pulse.md)

**Optional skins** behind the power surfaces: voice meetings (war room), brain view (team pulse).

**Cut to a hidden Labs area** (do not give navigation in the operator product): standalone token
telemetry, the memory-decay visualization as a primary screen.

## Build sequence

The order is dictated by what gates shipping, not by what is fun.

1. **Electron shell** ([01-foundations.md](01-foundations.md)). Until a non-developer can install
   and run it with no terminal, there is no product. Everything else is wasted effort before this.
2. **Onboarding** front door (OAuth account connect, Claude login flow, no `.env`).
3. **Operator reframe**: vocabulary pass + Home + Projects + Team + Routines.
4. **Trust system**: Permissions + Activity + Audit + Memory.
5. **Power surfaces**: War room + Team pulse.
6. **Billing + licensing.**

Features are not on this list because they are already built. The gap is packaging and trust.

## Open decisions register

Carried forward from design. Each is flagged again in its screen spec.

**Resolved:**

| # | Decision | Resolution | Where |
|---|----------|------------|-------|
| D1 | Subscription vs API-key auth | **Both, subscription-default.** API-key path one link away, recommended for heavy automation. App owns auth precedence. | [02](02-onboarding.md) |
| D4 | The silent-vs-ask autonomy boundary | **Four tiers by reversibility; modes shift the line between tiers 1/2/3; irreversible Tier 4 is locked.** | [07](07-permissions-settings.md) |

**Open:**

| # | Decision | Where |
|---|----------|-------|
| D2 | How aggressive is the day-one "Today" suggestion engine (scan inbox unprompted or wait to be asked) | [03](03-home.md) |
| D3 | Does the activation block fully retire or persist as a thin "teach me more" affordance | [03](03-home.md) |
| D5 | Do operators create teammates freely, or only customize a shipped team / use templates | [05](05-team.md) |
| D6 | Where deep config bottoms out for non-technical users (hide raw instruction editing) | [05](05-team.md) |
| D7 | Per-routine autonomy: what a routine may do unattended | [06](06-routines.md) |
| D8 | Routine failure notifications: silent on success, alert on break/degrade | [06](06-routines.md) |
| D9 | Undo in Activity for reversible actions; tie permission tier to undo-ability | [08](08-activity-audit.md) |
| D10 | Audit log retention window on local disk | [08](08-activity-audit.md) |
| D11 | Memory provenance display and edit/delete controls | [09](09-memory.md) |
| D12 | War room cost guardrails (it is the most expensive screen) | [10](10-war-room-and-pulse.md) |

## How this maps to the existing codebase

| Spec surface        | Existing engine                                              |
|---------------------|-------------------------------------------------------------|
| Onboarding          | `scripts/setup.ts` wizard logic, wrapped in Electron        |
| Home / Projects     | `mission_tasks`, `scheduled_tasks` tables; `dashboard.ts` API |
| Team                | `agents/` registry, `agent.yaml`, per-agent CLAUDE.md, `orchestrator.ts` |
| Routines            | `scheduler.ts`, `scheduled_tasks`, `schedule-cli.ts`         |
| Permissions         | new; gates the Agent SDK tool-call layer                     |
| Activity / Audit    | `audit_log`, `hive_mind` tables                              |
| Memory              | `memories` table, consolidation/decay engine                 |
| Team pulse          | `hive_mind` table, `token_usage`                             |
| War room            | multi-agent orchestration (existing War Room), reframed      |

The reframe is mostly a view layer over data the engine already produces.
