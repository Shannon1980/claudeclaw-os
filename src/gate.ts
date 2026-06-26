/**
 * The permission gate — Slice A, the pure-logic engine core.
 *
 * Three responsibilities, all in-process inside the Node host that calls the
 * Agent SDK's `query()`:
 *   1. classifyTier(toolName, input) → 1..4   — name-pattern + Bash-command map.
 *   2. resolveOutcome(tier, mode, overrides) → 'allow' | 'ask'  — the mode×tier
 *      matrix, per-capability overrides, and the non-overridable Tier 4 lock.
 *   3. makeCanUseTool(ctx) → SDK CanUseTool callback — records every decision
 *      via audit() and, for 'ask', either blocks for an inline yes/no (attended)
 *      or enqueues + denies immediately (background).
 *
 * Design rules (from 03-RESEARCH + CONTEXT decisions):
 *   - Tier 4 (money / signing / permanent delete) is ALWAYS 'ask' — the lock
 *     precedes any mode/override branch (PERM-03, D-01, D-05).
 *   - Unknown / unclassified tools default to Tier 3 'ask', never Tier 1/2
 *     (D-03 safe side).
 *   - Never return `updatedPermissions` — every call re-enters the gate so no
 *     cached allow can bypass the lock (D-05).
 *   - Fail to the SAFE-USABLE side: a classify/resolve throw OR the
 *     PERMISSION_GATE_ENABLED kill switch being off routes to the Tier 3
 *     ask/queue path — never deny-all (bricks the bot) or allow-all (L-2).
 *   - Audit detail carries only tool/tier/mode/outcome — never env/secrets
 *     (D-10, L-4, ASVS V8).
 */

import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { audit } from './security.js';
import { getMode, getOverrides, type Mode, type OverrideValue } from './permissions-config.js';
import { isEnabled } from './kill-switches.js';

export type { Mode } from './permissions-config.js';
export type Tier = 1 | 2 | 3 | 4;

// ── Classification ───────────────────────────────────────────────────
//
// Classify by tool-name pattern (and, for Bash, by the command), because MCP
// servers are configured per-operator and are not a fixed list in the repo.

// Tier 4 LOCKED (D-01) — money movement, contract signing, permanent delete.
const TIER4_PATTERNS: RegExp[] = [
  /pay/i, /invoice/i, /payment[-_]?link/i, /purchase/i, /charge/i,
  /sign(ature)?/i, /docusign/i, /contract/i,
  /delete[-_]?permanent/i, /permanent[-_]?delete/i, /purge/i, /destroy/i,
];

// Tier 1 — read & prepare (read-only built-ins + read-only MCP).
const TIER1_BUILTINS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'NotebookRead']);
const TIER1_MCP: RegExp[] = [/(^|__)(get|list|read|search|find|fetch|summar)/i, /draft/i];

// Tier 3 — consequential external send/post/reply/book-with-external.
const TIER3_PATTERNS: RegExp[] = [
  /send/i, /post/i, /publish/i, /reply/i,
  /^mcp__slack__/i, /^mcp__gmail__send/i,
  /calendar.*(create|move|update)/i,
];

// Tier 2 — low-stakes external (labels, Drive save, internal-only).
const TIER2_PATTERNS: RegExp[] = [/label/i, /save/i, /upload/i, /drive/i, /archive/i];

/**
 * Bash is special: anything but a recognized read-only command defaults to
 * Tier 3 (ask), and known-destructive commands escalate to Tier 4, because
 * Bash can do anything including move money or permanently delete.
 */
function classifyBash(input: Record<string, unknown>): Tier {
  const cmd = String(input.command ?? '');
  const DESTRUCTIVE = /\b(rm\s+-rf?\b|git\s+push\s+--force|drop\s+table|shred\b|dd\s+if=)/i;
  const READ_ONLY = /^\s*(ls|cat|grep|rg|find|head|tail|wc|pwd|echo|git\s+(status|log|diff|show))\b/i;
  if (DESTRUCTIVE.test(cmd)) return 4; // irreversible
  if (READ_ONLY.test(cmd)) return 1;
  return 3; // unknown command = ask (D-03 safe default)
}

/**
 * Map a tool name (+ optional input) to a tier. Pure, total, never throws on
 * normal input. Unknown tools fall to Tier 3 (D-03), never Tier 1/2.
 */
export function classifyTier(toolName: string, input: Record<string, unknown> = {}): Tier {
  if (TIER4_PATTERNS.some((r) => r.test(toolName))) return 4;
  if (TIER1_BUILTINS.has(toolName)) return 1;
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') return 2;
  if (toolName === 'Bash') return classifyBash(input);
  if (TIER1_MCP.some((r) => r.test(toolName))) return 1;
  if (TIER3_PATTERNS.some((r) => r.test(toolName))) return 3;
  if (TIER2_PATTERNS.some((r) => r.test(toolName))) return 2;
  return 3; // D-03 safe default — never silent auto-run an unclassified tool
}

