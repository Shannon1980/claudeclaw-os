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
  getApprovalById,
  listApprovals,
  undo,
} from './approval-queue.js';
import { getDb } from './db.js';

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

describe('approval-queue read helpers (Undo prep)', () => {
  it('getApprovalById returns a hydrated row of any status (pending/approved/denied/expired)', () => {
    const pendingId = enqueueSample();
    const approvedId = enqueueSample();
    approve(approvedId, { ok: true });
    const deniedId = enqueueSample();
    deny(deniedId, { ok: false });

    const pending = getApprovalById(pendingId);
    expect(pending?.status).toBe('pending');
    // tool_input hydrated to an object, not the raw JSON string.
    expect(typeof pending?.tool_input).toBe('object');
    expect(pending?.tool_input).toMatchObject({ to: 'a@b.com' });

    expect(getApprovalById(approvedId)?.status).toBe('approved');
    expect(getApprovalById(deniedId)?.status).toBe('denied');
  });

  it('getApprovalById returns undefined for a missing id', () => {
    expect(getApprovalById(999_999)).toBeUndefined();
  });

  it('listApprovals(statuses) returns only rows in those statuses, most-recent-first', () => {
    const pendingId = enqueueSample();
    const approvedId = enqueueSample();
    approve(approvedId, { ok: true });
    const deniedId = enqueueSample();
    deny(deniedId, { ok: false });

    const rows = listApprovals(['approved', 'denied']);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(approvedId);
    expect(ids).toContain(deniedId);
    expect(ids).not.toContain(pendingId);
    // Ordered created_at DESC, id DESC — the later-inserted denied id comes first.
    expect(ids.indexOf(deniedId)).toBeLessThan(ids.indexOf(approvedId));
  });

  it('listApprovals([]) returns no rows (empty status set)', () => {
    enqueueSample();
    expect(listApprovals([])).toEqual([]);
  });

  it('a corrupt tool_input JSON string hydrates to {} and does not throw', () => {
    const id = enqueueSample();
    // Force a corrupt JSON blob directly into the row.
    getDb()
      .prepare(`UPDATE approval_queue SET tool_input = ? WHERE id = ?`)
      .run('{not valid json', id);
    expect(() => getApprovalById(id)).not.toThrow();
    expect(getApprovalById(id)?.tool_input).toEqual({});
  });
});

describe('undo write (status-guarded, no double-fire, T-04-undo-doublefire)', () => {
  it('records the undo result on an approved row and returns true', () => {
    const id = enqueueSample();
    approve(id, { ok: true });
    const acted = undo(id, { ok: true, message: 'Removed label.' });
    expect(acted).toBe(true);
    const row = getApprovalById(id);
    expect(row?.status).toBe('approved'); // status unchanged; only result stamped
    expect(row?.result).toContain('Removed label.');
  });

  it('a SECOND undo of the same row is a no-op returning false (no double-fire)', () => {
    const id = enqueueSample();
    approve(id, { ok: true });
    const first = undo(id, { ok: true, message: 'Removed label.' });
    expect(first).toBe(true);
    const second = undo(id, { ok: true, message: 'Removed label.' });
    expect(second).toBe(false); // status-guarded: already undone
  });

  it('undo on a non-approved (pending) row is a no-op returning false', () => {
    const id = enqueueSample(); // stays pending
    const acted = undo(id, { ok: true, message: 'x' });
    expect(acted).toBe(false);
  });

  it('undo on an unknown id returns false', () => {
    expect(undo(999_999, { ok: true })).toBe(false);
  });
});
