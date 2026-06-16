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
 *  followed by uppercase alphanumerics, e.g. `C0XXXX`. Validated loosely
 *  (the exact length is not pinned) so future id shapes still pass. Used to
 *  guard the dashboard `slack_channel` editor and the agent.yaml load path. */
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
  /** Working directory the agent runs in (`project_dir`). When set, a
   *  routed/delegated run uses this as its SDK cwd so the agent loads that
   *  project's CLAUDE.md / .claude settings and operates on those files.
   *  Unset = the agent's own directory under agents/<id>. */
  projectDir?: string;
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
  /** Slack channel ID (e.g. "C0XXXXXXX") this agent owns. When the main
   *  Slack bot receives a message in this channel, it routes the message to
   *  this agent instead of main. Single Slack app, many agents — see
   *  getSlackChannelMap(). Unset = no dedicated Slack channel (the agent is
   *  still reachable via @agentId: / /delegate). */
  slackChannel?: string;
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

  // mcp_servers can be a plain string array, or (in richer custom yamls) a
  // mapping of server name → metadata. Either way the allowlist is the names.
  let mcpServers: string[] | undefined;
  const mcpRaw = raw['mcp_servers'];
  if (Array.isArray(mcpRaw)) {
    mcpServers = mcpRaw.filter((s): s is string => typeof s === 'string');
  } else if (mcpRaw && typeof mcpRaw === 'object') {
    mcpServers = Object.keys(mcpRaw as Record<string, unknown>);
  }
  // War-room tool policy override. If present in agent.yaml, this list
  // overrides the per-agent default in warroom-tool-policy.ts. Tokens
  // can be SDK tool names ("Bash", "Write") or "mcp:<name>" to opt that
  // MCP server into the war-room session.
  const warroomTools = raw['warroom_tools'] as string[] | undefined;
  const meetVoiceId = typeof raw['meet_voice_id'] === 'string' ? (raw['meet_voice_id'] as string) : undefined;
  const meetBotName = typeof raw['meet_bot_name'] === 'string' ? (raw['meet_bot_name'] as string) : undefined;
  let slackChannel =
    typeof raw['slack_channel'] === 'string' && (raw['slack_channel'] as string).trim()
      ? (raw['slack_channel'] as string).trim()
      : undefined;
  // Validate the channel id shape on the read path too (not just the dashboard
  // write path) so a hand-edited agent.yaml with a malformed value drops to
  // undefined with a signal, rather than silently never matching a channel in
  // getSlackChannelMap().
  if (slackChannel && !SLACK_CHANNEL_RE.test(slackChannel)) {
    // eslint-disable-next-line no-console
    console.warn(`[${agentId}] WARNING: slack_channel "${slackChannel}" is not a valid channel id (expected e.g. C0XXXX); ignoring.`);
    slackChannel = undefined;
  }
  const projectDir = typeof raw['project_dir'] === 'string' ? (raw['project_dir'] as string) : undefined;
  if (projectDir && !fs.existsSync(projectDir)) {
    // eslint-disable-next-line no-console
    console.warn(`[${agentId}] WARNING: project_dir does not exist: ${projectDir}`);
    console.warn(`[${agentId}] Runs will fall back to the agent's own directory.`);
  }

  return {
    name,
    description,
    botTokenEnv,
    botToken,
    model,
    projectDir,
    mcpServers,
    warroomTools,
    obsidian,
    meetVoiceId,
    meetBotName,
    slackChannel,
  };
}

/**
 * Stable, deterministic memory pool key for a workspace agent.
 *
 * Both modes (a terminal Claude Code session captured via the Stop hook AND
 * the bot's delegated `@aos:` turns) must read/write ONE shared memory pool so
 * they behave as one assistant (the locked unified-pool decision). Memories are
 * normally keyed by the caller's chat_id, which differs per chat and never
 * intersects the terminal. Keying both halves on this stable value
 * (`ws:<agentId>`) collapses them onto a single pool.
 *
 * Used by delegation save (message-core), delegation recall (orchestrator),
 * the memory projection, and the capture CLI — all four MUST resolve their
 * chat_id through this helper so they agree on one pool.
 */
