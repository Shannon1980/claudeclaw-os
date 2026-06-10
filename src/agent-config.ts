import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

import { CLAUDECLAW_CONFIG, PROJECT_ROOT } from './config.js';
import { readEnvFile } from './env.js';
import { isValidClaudeModel, resolveClaudeModelAlias } from './models.js';

// Shared roster path. Written by Node on startup and any time the agent
// roster changes (new agent, deleted agent). Read by the Python Pipecat
// voice stack so new agents propagate into voice War Room without a
// full bot restart.
export const WARROOM_ROSTER_PATH = '/tmp/warroom-agents.json';

/** Single source of truth for "is this string a syntactically valid
 *  agent id?". Lifted out of the various inline copies in the dashboard
 *  HTTP layer so the avatar / chat / agent-files handlers all share one
 *  definition. Lower-case alphanumerics plus `_` and `-`; `i` flag is
 *  kept for backwards compatibility with the historical regex. */
export const AGENT_ID_RE = /^[a-z0-9_-]+$/i;

/** Loose validity check for a Slack channel/group id. Slack channel ids
 *  start with `C` (public/private channels) or `G` (legacy private groups)
 *  followed by uppercase alphanumerics, e.g. `C0XXXX`. We validate loosely
 *  (don't pin the exact length) so future id shapes still pass. Used to
 *  guard the dashboard `slack_channel` editor. */
export const SLACK_CHANNEL_RE = /^[CG][A-Z0-9]+$/;

/** Cheap "does this agent exist on disk?" check. `main` always exists
 *  (it's the root process); any other id needs an `agent.yaml` next to
 *  resolveAgentDir(id). Returns false for syntactically invalid ids so
 *  callers can use this as the only existence check they need. */
export function agentExists(agentId: string): boolean {
  if (!AGENT_ID_RE.test(agentId)) return false;
  if (agentId === 'main') return true;
  try {
    const dir = resolveAgentDir(agentId);
    return fs.existsSync(path.join(dir, 'agent.yaml'));
  } catch {
    return false;
  }
}

export interface AgentConfig {
  name: string;
  description: string;
  botTokenEnv: string;
  botToken: string;
  model?: string;
  /** Slack channel/group id that routes to this agent. When set, messages
   *  posted in this channel are handled by this agent (the channel→agent
   *  map is built once at createSlackBot startup). Unset = no dedicated
   *  channel. */
  slackChannel?: string;
  /** Human-friendly display name (`display_name`), shown in UIs. Falls
   *  back to `name` when unset. */
  displayName?: string;
  /** Working directory the agent runs in (`project_dir`). When set, a
   *  delegated run uses this as its cwd so the agent loads the project's
   *  CLAUDE.md / .claude settings and operates on those files. Unset =
   *  inherit the parent process cwd. */
  projectDir?: string;
  /** SDK tool allowlist for delegated runs (`tools`). When set, the
   *  delegated agent may only use these tools (passed as `allowedTools`).
   *  Unset = all tools available. Distinct from `warroomTools`, which
   *  governs the war-room session. */
  tools?: string[];
  /** Skills this agent specializes in (`skills`). All installed skills
   *  remain available via the Skill tool; this list is surfaced to the
   *  agent as its primary skills rather than hard-enforced. */
  skills?: string[];
  /** Free-text routing hints (`triggers`). Currently advisory only — no
   *  automatic trigger-based routing is wired. Parsed so the dashboard
   *  and future routing can read them without a schema change. */
  triggers?: string[];
  /** MCP server allowlist. Accepts either `mcp_servers` or `mcp` in
   *  agent.yaml; both map here. */
  mcpServers?: string[];
  /** Per-agent war-room tool allowlist. Tokens are SDK tool names
   *  ("Bash", "Write") or "mcp:<name>" entries to opt an MCP server in.
   *  Overrides the defaults in warroom-tool-policy.ts. Unset = use
   *  defaults. */
  warroomTools?: string[];
  obsidian?: {
    vault: string;
    folders: string[];
    readOnly?: string[];
  };
  /** Pika voice id used when this agent joins a video meeting. Falls back
   *  to the Pika preset English_radiant_girl if unset. */
  meetVoiceId?: string;
  /** Display name shown in the meeting ("Your Agent wants to join"). Falls
   *  back to the agent's name or id with first letter capitalized. */
  meetBotName?: string;
}

