---
name: meeting-intelligence
description: Pull meeting transcripts and notes from Echo AI, analyse them for themes, action items, and decisions, then turn that into proactive recommendations and durable memory. Triggers on meetings, transcripts, "what did I commit to", action items, weekly/daily recap, "what's slipping", themes across my calls.
allowed-tools: mcp__echo-ai__list_meetings, mcp__echo-ai__get_meeting, mcp__echo-ai__search_transcripts, mcp__echo-ai__get_daily_summary, mcp__echo-ai__get_weekly_summary, mcp__echo-ai__extract_action_items, mcp__echo-ai__list_todos_today, mcp__echo-ai__list_overdue_todos, mcp__echo-ai__create_todo, mcp__echo-ai__update_todo, mcp__echo-ai__carryover_todos, mcp__echo-ai__set_meeting_favorite, Bash
---

# Meeting Intelligence

## Purpose

Turn the raw record of what was said in meetings into things that actually move: themes worth tracking, commitments that are slipping, and a short list of proactive moves you can make on [YOUR NAME]'s behalf. Meeting data lives in Echo AI and is reached through the `echo-ai` MCP server (already wired into ClaudeClaw settings). This skill is the playbook for reading it, analysing it, and feeding the result into ClaudeClaw's memory and chat so agents get more useful over time instead of asking the same questions every session.

The job is not to summarise a meeting back. Echo already writes summaries. The job is to be one step ahead: connect meetings to each other, notice what [YOUR NAME] keeps circling, flag what they said they'd do and haven't, and hand them the next action before they ask.

## Echo AI tools

Read:
- `mcp__echo-ai__list_meetings` — `{limit, offset}`. Returns id, title, date, durationSeconds, template, attendees, status, summary, actionItems, enhancedActionItems. 100+ meetings exist; page with offset.
- `mcp__echo-ai__get_meeting` — `{meeting_id}`. Full record including transcript/notes for one meeting.
- `mcp__echo-ai__search_transcripts` — `{query, limit}`. Full-text search across all transcripts. Use this to trace a topic ("FY27 budget", "platform engineering") across many meetings.
- `mcp__echo-ai__get_daily_summary` — `{date, assignee?}`. `date` is `YYYY-MM-DD`. Rolls up a single day.
- `mcp__echo-ai__get_weekly_summary` — `{start, end, assignee?}`. Both `YYYY-MM-DD`. Rolls up a range.
- `mcp__echo-ai__extract_action_items` — `{meeting_id}`. Re-extracts structured action items for one meeting.
- `mcp__echo-ai__list_todos_today` / `mcp__echo-ai__list_overdue_todos` — the current commitment state.

Write (use deliberately, never in bulk without a reason):
- `mcp__echo-ai__create_todo` / `mcp__echo-ai__update_todo` / `mcp__echo-ai__carryover_todos` — manage Echo todos.
- `mcp__echo-ai__set_meeting_favorite` — `{meeting_id, favorite}`.

Do not call `delete_meeting`. Deleting meeting records is destructive and out of scope for analysis — if [YOUR NAME] wants a meeting gone, tell them to do it in Echo.

## Analysis playbook

When asked to analyse meetings (a day, a week, a topic, or "catch me up"):

1. **Pull the right window.** For a recap use `get_daily_summary` / `get_weekly_summary`. For "what's been going on with X" use `search_transcripts`. For deep detail on one meeting use `get_meeting`. Don't pull all 100+ meetings unless the ask is genuinely cross-corpus — page and scope.

2. **Extract four layers.** For the window, produce:
   - **Themes** — what keeps coming up across meetings. Group, don't list. "Contract mod + FY27/FY28 pricing" is one theme spanning several calls, not four bullets.
   - **Decisions** — what was actually decided or committed to, with who owns it.
   - **Action items** — open items assigned to [YOUR NAME] or their team. Cross-check against `list_overdue_todos` so you catch what's slipping, not just what's new.
   - **Recommendations** — 2 to 4 proactive moves. This is the point of the skill (see below).

