// Wave 0 RED tests for the Phase 3 permission gate (PERM-01..04 + D-10).
//
// These reference `./gate.js`, which does NOT exist yet. The import failing is
// the intended RED state — plans 02-04 are graded against these executable
// specifications, not against interpretation.
//
// What this file pins:
//   - classifyTier: the concrete tool -> tier mapping + the D-03 safe default
//     (unknown tools are never Tier 1/2).
//   - resolveOutcome: the mode x tier (allow|ask) matrix (PERM-01), per-action
//     overrides flipping Tier 2/3 (PERM-02), and the Tier 4 lock that ignores
//     both mode and override (PERM-03).
//   - makeCanUseTool: a background (unattended) Tier 3 call denies + enqueues
//     (PERM-04), and every decision path records exactly one audit() event
//     carrying tool/tier/mode/outcome with NO secret material (D-10).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setAuditCallback, type AuditEntry } from './security.js';
import {
  _initTestDatabase,
  insertAuditLog,
  getAuditLogFiltered,
} from './db.js';
import {
  classifyTier,
  resolveOutcome,
  makeCanUseTool,
  type Tier,
  type Mode,
  type GateContext,
} from './gate.js';

// The SDK CanUseTool callback is invoked with a third `options` argument
// ({ signal }). Supply a no-op one here so the calls match the SDK signature;
// the gate ignores it (`_options`), so this changes no assertion.
const OPTS = { signal: new AbortController().signal, toolUseID: 'test-tool-use' };