/**
 * Resolve the directory for a given agent, checking CLAUDECLAW_CONFIG first,
 * then falling back to PROJECT_ROOT/agents/<id>.
 */
export function resolveAgentDir(agentId: string): string {
  const externalDir = path.join(CLAUDECLAW_CONFIG, 'agents', agentId);
  if (fs.existsSync(path.join(externalDir, 'agent.yaml'))) {
    return externalDir;
  }
  return path.join(PROJECT_ROOT, 'agents', agentId);
}

/**
 * Resolve the CLAUDE.md path for a given agent, checking CLAUDECLAW_CONFIG first,
 * then falling back to PROJECT_ROOT/agents/<id>/CLAUDE.md.
 */
export function resolveAgentClaudeMd(agentId: string): string | null {
  const externalPath = path.join(CLAUDECLAW_CONFIG, 'agents', agentId, 'CLAUDE.md');
  if (fs.existsSync(externalPath)) {
    return externalPath;
  }
  const repoPath = path.join(PROJECT_ROOT, 'agents', agentId, 'CLAUDE.md');
  if (fs.existsSync(repoPath)) {
    return repoPath;
  }
  return null;
}

export function loadAgentConfig(agentId: string): AgentConfig {
  const agentDir = resolveAgentDir(agentId);
  const configPath = path.join(agentDir, 'agent.yaml');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Agent config not found: ${configPath}`);
  }

  const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;

  const name = raw['name'] as string;
  const description = (raw['description'] as string) ?? '';
  const botTokenEnv = (raw['telegram_bot_token_env'] as string) || '';
  const model = raw['model'] as string | undefined;
  const slackChannel = typeof raw['slack_channel'] === 'string' ? (raw['slack_channel'] as string) : undefined;
  const displayName = typeof raw['display_name'] === 'string' ? (raw['display_name'] as string) : undefined;
  const projectDir = typeof raw['project_dir'] === 'string' ? (raw['project_dir'] as string) : undefined;

  if (!name) {
    throw new Error(`Agent config ${configPath} must have 'name'`);
  }

  // The Telegram bot token is OPTIONAL: delegation-only agents (reached via
  // @agentId: / /delegate through the main bot) never poll Telegram and need
  // no token. A token is only required to run the agent as a standalone
  // process (--agent), which index.ts enforces at startup.
  let botToken = '';
  if (botTokenEnv) {
    const env = readEnvFile([botTokenEnv]);
    botToken = process.env[botTokenEnv] || env[botTokenEnv] || '';
  }

  let obsidian: AgentConfig['obsidian'];
  const obsRaw = raw['obsidian'] as Record<string, unknown> | undefined;
  if (obsRaw) {
    const vault = obsRaw['vault'] as string;
    if (vault && !fs.existsSync(vault)) {
      // eslint-disable-next-line no-console
      console.warn(`[${agentId}] WARNING: Obsidian vault path does not exist: ${vault}`);
      console.warn(`[${agentId}] Update obsidian.vault in agent.yaml to your local vault path.`);
    }
    obsidian = {
      vault,
      folders: (obsRaw['folders'] as string[]) ?? [],
      readOnly: (obsRaw['read_only'] as string[]) ?? [],
    };
  }

  if (projectDir && !fs.existsSync(projectDir)) {
    // eslint-disable-next-line no-console
    console.warn(`[${agentId}] WARNING: project_dir does not exist: ${projectDir}`);
    console.warn(`[${agentId}] Delegated runs will fall back to the parent process cwd.`);
  }

  // mcp_servers (canonical) or mcp (alias) can be a plain string array, or
  // (in richer custom yamls) a mapping of server name → metadata. Either
  // way the allowlist is the names.
  let mcpServers: string[] | undefined;
  const mcpRaw = raw['mcp_servers'] ?? raw['mcp'];
  if (Array.isArray(mcpRaw)) {
    mcpServers = mcpRaw.filter((s): s is string => typeof s === 'string');
  } else if (mcpRaw && typeof mcpRaw === 'object') {
    mcpServers = Object.keys(mcpRaw as Record<string, unknown>);
  }

  // Optional string-list fields. Tolerate non-array values by coercing to
  // undefined so a malformed yaml never throws here.
  const stringList = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : undefined;
  const tools = stringList(raw['tools']);
  const skills = stringList(raw['skills']);
  const triggers = stringList(raw['triggers']);
  // War-room tool policy override. If present in agent.yaml, this list
  // overrides the per-agent default in warroom-tool-policy.ts. Tokens
  // can be SDK tool names ("Bash", "Write") or "mcp:<name>" to opt that
  // MCP server into the war-room session.
  const warroomTools = raw['warroom_tools'] as string[] | undefined;
  const meetVoiceId = typeof raw['meet_voice_id'] === 'string' ? (raw['meet_voice_id'] as string) : undefined;
  const meetBotName = typeof raw['meet_bot_name'] === 'string' ? (raw['meet_bot_name'] as string) : undefined;

  return {
    name,
    description,
    botTokenEnv,
    botToken,
    model,
    slackChannel,
    displayName,
    projectDir,
    tools,
    skills,
    triggers,
    mcpServers,
    warroomTools,
    obsidian,
    meetVoiceId,
    meetBotName,
  };
}

/**
 * Resolve an agent.yaml `model` value to a canonical Claude model id.
 * Accepts a full id ("claude-sonnet-4-6") or a chat alias ("opus",
 * "sonnet", "haiku"). Returns undefined when unset or unrecognized so the
 * caller can fall back to the default model.
 */
export function resolveAgentModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  if (isValidClaudeModel(model)) return model;
  return resolveClaudeModelAlias(model);
}

/**
 * Build the Slack channel → agent id routing map from every configured
 * agent's `slack_channel`. Last-writer-wins if two agents claim the same
 * channel (and we warn). Called once at createSlackBot startup; the bot
 * must restart to pick up edits.
 */
export function getSlackChannelMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of listAgentIds()) {
    try {
      const cfg = loadAgentConfig(id);
      const ch = cfg.slackChannel?.trim();
      if (!ch) continue;
      const existing = map.get(ch);
      if (existing && existing !== id) {
        // eslint-disable-next-line no-console
        console.warn(`[slack] channel ${ch} claimed by both "${existing}" and "${id}"; using "${id}"`);
      }
      map.set(ch, id);
    } catch {
      // Skip agents whose config fails to load.
    }
  }
  return map;
}

/** Update the model field in an agent's agent.yaml file. */
export function setAgentModel(agentId: string, model: string): void {
  const agentDir = resolveAgentDir(agentId);
  const configPath = path.join(agentDir, 'agent.yaml');
  if (!fs.existsSync(configPath)) throw new Error(`Agent config not found: ${configPath}`);

  const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  raw['model'] = model;
  fs.writeFileSync(configPath, yaml.dump(raw, { lineWidth: -1 }), 'utf-8');
}

/** Set or clear the `slack_channel` key in an agent's agent.yaml. Pass a
 *  channel id to route that Slack channel to this agent; pass an empty
 *  string to remove the key entirely (channel routing off). Mirrors
 *  setAgentModel. The channel→agent map is built once at createSlackBot
 *  startup, so a write here only takes effect after the bot restarts. */
export function setAgentSlackChannel(agentId: string, channel: string): void {
  const agentDir = resolveAgentDir(agentId);
  const configPath = path.join(agentDir, 'agent.yaml');
  if (!fs.existsSync(configPath)) throw new Error(`Agent config not found: ${configPath}`);

  const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  const trimmed = channel.trim();
  if (trimmed) {
    raw['slack_channel'] = trimmed;
  } else {
    delete raw['slack_channel'];
  }
  fs.writeFileSync(configPath, yaml.dump(raw, { lineWidth: -1 }), 'utf-8');
}

/** Update display name and/or description in agent.yaml. */
export function setAgentProfile(
  agentId: string,
  fields: { name?: string; description?: string },
): void {
  const agentDir = resolveAgentDir(agentId);
  const configPath = path.join(agentDir, 'agent.yaml');
  if (!fs.existsSync(configPath)) throw new Error(`Agent config not found: ${configPath}`);

  const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  if (fields.name !== undefined) {
    const name = fields.name.trim();
    if (!name) throw new Error('name required');
    raw['name'] = name;
  }
  if (fields.description !== undefined) {
    raw['description'] = fields.description.trim();
  }
  if (!raw['name']) throw new Error('agent.yaml requires a name field');
  fs.writeFileSync(configPath, yaml.dump(raw, { lineWidth: -1 }), 'utf-8');
}

/** List all configured agent IDs (directories under agents/ with agent.yaml).
 *  Scans both CLAUDECLAW_CONFIG/agents/ and PROJECT_ROOT/agents/, deduplicating.
 */
export function listAgentIds(): string[] {
  const ids = new Set<string>();

  for (const baseDir of [
    path.join(CLAUDECLAW_CONFIG, 'agents'),
    path.join(PROJECT_ROOT, 'agents'),
  ]) {
    if (!fs.existsSync(baseDir)) continue;
    for (const d of fs.readdirSync(baseDir)) {
      if (d.startsWith('_')) continue;
      const yamlPath = path.join(baseDir, d, 'agent.yaml');
      if (fs.existsSync(yamlPath)) ids.add(d);
    }
  }

  return [...ids];
}

/** Return the capabilities (name + description) for a specific agent. */
export function getAgentCapabilities(
  agentId: string,
): { name: string; description: string } | null {
  try {
    const config = loadAgentConfig(agentId);
    return { name: config.name, description: config.description };
  } catch {
    return null;
  }
}

/**
 * List all configured agents with their descriptions.
 * Unlike `listAgentIds()`, this returns richer metadata and silently
 * skips agents whose config fails to load (e.g. missing token).
 */
export function listAllAgents(): Array<{
  id: string;
  name: string;
  description: string;
  model?: string;
}> {
  const ids = listAgentIds();
  const result: Array<{
    id: string;
    name: string;
    description: string;
    model?: string;
  }> = [];

  for (const id of ids) {
    try {
      const config = loadAgentConfig(id);
      result.push({
        id,
        name: config.name,
        description: config.description,
        model: config.model,
      });
    } catch {
      // Skip agents with broken config
    }
  }

  return result;
}

/**
 * Write the current agent roster to the path the Python Pipecat voice
 * stack reads from. Call this:
 *   - On main-bot startup (index.ts does this already)
 *   - After creating or deleting an agent (agent-create flow)
 *   - Before /warroom/text turns (orchestrator does this cheaply too)
 *
 * The file is read-only metadata: id, name, description. The voice
 * server kills + respawns its subprocess when this changes if callers
 * want the new roster to take effect immediately.
 */
export function refreshWarRoomRoster(): void {
  try {
    const ids = ['main', ...listAgentIds().filter((id) => id !== 'main')];
    const roster = ids.map((id) => {
      try {
        if (id === 'main') return { id: 'main', name: 'Main', description: 'General ops and triage' };
        const cfg = loadAgentConfig(id);
        return { id, name: cfg.name || id, description: cfg.description || '' };
      } catch {
        return { id, name: id, description: '' };
      }
    });
    fs.writeFileSync(WARROOM_ROSTER_PATH, JSON.stringify(roster, null, 2));
  } catch {
    // Non-fatal. Voice stack falls back to the built-in default roster
    // if the file is missing.
  }
}
