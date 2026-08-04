#!/usr/bin/env node
/**
 * ClaudeClaw Mission CLI
 *
 * Used by Claude assistants to create and manage one-shot mission tasks
 * that are picked up and executed by the target agent's scheduler.
 *
 * Usage:
 *   node dist/mission-cli.js create --title "Label" "Full prompt"          (auto-routes)
 *   node dist/mission-cli.js create --agent research --title "Label" "..."
 *   node dist/mission-cli.js agents
 *   node dist/mission-cli.js list [--status queued] [--agent research]
 *   node dist/mission-cli.js result <id>
 *   node dist/mission-cli.js cancel <id>
 */

import { randomBytes } from 'crypto';

import {
  initDatabase,
  createMissionTask,
  getMissionTasks,
  getMissionTask,
  cancelMissionTask,
  isAgentPaused,
} from './db.js';
import { listAgentIds, loadAgentConfig } from './agent-config.js';
import { classifyTaskAgent } from './task-router.js';
import { isEnabled } from './kill-switches.js';

initDatabase();

// Parse --agent flag (omit to auto-route to the best-suited agent)
const agentFlagIdx = process.argv.indexOf('--agent');
const targetAgent = agentFlagIdx !== -1
  ? process.argv[agentFlagIdx + 1] ?? null
  : null;

// Parse --title flag
const titleFlagIdx = process.argv.indexOf('--title');
const titleArg = titleFlagIdx !== -1
  ? process.argv[titleFlagIdx + 1] ?? ''
  : '';

// Parse --status flag
const statusFlagIdx = process.argv.indexOf('--status');
const statusFilter = statusFlagIdx !== -1
  ? process.argv[statusFlagIdx + 1] ?? undefined
  : undefined;

// Parse --priority flag
const priorityFlagIdx = process.argv.indexOf('--priority');
const priorityArg = priorityFlagIdx !== -1
  ? parseInt(process.argv[priorityFlagIdx + 1] ?? '0', 10)
  : 5;

// Who created this task
const createdBy = process.env.CLAUDECLAW_AGENT_ID ?? 'main';

// Clean argv: remove all flag pairs
const flagIndices = new Set<number>();
[agentFlagIdx, titleFlagIdx, statusFlagIdx, priorityFlagIdx].forEach(idx => {
  if (idx !== -1) { flagIndices.add(idx); flagIndices.add(idx + 1); }
});
const cleanedArgv = process.argv.filter((_, i) => !flagIndices.has(i));
const [, , command, ...rest] = cleanedArgv;

function formatDate(unix: number | null): string {
  if (!unix) return '-';
  return new Date(unix * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function validAgents(): string[] {
  return ['main', ...listAgentIds()];
}

switch (command) {
  case 'create': {
    const prompt = rest[0];
    if (!prompt) {
      console.error('Usage: mission-cli create [--agent <id>] --title "Label" "Full prompt text"');
      console.error('Omit --agent to auto-route the task to the best-suited agent.');
      process.exit(1);
    }

    // Reject typo'd agent ids up front — a task assigned to an agent that
    // doesn't exist is never claimed and sits queued forever.
    if (targetAgent && !validAgents().includes(targetAgent)) {
      console.error(`Unknown agent: ${targetAgent}. Valid: ${validAgents().join(', ')}`);
      console.error('Or omit --agent to auto-route.');
      process.exit(1);
    }

    const title = titleArg || prompt.slice(0, 60);
    const id = randomBytes(4).toString('hex');

    // No --agent: classify against the live roster right here so the caller
    // can report where the task went. If classification fails (or auto-assign
    // is switched off), create unassigned — the scheduler's sweep retries
    // routing on its next tick, so the task still runs without a human.
    let assigned = targetAgent;
    let routedBy: 'flag' | 'auto' | 'pending' = targetAgent ? 'flag' : 'pending';
    if (!assigned && isEnabled('MISSION_AUTO_ASSIGN_ENABLED')) {
      try {
        assigned = await classifyTaskAgent(prompt);
        if (assigned) routedBy = 'auto';
      } catch { /* fall through to unassigned */ }
    }

    createMissionTask(id, title, prompt, assigned ?? null, createdBy, priorityArg);

    const agentLine = routedBy === 'flag' ? assigned
      : routedBy === 'auto' ? `${assigned} (auto-routed)`
      : 'unassigned — the scheduler will route it to the best agent shortly';
    console.log(`Mission task created: ${id}`);
    console.log(`  Title:    ${title}`);
    console.log(`  Agent:    ${agentLine}`);
    console.log(`  Priority: ${priorityArg}`);
    console.log(`  Prompt:   ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`);
    break;
  }

  case 'agents': {
    // Live roster from agent.yaml on disk — the source of truth the router
    // classifies against, so callers never need a hardcoded agent list.
    const rows = [
      { id: 'main', description: 'Primary assistant, general tasks, anything that does not clearly fit another agent' },
      ...listAgentIds().map((agentId) => {
        try { return { id: agentId, description: loadAgentConfig(agentId).description }; }
        catch { return { id: agentId, description: '(no description)' }; }
      }),
    ];
    console.log(`${rows.length} agents:\n`);
    for (const a of rows) {
      const paused = isAgentPaused(a.id) ? ' [paused]' : '';
      console.log(`${a.id}${paused}`);
      console.log(`  ${a.description}`);
      console.log();
    }
    break;
  }

  case 'list': {
    const tasks = getMissionTasks(targetAgent ?? undefined, statusFilter);
    if (tasks.length === 0) {
      const scope = [
        targetAgent ? ` for @${targetAgent}` : '',
        statusFilter ? ` with status "${statusFilter}"` : '',
      ].join('');
      console.log('No mission tasks' + scope + '.');
      break;
    }
    console.log(`${tasks.length} mission task${tasks.length === 1 ? '' : 's'}:\n`);
    for (const t of tasks) {
      console.log(`${t.id} [${t.status}] @${t.assigned_agent ?? 'unassigned'}`);
      console.log(`  Title:   ${t.title}`);
      console.log(`  Created: ${formatDate(t.created_at)}`);
      if (t.completed_at) console.log(`  Done:    ${formatDate(t.completed_at)}`);
      console.log();
    }
    break;
  }

  case 'result': {
    const id = rest[0];
    if (!id) { console.error('Usage: mission-cli result <id>'); process.exit(1); }
    const task = getMissionTask(id);
    if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }
    console.log(`Task:   ${task.id} [${task.status}]`);
    console.log(`Title:  ${task.title}`);
    console.log(`Agent:  ${task.assigned_agent}`);
    if (task.result) {
      console.log(`\nResult:\n${task.result}`);
    } else if (task.error) {
      console.log(`\nError: ${task.error}`);
    } else {
      console.log('\nNo result yet.');
    }
    break;
  }

  case 'cancel': {
    const id = rest[0];
    if (!id) { console.error('Usage: mission-cli cancel <id>'); process.exit(1); }
    const ok = cancelMissionTask(id);
    console.log(ok ? `Cancelled task: ${id}` : `Could not cancel (may already be completed): ${id}`);
    break;
  }

  default:
    console.error('Commands: create | agents | list | result | cancel');
    process.exit(1);
}
