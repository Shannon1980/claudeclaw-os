#!/bin/bash
# Send a chat message mid-task (Slack or Telegram, whichever transport is active).
# Usage: notify.sh "message text"
# Reads transport config from .env in the project root:
#   Slack:    SLACK_BOT_TOKEN + ALLOWED_SLACK_USER_ID
#   Telegram: TELEGRAM_BOT_TOKEN + ALLOWED_CHAT_ID

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "notify.sh: .env not found at $ENV_FILE" >&2
  exit 1
fi

env_get() {
  grep -E "^$1=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'"
}

TRANSPORT=$(env_get TRANSPORT | tr '[:upper:]' '[:lower:]')
SLACK_TOKEN=$(env_get SLACK_BOT_TOKEN)
SLACK_USER=$(env_get ALLOWED_SLACK_USER_ID)
TG_TOKEN=$(env_get TELEGRAM_BOT_TOKEN)
TG_CHAT=$(env_get ALLOWED_CHAT_ID)

# Mirror src/config.ts: explicit TRANSPORT wins, else Slack when its tokens exist.
if [ "$TRANSPORT" != "telegram" ] && [ -n "$SLACK_TOKEN" ] && [ -n "$SLACK_USER" ]; then
  curl -s -X POST "https://slack.com/api/chat.postMessage" \
    -H "Authorization: Bearer ${SLACK_TOKEN}" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d "$(printf '{"channel":"%s","text":%s}' "$SLACK_USER" "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" > /dev/null
  exit 0
fi

if [ -z "$TG_TOKEN" ] || [ -z "$TG_CHAT" ]; then
  echo "notify.sh: no transport configured (need SLACK_BOT_TOKEN+ALLOWED_SLACK_USER_ID or TELEGRAM_BOT_TOKEN+ALLOWED_CHAT_ID in .env)" >&2
  exit 1
fi

curl -s -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
  -d chat_id="${TG_CHAT}" \
  -d text="${1}" \
  -d parse_mode="HTML" > /dev/null
