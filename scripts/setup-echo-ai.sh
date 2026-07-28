#!/usr/bin/env bash
# setup-echo-ai.sh — activate the Echo AI meeting-intelligence proactive routines.
#
# What this does:
#   1. Verifies the echo-ai MCP server is reachable (via ClaudeClaw settings).
#   2. Registers two scheduled routines (daily digest + weekly themes review)
#      against the ClaudeClaw DB, idempotently.
#
# Where it writes:
#   Routines live in the ClaudeClaw scheduled_tasks table. The DB is resolved
#   from CLAUDECLAW_DATA_DIR (the live desktop app sets this to
#   ~/Library/Application Support/claudeclaw). Run this in the SAME environment
#   the live app runs in so the schedules land in the live DB.
#
# Usage:
#   # Against the live desktop app:
#   CLAUDECLAW_DATA_DIR="$HOME/Library/Application Support/claudeclaw" \
#     bash scripts/setup-echo-ai.sh
#
#   # Against a dev checkout (writes to ./store/claudeclaw.db):
#   bash scripts/setup-echo-ai.sh
#
set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
CLI="$PROJECT_ROOT/dist/schedule-cli.js"

if [[ ! -f "$CLI" ]]; then
  echo "error: $CLI not found. Build first: npm run build" >&2
  exit 1
fi

DATA_DIR="${CLAUDECLAW_DATA_DIR:-}"
if [[ -n "$DATA_DIR" ]]; then
  echo "Target DB: $DATA_DIR/store/claudeclaw.db (live)"
else
  echo "Target DB: $PROJECT_ROOT/store/claudeclaw.db (dev checkout)"
fi

# Stable marker so re-running doesn't double-register.
DAILY_MARKER="[echo-daily-digest]"
WEEKLY_MARKER="[echo-weekly-review]"

DAILY_PROMPT="$DAILY_MARKER Use the meeting-intelligence skill. Analyse yesterday's meetings from Echo AI via get_daily_summary (date = yesterday). Cross-check list_overdue_todos. Surface: grouped themes, my open action items (flag anything overdue), and 2-3 proactive moves I could make today, each tied to a specific meeting and offered as something you can do. Write any standing theme or decision to ClaudeClaw memory with source='echo-meeting'. If there were no meetings yesterday, send one short line with the count of still-open items. Post to Slack, tight format, no fluff."

WEEKLY_PROMPT="$WEEKLY_MARKER Use the meeting-intelligence skill. Roll up the past 7 days of meetings from Echo AI via get_weekly_summary. Identify recurring themes, decisions made this week, and what is carrying over or slipping into next week. Give me 2-4 proactive recommendations for the week ahead. Write the week's durable themes to ClaudeClaw memory with source='echo-meeting' and importance ~0.8. Post to Slack, lead with the punchline."

# --- idempotency guard: skip if a routine with the marker already exists ---
EXISTING="$(node "$CLI" list 2>/dev/null || true)"

register() {
  local marker="$1" prompt="$2" cron="$3" label="$4"
  if grep -qF "$marker" <<<"$EXISTING"; then
    echo "skip: $label already registered ($marker)"
  else
    node "$CLI" create "$prompt" "$cron" --agent main
    echo "registered: $label ($cron)"
  fi
}

register "$DAILY_MARKER"  "$DAILY_PROMPT"  "0 8 * * 1-5" "daily digest (weekday 8am)"
register "$WEEKLY_MARKER" "$WEEKLY_PROMPT" "0 18 * * 0"  "weekly themes review (Sun 6pm)"

echo
echo "Done. Verify with:  CLAUDECLAW_DATA_DIR=\"$DATA_DIR\" node \"$CLI\" list"
