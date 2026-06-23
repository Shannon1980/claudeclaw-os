// Wave 0 RED tests for the approval queue (PERM-04 + L-3 replay-once + D-08).
//
// References `./approval-queue.js`, which does NOT exist yet — the import
// failing is the intended RED state. Pins the full state machine:
//   enqueue -> pending; list returns pending; approve pending->approved with
//   decided_at + result; deny pending->denied; expire flips stale pending.
// Plus the L-3 replay-once guard: a SECOND approve on an already-approved id
// is a no-op (the status-guarded UPDATE changed zero rows) and the function
// reports it did not act. tool_input round-trips as captured JSON params
// (D-08) and no env/secret material is written.

import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import {
  enqueueApproval,
  listPending,
  approve,
  deny,
  expireOlderThan,
} from './approval-queue.js';

beforeEach(() => {
  _initTestDatabase();
});

function enqueueSample(overrides: Record<string, unknown> = {}): number {
  return enqueueApproval({
    toolName: 'mcp__gmail__send-email',
    toolInput: { to: 'a@b.com', subject: 'Hi', body: 'body' },
    tier: 3,
    modeAtDecision: 'balanced',
    summary: 'Send email to a@b.com',
    runId: 'routine-123',
    ...overrides,
  });
}

describe('approval-queue', () => {
  it('enqueueApproval inserts a pending row and returns its id; listPending returns it', () => {
    const id = enqueueSample();
    expect(typeof id).toBe('number');
    const pending = listPending();
    const found = pending.find((p) => p.id === id);
    expect(found).toBeTruthy();
    expect(found!.status).toBe('pending');
  });

  it('tool_input round-trips as the captured JSON params (D-08)', () => {
    const id = enqueueSample({ toolInput: { to: 'x@y.com', subject: 'Quote', amount: 42 } });
    const found = listPending().find((p) => p.id === id);
    expect(found!.tool_input).toMatchObject({ to: 'x@y.com', subject: 'Quote', amount: 42 });
  });

  it('approve transitions pending->approved, sets decided_at, and stores a result', () => {
    const id = enqueueSample();
    const acted = approve(id, { ok: true, sent: 'message-id-1' });
    expect(acted).toBe(true);
    const found = listPending().find((p) => p.id === id);
    expect(found).toBeFalsy(); // no longer pending
  });

  it('deny transitions pending->denied', () => {
    const id = enqueueSample();
    const acted = deny(id);
    expect(acted).toBe(true);
    const found = listPending().find((p) => p.id === id);
    expect(found).toBeFalsy();
  });

  it('replay-once: a SECOND approve on an already-approved id is a no-op (L-3)', () => {
    const id = enqueueSample();
    const first = approve(id, { ok: true });
    expect(first).toBe(true);
    const second = approve(id, { ok: true });
    expect(second).toBe(false); // status-guarded UPDATE changed zero rows
  });

  it('expireOlderThan flips stale pending rows to expired', () => {
    const id = enqueueSample();
    // Expire everything older than "now + 1s" so the just-inserted row is stale.
    const cutoff = Math.floor(Date.now() / 1000) + 1;
    expireOlderThan(cutoff);
    const found = listPending().find((p) => p.id === id);
    expect(found).toBeFalsy();
  });

  it('does not write env/secret material into the queue row', () => {
    const secret = 'sk-secret-AKIA0987654321';
    const id = enqueueSample({ toolInput: { to: 'x@y.com', body: 'safe' }, summary: 'safe summary' });
    const found = listPending().find((p) => p.id === id);
    expect(JSON.stringify(found)).not.toContain(secret);
  });
});