export function workspaceMemoryKey(agentId: string): string {
  return `ws:${agentId}`;
}

/**
 * True when the agent is a workspace agent: its config has a `project_dir`
 * that exists on disk. Reuses the EXACT predicate `resolveAgentRuntime` uses
 * to pick the cwd (`config.projectDir && fs.existsSync(config.projectDir)`) so
 * the two never diverge. Returns false (never throws) when the config cannot
 * be loaded — callers treat an unknown/broken agent as non-workspace.
 *
 * Only workspace agents are rerouted onto the shared pool; non-workspace agents
 * and the main (non-delegated) path keep their caller chat_id unchanged
 * (COMPAT-02).
 */
export function isWorkspaceAgent(agentId: string): boolean {
  try {
    const config = loadAgentConfig(agentId);
    return Boolean(config.projectDir && fs.existsSync(config.projectDir));
  } catch {
    return false;
  }
}

// ── Slack channel routing ────────────────────────────────────────────

/** Resolved per-agent runtime used to run a sub-agent in-process for a
 *  routed Slack channel message: the SDK cwd (so it loads the agent's
 *  CLAUDE.md + .claude/settings.json), the default model, the system prompt
 *  injected on a fresh session, and the MCP allowlist. */
export interface AgentRuntime {
  agentId: string;
  cwd: string;
  model?: string;
  systemPrompt?: string;
  mcpAllowlist?: string[];
}

/**
 * Resolve the full runtime for a sub-agent so the shared message core can
 * run it without flipping the process-global agent overrides (which are not
 * concurrency-safe). Throws if the agent config can't be loaded.
 */
export function resolveAgentRuntime(agentId: string): AgentRuntime {
  const config = loadAgentConfig(agentId);
  // An explicit, existing project_dir wins so the agent runs against that
  // project's files; otherwise fall back to the agent's own directory.
  const cwd =
    config.projectDir && fs.existsSync(config.projectDir)
      ? config.projectDir
      : resolveAgentDir(agentId);
  let systemPrompt: string | undefined;
  const claudeMdPath = resolveAgentClaudeMd(agentId);
  if (claudeMdPath) {
    try {
      systemPrompt = fs.readFileSync(claudeMdPath, 'utf-8');
    } catch {
      /* no CLAUDE.md — fine */
    }
  }
  return { agentId, cwd, model: resolveAgentModel(config.model), systemPrompt, mcpAllowlist: config.mcpServers };
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
 * Build the Slack channel → agentId routing map from all configured agents.
 * Agents whose config fails to load (or that declare no slack_channel) are
 * skipped. If two agents claim the same channel the first one wins and a
 * warning is logged.
 */
export function getSlackChannelMap(): Map<string, string> {
  const map = new Map<string, string>();
  // Sort for deterministic conflict resolution: when two agents claim the
  // same channel, the alphabetically-first id wins regardless of the
  // filesystem's directory scan order.
  for (const id of listAgentIds().sort()) {
    let channel: string | undefined;
    try {
      channel = loadAgentConfig(id).slackChannel;
    } catch (err) {
      // Don't let a malformed agent.yaml silently vanish from routing — a user
      // posting in that agent's channel would just get nothing, with no signal.
      // eslint-disable-next-line no-console
      console.warn(`[agent-config] skipping agent "${id}" for Slack channel routing: config failed to load:`, err instanceof Error ? err.message : err);
      continue;
    }
    if (!channel) continue;
    if (map.has(channel)) {
      // eslint-disable-next-line no-console
      console.warn(`[agent-config] Slack channel ${channel} claimed by both "${map.get(channel)}" and "${id}"; keeping "${map.get(channel)}".`);
      continue;
    }
    map.set(channel, id);
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
 *  channel id to route that Slack channel to this agent; pass an empty string
 *  to remove the key (channel routing off). Mirrors setAgentModel. The
 *  channel→agent map is built once at createSlackBot startup, so a write here
 *  only takes effect after the bot restarts. The caller is responsible for
 *  validating the channel id shape (see SLACK_CHANNEL_RE). */
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
