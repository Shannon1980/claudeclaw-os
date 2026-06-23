import { describe, it, expect, vi } from 'vitest';

// ── RED scaffolding (Phase 2 Wave 0) ────────────────────────────────────────
// These symbols do not exist yet — 02-02 creates src/routine-draft.ts. Until
// then this suite is RED (module-not-found / undefined). It pins the draft
// assembly contract (RTN-01/RTN-02): parseJsonLoose against fenced/prose model
// output (Pitfall 4), agent_id validation against the roster, and cron validity
// via computeNextRun. runAgent is mocked in every test — no live SDK subprocess.
import {
  parseJsonLoose,
  assembleRoutineDraft,
} from './routine-draft.js';

// ── parseJsonLoose (Pitfall 4) ───────────────────────────────────────────────

describe('parseJsonLoose', () => {
  it('strips ```json fences and parses', () => {
    const raw = '```json\n{"cron":"0 8 * * 1-5","steps":[]}\n```';
    const parsed = parseJsonLoose<{ cron: string; steps: unknown[] }>(raw);
    expect(parsed).toMatchObject({ cron: '0 8 * * 1-5', steps: [] });
  });

  it('regex-fallback extracts the first {...} block from prose', () => {
    const raw = 'Sure, here is your routine:\n{"cron":"0 9 * * *","steps":[]}\nLet me know!';
    const parsed = parseJsonLoose<{ cron: string }>(raw);
    expect(parsed?.cron).toBe('0 9 * * *');
  });

  it('returns null (or throws friendly) when no JSON is present', () => {
    const raw = 'I could not assemble that routine, please rephrase.';
    let result: unknown;
    let threw = false;
    try {
      result = parseJsonLoose(raw);
    } catch (err) {
      threw = true;
      expect((err as Error).message).toMatch(/json|assemble|parse/i);
    }
    if (!threw) expect(result).toBeNull();
  });
});

// ── assembleRoutineDraft: agent_id validation against the roster ─────────────

describe('assembleRoutineDraft', () => {
  it('validates each step agent_id against the roster; an unknown id falls back to "main"', async () => {
    const runAgent = vi.fn(async () => ({
      text: JSON.stringify({
        cron: '0 8 * * 1-5',
        schedule_text: 'every weekday at 8am',
        steps: [
          { action: 'send the brief', agent_id: 'research', on_error: 'continue' },
          { action: 'chase invoices', agent_id: 'nonexistent-bot', on_error: 'continue' },
        ],
      }),
      aborted: false,
    }));

    const draft = await assembleRoutineDraft('every weekday at 8 send a brief then chase invoices', {
      runAgent: runAgent as any,
      listAgentIds: () => ['main', 'research', 'comms', 'ops'],
      computeNextRun: (_cron: string) => Math.floor(Date.now() / 1000) + 60,
    } as any);

    expect(draft.steps[0].agent_id).toBe('research');
    // Unknown teammate is coerced to the safe default.
    expect(draft.steps[1].agent_id).toBe('main');
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it('cron-valid: rejects an assembled cron that computeNextRun cannot parse', async () => {
    const runAgent = vi.fn(async () => ({
      text: JSON.stringify({
        cron: 'not-a-cron',
        schedule_text: 'gibberish',
        steps: [{ action: 'x', agent_id: 'main', on_error: 'continue' }],
      }),
      aborted: false,
    }));

    const computeNextRun = (cron: string) => {
      if (cron === 'not-a-cron') throw new Error('invalid cron');
      return Math.floor(Date.now() / 1000) + 60;
    };

    await expect(
      assembleRoutineDraft('do a thing on a broken schedule', {
        runAgent: runAgent as any,
        listAgentIds: () => ['main'],
        computeNextRun: computeNextRun as any,
      } as any),
    ).rejects.toThrow(/cron/i);
  });

  it('cron-valid: accepts a draft whose cron computeNextRun parses', async () => {
    const runAgent = vi.fn(async () => ({
      text: JSON.stringify({
        cron: '0 9 * * *',
        schedule_text: 'every day at 9am',
        steps: [{ action: 'morning brief', agent_id: 'main', on_error: 'continue' }],
      }),
      aborted: false,
    }));

    const draft = await assembleRoutineDraft('every day at 9 send me a brief', {
      runAgent: runAgent as any,
      listAgentIds: () => ['main'],
      computeNextRun: (_cron: string) => Math.floor(Date.now() / 1000) + 3600,
    } as any);

    expect(draft.cron).toBe('0 9 * * *');
    expect(draft.steps).toHaveLength(1);
  });
});
