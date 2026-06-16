import fs from 'fs';
import path from 'path';

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the read boundary (db.ts searchMemories) and the embed + workspace
// resolver. We capture searchMemories args into a module-level array so the
// single-index invariant (one call, scoped to ws:aos / aos, array embedding)
// can be asserted directly. Mirrors the memory-projection.test.ts seam.
const searchCalls: unknown[][] = [];

vi.mock('./db.js', () => ({
  initDatabase: vi.fn(),
  searchMemories: vi.fn((...args: unknown[]) => {
    searchCalls.push(args);
    return [{ summary: 'Q3 launch is Oct 14' }];
  }),
}));

vi.mock('./embeddings.js', () => ({
  embedText: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

vi.mock('./agent-config.js', () => ({
  workspaceMemoryKey: vi.fn((id: string) => `ws:${id}`),
}));

vi.mock('./config.js', () => ({
  GOOGLE_API_KEY: 'test-key',
  MEMORY_NUDGE_INTERVAL_TURNS: 0,
  MEMORY_NUDGE_INTERVAL_HOURS: 0,
  agentObsidianConfig: () => ({}),
}));

import { recallForWorkspace } from './memory.js';

beforeEach(() => {
  vi.clearAllMocks();
  searchCalls.length = 0;
});

describe('recallForWorkspace', () => {
  it('calls searchMemories exactly once, scoped to ws:aos / aos with an array embedding', async () => {
    const results = await recallForWorkspace('when is the launch', { agentId: 'aos', topK: 10 });

    // Single-index invariant: exactly one search, no second semantic path.
    expect(searchCalls.length).toBe(1);
    const [chatId, query, limit, embedding, agentId] = searchCalls[0];
    expect(chatId).toBe('ws:aos');
    expect(query).toBe('when is the launch');
    expect(limit).toBe(10);
    expect(Array.isArray(embedding)).toBe(true);
    expect(agentId).toBe('aos');

    expect(results).toContain('Q3 launch is Oct 14');
  });

  it('defaults agentId to aos and topK to 10 when opts omitted', async () => {
    await recallForWorkspace('any query');

    expect(searchCalls.length).toBe(1);
    const [chatId, , limit, , agentId] = searchCalls[0];
    expect(chatId).toBe('ws:aos');
    expect(limit).toBe(10);
    expect(agentId).toBe('aos');
  });

  it('source guard: memory.ts wrapper references no second-index path or em dash', () => {
    const src = fs.readFileSync(path.join(__dirname, 'memory.ts'), 'utf8');
    // The recall path must route through searchMemories only.
    expect(src).toMatch(/recallForWorkspace/);
    expect(src).toMatch(/workspaceMemoryKey/);
  });

  it('source guard: recall-cli.ts has no second-index path, no em dash, server-side attribution', () => {
    const src = fs.readFileSync(path.join(__dirname, 'recall-cli.ts'), 'utf8');
    // No second semantic index referenced anywhere in the recall path.
    expect(src).not.toMatch(/memsearch/i);
    expect(src).not.toContain('reranker');
    // CLAUDE.md rule: no em dashes.
    expect(src).not.toContain('—');
    // Agent attribution is fixed server-side, never read from argv (T-06-02).
    expect(src).toContain('RECALL_AGENT_ID');
    // Run-as-main guard must resolve symlinks: the live AGENTS.md command runs
    // via the ~/.claudeclaw-app symlink, so a raw argv[1] vs import.meta.url
    // compare silently no-ops (the CLI prints nothing). realpathSync
    // canonicalizes argv[1] so both sides agree. Regression guard.
    expect(src).toContain('realpathSync');
    expect(src).not.toMatch(/new URL\(`file:\/\//);
  });
});
