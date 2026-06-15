import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { runAgent, UsageInfo } from './agent.js';
import { loadAgentConfig, listAgentIds, resolveAgentClaudeMd, resolveAgentRuntime } from './agent-config.js';
import { PROJECT_ROOT, DELEGATION_TIMEOUT_MS } from './config.js';
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

/** Default timeout for a delegated task. Configurable via DELEGATION_TIMEOUT_MS
 *  (default 15 minutes) so file-producing workspace skills that build + render
 *  can finish instead of aborting with "completed with no output". */
const DEFAULT_TIMEOUT_MS = DELEGATION_TIMEOUT_MS;

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
    // Resolve the delegated agent's working directory (its project_dir when
    // set and present, else its own dir). Without this the SDK subprocess
    // falls back to the parent bot's cwd, so a workspace agent would READ from
    // its project_dir but WRITE relative paths (projects/, context/learnings.md)
    // into the bot's repo instead of the workspace.
    const { cwd: delegateCwd } = resolveAgentRuntime(agentId);
    const claudeMdPath = resolveAgentClaudeMd(agentId);
    let systemPrompt = '';
    if (claudeMdPath) {
      try {
        systemPrompt = fs.readFileSync(claudeMdPath, 'utf-8');
      } catch {
        // No CLAUDE.md for this agent — that's fine
      }
    }

    // Build memory context for the delegated agent. Scope recall to this
    // agent so a delegated workspace agent (e.g. aos) only surfaces its own
    // memories, not other agents' memories sharing the chat_id (no
    // cross-agent leakage). The main/non-delegated path is left unscoped on
    // purpose to preserve default-fleet behavior (COMPAT-02).
    const { contextText: memCtx } = await buildMemoryContext(chatId, prompt, agentId, { strictAgentId: agentId });

    // Build the delegated prompt with agent role context + memory
    const contextParts: string[] = [];
    if (systemPrompt) {
      contextParts.push(`[Agent role — follow these instructions]\n${systemPrompt}\n[End agent role]`);
    }
    if (memCtx) {
      contextParts.push(memCtx);
    }
    contextParts.push(prompt);
    const fullPrompt = contextParts.join('\n\n');

    // Create an AbortController with timeout (or reuse the caller's)
    const ctrl = abortCtrl ?? new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const result = await runAgent(
        fullPrompt,
        undefined, // fresh session for each delegation
        () => {}, // no typing indicator needed for sub-delegation
        undefined, // no progress callback for inner agent
        undefined, // use default model
        ctrl,
        undefined, // no streaming for delegation
        agentConfig.mcpServers,
        delegateCwd, // run in the agent's project_dir so writes land in the workspace
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
