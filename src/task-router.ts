/**
 * Shared task→agent router.
 *
 * One classifier, three callers: the dashboard auto-assign routes, the
 * mission CLI (`create` without --agent), and the scheduler's background
 * sweep. Before this lived here, the classifier was private to dashboard.ts,
 * so chat-created tasks could only be routed by opening the browser — an
 * unassigned task sat in "Needs you" forever.
 *
 * All entry points that mutate assignment honor the MISSION_AUTO_ASSIGN_ENABLED
 * kill switch; `classifyTaskAgent` itself is pure classification.
 */

import { listAgentIds, loadAgentConfig } from './agent-config.js';
import { assignMissionTask, getUnassignedMissionTasks } from './db.js';
import { generateContent, parseJsonResponse } from './gemini.js';
import { isEnabled } from './kill-switches.js';
import { logger } from './logger.js';
import { extractViaClaude } from './memory-ingest.js';

/**
 * Pick the best agent for a task prompt from the live roster (agent.yaml
 * descriptions read from disk, so a newly created teammate is routable
 * immediately — no prose list to keep in sync).
 *
 * Primary path is Claude Haiku via OAuth — same auth the agents use, no
 * free-tier quota wall. Gemini classification used to 429 here and surface
 * a 500 to the dashboard, blocking the auto-assign UI. Falls back to Gemini,
 * then hard-defaults to 'main' so a task is never left unroutable.
 */
export async function classifyTaskAgent(prompt: string): Promise<string | null> {
  const agentIds = listAgentIds();
  const validAgents = ['main', ...agentIds];
  const agentDescriptions = agentIds.map((id) => {
    try {
      const config = loadAgentConfig(id);
      return `- ${id}: ${config.description}`;
    } catch { return `- ${id}: (no description)`; }
  });

  const classificationPrompt = `Given these agents and their roles:
- main: Primary assistant, general tasks, anything that doesn't clearly fit another agent
${agentDescriptions.join('\n')}

Which ONE agent is best suited for this task?
Task: "${prompt.slice(0, 500)}"

Reply with JSON: {"agent": "agent_id"}`;

  try {
    const raw = await extractViaClaude(classificationPrompt);
    const parsed = parseJsonResponse<{ agent: string }>(raw);
    if (parsed?.agent && validAgents.includes(parsed.agent)) return parsed.agent;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'Haiku classify failed, falling back to Gemini');
  }

  // Wrapped so a 429 doesn't bubble up — we'd rather assign to 'main' than
  // fail the request.
  try {
    const response = await generateContent(classificationPrompt);
    const parsed = parseJsonResponse<{ agent: string }>(response);
    if (parsed?.agent && validAgents.includes(parsed.agent)) return parsed.agent;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'Gemini classify failed, defaulting to main');
  }
  return 'main';
}

// The sweep can overlap itself (it's called from a 15s interval AND the 60s
// tick). assignMissionTask is a no-op once a task has an agent, so a race is
// harmless — this flag just avoids paying for the same classification twice.
let sweepInFlight = false;

/**
 * Route every unassigned queued task to a teammate. The scheduler calls this
 * each mission tick so a task created without an agent (chat, CLI, capture
 * bar with a dead classifier) starts running within seconds instead of
 * waiting for someone to open the dashboard.
 *
 * Returns the assignments made. Empty when the kill switch is off, a sweep
 * is already running, or there is nothing to route.
 */
export async function autoAssignUnassignedTasks(): Promise<Array<{ id: string; agent: string }>> {
  if (!isEnabled('MISSION_AUTO_ASSIGN_ENABLED')) return [];
  if (sweepInFlight) return [];
  sweepInFlight = true;
  try {
    const tasks = getUnassignedMissionTasks();
    const results: Array<{ id: string; agent: string }> = [];
    for (const task of tasks) {
      try {
        const agent = await classifyTaskAgent(task.prompt);
        if (agent && assignMissionTask(task.id, agent)) {
          results.push({ id: task.id, agent });
          logger.info({ taskId: task.id, agent, title: task.title }, 'Auto-routed unassigned mission task');
        }
      } catch (err) {
        // One unroutable task must not starve the rest of the sweep.
        logger.warn({ err, taskId: task.id }, 'Auto-route failed for task — will retry next sweep');
      }
    }
    return results;
  } finally {
    sweepInFlight = false;
  }
}