// ── Resolution ───────────────────────────────────────────────────────

// auto = silent allow; ask = gate.
const TIER_DEFAULT: Record<Mode, Record<Tier, 'auto' | 'ask'>> = {
  cautious: { 1: 'auto', 2: 'ask', 3: 'ask', 4: 'ask' },
  balanced: { 1: 'auto', 2: 'auto', 3: 'ask', 4: 'ask' },
  autonomous: { 1: 'auto', 2: 'auto', 3: 'auto', 4: 'ask' },
};

// Map a tier to the override capability key the operator toggles.
const TIER_CAPABILITY: Record<Tier, string> = {
  1: 'prepare',
  2: 'save',
  3: 'send',
  4: 'send-money',
};

/** The override capability key for a tier. */
export function capabilityForTier(tier: Tier): string {
  return TIER_CAPABILITY[tier];
}

/**
 * Resolve a tier to 'allow' | 'ask' under the given mode and overrides.
 *
 * Tier 4 is the LOCK: it returns 'ask' before any mode or override branch is
 * consulted, so neither an 'always' override nor Autonomous mode can ever make
 * an irreversible action silent (PERM-03, D-05).
 */
export function resolveOutcome(
  tier: Tier,
  mode: Mode,
  overrides: Record<string, OverrideValue>,
): 'allow' | 'ask' {
  if (tier === 4) return 'ask'; // PERM-03 lock — ignores mode + override
  const override = overrides[capabilityForTier(tier)];
  if (override === 'always') return 'allow';
  if (override === 'ask') return 'ask';
  return TIER_DEFAULT[mode][tier] === 'auto' ? 'allow' : 'ask';
}

/**
 * Plain-language one-liner for a queued/asked decision. Carries ONLY the tool
 * name and tier — never the input params (which may contain secrets).
 */
export function summarize(toolName: string, tier: Tier): string {
  return `${toolName} (Tier ${tier})`;
}

// ── The gate factory ───────────────────────────────────────────────────

/**
 * Per-turn gate context. Travels the call path (no module globals) so the gate
 * is safe under multi-agent concurrency.
 */
export interface GateContext {
  agentId?: string;
  chatId?: string;
  mode?: Mode; // resolved mode for this turn; falls back to getMode() if absent
  overrides?: Record<string, OverrideValue>; // falls back to getOverrides()
  attended: boolean; // true = live chat (inline ask); false = background (queue)
  runId?: string;
  routineId?: string;
  routineAutonomy?: 'unattended' | 'queue_approval';
  // Phase 5 audit enrichment (D-01). Per-turn carriers — NO module globals.
  sessionId?: string; // SDK session id for this turn (read-side cost JOIN key)
  model?: string; // effective model for this turn (token_usage has no model col)
  _startMs?: number; // turn-start epoch ms, stamped in makeCanUseTool for durationMs
  /** Background-path enqueue. Plan 03 supplies the real approval-queue module. */
  enqueue?: (item: {
    toolName: string;
    input: Record<string, unknown>;
    tier: Tier;
    mode: Mode;
    agentId?: string;
    chatId?: string;
    runId?: string;
  }) => number | string;
  /** Attended-path inline yes/no resolver, supplied by message-core. */
  requestInline?: (q: { summary: string; tier: Tier; toolName: string }) => Promise<boolean>;
}

// Audit detail keys, asserted by gate.test.ts: { tool, tier, mode, outcome }.
function encodeDecision(d: {
  tool: string;
  tier: Tier;
  mode: Mode;
  outcome: string;
  queueId?: number | string;
}): string {
  return JSON.stringify(d);
}

/**
 * Per-tool whitelist of the ONE model-supplied field worth recording as the
 * decision target. Mirrors summarize()'s tool→field intent: emit only a known,
 * non-secret param (e.g. the file a Write touches, the recipient an email goes
 * to) — never the raw input object, never anything secret-shaped. Anything not
 * whitelisted reads back as NULL → "not captured" in the UI (Open Q2, Pattern D).
 */
const TARGET_FIELD_BY_TOOL: Array<{ match: RegExp; field: string }> = [
  { match: /^(Write|Edit|Read|NotebookEdit|NotebookRead)$/, field: 'file_path' },
  { match: /send[-_]?email|gmail/i, field: 'to' },
  { match: /slack/i, field: 'channel' },
  { match: /calendar/i, field: 'summary' },
];

// Field names that may carry a secret/credential — never recorded as a target.
const SECRET_FIELD_PATTERN = /token|secret|key|password|passwd|auth|credential/i;
const TARGET_MAX_LEN = 256;

