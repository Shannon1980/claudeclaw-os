import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./gemini.js', () => ({
  generateContent: vi.fn(),
  parseJsonResponse: vi.fn(),
}));

vi.mock('./db.js', () => ({
  getUnconsolidatedMemories: vi.fn(),
  saveConsolidationAtomic: vi.fn(() => 1),
  saveConsolidationEmbedding: vi.fn(),
  // Phase 6 tombstone suppression (D-08) — does not exist in db.ts yet.
  isTombstoned: vi.fn(() => false),
}));

vi.mock('./embeddings.js', () => ({
  embedText: vi.fn(() => Promise.resolve([])),
}));

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { runConsolidation } from './memory-consolidate.js';
import { generateContent, parseJsonResponse } from './gemini.js';
import {
  getUnconsolidatedMemories,
  saveConsolidationAtomic,
  isTombstoned,
} from './db.js';

const mockGetUnconsolidated = vi.mocked(getUnconsolidatedMemories);
const mockGenerateContent = vi.mocked(generateContent);
const mockParseJson = vi.mocked(parseJsonResponse);
const mockSaveAtomic = vi.mocked(saveConsolidationAtomic);
const mockIsTombstoned = vi.mocked(isTombstoned);

function makeMemory(id: number, summary: string) {
  return {
    id,
    chat_id: 'chat1',
    source: 'conversation',
    agent_id: 'main',
    raw_text: 'raw',
    summary,
    entities: '[]',
    topics: '[]',
    connections: '[]',
    importance: 0.6,
    salience: 1.0,
    consolidated: 0,
    pinned: 0,
    embedding: null,
    created_at: Math.floor(Date.now() / 1000) - 3600,
    accessed_at: Math.floor(Date.now() / 1000) - 3600,
  };
}