describe('classify', () => {
  it('maps money/sign/delete MCP tools to Tier 4', () => {
    expect(classifyTier('mcp__quickbooks__pay-invoice')).toBe(4 as Tier);
    expect(classifyTier('mcp__docusign__send-for-signature')).toBe(4 as Tier);
    expect(classifyTier('mcp__drive__permanent-delete')).toBe(4 as Tier);
  });

  it('maps destructive Bash commands to Tier 4', () => {
    expect(classifyTier('Bash', { command: 'rm -rf /tmp/x' })).toBe(4 as Tier);
    expect(classifyTier('Bash', { command: 'git push --force origin main' })).toBe(4 as Tier);
    expect(classifyTier('Bash', { command: 'drop table users' })).toBe(4 as Tier);
  });

  it('maps ship-shaped Bash commands to Tier 4 so Autonomous cannot auto-run them', () => {
    // Landing on main / rewriting shared history.
    expect(classifyTier('Bash', { command: 'git push origin main' })).toBe(4 as Tier);
    expect(classifyTier('Bash', { command: 'git push -f origin feature' })).toBe(4 as Tier);
    expect(classifyTier('Bash', { command: 'git push --force-with-lease' })).toBe(4 as Tier);
    expect(classifyTier('Bash', { command: 'gh pr merge 103 --squash' })).toBe(4 as Tier);
    // Publishing outward.
    expect(classifyTier('Bash', { command: 'npm publish --access public' })).toBe(4 as Tier);
    expect(classifyTier('Bash', { command: 'gh release create v1.3.0' })).toBe(4 as Tier);
    // Deploying locally.
    expect(classifyTier('Bash', { command: 'npm run electron:build' })).toBe(4 as Tier);
    expect(classifyTier('Bash', { command: 'npm run migrate' })).toBe(4 as Tier);
    expect(classifyTier('Bash', { command: 'ditto /tmp/x/ClaudeClaw.app /Applications/ClaudeClaw.app' })).toBe(4 as Tier);
    expect(classifyTier('Bash', { command: 'launchctl bootout gui/501/com.claudeclaw.main' })).toBe(4 as Tier);
  });

  it('leaves ordinary PR-flow Bash commands below Tier 4', () => {
    // Agents must still be able to branch, commit and push a feature branch
    // unattended — the PR is the artifact the operator reviews.
    expect(classifyTier('Bash', { command: 'git checkout -b claude/fix-thing' })).toBe(3 as Tier);
    expect(classifyTier('Bash', { command: 'git commit -m "fix: thing"' })).toBe(3 as Tier);
    expect(classifyTier('Bash', { command: 'git push -u origin claude/fix-thing' })).toBe(3 as Tier);
    expect(classifyTier('Bash', { command: 'gh pr create --base main --title x --body y' })).toBe(3 as Tier);
    expect(classifyTier('Bash', { command: 'npm test' })).toBe(3 as Tier);
  });

  it('locks ship-shaped Bash even in Autonomous mode with a send override', () => {
    // The whole point: Tier 3 auto-runs under Autonomous, Tier 4 never does.
    expect(resolveOutcome(classifyTier('Bash', { command: 'npm run electron:build' }), 'autonomous', { send: 'always' })).toBe('ask');
    expect(resolveOutcome(classifyTier('Bash', { command: 'git push origin main' }), 'autonomous', {})).toBe('ask');
    expect(resolveOutcome(classifyTier('Bash', { command: 'git push -u origin claude/x' }), 'autonomous', {})).toBe('allow');
  });

  it('maps read-only Bash and read-only built-ins to Tier 1', () => {
    expect(classifyTier('Bash', { command: 'ls -la' })).toBe(1 as Tier);
    expect(classifyTier('Bash', { command: 'cat package.json' })).toBe(1 as Tier);
    expect(classifyTier('Bash', { command: 'git status' })).toBe(1 as Tier);
    expect(classifyTier('Read')).toBe(1 as Tier);
    expect(classifyTier('Grep')).toBe(1 as Tier);
    expect(classifyTier('WebSearch')).toBe(1 as Tier);
  });

  it('maps Write/Edit to Tier 2', () => {
    expect(classifyTier('Write')).toBe(2 as Tier);
    expect(classifyTier('Edit')).toBe(2 as Tier);
  });

  it('maps external send/post MCP tools to Tier 3', () => {
    expect(classifyTier('mcp__gmail__send-email')).toBe(3 as Tier);
    expect(classifyTier('mcp__slack__post-message')).toBe(3 as Tier);
  });

  it('maps read-only MCP tools to Tier 1 even when the tool name repeats the server name', () => {
    // Connector-style names: the read verb is mid-segment, not right after `__`.
    expect(classifyTier('mcp__claude_ai_Slack__slack_search_public_and_private')).toBe(1 as Tier);
    expect(classifyTier('mcp__claude_ai_Slack__slack_read_channel')).toBe(1 as Tier);
    expect(classifyTier('mcp__claude_ai_Gmail__search_threads')).toBe(1 as Tier);
    expect(classifyTier('mcp__gmail__gmail_list_labels')).toBe(1 as Tier);
    expect(classifyTier('mcp__echo-ai__list_overdue_todos')).toBe(1 as Tier);
  });

  it('keeps send-ish MCP tools off the Tier 1 read path even when they mention draft', () => {
    expect(classifyTier('mcp__gmail__gmail_send_draft')).toBe(3 as Tier);
    expect(classifyTier('mcp__claude_ai_Slack__slack_send_message_draft')).toBe(3 as Tier);
    // A pure draft read/prepare stays Tier 1.
    expect(classifyTier('mcp__gmail__gmail_list_drafts')).toBe(1 as Tier);
  });

  it('defaults UNKNOWN/unclassified tools to Tier 3 (D-03 safe side, never Tier 1/2)', () => {
    const t = classifyTier('mcp__mystery__do-something-unknown');
    expect(t).toBe(3 as Tier);
    expect(t).not.toBe(1 as Tier);
    expect(t).not.toBe(2 as Tier);
  });
});

describe('resolveOutcome mode matrix', () => {
  // cautious = auto Tier 1 only; balanced = auto Tier 1+2;
  // autonomous = auto Tier 1+2+3; Tier 4 = ask in all three (PERM-01).
  const cases: Array<{ mode: Mode; tier: Tier; expected: 'allow' | 'ask' }> = [
    { mode: 'cautious', tier: 1 as Tier, expected: 'allow' },
    { mode: 'cautious', tier: 2 as Tier, expected: 'ask' },
    { mode: 'cautious', tier: 3 as Tier, expected: 'ask' },
    { mode: 'cautious', tier: 4 as Tier, expected: 'ask' },
    { mode: 'balanced', tier: 1 as Tier, expected: 'allow' },
    { mode: 'balanced', tier: 2 as Tier, expected: 'allow' },
    { mode: 'balanced', tier: 3 as Tier, expected: 'ask' },
    { mode: 'balanced', tier: 4 as Tier, expected: 'ask' },
    { mode: 'autonomous', tier: 1 as Tier, expected: 'allow' },
    { mode: 'autonomous', tier: 2 as Tier, expected: 'allow' },
    { mode: 'autonomous', tier: 3 as Tier, expected: 'allow' },
    { mode: 'autonomous', tier: 4 as Tier, expected: 'ask' },
  ];

  for (const { mode, tier, expected } of cases) {
    it(`${mode} + Tier ${tier} -> ${expected}`, () => {
      expect(resolveOutcome(tier, mode, {})).toBe(expected);
    });
  }
});

