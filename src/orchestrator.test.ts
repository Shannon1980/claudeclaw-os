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
  // Workspace-pool helpers (Phase 5). Default: aos IS a workspace agent so
  // delegated recall keys on the shared ws:aos pool. Individual tests override
  // isWorkspaceAgent to exercise the non-workspace (COMPAT-02) branch.
  isWorkspaceAgent: vi.fn(() => true),
  workspaceMemoryKey: vi.fn((id: string) => `ws:${id}`),
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
import { resolveAgentRuntime, isWorkspaceAgent } from './agent-config.js';
import { buildMemoryContext } from './memory.js';
import { delegateToAgent, parseDelegation, initOrchestrator } from './orchestrator.js';

// runAgentWithRetry positional signature:
// (message, sessionId, onTyping, onProgress, model, abortController,
//  onStreamText, onRetry, fallbackModels, mcpAllowlist, cwd)
const CWD_ARG = 10;
const MCP_ARG = 9;
const MODEL_ARG = 4;

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

  it('forwards the agent-configured model resolved by resolveAgentRuntime', async () => {
    // The per-agent model from agent.yaml (resolved by resolveAgentRuntime)
    // must reach the SDK; otherwise delegation always runs the default model.
    vi.mocked(resolveAgentRuntime).mockReturnValueOnce({
      agentId: 'aos',
      cwd: '/Users/test/agentic-os',
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: undefined,
      mcpAllowlist: ['firecrawl'],
    });

    await delegateToAgent('aos', 'do a thing', 'chat1', 'main');

    expect(vi.mocked(runAgentWithRetry).mock.calls[0][MODEL_ARG]).toBe('claude-haiku-4-5-20251001');
  });

  it('passes undefined model (default) when the agent sets none', async () => {
    await delegateToAgent('aos', 'do a thing', 'chat1', 'main');

    expect(vi.mocked(runAgentWithRetry).mock.calls[0][MODEL_ARG]).toBeUndefined();
  });

  it('starts each delegation with a fresh session (no resume)', async () => {
    await delegateToAgent('aos', 'do a thing', 'chat1', 'main');

    // sessionId is the 2nd positional arg — undefined means a fresh session.
    expect(vi.mocked(runAgentWithRetry).mock.calls[0][1]).toBeUndefined();
  });

  it('scopes delegated recall to the agent via strictAgentId (no cross-agent leakage)', async () => {
    await delegateToAgent('aos', 'do a thing', 'chat1', 'main');

    // buildMemoryContext's 4th arg is the options object; strict scoping
    // constrains recall to this agent's own memories.
    expect(vi.mocked(buildMemoryContext).mock.calls[0][3]).toEqual({ strictAgentId: 'aos' });
  });

  it('recalls a workspace agent from the shared ws:<agentId> pool, not the caller chat_id', async () => {
    // Unified-pool decision: a workspace agent reads the shared pool so the
    // bot surfaces what a terminal session captured. strictAgentId stays = the
    // agent id exactly as Phase 4 left it.
    vi.mocked(isWorkspaceAgent).mockReturnValue(true);

    await delegateToAgent('aos', 'do a thing', 'caller-chat-99', 'main');

    expect(vi.mocked(buildMemoryContext).mock.calls[0][0]).toBe('ws:aos');
    expect(vi.mocked(buildMemoryContext).mock.calls[0][3]).toEqual({ strictAgentId: 'aos' });
  });

  it('recalls a non-workspace agent from the caller chat_id unchanged (COMPAT-02)', async () => {
    vi.mocked(isWorkspaceAgent).mockReturnValue(false);

    await delegateToAgent('aos', 'do a thing', 'caller-chat-99', 'main');

    expect(vi.mocked(buildMemoryContext).mock.calls[0][0]).toBe('caller-chat-99');
    expect(vi.mocked(buildMemoryContext).mock.calls[0][3]).toEqual({ strictAgentId: 'aos' });
  });
});

describe('parseDelegation', () => {
  // The no-colon form (`@aos prompt`) checks the module registry, so load it
  // from the mocked agent-config (listAgentIds → ['aos']).
  beforeEach(() => {
    initOrchestrator();
  });

  it('parses the @agentId: colon form', () => {
    expect(parseDelegation('@aos: remember the Q3 launch date is October 14')).toEqual({
      agentId: 'aos',
      prompt: 'remember the Q3 launch date is October 14',
    });
  });

  it('parses the /delegate form', () => {
    expect(parseDelegation('/delegate aos draw the architecture')).toEqual({
      agentId: 'aos',
      prompt: 'draw the architecture',
    });
  });

  it('parses the bare @agentId form only for a known agent', () => {
    expect(parseDelegation('@aos draw it')).toEqual({ agentId: 'aos', prompt: 'draw it' });
    // Unknown agent must NOT be treated as a delegation (falls through to main).
    expect(parseDelegation('@nope draw it')).toBeNull();
  });

  // Regression: a stray leading space/newline used to break `^@` and silently
  // misroute "@aos: ..." to the main agent. Anchoring on trimmed text fixes it.
  it('tolerates leading whitespace before @agentId: (misroute regression)', () => {
    expect(parseDelegation('  @aos: remember the Q3 launch date is October 14')).toEqual({
      agentId: 'aos',
      prompt: 'remember the Q3 launch date is October 14',
    });
    expect(parseDelegation('\n@aos: hi')).toEqual({ agentId: 'aos', prompt: 'hi' });
  });

  it('tolerates leading whitespace before /delegate', () => {
    expect(parseDelegation('  /delegate aos do a thing')).toEqual({
      agentId: 'aos',
      prompt: 'do a thing',
    });
  });

  it('returns null for plain messages with no delegation syntax', () => {
    expect(parseDelegation('remember the Q3 launch date is October 14')).toBeNull();
    expect(parseDelegation('email aos@example.com about the launch')).toBeNull();
  });
});
