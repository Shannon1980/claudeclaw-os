/**
 * Approval replay executor (PERM-04 / D-08, Pitfall P-3).
 *
 * When an operator approves a queued "Needs you" item, the prepared tool call
 * captured at gate time must RUN — without redoing the agent's reasoning. This
 * module is the tiny, explicit, allowlisted executor that does that.
 *
 * SECURITY (P-3 / T-03-replay-exec):
 *   - There is NO eval and NO shell metaprogramming. We only replay tools we
 *     can run by name with their stored params:
 *       • `Write`  → an explicit `fs.writeFile` of the stored {file_path, content}.
 *       • `Bash`   → the stored {command} string, run as-is via the shell. The
 *                    command was already classified + gated BEFORE it was queued
 *                    (gate.ts classifyBash), so replay runs the SAME captured
 *                    command — we never interpolate operator/model text into it
 *                    beyond the already-gated literal (P-3 explicit carve-out).
 *       • `mcp__<server>__<tool>` → a single JSON-RPC `tools/call` against the
 *                    stdio MCP server with the stored params object. No shell,
 *                    no string building — the params travel as a structured JSON
 *                    object over the server's stdin.
 *   - Anything else (other built-ins, unknown shapes) is REJECTED with an honest
 *     error string. We never guess, never substitute a similar tool, never run
 *     an unrecognized action.
 *   - The stored params are the ONLY thing executed; env/secrets are never read
 *     from the queue row (L-4) — MCP servers get their own configured env from
 *     settings, exactly as they do under the live agent.
 *
 * The caller (dashboard approve route) records the returned result/error
 * verbatim in the approval row's `result` column and surfaces it to the UI
 * (honest replay-failure line, never a generic error).
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { loadMcpServers } from './agent.js';
import { WORKSPACE_ROOT } from './config.js';
import { logger } from './logger.js';

export interface ReplayResult {
  /** True iff the captured action actually ran to completion. */
  ok: boolean;
  /** A short, operator-readable outcome on success, or the honest failure reason. */
  message: string;
}

const MCP_CALL_TIMEOUT_MS = 30_000;
const REPLAY_TEXT_CAP = 2000;

/** Trim a value to a readable, capped one-liner for the result column. */
function cap(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > REPLAY_TEXT_CAP ? flat.slice(0, REPLAY_TEXT_CAP) + '…' : flat;
}

/**
 * Replay a captured tool call. Pure dispatch on the tool name — allowlisted
 * tools run, everything else returns an honest "can't replay" error. Never
 * throws: a thrown executor error is caught and returned as `ok:false`.
 */
export async function replayApproval(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<ReplayResult> {
  try {
    if (toolName === 'Write') return await replayWrite(toolInput);
    if (toolName === 'Bash') return await replayBash(toolInput);
    if (toolName.startsWith('mcp__')) return await replayMcp(toolName, toolInput);
    return {
      ok: false,
      message: `Couldn't replay — ${toolName} is not a replayable action. Re-run it from chat instead.`,
    };
  } catch (err) {
    return { ok: false, message: cap(`Couldn't replay — ${err instanceof Error ? err.message : String(err)}`) };
  }
}

/** Explicit Write executor: write the stored content to the stored path. */
async function replayWrite(input: Record<string, unknown>): Promise<ReplayResult> {
  const filePath = typeof input.file_path === 'string' ? input.file_path : '';
  const content = typeof input.content === 'string' ? input.content : '';
  if (!filePath) return { ok: false, message: "Couldn't replay — no file_path in the prepared action." };
  // A relative path was captured relative to the agent's cwd, not the host
  // process's (in the packaged .app that is the read-only bundle).
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath);
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  await fs.promises.writeFile(resolved, content, 'utf-8');
  return { ok: true, message: `Wrote ${resolved}.` };
}

/**
 * Explicit Bash executor: run the captured command string as-is. The command
 * was already gate-classified before it was queued (gate.ts classifyBash); we
 * replay the SAME literal, never an interpolated one (P-3). Captures combined
 * stdout/stderr and the exit code for an honest result line.
 */