describe('override', () => {
  it('an `always` override flips a defaulted-ask Tier 3 capability to allow (PERM-02)', () => {
    // balanced default for Tier 3 is ask; override forces allow.
    expect(resolveOutcome(3 as Tier, 'balanced', {})).toBe('ask');
    expect(resolveOutcome(3 as Tier, 'balanced', { send: 'always' })).toBe('allow');
  });

  it('an `ask` override forces ask where the mode default was allow (PERM-02)', () => {
    // balanced default for Tier 2 is allow; override forces ask.
    expect(resolveOutcome(2 as Tier, 'balanced', {})).toBe('allow');
    expect(resolveOutcome(2 as Tier, 'balanced', { save: 'ask' })).toBe('ask');
  });

  it('with no override the mode default applies', () => {
    expect(resolveOutcome(3 as Tier, 'autonomous', {})).toBe('allow');
    expect(resolveOutcome(3 as Tier, 'cautious', {})).toBe('ask');
  });
});

describe('tier4 locked', () => {
  it('returns ask for Tier 4 in EVERY mode (PERM-03)', () => {
    expect(resolveOutcome(4 as Tier, 'cautious', {})).toBe('ask');
    expect(resolveOutcome(4 as Tier, 'balanced', {})).toBe('ask');
    expect(resolveOutcome(4 as Tier, 'autonomous', {})).toBe('ask');
  });

  it('ignores an `always` override on the Tier 4 capability — the lock holds (PERM-03)', () => {
    expect(resolveOutcome(4 as Tier, 'autonomous', { 'send-money': 'always' })).toBe('ask');
    expect(resolveOutcome(4 as Tier, 'balanced', { 'send-money': 'always' })).toBe('ask');
  });
});

