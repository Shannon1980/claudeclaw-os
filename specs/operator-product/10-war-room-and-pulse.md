# 10 War room & team pulse

Two power surfaces, kept by request, reframed so each does real operator work instead of being a demo.
Principle: **lead with the substance, keep the spectacle as an optional skin.** Off the daily path;
opened deliberately.

---

## War room — the multi-perspective decision tool

**Purpose:** convene multiple teammates on a hard call and get distinct viewpoints that converge on a
recommendation the operator decides on.

**When used:** deliberately, for genuinely hard decisions. Not routine questions.

### Layout

- Header "War room", subtitle "Bring the team together on a hard call". "Join by voice" is a
  **secondary** button (the voice/avatar feature is the optional skin, not the headline).
- Question card: the decision + which project + the convened teammates (avatars).
- Discussion thread: each teammate contributes a take from a **genuinely different axis** (e.g.
  Research = data, Comms = relationship, Ops = numbers). Colored by teammate.
- **Synthesis card** ("Where the team landed"): a recommendation + operator decision buttons ("Go with
  this" / "Hold firm" / "Dig deeper").

### Must converge

The synthesis + decision buttons are the most important element. Multi-agent discussion that does not
resolve to a recommendation is the failure mode (agents talking in circles while the meter runs).
**Force a synthesis step and an operator decision every time.** Diverse axes are what make convergence
worth more than asking one assistant.

### Cost (D12)

This is the most expensive screen: convening N teammates to deliberate burns real tokens. On the
local-first flat-subscription model that is the user's own Claude usage (not our cost), but it is their
patience and rate limits. Reserve it for hard calls; make that distinction in the UI so people do not
convene the team for trivial questions. Consider a soft confirmation when convening more than N
teammates.

### Data / engine

- Reuses the existing War Room multi-agent orchestration (text mode; async standup/discuss).
- Voice mode (Gemini Live) and avatar meetings are the optional skin behind "Join by voice".
- The decision outcome writes back as an action (e.g. "Comms drafts the offer") into the normal work
  pipeline, appearing on [Home](03-home.md) and [Activity](08-activity-audit.md).

---

## Team pulse — live situational awareness

**Purpose:** one glance at what the whole team is doing now, how hard each is working, and where effort
is going across projects.

**When used:** for the operator who wants a command center. Can sit one click from Home.

### Layout

- Header "Team pulse" + a Live indicator. "Brain view" is a **secondary** button (the 3D brain is the
  optional skin, not the headline).
- Metric cards: Active now · Tasks today · Shipped this week · Spend today.
- "Right now": each teammate's live status + a load bar (how busy), in teammate colors. Paused
  teammates dimmed at 0%.
- "Where today's effort went": a segmented bar by project with a legend (Product launch 46%, Acme
  30%, ...).

### Must drive action

The metrics are only worth showing if they answer an operator question: who is overloaded, what is
starved, where the money goes. "Content paused, 0% load" and "Product launch ate 46% of today" are the
lines that make someone reassign work. If nobody acts on it, it is a vanity screen; watch real usage
and cut it if click-through from it is dead.

### Data / engine

- Reuses `hive_mind` (cross-agent activity) and `token_usage` (spend).
- Load = relative recent task volume per agent. Effort breakdown = task/cost share by `project_id`.
- Brain view is the existing 2D/3D visualization, behind the toggle.

---

## Placement

Neither belongs in a non-technical operator's face on day one. Team pulse is one click from Home for
those who like a command center; War room is opened when facing a decision. The optional skins (voice
meetings, brain view) sit behind their substance, never as the first thing a new operator sees, or the
product reads as a gimmick.

## Open decisions

- **D12:** war room cost guardrails.

## Cross-references

- Both use [teammate](05-team.md) colors/identities and [project](04-projects.md) scoping.
- War room decisions flow into [Home](03-home.md) work and [Activity](08-activity-audit.md).
- Team pulse spend reconciles with Billing ([Permissions & settings](07-permissions-settings.md)).
