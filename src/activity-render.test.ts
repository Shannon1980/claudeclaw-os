// Wave 0 RED tests for the D-04/D-05 tool->phrase map (src/activity-render.ts).
//
// References `./activity-render.js`, which does NOT exist yet. The import
// failing is the intended RED state. Pins the deterministic phrase map:
//   mapped tools (gmail send, draft) return a plain, honest phrase; unmapped
//   tools return an honest generic with the mcp__server__ prefix stripped, and
//   NEVER fabricate a detail (D-05). No returned phrase may contain an em dash
//   (CLAUDE.md hard rule).

import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import { phraseFor } from './activity-render.js';

const EM_DASH = '—';

beforeEach(() => {
  _initTestDatabase();
});

describe('activity-render phraseFor', () => {
  it('maps a gmail send with a recipient to "Sent email to <to>"', () => {
    const phrase = phraseFor('mcp__gmail__send-email', { to: 'a@b.com', subject: 'Hi' }, 3);
    expect(phrase).toBe('Sent email to a@b.com');
  });

  it('maps a gmail send with no recipient to a plain "Sent an email"', () => {
    const phrase = phraseFor('mcp__gmail__send-email', { subject: 'Hi' }, 3);
    expect(phrase).toBe('Sent an email');
  });

  it('maps a draft-creating tool to "Prepared a draft"', () => {
    const phrase = phraseFor('mcp__gmail__create-draft', { to: 'a@b.com' }, 2);
    expect(phrase).toBe('Prepared a draft');
  });

  it('returns an honest generic for an unmapped tool, mcp__server__ prefix stripped', () => {
    const phrase = phraseFor('mcp__gmail__list-labels', {}, 1);
    // Honest generic: never a fabricated detail, never hidden.
    expect(phrase).toBe('Ran list-labels');
    expect(phrase).not.toMatch(/label.*applied|sent|created/i);
  });

  it('returns an honest generic for a non-mcp tool name unchanged', () => {
    const phrase = phraseFor('Bash', { command: 'ls' }, 1);
    expect(phrase).toBe('Ran Bash');
  });

  it('never emits an em dash in any returned phrase', () => {
    const samples: Array<[string, Record<string, unknown>, number]> = [
      ['mcp__gmail__send-email', { to: 'a@b.com' }, 3],
      ['mcp__gmail__send-email', {}, 3],
      ['mcp__gmail__create-draft', {}, 2],
      ['mcp__gmail__list-labels', {}, 1],
      ['Bash', { command: 'ls' }, 1],
    ];
    for (const [tool, input, tier] of samples) {
      expect(phraseFor(tool, input, tier)).not.toContain(EM_DASH);
    }
  });
});
