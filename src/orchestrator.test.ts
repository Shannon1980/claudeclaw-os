import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock every side-effecting dependency so the test exercises only
// delegateToAgent's cwd-routing wiring. The point of this suite is the
// regression guard for SK-05: a delegated agent whose agent.yaml sets
// `project_dir` must run with that dir as its SDK cwd so relative-path
// writes (projects/, context/learnings.md) land in the workspace, not the
// bot's own repo root.
vi.mock('./agent.js', () => ({ runAgent: vi.fn(async () => ({ text: 'ok', newSessionId: 's1', usage: null })) }));
vi.mock('./agent-config.js', () => ({
  listAgentIds: vi.fn(() => ['aos']),
  loadAgentConfig: vi.fn(() => ({
    name: 'AOS',
    description: 'workspace agent',
    botTokenEnv: '',
    botToken: '',
    mcpServers: ['firecrawl'],
  })),
  resolveAgentClaudeMd: vi.fn(() => null),
  resolveAgentRuntime: vi.fn(() => ({
    agentId: 'aos',
    cwd: '/Users/test/agentic-os',
    model: undefined,
    systemPrompt: undefined,
    mcpAllowlist: ['firecrawl'],
  })),
}));
vi.mock('./db.js', () => ({
  logToHiveMind: vi.fn(),
  createInterAgentTask: vi.fn(),
  completeInterAgentTask: vi.fn(),
}));
vi.mock('./memory.js', () => ({
  buildMemoryContext: vi.fn(async () => ({ contextText: '' })),
}));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runAgent } from './agent.js';
import { resolveAgentRuntime } from './agent-config.js';
import { buildMemoryContext } from './memory.js';
import { delegateToAgent } from './orchestrator.js';

// runAgent positional signature:
// (message, sessionId, onTyping, onProgress, model, abortController,
//  onStreamText, mcpAllowlist, cwd)
const CWD_ARG = 8;
const MCP_ARG = 7;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runAgent).mockResolvedValue({ text: 'ok', newSessionId: 's1', usage: null });
});

describe('delegateToAgent', () => {
  it('runs the delegated agent in its resolved project_dir cwd', async () => {
    await delegateToAgent('aos', 'do a thing', 'chat1', 'main');

    expect(runAgent).toHaveBeenCalledTimes(1);
    // The resolved cwd (project_dir) must be passed through to the SDK so
    // the subprocess resolves relative writes against the workspace.
    expect(vi.mocked(runAgent).mock.calls[0][CWD_ARG]).toBe('/Users/test/agentic-os');
    // It must come from resolveAgentRuntime, which honors project_dir.
    expect(resolveAgentRuntime).toHaveBeenCalledWith('aos');
  });

  it('forwards the agent MCP allowlist alongside the cwd', async () => {
    await delegateToAgent('aos', 'do a thing', 'chat1', 'main');

    expect(vi.mocked(runAgent).mock.calls[0][MCP_ARG]).toEqual(['firecrawl']);
  });

  it('starts each delegation with a fresh session (no resume)', async () => {
    await delegateToAgent('aos', 'do a thing', 'chat1', 'main');

    // sessionId is the 2nd positional arg — undefined means a fresh session.
    expect(vi.mocked(runAgent).mock.calls[0][1]).toBeUndefined();
  });

  it('scopes delegated recall to the agent via strictAgentId (no cross-agent leakage)', async () => {
    await delegateToAgent('aos', 'do a thing', 'chat1', 'main');

    // buildMemoryContext's 4th arg is the options object; strict scoping
    // constrains recall to this agent's own memories.
    expect(vi.mocked(buildMemoryContext).mock.calls[0][3]).toEqual({ strictAgentId: 'aos' });
  });
});
