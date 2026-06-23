import { ALLOWED_CHAT_ID } from './config.js';
import {
  saveRoutineRun,
  updateTaskAfterRun,
  getLastRoutineOutcome as getLastRoutineOutcomeDb,
  isAgentPaused as isAgentPausedDb,
  type RoutineStep,
  type ScheduledTask,
} from './db.js';
import { delegateToAgent as delegateToAgentFn } from './orchestrator.js';
import { logger } from './logger.js';
import { TASK_TIMEOUT_MS } from './scheduler.js';

/**
 * Per-step result the runner accumulates. `skipped` marks a step whose teammate
 * was paused (A4): not delegated, recorded as ok:false so it pulls the run toward
 * degraded without hard-failing it.
 */
export interface StepResult {
  stepId: number;
  ok: boolean;
  output: string;
  teammate: string;
  skipped?: boolean;
}

/**
 * Derive a routine's honest run outcome from its per-step results (D-02, RTN-05).
 * Pure — unit-testable like parseTimeout.
 *
 *  - `halted` (a stop-on-error step failed) → 'failed'.
 *  - no step produced useful output → 'failed' (the all-continue-fail edge MUST
 *    land here, NOT 'degraded').
 *  - every result ok → 'ok'.
 *  - otherwise (some failures/skips but at least one useful output, run completed)
 *    → 'degraded'.
 */
export function deriveOutcome(
  results: StepResult[],
  _steps: RoutineStep[],
  halted: boolean,
): 'ok' | 'degraded' | 'failed' {
  if (halted) return 'failed';
  const anyUsefulOutput = results.some((r) => r.ok);
  if (!anyUsefulOutput) return 'failed';
  if (results.every((r) => r.ok)) return 'ok';
  return 'degraded';
}

/** Injectable dependencies so the runner is testable without the queue/SDK/DB. */
export interface RoutineRunDeps {
  sender: (text: string) => Promise<void>;
  delegateToAgent: typeof delegateToAgentFn;
  isAgentPaused?: (agentId: string) => boolean;
  getLastRoutineOutcome?: (routineId: string) => string | null;
  saveRoutineRun?: typeof saveRoutineRun;
  updateTaskAfterRun?: typeof updateTaskAfterRun;
}

/** Cap any single step's threaded output so the prior-context block stays bounded. */
const STEP_OUTPUT_CAP = 4000;

/**
 * Run a routine's ordered steps once as a single claimed unit (Pattern 1, D-03).
 *
 * The atomic claim (claimDueTask) and the runningTaskIds guard are owned by the
 * CALLER (the scheduler branch / run-now route) — this function NEVER re-claims
 * per step, preserving the anti-double-fire lock (Pitfall 1, T-02-04).
 *
 * Each step runs as its assigned teammate via delegateToAgent (resolving that
 * teammate's cwd/CLAUDE.md/model/MCP allowlist). Earlier steps' output is threaded
 * forward into later prompts (D-03). A step whose teammate is paused is skipped
 * (A4 → contributes to degraded). After the loop the outcome is derived (D-02),
 * run history is persisted (RTN-05), and a state-change alert fires exactly once
 * on the ok→broken transition (D-09/D-10).
 *
 * task.autonomy is threaded into the step execution context (D-07) but is NOT
 * enforced here — enforcement is Phase 3 (D-08). It is carried, never presented as
 * a guarantee.
 *
 * Returns the derived outcome.
 */
export async function runRoutineOnce(
  task: ScheduledTask,
  steps: RoutineStep[],
  nextRun: number,
  deps: RoutineRunDeps,
): Promise<'ok' | 'degraded' | 'failed'> {
  const isAgentPaused = deps.isAgentPaused ?? isAgentPausedDb;
  const getLastOutcome = deps.getLastRoutineOutcome ?? getLastRoutineOutcomeDb;
  const persistRun = deps.saveRoutineRun ?? saveRoutineRun;
  const persistTask = deps.updateTaskAfterRun ?? updateTaskAfterRun;

  // Forward-compatible autonomy context (D-07). Carried into each step's run; no
  // gate is built on it here (D-08 — enforcement is Phase 3).
  const execContext = { autonomy: task.autonomy ?? 'unattended' };

  const results: StepResult[] = [];
  let halted = false;

  for (const step of steps) {
    // A4: a paused teammate's step is recorded as a skip, never delegated.
    if (isAgentPaused(step.agent_id)) {
      results.push({
        stepId: step.id,
        ok: false,
        output: `(skipped — teammate "${step.agent_id}" is paused)`,
        teammate: step.agent_id,
        skipped: true,
      });
      continue;
    }

    // D-03: thread earlier outputs forward so later steps see prior work.
    const priorContext = results.length
      ? `\n\n[Earlier steps' output]\n${results
          .map((r) => `• ${r.output.slice(0, STEP_OUTPUT_CAP)}`)
          .join('\n')}`
      : '';

    try {
      const r = await deps.delegateToAgent(
        step.agent_id,
        step.action + priorContext,
        ALLOWED_CHAT_ID || 'routine',
        'main',
        undefined,
        TASK_TIMEOUT_MS,
      );
      const output = (r.text ?? '').trim();
      results.push({
        stepId: step.id,
        ok: output.length > 0,
        output,
        teammate: step.agent_id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ stepId: step.id, ok: false, output: msg, teammate: step.agent_id });
      // D-01: a stop-on-error step that fails halts the run.
      if (step.on_error === 'stop') {
        halted = true;
        break;
      }
    }
  }

  const outcome = deriveOutcome(results, steps, halted);

  // D-10: read the prior outcome BEFORE persisting this run so the transition
  // check sees yesterday's state, not today's.
  const prior = getLastOutcome(task.id);

  const detail = summarize(results, halted, execContext);
  const combinedOutput = results.map((r) => r.output).join('\n\n').trim() || null;

  // Persist run history + reset the task row. A bookkeeping write failure must
  // never crash the run (the steps already executed) — log and continue so the
  // state-change notification still fires.
  try {
    persistRun(task.id, outcome, results, detail, combinedOutput);
    persistTask(task.id, nextRun, detail, outcome === 'failed' ? 'failed' : 'success');
  } catch (err) {
    logger.error({ err, routineId: task.id }, 'failed to persist routine run history');
  }

  // D-09/D-10: alert ONCE on the ok→broken transition; silent on success and
  // never re-alert while already broken.
  const isFirstBreak =
    (prior === 'ok' || prior === null) && (outcome === 'degraded' || outcome === 'failed');
  if (isFirstBreak) {
    const verb = outcome === 'failed' ? 'failed' : 'ran partial';
    const name = (task as { prompt?: string }).prompt?.slice(0, 60) || task.id;
    try {
      await deps.sender(`"${name}" ${verb}: ${detail.slice(0, 200)}`);
    } catch (err) {
      logger.warn({ err, routineId: task.id }, 'routine break notification failed to send');
    }
  }
  // Recovery (failed/degraded → ok): silent by choice. Keeps the channel quiet on
  // the routine quietly going back to normal (D-10 discretion).

  return outcome;
}

/** Honest one-line summary of the run for history + the notification body. */
function summarize(
  results: StepResult[],
  halted: boolean,
  _execContext: { autonomy: string },
): string {
  if (results.length === 0) return 'no steps ran';
  const ok = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.length - ok - skipped;
  const parts: string[] = [`${ok}/${results.length} steps ok`];
  if (skipped) parts.push(`${skipped} skipped (teammate paused)`);
  if (failed) parts.push(`${failed} failed`);
  if (halted) parts.push('halted on a stop-on-error step');
  return parts.join(', ');
}
