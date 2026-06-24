// Wave 0 RED tests for the curated Activity read model (src/activity.ts).
//
// References `./activity.js`, which does NOT exist yet — the import failing is
// the intended RED state. Pins TRUST-01 + D-06:
//   - reverse-chron merge over approval_queue + audit_log permission rows
//   - tag derivation read-side (pending/approved/allow/denied/expired)
//   - dedupe: a queued action that wrote BOTH an audit outcome='queued' row and
//     an approval_queue row appears exactly once (approval_queue wins)
//   - attribution by agent_id
//   - undoable flag: only an approval_queue row on the undo allowlist, tier < 4,
//     with tool_input present (audit allow rows are never undoable)

import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase, getDb } from './db.js';
import { enqueueApproval, approve, deny } from './approval-queue.js';
import { buildActivityFeed, isUndoableFamily } from './activity.js';

beforeEach(() => {
  _initTestDatabase();
});

/** Insert a permission audit row with explicit created_at + detail (controls order). */
function insertPermissionAudit(opts: {
  agentId?: string;
  outcome: string;
  tool: string;
  tier: number;
  queueId?: number;
  createdAt: number;
  blocked?: boolean;
}): void {
  const detail = JSON.stringify({
    tool: opts.tool,
    tier: opts.tier,
    mode: 'balanced',
    outcome: opts.outcome,
    ...(opts.queueId !== undefined ? { queueId: opts.queueId } : {}),
  });
  getDb()
    .prepare(
      `INSERT INTO audit_log (agent_id, chat_id, action, detail, blocked, created_at)
       VALUES (?, '', 'permission', ?, ?, ?)`,
    )
    .run(opts.agentId ?? 'main', detail, opts.blocked ? 1 : 0, opts.createdAt);
}

/** Force a specific created_at on an approval_queue row (created_at is seconds). */
function setApprovalCreatedAt(id: number, createdAt: number): void {
  getDb().prepare(`UPDATE approval_queue SET created_at = ? WHERE id = ?`).run(createdAt, id);
}

function enqueueDraft(overrides: Record<string, unknown> = {}): number {
  return enqueueApproval({
    toolName: 'mcp__gmail__create-draft',
    toolInput: { to: 'a@b.com', subject: 'Hi' },
    tier: 2,
    modeAtDecision: 'balanced',
    agentId: 'comms',
    ...overrides,
  });
}