describe('runConsolidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Skip conditions ───────────────────────────────────────────────

  it('skips when fewer than 2 unconsolidated memories', async () => {
    mockGetUnconsolidated.mockReturnValue([makeMemory(1, 'only one')]);
    await runConsolidation('chat1');
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(mockSaveAtomic).not.toHaveBeenCalled();
  });

  it('skips when zero unconsolidated memories', async () => {
    mockGetUnconsolidated.mockReturnValue([]);
    await runConsolidation('chat1');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  // ── Successful consolidation ──────────────────────────────────────

  it('consolidates 2+ memories and saves the result atomically', async () => {
    const memories = [
      makeMemory(10, 'User prefers morning email triage'),
      makeMemory(20, 'User checks Slack after email'),
      makeMemory(30, 'User blocks 9-10am for admin tasks'),
    ];
    mockGetUnconsolidated.mockReturnValue(memories);

    const consolidationResult = {
      summary: 'User has a structured morning routine.',
      insight: 'User organizes mornings around a clear priority order.',
      connections: [
        { from_id: 10, to_id: 20, relationship: 'sequential workflow' },
        { from_id: 20, to_id: 30, relationship: 'part of morning routine' },
      ],
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(consolidationResult));
    mockParseJson.mockReturnValue(consolidationResult);

    await runConsolidation('chat1');

    // Should call atomic save with all data bundled
    expect(mockSaveAtomic).toHaveBeenCalledTimes(1);
    expect(mockSaveAtomic).toHaveBeenCalledWith(
      'chat1',
      [10, 20, 30],
      consolidationResult.summary,
      consolidationResult.insight,
      // Valid connections passed through
      [
        { from_id: 10, to_id: 20, relationship: 'sequential workflow' },
        { from_id: 20, to_id: 30, relationship: 'part of morning routine' },
      ],
      // No contradictions
      [],
    );
  });

  // ── Connection filtering ──────────────────────────────────────────

  it('ignores connections with IDs outside the source set', async () => {
    const memories = [makeMemory(10, 'mem1'), makeMemory(20, 'mem2')];
    mockGetUnconsolidated.mockReturnValue(memories);

    const result = {
      summary: 'summary',
      insight: 'insight',
      connections: [
        { from_id: 10, to_id: 999, relationship: 'invalid target' },
        { from_id: 888, to_id: 20, relationship: 'invalid source' },
        { from_id: 10, to_id: 20, relationship: 'valid connection' },
      ],
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(result));
    mockParseJson.mockReturnValue(result);

    await runConsolidation('chat1');

    // Only the valid connection should be passed to atomic save
    expect(mockSaveAtomic).toHaveBeenCalledWith(
      'chat1',
      [10, 20],
      'summary',
      'insight',
      [{ from_id: 10, to_id: 20, relationship: 'valid connection' }],
      [],
    );
  });

  it('handles empty connections array', async () => {
    const memories = [makeMemory(10, 'mem1'), makeMemory(20, 'mem2')];
    mockGetUnconsolidated.mockReturnValue(memories);

    const result = {
      summary: 'These cover different topics',
      insight: 'No clear pattern between these memories',
      connections: [],
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(result));
    mockParseJson.mockReturnValue(result);

    await runConsolidation('chat1');

    expect(mockSaveAtomic).toHaveBeenCalledWith(
      'chat1',
      [10, 20],
      result.summary,
      result.insight,
      [],
      [],
    );
  });

  // ── Error handling ────────────────────────────────────────────────

  it('handles Gemini API failure gracefully', async () => {
    const memories = [makeMemory(10, 'mem1'), makeMemory(20, 'mem2')];
    mockGetUnconsolidated.mockReturnValue(memories);
    mockGenerateContent.mockRejectedValue(new Error('API timeout'));

    await expect(runConsolidation('chat1')).resolves.not.toThrow();
    expect(mockSaveAtomic).not.toHaveBeenCalled();
  });

  it('handles invalid Gemini response (null parse)', async () => {
    const memories = [makeMemory(10, 'mem1'), makeMemory(20, 'mem2')];
    mockGetUnconsolidated.mockReturnValue(memories);
    mockGenerateContent.mockResolvedValue('garbage');
    mockParseJson.mockReturnValue(null);

    await runConsolidation('chat1');
    expect(mockSaveAtomic).not.toHaveBeenCalled();
  });

  it('handles missing summary in response', async () => {
    const memories = [makeMemory(10, 'mem1'), makeMemory(20, 'mem2')];
    mockGetUnconsolidated.mockReturnValue(memories);

    const result = { summary: '', insight: 'insight', connections: [] };
    mockGenerateContent.mockResolvedValue(JSON.stringify(result));
    mockParseJson.mockReturnValue(result);

    await runConsolidation('chat1');
    expect(mockSaveAtomic).not.toHaveBeenCalled();
  });

  it('handles missing insight in response', async () => {
    const memories = [makeMemory(10, 'mem1'), makeMemory(20, 'mem2')];
    mockGetUnconsolidated.mockReturnValue(memories);

    const result = { summary: 'summary', insight: '', connections: [] };
    mockGenerateContent.mockResolvedValue(JSON.stringify(result));
    mockParseJson.mockReturnValue(result);

    await runConsolidation('chat1');
    expect(mockSaveAtomic).not.toHaveBeenCalled();
  });

  // ── Overlap guard ─────────────────────────────────────────────────

  // ── Tombstone suppression on the consolidation path (Wave 0 RED — D-08) ──
  //
  // Second tombstone consult: a deleted fact must not re-enter the store as a
  // synthesized "consolidation." Before saveConsolidationAtomic, the synthesized
  // summary/insight is hash-checked against the tombstone set; a match is NOT
  // saved. RED today: runConsolidation does not consult isTombstoned. Plan 02
  // adds the check before the save.

  it('does not save a synthesized fact whose summary matches a tombstone (D-08)', async () => {
    const memories = [makeMemory(10, 'mem1'), makeMemory(20, 'mem2')];
    mockGetUnconsolidated.mockReturnValue(memories);

    const result = {
      summary: 'User prefers dark mode in all applications',
      insight: 'A synthesized insight the operator already deleted',
      connections: [],
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(result));
    mockParseJson.mockReturnValue(result);
    // The synthesized summary was previously deleted -> tombstoned.
    mockIsTombstoned.mockReturnValue(true);

    await runConsolidation('chat1');

    expect(mockIsTombstoned).toHaveBeenCalled();
    expect(mockSaveAtomic).not.toHaveBeenCalled();
  });

  it('saves a synthesized fact that is NOT tombstoned (targeted suppression)', async () => {
    const memories = [makeMemory(10, 'mem1'), makeMemory(20, 'mem2')];
    mockGetUnconsolidated.mockReturnValue(memories);

    const result = {
      summary: 'User batches admin work on Fridays',
      insight: 'A genuinely new synthesized insight',
      connections: [],
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(result));
    mockParseJson.mockReturnValue(result);
    mockIsTombstoned.mockReturnValue(false);

    await runConsolidation('chat1');
    expect(mockSaveAtomic).toHaveBeenCalled();
  });

  it('does not run concurrently (overlap guard)', async () => {
    const memories = [makeMemory(10, 'mem1'), makeMemory(20, 'mem2')];
    mockGetUnconsolidated.mockReturnValue(memories);

    let resolveFirst!: (val: string) => void;
    const firstPromise = new Promise<string>((resolve) => { resolveFirst = resolve; });
    mockGenerateContent.mockReturnValueOnce(firstPromise);

    const result = {
      summary: 'summary',
      insight: 'insight',
      connections: [],
    };

    const run1 = runConsolidation('chat1');
    mockGetUnconsolidated.mockReturnValue(memories);
    const run2 = runConsolidation('chat1');

    resolveFirst(JSON.stringify(result));
    mockParseJson.mockReturnValue(result);

    await run1;
    await run2;

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});
