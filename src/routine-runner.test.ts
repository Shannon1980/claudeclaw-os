import { describe, it, expect, vi } from 'vitest';

// ── RED scaffolding (Phase 2 Wave 0) ────────────────────────────────────────
// These symbols do not exist yet — 02-02 creates src/routine-runner.ts. Until
// then this suite is RED (module-not-found / undefined). It pins the D-02
// outcome derivation, D-03 step threading, the claim-once invariant, the
// paused-teammate skip (A4), and the D-10 state-change notify transition so the
// implementer satisfies a spec, not a vibe.
//
// Mocks are injected via the AosFireDeps dependency-injection pattern modeled on
// src/scheduler.aos.test.ts: no real DB writes, no SDK subprocess. We assert
// observable call counts/shapes, never internal state.
import {
  deriveOutcome,
  runRoutineOnce,
  type StepResult,
} from './routine-runner.js';
import type { RoutineStep } from './db.js';

// Minimal step factory — only the fields deriveOutcome/runRoutineOnce read.
function step(over: Partial<RoutineStep> = {}): RoutineStep {
  return {
    id: 1,
    routine_id: 'r-1',
    step_order: 0,
    action: 'do the thing',
    agent_id: 'main',
    on_error: 'continue',
    created_at: Math.floor(Date.now() / 1000),
    ...over,
  } as RoutineStep;
}

function result(over: Partial<StepResult> = {}): StepResult {
  return {
    stepId: 1,
    ok: true,
    output: 'useful output',
    teammate: 'main',
    ...over,
  } as StepResult;
}

// A routine row the runner operates on. Shape mirrors ScheduledTask's read path;
// runRoutineOnce only needs id/schedule for bookkeeping.
function routine(over: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    prompt: 'morning brief routine',
    schedule: '0 8 * * 1-5',
    source: 'routine',
    autonomy: 'unattended',
    agent_id: 'main',
    ...over,
  } as any;
}

// ── deriveOutcome (D-02, RTN-05) — pure-fn tests à la parseTimeout ───────────

describe('deriveOutcome (outcome)', () => {
  it('outcome: every step ok → "ok"', () => {
    const steps = [step({ id: 1 }), step({ id: 2 })];
    const results = [result({ stepId: 1, ok: true }), result({ stepId: 2, ok: true })];
    expect(deriveOutcome(results, steps, false)).toBe('ok');
  });

  it('outcome: a continue-on-error step failed but another produced useful output and run completed → "degraded"', () => {
    const steps = [
      step({ id: 1, on_error: 'continue' }),
      step({ id: 2, on_error: 'continue' }),
    ];
    const results = [
      result({ stepId: 1, ok: false, output: 'calendar not connected' }),
      result({ stepId: 2, ok: true, output: 'inbox brief sent' }),
    ];
    expect(deriveOutcome(results, steps, false)).toBe('degraded');
  });

  it('outcome: a stop-on-error step failed (halted=true) → "failed"', () => {
    const steps = [step({ id: 1, on_error: 'stop' }), step({ id: 2 })];
    const results = [
      result({ stepId: 1, ok: false, output: 'hard gate failed' }),
    ];
    expect(deriveOutcome(results, steps, true)).toBe('failed');
  });

  it('outcome edge: ALL continue-on-error steps fail (no useful output) → "failed", NOT "degraded"', () => {
    const steps = [
      step({ id: 1, on_error: 'continue' }),
      step({ id: 2, on_error: 'continue' }),
    ];
    const results = [
      result({ stepId: 1, ok: false, output: 'err a' }),
      result({ stepId: 2, ok: false, output: 'err b' }),
    ];
    expect(deriveOutcome(results, steps, false)).toBe('failed');
  });
});

// ── runRoutineOnce: step threading (D-03, RTN-03) ────────────────────────────

