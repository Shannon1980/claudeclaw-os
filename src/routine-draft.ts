/**
 * Routine draft assembler (RTN-01 / RTN-02).
 *
 * Turns an operator's plain-language description of a routine into a validated,
 * editable draft of the shape `{ cron, schedule_text, steps[] }` via a single
 * constrained `runAgent` call. This is the ONLY place the SDK subprocess runs
 * for a draft: the browser cannot call `runAgent` (it needs the scrubbed SDK
 * env — see getScrubbedSdkEnv in security.ts), so the dashboard route delegates
 * here and renders the returned draft as a thin client.
 *
 * Nothing here persists (D-05). The draft is held in the UI until the operator
 * confirms, at which point POST /api/routines writes the rows.
 *
 * Failure tolerant: unparseable model output returns a friendly `{ error }`
 * shape rather than throwing a raw 500 (Pitfall 4). An assembled cron that
 * `computeNextRun` cannot parse is rejected (RTN-02 / D-06): a routine the
 * scheduler can never fire is not a usable draft.
 */

import { runAgent as defaultRunAgent } from './agent.js';
import { listAgentIds as defaultListAgentIds } from './agent-config.js';
import { computeNextRun as defaultComputeNextRun } from './scheduler.js';

/** Cap on a single step's action text (V5 — bound untrusted/model-emitted text
 *  so a runaway model response can't store an unbounded blob). */
const MAX_ACTION_LEN = 2000;
/** Cap on the plain-language schedule label. */
const MAX_SCHEDULE_TEXT_LEN = 200;
/** Model + budget mirror the war-room router: a zero-tool classifier-style call. */
const DRAFT_MODEL = 'claude-haiku-4-5-20251001';

export interface RoutineDraftStep {
  action: string;
  agent_id: string;
  on_error: 'continue' | 'stop';
}

export interface RoutineDraft {
  /** Internal cron expression. Never surfaced raw in an operator-facing field —
   *  the row label uses `schedule_text`. */
  cron: string;
  /** Plain-language label the operator sees (RTN-02). */
  schedule_text: string;
  steps: RoutineDraftStep[];
}

export interface RoutineDraftError {
  error: string;
}

/**
 * Minimal result shape this module needs back from `runAgent`. The real
 * `AgentResult` is wider (`text: string | null`, usage, session id); we only
 * read `text`, so a narrow structural type keeps tests able to inject a stub.
 */
interface RunAgentLike {
  text: string | null;
}

export interface AssembleRoutineDraftDeps {
  /** SDK entry point. Injected in tests so no live subprocess runs. The real
   *  runAgent's signature is wider; we only ever pass (prompt, undefined, noop). */
  runAgent?: (...args: any[]) => Promise<RunAgentLike>;
  /** Roster source for agent_id validation. */
  listAgentIds?: () => string[];
  /** Cron validator — throws on an unparseable cron. */
  computeNextRun?: (cron: string) => number;
}

/**
 * Parse JSON out of a model response that may be fenced or wrapped in prose.
 * Copied verbatim from warroom-text-router's `parseJson` (the verified
 * JSON-from-LLM parser) and exported here as the shared loose parser.
 *
 * 1. Strip a leading ```json / trailing ``` fence, then JSON.parse.
 * 2. On failure, grab the first {...} block and parse that.
 * 3. Return null when no JSON is present.
 */
export function parseJsonLoose<T>(text: string): T | null {
  if (!text) return null;
  // Tolerate the SDK wrapping JSON in code fences even when we asked it not to.
  const stripped = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // Grab the first {...} block if the model added commentary.
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]) as T; } catch { /* fall through */ }
    }
    return null;
  }
}

/**
 * Strip prompt-delimiter sequences from the untrusted description before it
 * lands inside our `"""..."""` block. Mirrors warroom-text-router's
 * sanitizeForPromptBlock so a description containing `"""` can't terminate the
 * block early and inject instructions.
 */
