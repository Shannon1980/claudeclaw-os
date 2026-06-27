import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./gemini.js', () => ({
  generateContent: vi.fn(),
  parseJsonResponse: vi.fn(),
}));

// Mock the Claude SDK so the new Anthropic-Haiku ingestion path doesn't
// actually try to spawn a subprocess in tests. We force it to throw so
// the code falls back to the mocked Gemini path the existing tests
// already exercise.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => {
    async function* failing(): AsyncGenerator<never> {
      throw new Error('mocked: Claude SDK unavailable in test env');
    }
    return failing();
  }),
}));

vi.mock('./security.js', () => ({
  getScrubbedSdkEnv: vi.fn(() => ({})),
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

vi.mock('./db.js', () => ({
  saveStructuredMemoryAtomic: vi.fn(() => 1),
  getMemoriesWithEmbeddings: vi.fn(() => []),
  // Phase 6 tombstone suppression helpers (D-08).
  isTombstoned: vi.fn(() => false),
  writeTombstone: vi.fn(),
  // D-06 category validator: mirror db.ts's enum so the ingest classifier maps
  // the model's category onto the 3-value enum (unknown/absent -> null, D-07).
  normalizeOperatorCategory: vi.fn((value: unknown) => {
    const VALID = ['your-business', 'your-clients', 'how-you-work'];
    return typeof value === 'string' && VALID.includes(value) ? value : null;
  }),
}));

vi.mock('./embeddings.js', () => ({
  embedText: vi.fn(() => Promise.resolve([0.1, 0.2, 0.3])),
  cosineSimilarity: vi.fn(() => 0),
}));

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { ingestConversationTurn } from './memory-ingest.js';
import { generateContent, parseJsonResponse } from './gemini.js';
import { saveStructuredMemoryAtomic, isTombstoned } from './db.js';

const mockGenerateContent = vi.mocked(generateContent);
const mockParseJson = vi.mocked(parseJsonResponse);
const mockSave = vi.mocked(saveStructuredMemoryAtomic);
const mockIsTombstoned = vi.mocked(isTombstoned);

describe('ingestConversationTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Hard filters (skip before hitting Gemini) ────────────────────

  it('skips messages <= 15 characters', async () => {
    const result = await ingestConversationTurn('chat1', 'short msg', 'ok');
    expect(result).toBe(false);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('skips messages exactly 15 characters', async () => {
    const result = await ingestConversationTurn('chat1', '123456789012345', 'ok');
    expect(result).toBe(false);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('processes messages of 16 characters', async () => {
    mockGenerateContent.mockResolvedValue('{}');
    mockParseJson.mockReturnValue({ skip: true });
    const result = await ingestConversationTurn('chat1', '1234567890123456', 'ok');
    // Should have called Gemini even though it was skipped by LLM
    expect(mockGenerateContent).toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('skips messages starting with /', async () => {
    const result = await ingestConversationTurn('chat1', '/chatid some long command text here', 'Your ID is 12345');
    expect(result).toBe(false);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  // ── Gemini decides to skip ────────────────────────────────────────

  it('returns false when Gemini says skip', async () => {
    mockGenerateContent.mockResolvedValue('{"skip": true}');
    mockParseJson.mockReturnValue({ skip: true });
    const result = await ingestConversationTurn('chat1', 'ok sounds good thanks for doing that', 'No problem.');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns false when Gemini returns null (parse failure)', async () => {
    mockGenerateContent.mockResolvedValue('garbage');
    mockParseJson.mockReturnValue(null);
    const result = await ingestConversationTurn('chat1', 'some message that is long enough', 'response');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  // ── Gemini extracts a memory ──────────────────────────────────────

  it('saves a structured memory on valid extraction', async () => {
    const extraction = {
      skip: false,
      summary: 'User prefers dark mode in all applications',
      entities: ['dark mode', 'UI'],
      topics: ['preferences', 'UI'],
      importance: 0.8,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn(
      'chat1',
      'I always want dark mode enabled in everything',
      'Got it, I will remember your dark mode preference.',
    );

    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalledWith(
      'chat1',
      'I always want dark mode enabled in everything',
      'User prefers dark mode in all applications',
      ['dark mode', 'UI'],
      ['preferences', 'UI'],
      0.8,
      expect.any(Array),
      'conversation',
      'main',
      null, // no category in this extraction -> NULL (D-07)
    );
  });

  // ── Importance filtering ──────────────────────────────────────────

  it('skips extraction with importance < 0.3', async () => {
    const extraction = {
      skip: false,
      summary: 'Trivial fact',
      entities: [],
      topics: [],
      importance: 0.25,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'some trivial message longer than fifteen', 'ok');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('skips extraction with importance exactly 0.2 (below 0.3 floor)', async () => {
    const extraction = {
      skip: false,
      summary: 'Low importance fact',
      entities: [],
      topics: [],
      importance: 0.2,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'some borderline message longer than fifteen', 'ok');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('skips extraction with importance exactly 0.3 (below 0.5 floor)', async () => {
    const extraction = {
      skip: false,
      summary: 'Borderline fact',
      entities: [],
      topics: [],
      importance: 0.3,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'some borderline message longer than fifteen', 'ok');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('saves extraction with importance exactly 0.5', async () => {
    const extraction = {
      skip: false,
      summary: 'Useful fact',
      entities: [],
      topics: [],
      importance: 0.5,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'some useful message longer than fifteen', 'ok');
    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalled();
  });

  // ── Importance clamping ───────────────────────────────────────────

  it('clamps importance above 1.0 to 1.0', async () => {
    const extraction = {
      skip: false,
      summary: 'Very important',
      entities: [],
      topics: [],
      importance: 1.5,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    await ingestConversationTurn('chat1', 'extremely important message for testing', 'noted');
    expect(mockSave).toHaveBeenCalledWith(
      'chat1',
      expect.any(String),
      'Very important',
      [],
      [],
      1.0,  // clamped
      expect.any(Array),
      'conversation',
      'main',
      null,
    );
  });

  it('clamps negative importance to 0', async () => {
    const extraction = {
      skip: false,
      summary: 'Negative importance',
      entities: [],
      topics: [],
      importance: -0.5,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    // importance -0.5 < 0.2 threshold, so it should be skipped
    const result = await ingestConversationTurn('chat1', 'message with negative importance test', 'response');
    expect(result).toBe(false);
  });

  // ── Validation of required fields ─────────────────────────────────

  it('skips when summary is missing', async () => {
    const extraction = {
      skip: false,
      summary: '',
      entities: [],
      topics: [],
      importance: 0.7,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'message with no summary extracted from it', 'response');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('skips when importance is not a number', async () => {
    const extraction = {
      skip: false,
      summary: 'Valid summary',
      entities: [],
      topics: [],
      importance: 'high' as unknown as number,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'message where importance is a string', 'response');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  // ── Missing optional fields ───────────────────────────────────────

  it('handles missing entities and topics gracefully', async () => {
    const extraction = {
      skip: false,
      summary: 'No entities or topics',
      importance: 0.5,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'message with no entities or topics at all', 'response');
    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalledWith(
      'chat1',
      expect.any(String),
      'No entities or topics',
      [],  // defaults to empty
      [],  // defaults to empty
      0.5,
      expect.any(Array),
      'conversation',
      'main',
      null,
    );
  });

  // ── Error handling ────────────────────────────────────────────────

  it('returns false when Gemini API throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API rate limited'));

    const result = await ingestConversationTurn('chat1', 'this message should not crash the bot', 'response');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  // ── Message truncation ────────────────────────────────────────────

  it('truncates long messages to 2000 chars in prompt', async () => {
    mockGenerateContent.mockResolvedValue('{"skip": true}');
    mockParseJson.mockReturnValue({ skip: true });

    const longMsg = 'x'.repeat(5000);
    await ingestConversationTurn('chat1', longMsg, 'response');

    const promptArg = mockGenerateContent.mock.calls[0][0];
    // The prompt should contain the truncated message, not the full 5000 chars
    expect(promptArg).not.toContain('x'.repeat(3000));
    expect(promptArg).toContain('x'.repeat(2000));
  });

  // ── Tombstone suppression (Wave 0 RED — D-08, crit 3) ─────────────────
  //
  // A deleted fact writes a tombstone (sha256 of the normalized summary, plus
  // optional embedding). When the SAME turn is re-fed through ingestion, the
  // tombstone check must fire BEFORE save and skip it: no new memory row is
  // created. RED today: ingestConversationTurn does not consult isTombstoned,
  // so a re-fed deleted fact would be saved again. Plan 02 slots the check in
  // at the existing dedupe point.

  it('does not create a new memory row when the extracted fact is tombstoned (D-08)', async () => {
    const extraction = {
      skip: false,
      summary: 'User prefers dark mode in all applications',
      entities: ['dark mode'],
      topics: ['preferences'],
      importance: 0.8,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);
    // This summary was deleted earlier -> its hash is tombstoned.
    mockIsTombstoned.mockReturnValue(true);

    const result = await ingestConversationTurn(
      'chat1',
      'I always want dark mode enabled in everything',
      'Got it.',
    );

    // The tombstone check must have run...
    expect(mockIsTombstoned).toHaveBeenCalled();
    // ...and suppressed the save: no new row.
    expect(mockSave).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('still saves when the fact is NOT tombstoned (suppression is targeted, not blanket)', async () => {
    const extraction = {
      skip: false,
      summary: 'User wants weekly invoice reminders',
      entities: [],
      topics: ['invoices'],
      importance: 0.7,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);
    mockIsTombstoned.mockReturnValue(false);

    const result = await ingestConversationTurn('chat1', 'remind me about invoices weekly please', 'ok');
    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalled();
  });

  // ── Category classification on ingest (D-06 / D-07) ───────────────────
  //
  // The extraction prompt now returns a `category` constrained to the 3-value
  // operator enum or null. The value is validated like importance and persisted
  // on the new row. A valid category is passed through; an unknown/invalid one
  // (or an absent one) is clamped to NULL so the surface never shows a junk bucket.

  it('persists a valid category from the extraction (D-06)', async () => {
    const extraction = {
      skip: false,
      summary: 'User invoices clients on net-30 terms',
      entities: ['invoicing'],
      topics: ['billing'],
      importance: 0.8,
      category: 'how-you-work',
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'I always bill clients on net-30 terms', 'noted');
    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalledWith(
      'chat1',
      expect.any(String),
      'User invoices clients on net-30 terms',
      ['invoicing'],
      ['billing'],
      0.8,
      expect.any(Array),
      'conversation',
      'main',
      'how-you-work',
    );
  });

  it('clamps an unknown category to NULL (D-07)', async () => {
    const extraction = {
      skip: false,
      summary: 'User likes concise summaries',
      entities: [],
      topics: [],
      importance: 0.6,
      category: 'totally-made-up-bucket',
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'keep your summaries short and to the point', 'ok');
    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalledWith(
      'chat1',
      expect.any(String),
      'User likes concise summaries',
      [],
      [],
      0.6,
      expect.any(Array),
      'conversation',
      'main',
      null, // unknown enum value -> NULL
    );
  });

  it('treats an absent category as NULL (D-07)', async () => {
    const extraction = {
      skip: false,
      summary: 'User runs a consulting business',
      entities: [],
      topics: [],
      importance: 0.7,
      // no category field at all
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'my consulting business is the main focus', 'got it');
    expect(result).toBe(true);
    const lastCall = mockSave.mock.calls[mockSave.mock.calls.length - 1];
    expect(lastCall[9]).toBeNull();
  });
});
