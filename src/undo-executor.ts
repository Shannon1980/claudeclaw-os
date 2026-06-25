/**
 * Undo executor (TRUST-02 / D-07/D-08/D-09).
 *
 * The structural inverse of replay-executor.ts. When an operator clicks Undo on
 * an allowlisted reversible action in the Activity feed, this module runs the
 * one known-safe inverse of the captured forward call. It is deliberately tiny,
 * explicit, and allowlisted. There is no eval and no shell metaprogramming.
 *
 * SECURITY (T-04-undo-allowlist / T-04-tier4 / T-04-injection / T-04-undo-infodisc):
 *   - Tier 4 (irreversible) is REFUSED before any allowlist check or dispatch
 *     (D-09). An irreversible action can never reach an MCP call here.
 *   - Only tool families on the SHARED isUndoableFamily allowlist (imported from
 *     activity.ts, the single source of truth) dispatch an inverse. Everything
 *     else returns an honest "no undo" string. We never guess, never substitute
 *     a similar tool, never fabricate a success.
 *   - The inverse arguments are DERIVED from the captured forward tool_input and
 *     travel as a structured JSON object over the server's stdin. No string
 *     building, no shell, no eval (mirror of replay-executor.replayMcp).
 *   - MCP env comes ONLY from loadMcpServers() cfg.env (exactly as under the
 *     live agent). No secret is ever read from the queue row (L-4 / ASVS V8).
 *
 * D-08 floor: at least ONE family (label-remove) runs end-to-end via a real
 * inverse. Families whose clean inverse cannot be confirmed against the
 * operator's connected MCP servers ship as an honest "connect it in Settings"
 * failure (never a faked or no-op success) and are logged as deferred
 * follow-ups (see .planning/phases/04-activity-feed/deferred-items.md).
 *
 * The caller (dashboard undo route) records the returned result verbatim in the
 * approval row's `result` column and surfaces it to the UI (honest undo-failure
 * line, never a generic error).
 */

import { spawn } from 'child_process';
import { loadMcpServers } from './agent.js';
import { isUndoableFamily } from './activity.js';
import { logger } from './logger.js';

/** The outcome of an undo attempt. */
export interface UndoResult {
  /** True iff the real inverse actually ran to completion. */
  ok: boolean;
  /** A short, operator-readable outcome on success, or the honest failure reason. */
  message: string;
}

const MCP_CALL_TIMEOUT_MS = 30_000;
const UNDO_TEXT_CAP = 2000;

/** Trim a value to a readable, capped one-liner for the result column. */
function cap(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > UNDO_TEXT_CAP ? flat.slice(0, UNDO_TEXT_CAP) + '...' : flat;
}

/**
 * The inverse map: a forward tool family resolves to the inverse MCP tool name
 * plus a deriver that pulls the inverse arguments out of the captured forward
 * tool_input. Kept tiny and explicit. The tool names follow the connected-server
 * `mcp__<server>__<hyphenated-tool>` convention; they are the most idempotent
 * inverse per family. If a family's inverse cannot be confirmed against the
 * operator's actual servers it still fails honestly at dispatch (server absent),
 * never silently no-ops.
 */
interface Inverse {
  /** The inverse MCP tool to call (`mcp__<server>__<tool>`). */
  tool: string;
  /** Derive the inverse arguments from the captured forward params. */
  derive: (input: Record<string, unknown>) => { args: Record<string, unknown>; missing?: string };
}