function sanitizeForPromptBlock(s: string): string {
  if (!s) return '';
  return s.replace(/"""/g, "'''");
}

function buildDraftPrompt(description: string, roster: string[]): string {
  const rosterLine = roster.length ? roster.join(', ') : 'main';
  return `You assemble a recurring routine for an operator's AI team from a plain-language description.

Available teammates (agent_id values you may assign steps to): ${rosterLine}
If a step doesn't clearly belong to a specialist, assign it to "main".

Operator's description:
"""
${sanitizeForPromptBlock(description)}
"""

Produce:
- cron: a standard 5-field cron expression for when the routine should run.
- schedule_text: a short plain-language label for that schedule (e.g. "every weekday at 8am"). No cron syntax.
- steps: the ordered actions, each as { "action": "<what to do>", "agent_id": "<one of the teammates above>", "on_error": "continue" | "stop" }. Default on_error to "continue".

Respond with ONLY a JSON object, no prose, no code fences:
{"cron": "<cron>", "schedule_text": "<plain language>", "steps": [{"action": "<text>", "agent_id": "<agent_id>", "on_error": "continue"}]}`;
}

/**
 * Assemble a routine draft from a plain-language description.
 *
 * Validation (T-02-08 / T-02-09):
 * - parse with parseJsonLoose; on failure return a friendly `{ error }` (never throw a 500).
 * - reject an empty steps array (a routine with no steps does nothing).
 * - coerce each step.agent_id to a roster member, falling back to 'main' for unknown ids.
 * - default on_error to 'continue' (D-01); coerce anything that isn't 'stop' to 'continue'.
 * - cap action length (V5) and the schedule_text label.
 * - validate the assembled cron with computeNextRun — throw on an unparseable cron (RTN-02 / D-06).
 *
 * @returns the validated draft, or a `{ error }` shape when the model output
 *          could not be parsed/shaped. Throws only when the assembled cron is invalid.
 */
export async function assembleRoutineDraft(
  description: string,
  deps: AssembleRoutineDraftDeps = {},
): Promise<RoutineDraft & Partial<RoutineDraftError>> {
  const runAgent = deps.runAgent ?? (defaultRunAgent as unknown as (...args: any[]) => Promise<RunAgentLike>);
  const listAgentIds = deps.listAgentIds ?? defaultListAgentIds;
  const computeNextRun = deps.computeNextRun ?? defaultComputeNextRun;

  const desc = (description ?? '').trim();
  if (!desc) {
    return { error: 'Describe the routine first.' } as RoutineDraft & RoutineDraftError;
  }

  const roster = ['main', ...listAgentIds().filter((id) => id !== 'main')];
  const prompt = buildDraftPrompt(desc, roster);

  const result = await runAgent(
    prompt,
    undefined,
    () => {},
    undefined,
    DRAFT_MODEL,
  );
  const text = result?.text ?? '';

  const parsed = parseJsonLoose<{
    cron?: unknown;
    schedule_text?: unknown;
    steps?: unknown;
  }>(text);

  // Unparseable / non-object model output → friendly error, never a raw 500.
  if (!parsed || typeof parsed !== 'object') {
    return {
      error: 'Could not assemble that routine — try describing it again.',
    } as RoutineDraft & RoutineDraftError;
  }

  const cron = typeof parsed.cron === 'string' ? parsed.cron.trim() : '';
  if (!cron) {
    return {
      error: 'Could not work out a schedule from that — say when it should run.',
    } as RoutineDraft & RoutineDraftError;
  }

  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
  const validIds = new Set(roster);
  const steps: RoutineDraftStep[] = [];
  for (const entry of rawSteps) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    const action = typeof s.action === 'string' ? s.action.trim().slice(0, MAX_ACTION_LEN) : '';
    if (!action) continue;
    // Coerce unknown teammates to the safe default (main owns/fires it anyway).
    const rawAgent = typeof s.agent_id === 'string' ? s.agent_id : '';
    const agent_id = validIds.has(rawAgent) ? rawAgent : 'main';
    const on_error: 'continue' | 'stop' = s.on_error === 'stop' ? 'stop' : 'continue';
    steps.push({ action, agent_id, on_error });
  }

  if (steps.length === 0) {
    return {
      error: 'That routine has no steps — describe what it should do.',
    } as RoutineDraft & RoutineDraftError;
  }

  // RTN-02 / D-06: a routine the scheduler can never fire is not a usable draft.
  // computeNextRun throws on an unparseable cron; let it surface (the route maps
  // it to a 400, never a 500).
  computeNextRun(cron);

  const schedule_text =
    typeof parsed.schedule_text === 'string' && parsed.schedule_text.trim()
      ? parsed.schedule_text.trim().slice(0, MAX_SCHEDULE_TEXT_LEN)
      : '';

  return { cron, schedule_text, steps };
}
