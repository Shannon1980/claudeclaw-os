# 04 Projects

**Purpose:** the container everything else hangs off. Operators think in projects and clients, not
flat lists. Projects give the daily loop structure and let it scale past a handful of items.

**When used:** primary daily path. The organizing layer.

## Why this is structural, not optional

Without projects, the Home loop is a single flat list that does not scale. A project is the **same
daily loop scoped down**. Build this and Home, Routines, Activity, and Team all gain a project filter
for free, because they are the same data viewed through different cuts:
- Home = all projects.
- A project view = Home filtered to one project.
- Routines can be scoped to a project.
- Activity/Audit filter by project.
- Teammates work across projects.

Maps to the existing per-agent `project_dir` / workspace concept.

## List view

Projects as cards (richer objects than rows; the card shape signals "top-level container"). Header +
"New project" button. Each card:

- **Name + type** (Client / Internal / Hiring / etc.).
- **Status pill:** On track / At risk / Needs you / Paused. "Needs you" projects get the 2px info
  accent, same language as Home's decision items.
- **Scoped daily-loop counts:** on plate · waiting · shipped, filtered to this project.
- **Teammates assigned:** small overlapping teammate avatars in fixed colors.
- **Next item:** "Next: your approval on the proposal" / "Next: landing copy, due Thu". Surfaces the
  single most relevant thing.

## Project detail view

Opening a project shows the Home skeleton scoped to it:
- The three zones (plate / waiting / shipped) for this project only.
- Project-scoped routines.
- Project context/files (the workspace), and which teammates are assigned.
- Project-level "Needs you" decisions.

Reuse Home components; do not build a parallel layout.

## New project

Conversational, not a form: "Help me start a new project. Ask what it is and who should work on it."
The assistant captures the goal, type, and which teammates to assign, then creates the container.

## Data / engine

- New `projects` table (id, name, type, status, created_at). `mission_tasks` and `scheduled_tasks`
  gain a `project_id` foreign key. Existing rows default to a catch-all "General" project on migration.
- Status is derived (At risk if a blocked item is aging or a decision is overdue; Needs you if a
  permission-gated action is queued for this project) with a manual override.
- Teammate assignment maps to which agents have run work tagged to the project.

## States

- Empty: no projects yet -> a single starter card prompting "Start your first project" plus the
  General bucket.
- Active / at risk / needs you / paused per the status pill.

## Cross-references

- Adds a project filter to [Home](03-home.md), [Routines](06-routines.md),
  [Activity](08-activity-audit.md).
- Teammate avatars link to [Team](05-team.md).
- Status language ("Needs you") shared with Home and Permissions.