3. **Recommendations must be proactive, not descriptive.** Each one is a move [YOUR NAME] could make now, tied to evidence from the meetings. Good: "You told Angel you'd send September justification language by today and it's not in your todos — want me to draft it from the meeting notes?" Bad: "Consider following up on action items." Every recommendation should be something an agent could actually execute (draft the email, prep the doc, schedule the follow-up, queue a mission task) — and offer to do it.

4. **Connect to what you already know.** Before recommending, check ClaudeClaw memory (`[Memory context]` block, or query the memories table) so you don't re-surface something already handled or contradict a known decision.

## Memory bridge

After a meaningful analysis, write durable insights into ClaudeClaw's memory so every agent carries them forward. Use `source='echo-meeting'` so meeting-derived memories are traceable and can be pruned as a set. Write the *insight*, not the transcript — themes, standing commitments, recurring stakeholders, decisions with lasting weight. Skip one-off logistics.

Resolve the DB and chat_id, then insert (mirrors the `checkpoint` pattern in CLAUDE.md, uses the `sqlite3` CLI so no native module is needed):

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
DB="${CLAUDECLAW_DB:-$PROJECT_ROOT/store/claudeclaw.db}"
CHAT_ID=$(sqlite3 "$DB" "SELECT chat_id FROM sessions LIMIT 1;")
NOW=$(date +%s)
sqlite3 "$DB" "INSERT INTO memories (chat_id, source, raw_text, summary, entities, topics, importance, salience, created_at, accessed_at)
VALUES ('$CHAT_ID', 'echo-meeting',
  'THEME/INSIGHT TEXT',
  'ONE LINE SUMMARY',
  '[\"Angel\",\"Naima\"]',
  '[\"contract-mod\",\"FY27\"]',
  0.8, 3.0, $NOW, $NOW);"
```

- `importance` 0.6–0.9 for standing themes/decisions; keep one-offs out entirely.
- `entities` = people/orgs (JSON array), `topics` = short tags (JSON array).
- The live desktop app reads its DB from `~/Library/Application Support/claudeclaw/store/claudeclaw.db`. When running inside the live app, set `CLAUDECLAW_DB` to that path (the routines below do this). In a dev checkout the default is fine.

To review or prune what's been written: `sqlite3 "$DB" "SELECT id, summary, importance FROM memories WHERE source='echo-meeting' ORDER BY created_at DESC LIMIT 20;"`

## Output format (Slack)

Responses go to Slack. Keep it tight, lead with the punchline, no heavy markdown.

```
Meeting recap — <window>

Themes
- <grouped theme, one line>
- <grouped theme, one line>

Your open items
☐ <task> — <owner/deadline, flag if overdue>
☐ <task> — <owner/deadline>

Recommend
- <proactive move, tied to a meeting> — want me to do it?
```

Keep action items as individual `☐` lines (per CLAUDE.md), don't collapse them. If nothing is slipping, say so in one line rather than padding.

## Proactive routines

Two scheduled routines drive this without [YOUR NAME] asking. They are registered against the live app DB (see `scripts/setup-echo-ai.sh`). Both run as the main agent and post to Slack.

**Daily digest** (`0 8 * * 1-5`, weekday mornings): Look back at yesterday's meetings via `get_daily_summary`, cross-check `list_overdue_todos`, surface themes + open items + 2–3 proactive moves, then write any standing insight to memory. If yesterday had no meetings, send one line ("No meetings yesterday, N items still open") — don't fabricate.

**Weekly themes review** (`0 18 * * 0`, Sunday evening): `get_weekly_summary` for the past 7 days. Roll up recurring themes, decisions made, and what's carrying over into next week. This is the pattern layer — what did [YOUR NAME] spend the week on, and what's drifting. Write the week's durable themes to memory with importance ~0.8.

## Principles

- Be one step ahead, not one behind. If you can see the next action, offer to take it.
- Never invent meeting content. If a window is empty or a transcript is thin, say so.
- Respect the memory: check before surfacing, don't nag about things already handled.
- Meeting write operations (todos, favorites) are fine on request; deleting meetings is not.
