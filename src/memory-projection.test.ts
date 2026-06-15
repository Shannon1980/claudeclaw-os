import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the read boundary (db.ts in-process access path) and the workspace
// resolver. The projection's only inputs are: where the workspace is
// (resolveAgentRuntime) and the memory rows (getRecentHighImportanceMemories).
const memoryRows: Array<{ summary: string }> = [];
const resolvedCwd = { value: '' };

vi.mock('./db.js', () => ({
  getRecentHighImportanceMemories: vi.fn(() => memoryRows),
}));

vi.mock('./agent-config.js', () => ({
  resolveAgentRuntime: vi.fn(() => ({ agentId: 'aos', cwd: resolvedCwd.value })),
  workspaceMemoryKey: vi.fn((id: string) => `ws:${id}`),
}));

import { resolveAgentRuntime, workspaceMemoryKey } from './agent-config.js';
import { getRecentHighImportanceMemories } from './db.js';
import { renderMemoryProjection } from './memory-projection.js';

let workspace: string;

function makeWorkspace(withMemDir: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-projection-'));
  if (withMemDir) fs.mkdirSync(path.join(dir, 'context', 'memory'), { recursive: true });
  return dir;
}

beforeEach(() => {
  vi.clearAllMocks();
  memoryRows.length = 0;
  workspace = makeWorkspace(true);
  resolvedCwd.value = workspace;
  vi.mocked(resolveAgentRuntime).mockReturnValue({ agentId: 'aos', cwd: workspace } as ReturnType<typeof resolveAgentRuntime>);
  vi.mocked(workspaceMemoryKey).mockImplementation((id: string) => `ws:${id}`);
  vi.mocked(getRecentHighImportanceMemories).mockImplementation(() => memoryRows as never);
});

afterEach(() => {
  if (workspace && fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
});

describe('renderMemoryProjection', () => {
  it('writes recent memory summaries to {date}.claudeclaw.md', () => {
    memoryRows.push({ summary: 'Shipped the unified memory pool' }, { summary: 'Fixed the cwd drift bug' });
    const date = new Date('2026-06-15T12:00:00Z');

    const out = renderMemoryProjection('aos', date);

    expect(out).toBe(path.join(workspace, 'context', 'memory', '2026-06-15.claudeclaw.md'));
    const content = fs.readFileSync(out as string, 'utf8');
    expect(content).toContain('Shipped the unified memory pool');
    expect(content).toContain('Fixed the cwd drift bug');
    // ClaudeClaw-owned, one-directional header. CLAUDE.md rule: no em dashes.
    expect(content).toContain('ClaudeClaw memory projection');
    expect(content).toContain('source of record');
    expect(content).not.toContain('—');
  });

  it('reads the shared pool via the in-process access path (ws:aos, agent-scoped)', () => {
    renderMemoryProjection('aos', new Date('2026-06-15T12:00:00Z'));
    expect(getRecentHighImportanceMemories).toHaveBeenCalledWith('ws:aos', 10, 'aos');
  });

  it('leaves an existing {date}.md byte-for-byte unchanged (no clobber)', () => {
    const date = new Date('2026-06-15T12:00:00Z');
    const ownLog = path.join(workspace, 'context', 'memory', '2026-06-15.md');
    const original = '## Session 09:00\n\nThe agent wrote this. Do not touch.\n';
    fs.writeFileSync(ownLog, original, 'utf8');
    memoryRows.push({ summary: 'A projected memory' });

    renderMemoryProjection('aos', date);

    expect(fs.readFileSync(ownLog, 'utf8')).toBe(original);
    // And the projection landed in the separate file.
    expect(fs.existsSync(path.join(workspace, 'context', 'memory', '2026-06-15.claudeclaw.md'))).toBe(true);
  });

  it('returns null and writes nothing when the workspace has no context/memory dir', () => {
    const bare = makeWorkspace(false);
    resolvedCwd.value = bare;
    vi.mocked(resolveAgentRuntime).mockReturnValue({ agentId: 'aos', cwd: bare } as ReturnType<typeof resolveAgentRuntime>);

    try {
      const out = renderMemoryProjection('aos', new Date('2026-06-15T12:00:00Z'));
      expect(out).toBeNull();
      expect(fs.existsSync(path.join(bare, 'context'))).toBe(false);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it('MEM-06 source guard: the module references no decrypt path, sqlite driver, or encrypted tables', () => {
    const src = fs.readFileSync(path.join(__dirname, 'memory-projection.ts'), 'utf8');
    expect(src).not.toContain('decryptField');
    expect(src).not.toContain('better-sqlite3');
    expect(src).not.toMatch(/\bwa_/);
    expect(src).not.toContain('slack_messages');
  });
});
