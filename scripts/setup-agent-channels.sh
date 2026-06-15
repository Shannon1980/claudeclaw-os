#!/usr/bin/env bash
# setup-agent-channels.sh — Map Slack channels to agents
#
# Usage:
#   ./scripts/setup-agent-channels.sh <agent_id> <slack_channel_id>
#
# Example:
#   ./scripts/setup-agent-channels.sh bertha C08ABCD1234
#   ./scripts/setup-agent-channels.sh forge  C08EFGH5678
#
# This adds or updates the slack_channel field in the agent's agent.yaml.
# After mapping all agents, restart the bot for routing to take effect.
#
# To see current mappings:
#   ./scripts/setup-agent-channels.sh --list

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="${CLAUDECLAW_CONFIG:-$HOME/.claudeclaw}"

find_agent_yaml() {
  local id="$1"
  local id_lower
  id_lower="$(echo "$id" | tr '[:upper:]' '[:lower:]')"
  # Check external config dir first (case-insensitive match)
  for d in "$CONFIG_DIR/agents"/*/; do
    local base
    base="$(basename "$d")"
    local base_lower
    base_lower="$(echo "$base" | tr '[:upper:]' '[:lower:]')"
    if [[ "$base_lower" == "$id_lower" ]] && [[ -f "$d/agent.yaml" ]]; then
      echo "${d}agent.yaml"
      return 0
    fi
  done
  # Fall back to repo agents/
  if [[ -f "$PROJECT_ROOT/agents/$id/agent.yaml" ]]; then
    echo "$PROJECT_ROOT/agents/$id/agent.yaml"
    return 0
  fi
  return 1
}

list_mappings() {
  echo "Current agent channel mappings:"
  echo "────────────────────────────────"
  local found=0
  for dir in "$CONFIG_DIR/agents"/*/agent.yaml "$PROJECT_ROOT/agents"/*/agent.yaml; do
    [[ -f "$dir" ]] || continue
    local agent_id
    agent_id="$(basename "$(dirname "$dir")")"
    local channel
    channel="$(grep -E '^slack_channel:' "$dir" 2>/dev/null | awk '{print $2}' || true)"
    if [[ -n "$channel" ]]; then
      printf "  %-15s → %s\n" "$agent_id" "$channel"
      found=1
    fi
  done
  if [[ $found -eq 0 ]]; then
    echo "  (none configured)"
  fi
  echo ""
  echo "Agents without channel mappings:"
  for dir in "$CONFIG_DIR/agents"/*/agent.yaml "$PROJECT_ROOT/agents"/*/agent.yaml; do
    [[ -f "$dir" ]] || continue
    local agent_id
    agent_id="$(basename "$(dirname "$dir")")"
    [[ "$agent_id" == "_template" ]] && continue
    local channel
    channel="$(grep -E '^slack_channel:' "$dir" 2>/dev/null | awk '{print $2}' || true)"
    if [[ -z "$channel" ]]; then
      printf "  %-15s (%s)\n" "$agent_id" "$dir"
    fi
  done
}

if [[ "${1:-}" == "--list" ]]; then
  list_mappings
  exit 0
fi

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <agent_id> <slack_channel_id>"
  echo "       $0 --list"
  echo ""
  echo "Agents: bertha, forge, samantha, skylar, sentinel, social"
  echo ""
  echo "To get a channel ID: open channel in Slack -> click channel name"
  echo "-> ID is at the bottom of the dialog (starts with C or G)."
  exit 1
fi

AGENT_ID="$1"
CHANNEL_ID="$2"

# Validate channel ID format
if [[ ! "$CHANNEL_ID" =~ ^[CG][A-Z0-9]+$ ]]; then
  echo "Error: Channel ID should start with C (public) or G (private) followed by alphanumerics."
  echo "Got: $CHANNEL_ID"
  exit 1
fi

# Find the agent.yaml
YAML_PATH=""
if ! YAML_PATH="$(find_agent_yaml "$AGENT_ID")"; then
  echo "Error: No agent.yaml found for '$AGENT_ID'"
  echo "Checked: $CONFIG_DIR/agents/$AGENT_ID/ and $PROJECT_ROOT/agents/$AGENT_ID/"
  exit 1
fi

echo "Agent:   $AGENT_ID"
echo "Channel: $CHANNEL_ID"
echo "Config:  $YAML_PATH"

# Check if slack_channel already exists
if grep -qE '^slack_channel:' "$YAML_PATH"; then
  OLD="$(grep -E '^slack_channel:' "$YAML_PATH" | awk '{print $2}')"
  echo "Updating existing mapping: $OLD -> $CHANNEL_ID"
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s/^slack_channel:.*/slack_channel: $CHANNEL_ID/" "$YAML_PATH"
  else
    sed -i "s/^slack_channel:.*/slack_channel: $CHANNEL_ID/" "$YAML_PATH"
  fi
elif grep -qE '^#\s*slack_channel:' "$YAML_PATH"; then
  echo "Uncommenting and setting slack_channel..."
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s/^#.*slack_channel:.*/slack_channel: $CHANNEL_ID/" "$YAML_PATH"
  else
    sed -i "s/^#.*slack_channel:.*/slack_channel: $CHANNEL_ID/" "$YAML_PATH"
  fi
else
  echo "Adding slack_channel field..."
  echo "slack_channel: $CHANNEL_ID" >> "$YAML_PATH"
fi

echo "Done. Restart the bot for routing to take effect."