describe('activity buildActivityFeed', () => {
  it('reverse-chron: rows from both sources return newest first (created_at DESC, id DESC)', () => {
    const older = enqueueDraft();
    setApprovalCreatedAt(older, 1000);
    insertPermissionAudit({ outcome: 'allow', tool: 'mcp__gmail__list-labels', tier: 1, createdAt: 2000 });
    const newer = enqueueDraft();
    setApprovalCreatedAt(newer, 3000);

    const feed = buildActivityFeed({});
    const times = feed.map((r) => r.created_at);
    // strictly non-increasing
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
    expect(feed[0].created_at).toBe(3000);
  });

  it('tag derivation: pending -> Needs you', () => {
    const id = enqueueDraft();
    const row = buildActivityFeed({}).find((r) => r.source === 'queue' && r.id === id);
    expect(row?.tag).toBe('Needs you');
  });

  it('tag derivation: approved -> You approved', () => {
    const id = enqueueDraft();
    approve(id, { ok: true });
    const row = buildActivityFeed({}).find((r) => r.source === 'queue' && r.id === id);
    expect(row?.tag).toBe('You approved');
  });

  it('tag derivation: audit allow -> Ran on its own', () => {
    insertPermissionAudit({ outcome: 'allow', tool: 'mcp__gmail__list-labels', tier: 1, createdAt: 1000 });
    const row = buildActivityFeed({}).find((r) => r.source === 'audit');
    expect(row?.tag).toBe('Ran on its own');
  });

  it('tag derivation: denied / expired surface honestly, never dropped', () => {
    const deniedId = enqueueDraft();
    deny(deniedId, { ok: false });
    const feed = buildActivityFeed({});
    const denied = feed.find((r) => r.source === 'queue' && r.id === deniedId);
    expect(denied).toBeTruthy();
    expect(denied?.tag.toLowerCase()).toContain('denied');
  });

  it('no double: a queued action with BOTH an audit queued row and a queue row appears once', () => {
    const qId = enqueueDraft();
    setApprovalCreatedAt(qId, 5000);
    // The gate wrote an audit outcome='queued' row bridging to this queue id.
    insertPermissionAudit({
      outcome: 'queued',
      tool: 'mcp__gmail__create-draft',
      tier: 2,
      queueId: qId,
      createdAt: 5000,
      blocked: true,
    });

    const feed = buildActivityFeed({});
    const draftRows = feed.filter((r) => /draft/i.test(r.tool_name));
    expect(draftRows.length).toBe(1);
    expect(draftRows[0].source).toBe('queue');
  });

  it('attribution: each row carries agent_id from its source row', () => {
    const id = enqueueDraft({ agentId: 'research' });
    insertPermissionAudit({ agentId: 'ops', outcome: 'allow', tool: 'mcp__gmail__list-labels', tier: 1, createdAt: 1 });
    const feed = buildActivityFeed({});
    expect(feed.find((r) => r.source === 'queue' && r.id === id)?.agent_id).toBe('research');
    expect(feed.find((r) => r.source === 'audit')?.agent_id).toBe('ops');
  });

  it('undoable: only an approval_queue row on the allowlist, tier < 4, with tool_input', () => {
    const draftId = enqueueDraft(); // draft family, tier 2, has tool_input
    approve(draftId, { ok: true });
    const draftRow = buildActivityFeed({}).find((r) => r.source === 'queue' && r.id === draftId);
    expect(draftRow?.undoable).toBe(true);
  });

  it('undoable: an audit allow row (no tool_input) is never undoable', () => {
    insertPermissionAudit({ outcome: 'allow', tool: 'mcp__gmail__create-draft', tier: 2, createdAt: 1000 });
    const auditRow = buildActivityFeed({}).find((r) => r.source === 'audit');
    expect(auditRow?.undoable).toBe(false);
  });

  it('undoable: a tier 4 approved row is never undoable', () => {
    const id = enqueueApproval({
      toolName: 'mcp__gmail__create-draft',
      toolInput: { to: 'a@b.com' },
      tier: 4,
      modeAtDecision: 'balanced',
      agentId: 'comms',
    });
    approve(id, { ok: true });
    const row = buildActivityFeed({}).find((r) => r.source === 'queue' && r.id === id);
    expect(row?.undoable).toBe(false);
  });

  it('undoable: a non-allowlisted tool family is never undoable', () => {
    const id = enqueueApproval({
      toolName: 'mcp__gmail__send-email',
      toolInput: { to: 'a@b.com', body: 'x' },
      tier: 3,
      modeAtDecision: 'balanced',
      agentId: 'comms',
    });
    approve(id, { ok: true });
    const row = buildActivityFeed({}).find((r) => r.source === 'queue' && r.id === id);
    expect(row?.undoable).toBe(false);
  });

  it('filter needsyou returns only pending rows', () => {
    const pendingId = enqueueDraft();
    const approvedId = enqueueDraft();
    approve(approvedId, { ok: true });
    const feed = buildActivityFeed({ filter: 'needsyou' });
    expect(feed.every((r) => r.tag === 'Needs you')).toBe(true);
    expect(feed.some((r) => r.id === pendingId && r.source === 'queue')).toBe(true);
  });

  it('filter autonomous returns only Ran on its own rows', () => {
    enqueueDraft();
    insertPermissionAudit({ outcome: 'allow', tool: 'mcp__gmail__list-labels', tier: 1, createdAt: 1000 });
    const feed = buildActivityFeed({ filter: 'autonomous' });
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.every((r) => r.tag === 'Ran on its own')).toBe(true);
  });

  it('filter by agent_id returns only that teammate', () => {
    enqueueDraft({ agentId: 'comms' });
    enqueueDraft({ agentId: 'research' });
    const feed = buildActivityFeed({ filter: 'research' });
    expect(feed.every((r) => r.agent_id === 'research')).toBe(true);
  });

  it('limit caps the number of rows returned', () => {
    for (let i = 0; i < 5; i++) enqueueDraft();
    expect(buildActivityFeed({ limit: 3 }).length).toBe(3);
  });

  it('does not surface env/secret fields in any row', () => {
    enqueueDraft({ toolInput: { to: 'x@y.com', body: 'safe' } });
    const feed = buildActivityFeed({});
    const blob = JSON.stringify(feed);
    expect(blob).not.toMatch(/process\.env|API_KEY|OAUTH|sk-secret/i);
  });

  it('isUndoableFamily recognises draft/meeting/label families and rejects others', () => {
    expect(isUndoableFamily('mcp__gmail__create-draft')).toBe(true);
    expect(isUndoableFamily('mcp__gmail__send-email')).toBe(false);
    expect(isUndoableFamily('Bash')).toBe(false);
  });
});
