// Wave 3 RED tests for the Undo executor (TRUST-02 / D-07/D-08/D-09).
//
// The structural inverse of replay-executor.ts: an allowlist of reversible
// tool families (drafts/meetings/labels) that maps a captured tool_input to a
// known safe inverse MCP call, refuses Tier 4 BEFORE any dispatch (D-09), and
// returns an honest "no undo" for everything else (D-07). At least ONE family
// (the floor: label-remove) runs end-to-end via a real inverse (D-08).
//
// The MCP stdio layer is exercised end-to-end against a tiny fake JSON-RPC
// server injected via loadMcpServers() — so the floor family is proven to
// dispatch a real inverse, not a stub. No operator-connected server needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

// A tiny node script that speaks the line-delimited JSON-RPC the executor
// expects: respond to `initialize` (id 1), then echo a success result for
// `tools/call` (id 2) including the arguments it received, so the test can
// assert the inverse arguments were derived and sent as structured JSON.
const FAKE_MCP_SCRIPT = `
let buf = '';
process.stdin.on('data', (d) => {
  buf += String(d);
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 1) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\\n');
    } else if (msg.id === 2) {
      const args = JSON.stringify(msg.params && msg.params.arguments || {});
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'Removed label. args=' + args }] } }) + '\\n');
    }
  }
});
`;

let fakeServerPath: string;

// Mock loadMcpServers so the executor finds a "connected" gmail server whose
// command is our fake JSON-RPC node script. This injects a real inverse round
// trip without any operator setup. Other servers are intentionally absent so
// the honest "connect it in Settings" path is also reachable.
vi.mock('./agent.js', () => ({
  loadMcpServers: () => ({
    gmail: { command: process.execPath, args: [fakeServerPath] },
  }),
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { undoAction } from './undo-executor.js';

beforeEach(() => {
  if (!fakeServerPath) {
    fakeServerPath = path.join(os.tmpdir(), `fake-mcp-undo-${process.pid}.cjs`);
    fs.writeFileSync(fakeServerPath, FAKE_MCP_SCRIPT, 'utf-8');
  }
});

describe('undo-executor', () => {
  it('runs the floor family (label-remove) end-to-end via a real inverse and returns ok', async () => {
    const res = await undoAction(
      'mcp__gmail__apply-label',
      { message_id: 'msg-1', label: 'Follow up' },
      1,
    );
    expect(res.ok).toBe(true);
    // The inverse arguments were derived from the captured input and sent as
    // structured JSON over stdin (no string building, no eval).
    expect(res.message).toContain('msg-1');
  });

  it('refuses Tier 4 BEFORE any dispatch (D-09), with an honest message', async () => {
    const res = await undoAction(
      'mcp__gmail__apply-label',
      { message_id: 'msg-1', label: 'Follow up' },
      4,
    );
    expect(res.ok).toBe(false);
    expect(res.message.toLowerCase()).toContain("can't be undone");
  });

  it('returns an honest "no undo" for a non-allowlisted tool, never a fabricated success', async () => {
    const res = await undoAction('mcp__gmail__send-email', { to: 'a@b.com' }, 3);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Undo isn't available");
    expect(res.message).toContain('mcp__gmail__send-email');
  });

  it('fails honestly when the inverse server is not connected (no fake for gcal here)', async () => {
    const res = await undoAction('mcp__gcal__create-event', { event_id: 'evt-1' }, 2);
    // gcal is allowlisted (meeting family) but absent from the mocked servers,
    // so it must fail honestly with a connect-in-Settings message, never ok.
    expect(res.ok).toBe(false);
    expect(res.message.toLowerCase()).toContain('connect');
  });

  it('never throws on a bad/empty tool_input; a thrown error is returned as ok:false', async () => {
    const res = await undoAction('mcp__gmail__apply-label', {} as Record<string, unknown>, 1);
    expect(res.ok).toBe(false);
    // No message_id to remove — honest reason, not a crash.
    expect(typeof res.message).toBe('string');
  });

  it('produces no em dash in any returned message', async () => {
    const messages: string[] = [];
    messages.push((await undoAction('mcp__gmail__apply-label', { message_id: 'm', label: 'L' }, 1)).message);
    messages.push((await undoAction('mcp__gmail__apply-label', {}, 4)).message);
    messages.push((await undoAction('Write', { file_path: '/tmp/x' }, 1)).message);
    messages.push((await undoAction('mcp__gcal__create-event', { event_id: 'e' }, 2)).message);
    for (const m of messages) {
      expect(m).not.toContain('—');
    }
  });
});