describe('runRoutineOnce step threading + teammate (teammate)', () => {
  it('teammate: steps execute in step_order and each step runs as its assigned teammate', async () => {
    const steps = [
      step({ id: 1, step_order: 0, action: 'A', agent_id: 'research' }),
      step({ id: 2, step_order: 1, action: 'B', agent_id: 'comms' }),
    ];
    const delegateToAgent = vi.fn(async (agentId: string) => ({
      text: `output from ${agentId}`,
      aborted: false,
    }));
    const sender = vi.fn(async (_t: string) => {});

    await runRoutineOnce(routine(), steps, Date.now() / 1000 + 300, {
      sender,
      delegateToAgent: delegateToAgent as any,
      isAgentPaused: () => false,
      getLastRoutineOutcome: () => null,
    } as any);

    // Ordered by step_order: research before comms.
    expect((delegateToAgent.mock.calls[0] as any[])[0]).toBe('research');
    expect((delegateToAgent.mock.calls[1] as any[])[0]).toBe('comms');
  });

  it('teammate: a later step prompt contains the earlier step output (D-03 threading)', async () => {
    const steps = [
      step({ id: 1, step_order: 0, action: 'FIRST', agent_id: 'research' }),
      step({ id: 2, step_order: 1, action: 'SECOND', agent_id: 'comms' }),
    ];
    const delegateToAgent = vi.fn(async (_agentId: string) => ({
      text: 'EARLIER_OUTPUT_TOKEN',
      aborted: false,
    }));

    await runRoutineOnce(routine(), steps, Date.now() / 1000 + 300, {
      sender: vi.fn(async () => {}),
      delegateToAgent: delegateToAgent as any,
      isAgentPaused: () => false,
      getLastRoutineOutcome: () => null,
    } as any);

    const secondPrompt = (delegateToAgent.mock.calls[1] as any[])[1] as string;
    expect(secondPrompt).toContain('EARLIER_OUTPUT_TOKEN');
  });

  it('teammate: a step whose teammate isAgentPaused is recorded as a skip and yields a degraded outcome (A4)', async () => {
    const steps = [
      step({ id: 1, step_order: 0, action: 'A', agent_id: 'research' }),
      step({ id: 2, step_order: 1, action: 'B', agent_id: 'comms' }),
    ];
    // research is paused → its step is skipped (not delegated); comms succeeds.
    const delegateToAgent = vi.fn(async (_agentId: string) => ({
      text: 'comms did real work',
      aborted: false,
    }));

    const out = await runRoutineOnce(routine(), steps, Date.now() / 1000 + 300, {
      sender: vi.fn(async () => {}),
      delegateToAgent: delegateToAgent as any,
      isAgentPaused: (id: string) => id === 'research',
      getLastRoutineOutcome: () => null,
    } as any);

    // The paused teammate's step is NOT delegated.
    const delegatedAgents = delegateToAgent.mock.calls.map((c) => (c as any[])[0]);
    expect(delegatedAgents).not.toContain('research');
    // One useful output + one skip → degraded.
    expect(out).toBe('degraded');
  });
});

// ── claim-once invariant (RTN-04, Pitfall 1) ─────────────────────────────────

describe('runRoutineOnce claim-once', () => {
  it('claim and delegate fire per-routine-run, never per-step (no double-fire)', async () => {
    const steps = [
      step({ id: 1, step_order: 0 }),
      step({ id: 2, step_order: 1 }),
      step({ id: 3, step_order: 2 }),
    ];
    const claim = vi.fn(() => true);
    const delegateToAgent = vi.fn(async () => ({ text: 'ok', aborted: false }));

    await runRoutineOnce(routine(), steps, Date.now() / 1000 + 300, {
      sender: vi.fn(async () => {}),
      delegateToAgent: delegateToAgent as any,
      claim: claim as any,
      isAgentPaused: () => false,
      getLastRoutineOutcome: () => null,
    } as any);

    // runRoutineOnce is invoked once with all steps; it must NOT re-claim per step.
    expect(claim.mock.calls.length).toBeLessThanOrEqual(1);
    // delegate fires once per step (3), proving claim is not coupled to step count.
    expect(delegateToAgent).toHaveBeenCalledTimes(3);
  });
});

// ── state-change notification (D-10, RTN-05) ─────────────────────────────────

describe('runRoutineOnce notify-transition', () => {
  it('notify-transition: sender fires once when prior outcome is "ok" and new outcome is failing', async () => {
    const steps = [step({ id: 1, on_error: 'stop' })];
    const delegateToAgent = vi.fn(async () => {
      throw new Error('step blew up');
    });
    const sender = vi.fn(async (_t: string) => {});

    await runRoutineOnce(routine(), steps, Date.now() / 1000 + 300, {
      sender,
      delegateToAgent: delegateToAgent as any,
      isAgentPaused: () => false,
      getLastRoutineOutcome: () => 'ok',
    } as any);

    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('notify-transition: sender fires once when prior outcome is null (first break)', async () => {
    const steps = [step({ id: 1, on_error: 'stop' })];
    const delegateToAgent = vi.fn(async () => {
      throw new Error('boom');
    });
    const sender = vi.fn(async (_t: string) => {});

    await runRoutineOnce(routine(), steps, Date.now() / 1000 + 300, {
      sender,
      delegateToAgent: delegateToAgent as any,
      isAgentPaused: () => false,
      getLastRoutineOutcome: () => null,
    } as any);

    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('notify-transition: sender does NOT fire when prior is already "failed" and new run also fails (D-10)', async () => {
    const steps = [step({ id: 1, on_error: 'stop' })];
    const delegateToAgent = vi.fn(async () => {
      throw new Error('still broken');
    });
    const sender = vi.fn(async (_t: string) => {});

    await runRoutineOnce(routine(), steps, Date.now() / 1000 + 300, {
      sender,
      delegateToAgent: delegateToAgent as any,
      isAgentPaused: () => false,
      getLastRoutineOutcome: () => 'failed',
    } as any);

    expect(sender).not.toHaveBeenCalled();
  });
});
