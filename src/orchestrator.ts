import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { runAgentWithRetry, UsageInfo } from './agent.js';
import { loadAgentConfig, listAgentIds, resolveAgentClaudeMd, resolveAgentModel } from './agent-config.js';
import { MODEL_FALLBACK_CHAIN, PROJECT_ROOT } from './config.js';
import { logToHiveMind, createInterAgentTask, completeInterAgentTask } from './db.js';
import { logger } from './logger.js';
import { buildMemoryContext } from './memory.js';

// ── Types ────────────────────────────────────────────────────────────

export interface DelegationResult {
  agentId: string;
  text: string | null;
  usage: UsageInfo | null;
  taskId: string;
  durationMs: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
}

// ── Registry ─────────────────────────────────────────────────────────

/** Cache of available agents loaded at startup. */
let agentRegistry: AgentInfo[] = [];

/** Default timeout for a delegated task (5 minutes). */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Initialize the orchestrator by scanning `agents/` for valid configs.
 * Safe to call even if no agents are configured — the registry will be empty.
 */
export function initOrchestrator(): void {
  rebuildRegistry();
  logger.info(
    { agents: agentRegistry.map((a) => a.id) },
    'Orchestrator initialized',
  );
}

function rebuildRegistry(): void {
  const ids = listAgentIds();
  const next: AgentInfo[] = [];
  for (const id of ids) {
    try {
      const config = loadAgentConfig(id);
      next.push({ id, name: config.name, description: config.description });
    } catch (err) {
      // Agent config is broken (e.g. missing token) — skip it but warn
      logger.warn({ agentId: id, err }, 'Skipping agent — config load failed');
    }
  }
  agentRegistry = next;
}

/**
 * Refresh the cached registry from disk. Call after createAgent/deleteAgent
 * so @delegate: syntax sees newly-created agents without a process restart.
 */
export function refreshAgentRegistry(): void {
  rebuildRegistry();
  logger.info({ agents: agentRegistry.map((a) => a.id) }, 'Orchestrator registry refreshed');
}

/** Return all agents that were successfully loaded. */
export function getAvailableAgents(): AgentInfo[] {
  return [...agentRegistry];
}

// ── Delegation ───────────────────────────────────────────────────────

/**
 * Parse a user message for delegation syntax.
 *
 * Supported forms:
 *   @agentId: prompt text
 *   @agentId prompt text   (only if agentId is a known agent)
 *   /delegate agentId prompt text
 *
 * Returns `{ agentId, prompt }` or `null` if no delegation detected.
 */
export function parseDelegation(
  message: string,
): { agentId: string; prompt: string } | null {
  // /delegate agentId prompt
  const cmdMatch = message.match(
    /^\/delegate\s+(\S+)\s+([\s\S]+)/i,
  );
  if (cmdMatch) {
    return { agentId: cmdMatch[1], prompt: cmdMatch[2].trim() };
  }

  // @agentId: prompt
  const atMatch = message.match(
    /^@(\S+?):\s*([\s\S]+)/,
  );
  if (atMatch) {
    return { agentId: atMatch[1], prompt: atMatch[2].trim() };
  }

  // @agentId prompt (only for known agents to avoid false positives)
  const atMatchNoColon = message.match(
    /^@(\S+)\s+([\s\S]+)/,
  );
  if (atMatchNoColon) {
    const candidate = atMatchNoColon[1];
    if (agentRegistry.some((a) => a.id === candidate)) {
      return { agentId: candidate, prompt: atMatchNoColon[2].trim() };
    }
  }

  return null;
}

/**
 * Delegate a task to another agent. Runs the agent's Claude Code session
 * in-process (same Node.js process) with the target agent's cwd and
 * system prompt.
 *
 * The delegation is logged to both `inter_agent_tasks` and `hive_mind`.
 *
 * @param agentId    Target agent identifier (must exist in agents/)
 * @param prompt     The task to delegate
 * @param chatId     Telegram chat ID (for DB tracking)
 * @param fromAgent  The requesting agent's ID (usually 'main')
 * @param onProgress Optional callback for status updates
 * @param timeoutMs  Maximum execution time (default 5 min)
 * @param abortCtrl  Optional external controller so callers can cancel the run
 */