/** First non-empty string among the given keys of the captured input. */
function pick(input: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

/**
 * Resolve the inverse for an allowlisted forward tool. Returns undefined when
 * the tool is not on a reversible family (the caller then returns honest "no
 * undo"). Label-remove is the guaranteed floor family (D-08).
 */
function inverseFor(toolName: string): Inverse | undefined {
  // Labels: apply -> remove (the floor family; cleanest, idempotent).
  if (/label/i.test(toolName)) {
    return {
      tool: 'mcp__gmail__remove-label',
      derive: (input) => {
        const messageId = pick(input, ['message_id', 'messageId', 'id', 'thread_id', 'threadId']);
        const label = pick(input, ['label', 'label_id', 'labelId', 'label_name', 'labelName']);
        if (!messageId) return { args: {}, missing: 'no message id in the captured action' };
        // Guard label the same way as messageId (WR-03 / D-09): dispatching
        // remove-label with an empty label can silently no-op on the MCP server
        // while still reporting ok, faking a successful undo that did nothing.
        // Report an honest failure instead of dispatching an empty-label call.
        if (!label) return { args: {}, missing: 'no label id in the captured action' };
        return { args: { message_id: messageId, label } };
      },
    };
  }
  // Drafts: create -> delete.
  if (/draft/i.test(toolName)) {
    return {
      tool: 'mcp__gmail__delete-draft',
      derive: (input) => {
        const draftId = pick(input, ['draft_id', 'draftId', 'id']);
        if (!draftId) return { args: {}, missing: 'no draft id in the captured action' };
        return { args: { draft_id: draftId } };
      },
    };
  }
  // Meetings / calendar events: create -> delete (cancel/decline).
  if (/(calendar|gcal|event|meeting)/i.test(toolName)) {
    return {
      tool: 'mcp__gcal__delete-event',
      derive: (input) => {
        const eventId = pick(input, ['event_id', 'eventId', 'id']);
        if (!eventId) return { args: {}, missing: 'no event id in the captured action' };
        return { args: { event_id: eventId } };
      },
    };
  }
  return undefined;
}

/**
 * Run the known-safe inverse of a captured tool call. Guard order is load
 * bearing: (1) refuse Tier 4 before anything else (D-09); (2) dispatch only
 * families on the shared isUndoableFamily allowlist; (3) everything else returns
 * an honest "no undo". Never throws: a thrown error is caught and returned as
 * ok:false with an honest reason.
 *
 * @param toolName - The forward tool name as captured (`mcp__<server>__<tool>`).
 * @param toolInput - The captured forward params; the inverse args are derived from these.
 * @param tier - The action's permission tier; tier >= 4 is refused before dispatch.
 * @returns Whether the real inverse ran, plus an honest operator-readable message.
 */
export async function undoAction(
  toolName: string,
  toolInput: Record<string, unknown>,
  tier: number,
): Promise<UndoResult> {
  try {
    // (1) Tier 4 is irreversible. Refuse BEFORE any allowlist check or dispatch
    //     (D-09). No MCP call can ever run for a Tier 4 action.
    if (tier >= 4) {
      return { ok: false, message: "This action can't be undone." };
    }

    // (2) Only reversible families (shared allowlist, single source of truth)
    //     dispatch an inverse.
    if (!isUndoableFamily(toolName)) {
      return { ok: false, message: `Undo isn't available for ${toolName}.` };
    }
    const inverse = inverseFor(toolName);
    if (!inverse) {
      // On the family-name allowlist but no concrete inverse mapped: honest.
      return { ok: false, message: `Undo isn't available for ${toolName}.` };
    }

    const { args, missing } = inverse.derive(toolInput);
    if (missing) {
      return { ok: false, message: cap(`Couldn't undo. ${missing}.`) };
    }

    return await callInverseMcp(inverse.tool, args);
  } catch (err) {
    return { ok: false, message: cap(`Couldn't undo. ${err instanceof Error ? err.message : String(err)}`) };
  }
}

/**
 * Dispatch the inverse MCP tool. Mirrors replay-executor.replayMcp exactly:
 * loads the connected server config, spawns it with its own configured env
 * (never the queue row), and performs a single JSON-RPC initialize ->
 * notifications/initialized -> tools/call with the derived structured-JSON
 * arguments. If the server is not connected, fails honestly with a
 * connect-in-Settings message (D-08). No MCP SDK dependency (none is installed).
 */
function callInverseMcp(toolName: string, args: Record<string, unknown>): Promise<UndoResult> {
  const parts = toolName.split('__');
  if (parts.length < 3) {
    return Promise.resolve({ ok: false, message: `Couldn't undo. ${toolName} is not a recognizable tool name.` });
  }
  const serverName = parts[1];
  const tool = parts.slice(2).join('__');

  const servers = loadMcpServers();
  const cfg = servers[serverName];
  if (!cfg) {
    return Promise.resolve({
      ok: false,
      message: `Couldn't undo. Connect ${serverName} in Settings to undo this.`,
    });
  }

  return new Promise<UndoResult>((resolve) => {
    let settled = false;
    const finish = (r: UndoResult) => { if (!settled) { settled = true; cleanup(); resolve(r); } };

    const child = spawn(cfg.command, cfg.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Env comes ONLY from the configured server (as under the live agent).
      // No secret is ever read from the queue row (L-4 / ASVS V8).
      env: { ...process.env, ...(cfg.env ?? {}) },
    });

    const timer = setTimeout(() => {
      finish({ ok: false, message: "Couldn't undo. The tool didn't respond in time." });
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
        let msg: { id?: number; error?: { message?: string }; result?: unknown };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1 && !initialized) {
          // initialize response -> announce initialized, then call the inverse.
          initialized = true;
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } });
        } else if (msg.id === 2) {
          if (msg.error) {
            finish({ ok: false, message: cap(`Couldn't undo. ${msg.error.message ?? 'the tool reported an error.'}`) });
          } else {
            const text = extractMcpText(msg.result);
            finish({ ok: true, message: cap(text || 'Undone.') });
          }
        }
      }
    });

    child.stderr.on('data', () => { /* server logs, not part of the result */ });
    child.on('error', (e) => { finish({ ok: false, message: cap(`Couldn't undo. ${e.message}`) }); });
    child.on('close', () => {
      if (!settled) finish({ ok: false, message: "Couldn't undo. The tool exited before responding." });
    });

    // Kick off the JSON-RPC handshake.
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'claudeclaw-undo', version: '1.0.0' },
      },
    });

    logger.info({ serverName, tool }, 'undo: invoking inverse MCP tool');
  });
}

/** Pull a readable string out of an MCP tools/call result (content[].text). */
function extractMcpText(result: unknown): string {
  if (result && typeof result === 'object') {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      return content
        .map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
        .filter(Boolean)
        .join(' ');
    }
  }
  return '';
}
