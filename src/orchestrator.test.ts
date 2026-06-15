import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock every side-effecting dependency so the test exercises only
// delegateToAgent's cwd-routing wiring. The point of this suite is the
// regression guard for SK-05: a delegated agent whose agent.yaml sets
// `project_dir` must run with that dir as its SDK cwd so relative-path
// writes (projects/, context/learnings.md) land in the workspace, not the
// bot's own repo root.
// Delegation routes through runAgentWithRetry so transient errors (rate
// limits, subprocess crashes, overloaded/billing) recover the same way the
// main message path does — the per-agent cwd survives across retries.
vi.mock('./agent.js', () => ({ runAgentWithRetry: vi.fn(async () => ({ text: 'ok', newSessionId: 's1', usage: null })) }));
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

import { runAgentWithRetry } from './agent.js';
import { resolveAgentRuntime } from './agent-config.js';
import { delegateToAgent } from './orchestrator.js';

// runAgentWithRetry positional signature:
// (message, sessionId, onTyping, onProgress, model, abortController,
//  onStreamText, onRetry, fallbackModels, mcpAllowlist, cwd)
const CWD_ARG = 10;
const MCP_ARG = 9;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runAgentWithRetry).mockResolvedValue({ text: 'ok', newSessionId: 's1', usage: null });
});

describe('delegateToAgent', () => {
  it('runs the delegated agent in its resolved project_dir cwd', async () => {
    await delegateToAgent('aos', 'do a thing', 'chat1', 'main');

    // Delegation must go through the retry wrapper, not runAgent directly, so
    // a transient failure mid-delegation recovers instead of surfacing.
    expect(runAgentWithRetry).toHaveBeenCalledTimes(1);
    // The resolved cwd (project_dir) must be passed through to the SDK so
    // the subprocess resolves relative writes against the workspace.
    expect(vi.mocked(runAgentWithRetry).mock.calls[0][CWD_ARG]).toBe('/Users/test/agentic-os');
    // It must come from resolveAgentRuntime, which honors project_dir.
    expect(resolveAgentRuntime).toHaveBeenCalledWith('aos');
  });

  it('forwards the agent MCP allowlist alongside the cwd', async () => {
    await delegateToAgent('aos', 'do a thing', 'chat1', 'main');

    expect(vi.mocked(runAgentWithRetry).mock.calls[0][MCP_ARG]).toEqual(['firecrawl']);
  });

  it('starts each delegation with a fresh session (no resume)', async () => {
    await delegateToAgent('aos', 'do a thing', 'chat1', 'main');

    // sessionId is the 2nd positional arg — undefined means a fresh session.
    expect(vi.mocked(runAgentWithRetry).mock.calls[0][1]).toBeUndefined();
  });
});