describe('background queue deny', () => {
  it('denies a Tier 3 tool in a background (unattended) context under balanced and enqueues it (PERM-04)', async () => {
    const enqueue = vi.fn().mockReturnValue(1);
    const ctx: GateContext = {
      attended: false,
      mode: 'balanced',
      overrides: {},
      enqueue,
    };
    const canUseTool = makeCanUseTool(ctx);
    const result = await canUseTool('mcp__gmail__send-email', { to: 'x@y.com' }, OPTS);
    expect(result).toMatchObject({ behavior: 'deny' });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('audit recorded', () => {
  let entries: AuditEntry[];

  beforeEach(() => {
    entries = [];
    setAuditCallback((e) => entries.push(e));
  });

  async function runDecision(ctx: GateContext, tool: string, input: Record<string, unknown>) {
    const canUseTool = makeCanUseTool(ctx);
    return canUseTool(tool, input, OPTS);
  }

  it('records exactly one permission audit on the allow path with tool/tier/mode/outcome', async () => {
    await runDecision(
      { attended: false, mode: 'autonomous', overrides: {}, enqueue: vi.fn() },
      'Read',
      { file_path: '/tmp/x' },
    );
    const perm = entries.filter((e) => e.action === ('permission' as AuditEntry['action']));
    expect(perm).toHaveLength(1);
    const detail = JSON.parse(perm[0].detail);
    expect(detail).toMatchObject({ tool: 'Read', tier: 1, mode: 'autonomous', outcome: 'allow' });
  });

  it('enriches the permission audit with tool/target/decision/decidedBy/decidedAt/durationMs/session/model (D-01)', async () => {
    await runDecision(
      {
        attended: false,
        mode: 'autonomous',
        overrides: {},
        enqueue: vi.fn(),
        sessionId: 'sess-xyz',
        model: 'claude-opus-4',
      },
      'Write',
      { file_path: '/tmp/report.md', content: 'hi' },
    );
    const perm = entries.filter((e) => e.action === ('permission' as AuditEntry['action']));
    expect(perm).toHaveLength(1);
    const e = perm[0];
    expect(e.eventType).toBe('permission');
    expect(e.tool).toBe('Write');
    // safeTarget whitelists file_path for Write, never the raw input/content.
    expect(e.target).toBe('/tmp/report.md');
    expect(e.decision).toBe('allow');
    expect(e.decidedBy).toBe('system');
    expect(typeof e.decidedAt).toBe('number');
    expect(typeof e.durationMs).toBe('number');
    expect(e.durationMs).toBeGreaterThanOrEqual(0);
    expect(e.sessionId).toBe('sess-xyz');
    expect(e.model).toBe('claude-opus-4');
  });

  it('marks an inline approval as decidedBy=operator', async () => {
    await runDecision(
      {
        attended: true,
        mode: 'cautious',
        overrides: {},
        requestInline: vi.fn().mockResolvedValue(true),
      },
      'mcp__gmail__send-email',
      { to: 'a@b.com', subject: 'hi' },
    );
    const perm = entries.filter((e) => e.action === ('permission' as AuditEntry['action']));
    expect(perm).toHaveLength(1);
    expect(perm[0].decidedBy).toBe('operator');
    // whitelisted, non-secret recipient is recorded as the target.
    expect(perm[0].target).toBe('a@b.com');
  });

  it('records exactly one permission audit on the queued (background-deny) path', async () => {
    await runDecision(
      { attended: false, mode: 'balanced', overrides: {}, enqueue: vi.fn().mockReturnValue(7) },
      'mcp__gmail__send-email',
      { to: 'a@b.com' },
    );
    const perm = entries.filter((e) => e.action === ('permission' as AuditEntry['action']));
    expect(perm).toHaveLength(1);
    const detail = JSON.parse(perm[0].detail);
    expect(detail).toMatchObject({ tool: 'mcp__gmail__send-email', tier: 3, mode: 'balanced' });
    expect(detail.outcome).toMatch(/queue|deny/);
    // A queued decision is PENDING — the operator decides later in the queue.
    // The gate must NOT claim the system decided it; decidedBy stays unset and
    // is resolved read-side (getAuditLogFiltered) once the queue row is acted on.
    expect(perm[0].decidedBy).toBeUndefined();
  });

  it('never writes secret/env material into the audit detail (D-10 / L-4)', async () => {
    const secret = 'sk-super-secret-token-AKIA1234567890';
    await runDecision(
      { attended: false, mode: 'autonomous', overrides: {}, enqueue: vi.fn() },
      'mcp__slack__post-message',
      { token: secret, text: 'hi' },
    );
    const perm = entries.filter((e) => e.action === ('permission' as AuditEntry['action']));
    expect(perm.length).toBeGreaterThanOrEqual(1);
    for (const e of perm) {
      expect(e.detail).not.toContain(secret);
      // The secret must not leak into the new structured target field either
      // (T-05-02 / D-10 / L-4). slack post-message whitelists `channel`, not
      // `token`, so target should be omitted entirely here.
      expect(e.target ?? '').not.toContain(secret);
    }
  });
});

// ── End-to-end model capture (D-01) ──────────────────────────────────────────
//
// This proves the FULL chain, not a synthetic fixture row:
//   GateContext.model → recordDecision → audit() → insertAuditLog → audit_log →
//   getAuditLogFiltered (the same reader /api/audit uses).
// A permission decision fired inside a GateContext carrying a known model must
// yield a persisted audit_log row whose `model` column equals that value and is
// non-null. If the turn-boundary model never reaches the row, this is RED.

describe('model capture is persisted end-to-end (D-01)', () => {
  const SENTINEL_MODEL = 'claude-test-model';

  beforeEach(() => {
    // Real in-memory audit_log (createSchema + the v1.2.4 enrich columns).
    _initTestDatabase();
    // Wire the choke point to the real writer, exactly as src/index.ts does.
    setAuditCallback((e) => insertAuditLog(e));
  });

  it('a permission decision in a GateContext carrying a model persists that model on the audit_log row', async () => {
    const ctx: GateContext = {
      attended: false,
      mode: 'autonomous',
      overrides: {},
      enqueue: vi.fn(),
      sessionId: 'sess-e2e',
      model: SENTINEL_MODEL,
    };
    const canUseTool = makeCanUseTool(ctx);
    await canUseTool('Read', { file_path: '/tmp/x' }, OPTS);

    const rows = getAuditLogFiltered({ eventType: 'permission' });
    const permRows = rows.filter((r) => r.action === 'permission');
    expect(permRows.length).toBeGreaterThanOrEqual(1);
    const row = permRows[0];
    expect(row.model).not.toBeNull();
    expect(row.model).toBe(SENTINEL_MODEL);
    expect(row.session_id).toBe('sess-e2e');
  });
});