/**
 * Extract a safe, scrubbed target string from model-supplied tool input, or
 * undefined when nothing is whitelisted/safe. Never returns the raw input and
 * never an env/secret value (T-05-02 / ASVS V8). Bash is special-cased to its
 * command (already classified read-only/destructive upstream); secret-shaped
 * field names are dropped even when whitelisted.
 */
function safeTarget(toolName: string, input: Record<string, unknown>): string | undefined {
  let raw: unknown;
  if (toolName === 'Bash') {
    raw = input.command;
  } else {
    const rule = TARGET_FIELD_BY_TOOL.find((r) => r.match.test(toolName));
    if (!rule || SECRET_FIELD_PATTERN.test(rule.field)) return undefined;
    raw = input[rule.field];
  }
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  return raw.slice(0, TARGET_MAX_LEN);
}

function recordDecision(
  ctx: GateContext,
  input: Record<string, unknown>,
  d: { tool: string; tier: Tier; mode: Mode; outcome: string; queueId?: number | string },
  blocked: boolean,
): void {
  // D-01 records what was decided; it does not re-decide (classifyTier /
  // resolveOutcome are untouched). detail keeps the existing {tool,tier,mode,
  // outcome,queueId} shape; the structured columns ride alongside.
  audit({
    agentId: ctx.agentId ?? 'main',
    chatId: ctx.chatId ?? '',
    action: 'permission',
    eventType: 'permission',
    detail: encodeDecision(d),
    tool: d.tool,
    target: safeTarget(d.tool, input),
    decision: d.outcome,
    // 'inline' → the operator answered live. A 'queued' decision is PENDING:
    // the operator decides later in approval_queue, so leave decidedBy NULL here
    // (resolved read-side by getAuditLogFiltered) rather than claiming the system
    // decided it. Only a true auto-allow / auto path is 'system'.
    decidedBy: d.outcome.includes('inline')
      ? 'operator'
      : d.outcome === 'queued'
        ? undefined
        : 'system',
    decidedAt: Date.now(),
    durationMs: ctx._startMs !== undefined ? Date.now() - ctx._startMs : undefined,
    sessionId: ctx.sessionId,
    model: ctx.model,
    blocked,
  });
}

/**
 * Build the SDK `CanUseTool` callback for one turn, closing over `ctx`.
 *
 * - 'allow'                     → { behavior:'allow' } + one audit row.
 * - 'ask' + attended + inline   → await yes/no, audit, allow/deny.
 * - 'ask' + background          → enqueue + audit(blocked) + deny (turn continues).
 * Never returns `updatedPermissions`. On classify/resolve throw OR with the
 * PERMISSION_GATE_ENABLED kill switch off, routes to the Tier 3 ask/queue path
 * (fail-safe-usable, L-2).
 */
export function makeCanUseTool(ctx: GateContext): CanUseTool {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    _options?: unknown,
  ): Promise<PermissionResult> => {
    // Stamp the turn-start for durationMs (D-01). Idempotent per gate call; the
    // first canUseTool of a turn sets it, later calls reuse the caller's value.
    if (ctx._startMs === undefined) ctx._startMs = Date.now();

    const mode: Mode = ctx.mode ?? getMode();
    let tier: Tier;
    let outcome: 'allow' | 'ask';

    try {
      if (!isEnabled('PERMISSION_GATE_ENABLED')) {
        // Emergency switch off → degrade to the safe-usable side, not allow-all.
        tier = 3;
        outcome = 'ask';
      } else {
        tier = classifyTier(toolName, input);
        const overrides = ctx.overrides ?? getOverrides();
        outcome = resolveOutcome(tier, mode, overrides);
      }
    } catch {
      // Classifier/config threw → fail to Tier 3 ask, never deny-all/allow-all.
      tier = 3;
      outcome = 'ask';
    }

    if (outcome === 'allow') {
      recordDecision(ctx, input, { tool: toolName, tier, mode, outcome: 'allow' }, false);
      return { behavior: 'allow' };
    }

    // outcome === 'ask'
    if (ctx.attended && ctx.requestInline) {
      const ok = await ctx.requestInline({ summary: summarize(toolName, tier), tier, toolName });
      recordDecision(
        ctx,
        input,
        { tool: toolName, tier, mode, outcome: ok ? 'approved-inline' : 'denied-inline' },
        !ok,
      );
      return ok
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: 'Operator declined this action.' };
    }

    // Background → enqueue + immediate deny (turn continues, model reports it queued).
    const queueId = ctx.enqueue?.({
      toolName,
      input,
      tier,
      mode,
      agentId: ctx.agentId,
      chatId: ctx.chatId,
      runId: ctx.runId,
    });
    recordDecision(ctx, input, { tool: toolName, tier, mode, outcome: 'queued', queueId }, true);
    return {
      behavior: 'deny',
      message:
        queueId !== undefined
          ? `This action needs your approval and has been queued for you. (ref ${queueId})`
          : 'This action needs your approval.',
    };
  };
}