function replayBash(input: Record<string, unknown>): Promise<ReplayResult> {
  const command = typeof input.command === 'string' ? input.command : '';
  if (!command) return Promise.resolve({ ok: false, message: "Couldn't replay — no command in the prepared action." });
  return new Promise<ReplayResult>((resolve) => {
    // Run the already-gated literal command. We pass it as the single program
    // argument to the shell — no concatenation with any other input. `cwd` is
    // the agent's workspace: the command was written against that directory, so
    // replaying it from the host process cwd (the read-only .app bundle) turned
    // every `git rev-parse` / relative path into a bogus failure.
    const child = spawn('/bin/sh', ['-c', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: WORKSPACE_ROOT,
    });
    let out = '';
    let settled = false;
    const finish = (r: ReplayResult) => { if (!settled) { settled = true; resolve(r); } };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, message: "Couldn't replay — command timed out." });
    }, MCP_CALL_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { out += String(d); });
    child.on('error', (e) => { clearTimeout(timer); finish({ ok: false, message: cap(`Couldn't replay — ${e.message}`) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) finish({ ok: true, message: cap(out || 'Command ran.') });
      else finish({ ok: false, message: cap(`Couldn't replay — command exited ${code}. ${out}`) });
    });
  });
}

/**
 * MCP executor: spawn the configured stdio MCP server for `mcp__<server>__<tool>`
 * and perform a single JSON-RPC `initialize` → `tools/call` exchange with the
 * stored params. No MCP SDK dependency (none is installed): we speak the
 * line-delimited JSON-RPC the server already expects on stdin/stdout. If the
 * server is not configured (e.g. test env), we fail honestly.
 */
function replayMcp(toolName: string, input: Record<string, unknown>): Promise<ReplayResult> {
  const parts = toolName.split('__');
  if (parts.length < 3) {
    return Promise.resolve({ ok: false, message: `Couldn't replay — ${toolName} is not a recognizable tool name.` });
  }
  const serverName = parts[1];
  const tool = parts.slice(2).join('__');

  const servers = loadMcpServers();
  const cfg = servers[serverName];
  if (!cfg) {
    // Only locally configured *stdio* servers can be replayed: we speak JSON-RPC
    // to a process we spawn ourselves. claude.ai connectors are HTTP servers the
    // CLI subprocess owns, so there is nothing here to spawn — saying "isn't
    // connected" blamed the connector for a limit of the replay path (they are
    // reachable fine during a live turn).
    const isRemoteConnector = serverName.startsWith('claude_ai_');
    return Promise.resolve({
      ok: false,
      message: isRemoteConnector
        ? `Couldn't replay — "${serverName}" is a claude.ai connector, which only runs inside a live agent turn. Re-run the request instead of approving it here.`
        : `Couldn't replay — no local MCP server named "${serverName}" is configured, so there's nothing to call. Add it to settings.json, or re-run the request instead.`,
    });
  }

  return new Promise<ReplayResult>((resolve) => {
    let settled = false;
    const finish = (r: ReplayResult) => { if (!settled) { settled = true; cleanup(); resolve(r); } };

    const child = spawn(cfg.command, cfg.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: WORKSPACE_ROOT,
      env: { ...process.env, ...(cfg.env ?? {}) },
    });

    const timer = setTimeout(() => {
      finish({ ok: false, message: "Couldn't replay — the tool didn't respond in time." });
    }, MCP_CALL_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }

    let buf = '';
    let initialized = false;

    function send(obj: unknown) {
      try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch { /* server closed */ }
    }

    child.stdout.on('data', (d) => {
      buf += String(d);
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: any;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1 && !initialized) {
          // initialize response → announce initialized, then call the tool.
          initialized = true;
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: input } });
        } else if (msg.id === 2) {
          if (msg.error) {
            finish({ ok: false, message: cap(`Couldn't replay — ${msg.error.message ?? 'the tool reported an error.'}`) });
          } else {
            const text = extractMcpText(msg.result);
            finish({ ok: true, message: cap(text || 'Done.') });
          }
        }
      }
    });

    child.stderr.on('data', () => { /* server logs — not part of the result */ });
    child.on('error', (e) => { finish({ ok: false, message: cap(`Couldn't replay — ${e.message}`) }); });
    child.on('close', () => {
      if (!settled) finish({ ok: false, message: "Couldn't replay — the tool exited before responding." });
    });

    // Kick off the JSON-RPC handshake.
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'claudeclaw-replay', version: '1.0.0' },
      },
    });

    logger.info({ serverName, tool }, 'replay: invoking MCP tool');
  });
}

/** Pull a readable string out of an MCP tools/call result (content[].text). */
function extractMcpText(result: unknown): string {
  if (result && typeof result === 'object') {
    const content = (result as any).content;
    if (Array.isArray(content)) {
      return content
        .map((c) => (c && typeof c === 'object' && typeof c.text === 'string' ? c.text : ''))
        .filter(Boolean)
        .join(' ');
    }
  }
  return '';
}
