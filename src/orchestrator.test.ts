// Unit tests for delegateToAgent's per-agent run wiring (agent.yaml → runAgent
// options). The SDK boundary (runAgent) and the DB/memory side effects are
// mocked; resolveAgentModel is kept real so alias resolution is exercised
// end-to-end. The highest-value assertion is the cwd guard: a nonexistent
// project_dir must yield cwd:undefined rather than crashing the subprocess.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./agent.js', () => ({
  runAgent: vi.fn(async () => ({ text: 'ok', usage: null })),
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

// Keep resolveAgentModel real; mock only the disk-touching loaders so we can
// hand delegateToAgent an arbitrary config without writing fixtures.
vi.mock('./agent-config.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listAgentIds: vi.fn(() => ['research']),
    resolveAgentClaudeMd: vi.fn(() => null),
    loadAgentConfig: vi.fn(),
  };
});

import { delegateToAgent } from './orchestrator.js';
import { runAgent } from './agent.js';
import { loadAgentConfig } from './agent-config.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRunAgent = runAgent as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockLoadAgentConfig = loadAgentConfig as any;

// A directory guaranteed to exist, and one guaranteed not to.
const EXISTING_DIR = os.tmpdir();
const MISSING_DIR = path.join(os.tmpdir(), 'claudeclaw-nonexistent-' + 'zzz');

interface CfgOverrides {
  model?: string;
  projectDir?: string;
  tools?: string[];
  skills?: string[];
}

function cfg(overrides: CfgOverrides = {}) {
  return {
    name: 'Research',
    description: 'research agent',
    botTokenEnv: '',
    botToken: '',
    ...overrides,
  };
}

/** The `extra` (9th) arg handed to runAgent: { cwd, allowedTools }. */
function lastExtra(): { cwd?: string; allowedTools?: string[] } {
  const call = mockRunAgent.mock.calls.at(-1);
  return call[8];
}
function lastModelArg(): string | undefined {
  return mockRunAgent.mock.calls.at(-1)[4];
}
function lastPrompt(): string {
  return mockRunAgent.mock.calls.at(-1)[0];
}

async function delegate() {
  return delegateToAgent('research', 'do the thing', 'slack:U1', 'main');
}

describe('delegateToAgent — per-agent run wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (fs.existsSync(MISSING_DIR)) fs.rmSync(MISSING_DIR, { recursive: true, force: true });
  });

  it('passes an existing project_dir through as cwd', async () => {
    mockLoadAgentConfig.mockReturnValue(cfg({ projectDir: EXISTING_DIR }));
    await delegate();
    expect(lastExtra().cwd).toBe(EXISTING_DIR);
  });

  it('yields cwd:undefined for a nonexistent project_dir (the real subprocess guard)', async () => {
    mockLoadAgentConfig.mockReturnValue(cfg({ projectDir: MISSING_DIR }));
    await delegate();
    expect(lastExtra().cwd).toBeUndefined();
  });

  it('omits cwd when no project_dir is set', async () => {
    mockLoadAgentConfig.mockReturnValue(cfg());
    await delegate();
    expect(lastExtra().cwd).toBeUndefined();
  });

  it('collapses an empty tools list to undefined (all tools), not [] (no tools)', async () => {
    mockLoadAgentConfig.mockReturnValue(cfg({ tools: [] }));
    await delegate();
    // An empty allowlist would lock the agent out of every tool — must be undefined.
    expect(lastExtra().allowedTools).toBeUndefined();
  });

  it('passes a non-empty tools list through as allowedTools', async () => {
    mockLoadAgentConfig.mockReturnValue(cfg({ tools: ['Read', 'Bash'] }));
    await delegate();
    expect(lastExtra().allowedTools).toEqual(['Read', 'Bash']);
  });

  it('resolves an agent.yaml model alias to a canonical id', async () => {
    mockLoadAgentConfig.mockReturnValue(cfg({ model: 'opus' }));
    await delegate();
    expect(lastModelArg()).toBe('claude-opus-4-8');
  });

  it('passes undefined model when none is configured (default fallback)', async () => {
    mockLoadAgentConfig.mockReturnValue(cfg());
    await delegate();
    expect(lastModelArg()).toBeUndefined();
  });

  it('injects the skills block into the prompt only when skills are present', async () => {
    mockLoadAgentConfig.mockReturnValue(cfg({ skills: ['operations:status-report'] }));
    await delegate();
    expect(lastPrompt()).toContain('[Your primary skills');
    expect(lastPrompt()).toContain('operations:status-report');
  });

  it('omits the skills block when no skills are configured', async () => {
    mockLoadAgentConfig.mockReturnValue(cfg());
    await delegate();
    expect(lastPrompt()).not.toContain('[Your primary skills');
  });
});
