// Unit tests for the Summarize Today daily-digest module (D-10).
//
// summarizeDay assembles a plain-text prompt from the curated feed rows and
// calls the shared Haiku-via-OAuth path (extractViaClaude) to produce a 3 to 4
// sentence plain-language digest. extractViaClaude is mocked here exactly as
// memory-ingest's tests mock it, so no real LLM call is made.
//
// The three guarantees this file pins:
//   1. happy path returns the model text.
//   2. on any failure/timeout the caller gets the honest degrade string and
//      summarizeDay never throws.
//   3. the assembled prompt carries ONLY plain phrase/teammate/time, never an
//      em dash and never any secret/env field (ASVS V8, T-04-summarize-infodisc).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the shared LLM path so we can assert the prompt and stub the result.
vi.mock('./memory-ingest.js', () => ({
  extractViaClaude: vi.fn(),
}));

import { extractViaClaude } from './memory-ingest.js';
import { summarizeDay } from './activity-summary.js';
import type { ActivityRow } from './activity.js';

const mockExtract = vi.mocked(extractViaClaude);

const DEGRADE = "Couldn't summarize right now. The feed below is complete.";

function row(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    source: 'queue',
    id: 1,
    agent_id: 'comms',
    tool_name: 'mcp__gmail__send-email',
    tier: 2,
    tool_input: { to: 'lead@example.com', secret: 'should-never-appear' },
    phrase: 'Sent email to lead@example.com',
    tag: 'You approved',
    undoable: false,
    created_at: 1_700_000_000,
    ...overrides,
  };
}

describe('summarizeDay', () => {
  beforeEach(() => {
    mockExtract.mockReset();
  });

  it('returns the model text on the happy path', async () => {
    mockExtract.mockResolvedValue('Comms sent a follow-up. Research filed two notes. Quiet day overall.');
    const out = await summarizeDay([row()]);
    expect(out).toBe('Comms sent a follow-up. Research filed two notes. Quiet day overall.');
    expect(mockExtract).toHaveBeenCalledTimes(1);
  });

  it('returns the honest degrade string (never throws) when extractViaClaude rejects', async () => {
    mockExtract.mockRejectedValue(new Error('timeout'));
    const out = await summarizeDay([row()]);
    expect(out).toBe(DEGRADE);
  });

  it('returns the honest degrade string when the model returns empty text', async () => {
    mockExtract.mockResolvedValue('   ');
    const out = await summarizeDay([row()]);
    expect(out).toBe(DEGRADE);
  });

  it('builds a prompt with no em dash and no secret/env field', async () => {
    mockExtract.mockResolvedValue('ok');
    await summarizeDay([row({ phrase: 'Removed the Follow up label' })]);
    const prompt = mockExtract.mock.calls[0][0];
    // Plain feed content only.
    expect(prompt).toContain('Removed the Follow up label');
    // No em dash anywhere in the prompt (CLAUDE.md hard rule, D-10).
    expect(prompt).not.toContain('—');
    // No secret/env material leaks from tool_input into the prompt (ASVS V8).
    expect(prompt).not.toContain('should-never-appear');
    expect(prompt.toLowerCase()).not.toContain('secret');
    expect(prompt).not.toContain('OAUTH');
    expect(prompt).not.toContain('API_KEY');
  });

  it('degrades honestly on an empty feed without calling the model', async () => {
    const out = await summarizeDay([]);
    expect(out).toBe(DEGRADE);
    expect(mockExtract).not.toHaveBeenCalled();
  });
});
