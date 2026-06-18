# 08 Activity & audit

Two screens, deliberately different, that together complete the trust chain. They must look unlike
each other so nobody confuses them.

- **Activity** is operator-facing: notable work, plain language, what the team did.
- **Audit** is admin-facing: every event, technical detail, immutable, exportable.

---

## Activity — "What your team did"

**Purpose:** the transparency surface that makes autonomy safe to trust. The operator sees what
happened, autonomous or approved.

**When used:** operator glances daily. One click from Home.

### Layout

- Header "Activity", subtitle "What your team did", a Summarize action.
- Filter chips: All · Ran on its own · Needs review · per-teammate.
- Reverse-chronological feed grouped by day.

### Each event row

- Teammate color dot + the action in plain language ("Sent follow-up to 3 leads").
- Who + when ("Comms · 9:12am" / "Ops · 6:00pm routine").
- A tag: **You approved** (green) / **Ran on its own** (neutral) / **Needs you** (amber).
- View, or Review for held items, or Undo for reversible actions (see D9).

### Why it matters

The "Ran on its own" tag is the accountability that lets an operator flip to Autonomous mode without
anxiety. A "Skipped: waiting on your ok" row is the system working: an action hit a permission
boundary and parked itself instead of guessing. Activity and [Permissions](07-permissions-settings.md)
are the two ends of one mechanism.

### Undo (D9)

For reversible actions (a draft, a scheduled meeting, a label) provide Undo directly in the feed. For
irreversible actions (a sent email) there is no undo, which is exactly why those default to "Ask
first" in Permissions. **Permission tier and undo-ability track each other.**

---

## Audit — the immutable record

**Purpose:** complete technical truth for debugging your own autonomous agents and, later, for
customer compliance. Build the log now (you need it to debug autonomy regardless of customers); defer
the enterprise wrapper.

**When used:** opened deliberately when something is wrong or someone asks "what exactly did it do."
**Not in the operator's main nav** — lives under Settings > Security / admin area.

### Layout (denser, more technical than Activity)

- Header "Audit log", subtitle "Complete, read-only record of every event", Export action.
- Filter bar: search + type chips (Actions · Permissions · Auth · Errors) + date range.
- Dense log rows; monospace timestamps and detail to signal "technical."

### Each row

- Monospace timestamp (precise to the second).
- Actor badge (teammate / System / You).
- Event-type tag (action / permission / auth / routine / config / error).
- Description + outcome icon (ok / held / error).
- Expand for technical detail: tool used, target, project, permission decision and who/when approved,
  result + duration + cost, session id + model.

### Records everything

Including the boring and the failed: session refreshes, config changes, recovered API timeouts, held
permission requests. The value is precisely the events Activity hides. Each action ties back to the
permission rule that allowed it, closing the
Permissions -> action -> Activity -> Audit trace.

### Hard rules

- **Read-only and complete, or worthless.** Append-only, no delete, no silent dropping. An editable or
  lossy audit log provides negative trust. If a category is not captured, say so rather than imply
  full coverage. The "complete, read-only" header is a promise you must keep.
- **Export** (CSV/JSON) is the answer when a customer's security team asks what the AI did with their
  data. Foundation for the deferred enterprise security work (SSO-gated access, compliance formats,
  tamper-evidence).

## Data / engine

- Both read `audit_log`; Activity is a curated, plain-language view, Audit is the raw feed.
- `hive_mind` activity also feeds Activity attribution.
- Events carry: actor, type, target, project_id, permission_decision, outcome, duration, cost,
  session_id, model, timestamp.

## Open decisions

- **D9:** undo in Activity; tie permission tier to undo-ability.
- **D10:** audit retention on local disk. Default a window (e.g. 90 days full detail, then roll up or
  archive), make it configurable, and state it. Unbounded local logs become a disk problem by month
  three.

## Cross-references

- Both are the back half of the trust chain rooted in [Permissions](07-permissions-settings.md).
- Filter by [project](04-projects.md) and [teammate](05-team.md).
- Routine runs ([Routines](06-routines.md)) appear in both.