export async function delegateToAgent(
  agentId: string,
  prompt: string,
  chatId: string,
  fromAgent: string,
  onProgress?: (msg: string) => void,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  abortCtrl?: AbortController,
): Promise<DelegationResult> {
  let agent = agentRegistry.find((a) => a.id === agentId);
  if (!agent) {
    // Cache miss: an agent created via the dashboard wizard after this
    // process started won't be in the cache yet. Refresh once and retry.
    rebuildRegistry();
    agent = agentRegistry.find((a) => a.id === agentId);
  }
  if (!agent) {
    const available = agentRegistry.map((a) => a.id).join(', ') || '(none)';
    throw new Error(
      `Agent "${agentId}" not found. Available: ${available}`,
    );
  }

  const taskId = crypto.randomUUID();
  const start = Date.now();

  // Record the task
  createInterAgentTask(taskId, fromAgent, agentId, chatId, prompt);
  logToHiveMind(
    fromAgent,
    chatId,
    'delegate',
    `Delegated to ${agentId}: ${prompt.slice(0, 100)}`,
  );

  onProgress?.(`Delegating to ${agent.name}...`);

  try {
    // Load agent config to get its system prompt and MCP allowlist
    const agentConfig = loadAgentConfig(agentId);
    const claudeMdPath = resolveAgentClaudeMd(agentId);
    let systemPrompt = '';
    if (claudeMdPath) {
      try {
        systemPrompt = fs.readFileSync(claudeMdPath, 'utf-8');
      } catch {
        // No CLAUDE.md for this agent — that's fine
      }
    }

    // Build memory context for the delegated agent
    const { contextText: memCtx } = await buildMemoryContext(chatId, prompt, agentId);

    // Build the delegated prompt with agent role context + memory
    const contextParts: string[] = [];
    if (systemPrompt) {
      contextParts.push(`[Agent role — follow these instructions]\n${systemPrompt}\n[End agent role]`);
    }
    if (memCtx) {
      contextParts.push(memCtx);
    }
    // Surface the agent's designated skills. All installed skills remain
    // available via the Skill tool; this nudges the agent toward its
    // specialties rather than hard-enforcing a subset.
    if (agentConfig.skills?.length) {
      contextParts.push(
        `[Your primary skills — prefer these when relevant]\n${agentConfig.skills.join(', ')}`,
      );
    }
    contextParts.push(prompt);
    const fullPrompt = contextParts.join('\n\n');

    // Per-agent run overrides from agent.yaml.
    const model = resolveAgentModel(agentConfig.model);
    // project_dir sets the cwd so the agent loads that project's CLAUDE.md /
    // .claude settings and operates on its files. Skip if the path is missing
    // (loadAgentConfig already warned) so we don't crash the SDK subprocess.
    const cwd =
      agentConfig.projectDir && fs.existsSync(agentConfig.projectDir)
        ? agentConfig.projectDir
        : undefined;
    // loadAgentConfig warns once at load time, but the dir can also vanish
    // between then and now (deleted/unmounted). Log at the delegation site so
    // a run that silently falls back to the parent cwd — loading the wrong
    // project's CLAUDE.md and touching the wrong files — leaves a signal.
    if (agentConfig.projectDir && !cwd) {
      logger.warn(
        { agentId, projectDir: agentConfig.projectDir },
        'project_dir missing at delegation; running in parent cwd',
      );
    }
    const allowedTools = agentConfig.tools?.length ? agentConfig.tools : undefined;

    // Create an AbortController with timeout (or reuse the caller's)
    const ctrl = abortCtrl ?? new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const result = await runAgentWithRetry(
        fullPrompt,
        undefined, // fresh session for each delegation
        () => {}, // no typing indicator needed for sub-delegation
        undefined, // no progress callback for inner agent
        model, // per-agent model from agent.yaml (resolved alias), else default
        ctrl,
        undefined, // no streaming for delegation
        undefined, // no onRetry — retries are logged by the wrapper, no user channel here
        MODEL_FALLBACK_CHAIN.length > 0 ? MODEL_FALLBACK_CHAIN : undefined, // recover from overloaded/billing like the main path
        agentConfig.mcpServers,
        { cwd, allowedTools }, // per-agent project_dir + tool allowlist (forwarded across retries)
      );

      clearTimeout(timer);

      const durationMs = Date.now() - start;
      completeInterAgentTask(taskId, 'completed', result.text);
      logToHiveMind(
        agentId,
        chatId,
        'delegate_result',
        `Completed delegation from ${fromAgent}: ${(result.text ?? '').slice(0, 120)}`,
      );

      onProgress?.(
        `${agent.name} completed (${Math.round(durationMs / 1000)}s)`,
      );

      return {
        agentId,
        text: result.text,
        usage: result.usage,
        taskId,
        durationMs,
      };
    } catch (innerErr) {
      clearTimeout(timer);
      throw innerErr;
    }
  } catch (err) {
    const durationMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    completeInterAgentTask(taskId, 'failed', errMsg);
    logToHiveMind(
      agentId,
      chatId,
      'delegate_error',
      `Delegation from ${fromAgent} failed: ${errMsg.slice(0, 120)}`,
    );
    throw err;
  }
}
