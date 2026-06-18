# 05 Team

**Purpose:** manage the AI teammates (the agents), framed as a staff roster. Serves the operator
(glance, pause/resume) and the builder (deep config) on one page via progressive disclosure.

**When used:** primary path for the operator who wants to see/control their team; admin depth for the
builder.

## Reframe

Agents become **teammates** with roles. The page reads like managing staff, which a business owner
already understands. This turns the multi-agent system from a power-user feature into a selling point.
"Hide the jargon" never means "remove the controls" — management is a real, dedicated surface.

## Two depths (progressive disclosure)

- **Roster (operator depth):** who is on the team, what each is doing now, workload, pause/resume.
- **Settings drawer (builder/admin depth):** brain (model), instructions (CLAUDE.md), connected tools
  (MCP), workspace. Tucked behind a per-teammate expander so it never clutters the roster. The
  operator never opens it; the builder gets full control.

## Roster

Header: "Your team", count line (e.g. "4 teammates · 3 active, 1 paused"), "Add teammate" button.

Each teammate row:
- **Avatar** in the fixed teammate color (Research purple, Comms teal, Content coral, Ops amber).
- **Name + role** ("Research — Market intel, competitor scans, deep dives").
- **Live activity line** with a status dot: "Running Q3 competitor scan, due 2pm" / "Paused" /
  "Watching invoices, next check 6pm".
- **Workload** ("2 tasks" / "scheduled").
- **Controls:** pause/resume (primary control), expand for settings.

## Settings drawer

Per teammate:
- **Handles:** the role description (what they do, what they stop short of).
- **Brain:** model picker (Opus deepest / Sonnet balanced / Haiku fastest).
- **Workspace:** the project/working directory.
- **Instructions:** the agent's CLAUDE.md, shown as a preview with an Edit action (see D6 — consider
  hiding raw instruction editing behind an advanced toggle for non-technical users).
- **Connected tools:** chips for the teammate's MCP tools, with an Add affordance.
- **Remove teammate** (danger), in the drawer only.

## Add teammate

See D5. Recommended: ship a fixed starting team (Research, Comms, Content, Ops) and let operators
**customize** them. Gate creation behind templates ("add a Sales teammate") rather than a blank
wizard, so a non-technical user cannot create a broken, unconfigured agent. The existing
3-step agent-create flow (BotFather token -> bot -> YAML) is builder-only and stays in advanced.

## Data / engine

- Reads the `agents/` registry: `agent.yaml` (name, description, model, tokens, MCP servers,
  project_dir) + per-agent CLAUDE.md.
- Live activity from `mission_tasks` / `hive_mind` (current running task per agent).
- Pause/resume toggles an agent-enabled flag the scheduler/orchestrator honors (paused teammates are
  not assigned new work and do not run routines).

## States

- Active / idle / paused per teammate.
- Pause is non-destructive (resume later); only the drawer's Remove deletes.

## Open decisions

- **D5:** free creation vs fixed team + templates.
- **D6:** how deep config bottoms out for non-technical users; hide raw instruction editing behind
  advanced.

## Cross-references

- Teammate colors and names appear on [Home](03-home.md), [Projects](04-projects.md),
  [Routines](06-routines.md), [Activity](08-activity-audit.md), [Team pulse](10-war-room-and-pulse.md).
- Pausing a teammate affects routines that assign it ([Routines](06-routines.md)).
