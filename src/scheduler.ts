import fs from 'fs';

import { CronExpressionParser } from 'cron-parser';

import { AGENT_ID, ALLOWED_CHAT_ID, agentMcpAllowlist } from './config.js';
import {
  getDueTasks,
  getSession,
  logConversationTurn,
  markTaskRunning,
  claimDueTask,
  updateTaskAfterRun,
  resetStuckTasks,
  claimNextMissionTask,
  completeMissionTask,
  setMissionTaskBlocked,
  addTaskMessage,
  buildTaskRunPrompt,
  resetStuckMissionTasks,
  getMissionTask,
  setMissionTaskChatRef,
  isAgentPaused,
  getRoutineSteps,
  getLastRoutineOutcome,
  type MissionTask,
  type ScheduledTask,
} from './db.js';
import { runRoutineOnce } from './routine-runner.js';
import { countPendingByRun } from './approval-queue.js';
import { logger } from './logger.js';
import { messageQueue } from './message-queue.js';
import { runAgent } from './agent.js';
import type { GateContext } from './gate.js';
import { formatForTelegram, splitMessage } from './bot.js';
import { extractBlockedMarker, extractHeartbeatMarker, isHeartbeatPrompt } from './format.js';
import { delegateToAgent, getAvailableAgents } from './orchestrator.js';
import { isAgentRunning } from './agent-create.js';
import { AOS_CRON_SOURCE, parseJobFile } from './aos-cron.js';
import { autoAssignUnassignedTasks } from './task-router.js';
import { isEnabled } from './kill-switches.js';
import type { TaskResultPost } from './slack-bot.js';

type Sender = (text: string) => Promise<void>;
/**
 * Posts a mission-task result as a rich, thread-anchored chat message and
 * returns the anchor ts (so a threaded reply can route feedback back onto the
 * task). Only wired on the full Slack transport; undefined elsewhere, where we
 * fall back to the plain `sender`.
 */
type TaskPoster = (post: TaskResultPost) => Promise<string | undefined>;

/** Max time (ms) a scheduled task can run before being killed. */
export const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * How often the mission queue is polled for claimable work, separate from the
 * 60s scheduled-task tick. Overridable via MISSION_POLL_SECONDS (min 5).
 */
export const MISSION_POLL_MS = Math.max(5, Number(process.env.MISSION_POLL_SECONDS) || 15) * 1000;

/**
 * Appended to every mission-task run prompt. The scheduler parses [BLOCKED:]
 * out of every mission result (own-agent AND delegated), but only main's
 * CLAUDE.md documents the marker — a delegated agent (research, comms, ...)
 * runs with its own CLAUDE.md and had no idea the protocol existed, so its
 * "I'm stuck" prose was filed under Shipped. Teaching it at the prompt level
 * covers every agent without touching each CLAUDE.md.
 */
export const BLOCKED_PROTOCOL_FOOTER = `

---
If you cannot finish this task because you need information, access, or a decision only the operator can provide, put [BLOCKED: short reason] on its own line in your reply (bare [BLOCKED] works too) and explain around it what you tried and what you need. Only use it when genuinely stuck; a finished task is just a normal reply.`;

/**
 * Parse a per-job timeout token ('5m'/'10m'/'15m'/'1h'/'2h') to milliseconds
 * (D-10). Null / absent / unparseable falls back to TASK_TIMEOUT_MS rather than
 * crashing the fire — a garbled timeout must never take a job down.
 */
export function parseTimeout(raw: string | null | undefined): number {
  const s = String(raw ?? '').trim().toLowerCase();
  const m = s.match(/^(\d+)([mh])$/);
  if (!m) return TASK_TIMEOUT_MS;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) return TASK_TIMEOUT_MS;
  return m[2] === 'h' ? n * 60 * 60 * 1000 : n * 60 * 1000;
}

/**
 * Injectable dependencies for the aos-cron fire path so the claim/notify/
 * timeout/retry/re-read logic is unit-testable without the message queue, the
 * 60s interval, or a real agent subprocess. Production wires the real
 * `sender` + `runAgent`.
 */
export interface AosFireDeps {
  sender: Sender;
  runAgent: (
    prompt: string,
    abortController: AbortController,
  ) => Promise<{ text: string | null; aborted?: boolean }>;
}

let sender: Sender;
let taskPoster: TaskPoster | undefined;

/**
 * In-memory set of task IDs currently being executed.
 * Acts as a fast-path guard alongside the DB-level lock in markTaskRunning.
 */
const runningTaskIds = new Set<string>();

/**
 * Initialise the scheduler. Call once after the Telegram bot is ready.
 * @param send  Function that sends a message to the user's Telegram chat.
 */
let schedulerAgentId = 'main';

export function initScheduler(send: Sender, agentId = 'main', postTask?: TaskPoster): void {
  if (!ALLOWED_CHAT_ID) {
    logger.warn('ALLOWED_CHAT_ID not set — scheduler will not send results');
  }
  sender = send;
  taskPoster = postTask;
  schedulerAgentId = agentId;

  // Recover tasks stuck in 'running' from a previous crash
  const recovered = resetStuckTasks(agentId);
  if (recovered > 0) {
    logger.warn({ recovered, agentId }, 'Reset stuck tasks from previous crash');
  }
  const recoveredMission = resetStuckMissionTasks(agentId);
  if (recoveredMission > 0) {
    logger.warn({ recovered: recoveredMission, agentId }, 'Reset stuck mission tasks from previous crash');
  }

  // Main also recovers stuck tasks for offline agents it runs on their behalf
  if (agentId === 'main') {
    for (const agent of getAvailableAgents()) {
      if (isAgentRunning(agent.id)) continue;
      const n = resetStuckMissionTasks(agent.id);
      if (n > 0) {
        logger.warn({ recovered: n, agentId: agent.id }, 'Reset stuck mission tasks for offline agent');
      }
    }
  }

  setInterval(() => void runDueTasks(), 60_000);
  // Mission tasks get their own faster loop: a delegated chat task ("have
  // research look into X") shouldn't wait out the tail of a 60s cron tick
  // before it even starts. Claims are atomic and startMissionTask guards on
  // runningTaskIds, so overlapping with the 60s tick is safe.
  setInterval(() => void runDueMissionTasks(), MISSION_POLL_MS);
  logger.info(
    { agentId, missionPollSeconds: MISSION_POLL_MS / 1000 },
    'Scheduler started (tasks every 60s, mission queue on its own poll)',
  );
}

/**
 * Fire a single aos-cron job once (plan 07-04). Deltas over the user-task path:
 *  - D-07: re-read the prompt body from the row's `job_path` at fire time so
 *    `.md` edits take effect with no restart; fall back to the stored prompt
 *    projection (and log) if the file is missing/unreadable.
 *  - D-10: honor the row's per-job `timeout` ('5m'/'1h'/...) via parseTimeout,
 *    falling back to TASK_TIMEOUT_MS.
 *  - D-11: retry up to `task.retry` times (absent=0) on throw/abort before
 *    recording failure and firing the on_failure notify.
 *  - D-12: NO "Scheduled task running" preamble is sent.
 *  - D-03: `notify` gates Slack output — 'on_finish' sends the result on
 *    success; 'on_failure' sends only on error/timeout; both always write
 *    last_run/last_status/last_result to the row via updateTaskAfterRun.
 *
 * The atomic claim (claimDueTask) and the in-memory `runningTaskIds` guard are
 * performed by the caller (runDueTasks) BEFORE this runs; this function owns
 * the run + bookkeeping only. Dependencies are injected (AosFireDeps) for tests.
 */
export async function runAosCronTaskOnce(
  task: ScheduledTask,
  nextRun: number,
  deps: AosFireDeps,
): Promise<void> {
  const { sender: send, runAgent: run } = deps;
  const notify = task.notify ?? null;

  // D-07: re-read the live body from job_path; fall back to the projection.
  let body = task.prompt;
  if (task.job_path) {
    try {
      body = parseJobFile(fs.readFileSync(task.job_path, 'utf-8')).body;
    } catch (err) {
      logger.warn(
        { err, taskId: task.id, jobPath: task.job_path },
        'aos-cron job_path unreadable — falling back to stored prompt',
      );
    }
  }

  // D-10: per-job timeout (ms), falling back to the global default.
  const timeoutMs = parseTimeout(task.timeout);
  // D-11: total attempts = 1 initial + retry count.
  const attempts = 1 + Math.max(0, task.retry || 0);

  logger.info(
    { taskId: task.id, source: task.source, attempts, timeoutMs, prompt: body.slice(0, 60) },
    'Firing aos-cron task',
  );

  let lastErrMsg = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      const result = await run(body, abortController);
      clearTimeout(timer);

      if (result.aborted) {
        lastErrMsg = `Timed out after ${Math.round(timeoutMs / 60000)} minutes`;
        if (attempt < attempts) {
          logger.warn({ taskId: task.id, attempt }, 'aos-cron task timed out, retrying');
          continue;
        }
        updateTaskAfterRun(task.id, nextRun, lastErrMsg, 'timeout');
        logger.warn({ taskId: task.id }, 'aos-cron task timed out');
        if (notify === 'on_failure' || notify === 'on_finish') {
          try {
            await send(`⏱ Task timed out after ${Math.round(timeoutMs / 60000)}m: "${body.slice(0, 60)}..." — killed.`);
          } catch { /* ignore send failure */ }
        }
        return;
      }

      // Success.
      const text = result.text?.trim() || 'Task completed with no output.';
      updateTaskAfterRun(task.id, nextRun, text, 'success');
      logger.info({ taskId: task.id, nextRun }, 'aos-cron task complete, next run scheduled');

      // D-03: only 'on_finish' sends the result on success.
      if (notify === 'on_finish') {
        for (const chunk of splitMessage(formatForTelegram(text))) {
          await send(chunk);
        }
        // Inject output into the active chat session so user replies have context.
        if (ALLOWED_CHAT_ID) {
          const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'user', `[Scheduled task]: ${body}`, activeSession ?? undefined, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
        }
      }
      return;
    } catch (err) {
      clearTimeout(timer);
      lastErrMsg = err instanceof Error ? err.message : String(err);
      if (attempt < attempts) {
        logger.warn({ err, taskId: task.id, attempt }, 'aos-cron task failed, retrying');
        continue;
      }
      updateTaskAfterRun(task.id, nextRun, lastErrMsg.slice(0, 500), 'failed');
      logger.error({ err, taskId: task.id }, 'aos-cron task failed');
      if (notify === 'on_failure' || notify === 'on_finish') {
        try {
          await send(`❌ Task failed: "${body.slice(0, 60)}..." — ${lastErrMsg.slice(0, 200)}`);
        } catch { /* ignore send failure */ }
      }
      return;
    }
  }
}

async function runDueTasks(): Promise<void> {
  // Incident kill switch: skip the whole tick. next_run is untouched, so
  // due work fires on the first tick after the switch is re-enabled.
  if (!isEnabled('SCHEDULER_ENABLED')) return;

  const tasks = getDueTasks(schedulerAgentId);

  if (tasks.length > 0) {
    logger.info({ count: tasks.length }, 'Running due scheduled tasks');
  }

  for (const task of tasks) {
    // In-memory guard: skip if already running in this process
    if (runningTaskIds.has(task.id)) {
      logger.warn({ taskId: task.id }, 'Task already running, skipping duplicate fire');
      continue;
    }

    // Operator paused this teammate: its routines do not fire. next_run is left
    // untouched, so a routine that came due while paused fires once on resume.
    if (isAgentPaused(task.agent_id)) {
      logger.debug({ taskId: task.id, agentId: task.agent_id }, 'Teammate paused, skipping routine');
      continue;
    }

    // Compute next occurrence BEFORE executing so we can lock the task
    // in the DB immediately, preventing re-fire on subsequent ticks.
    const nextRun = computeNextRun(task.schedule);

    // ── aos-cron firing branch (SCH-04 / D-03 / D-07 / D-10 / D-11 / D-12) ──
    if (task.source === AOS_CRON_SOURCE) {
      // Atomic cross-process claim: only the winner (changes===1) proceeds; a
      // concurrent second caller sees false and skips — no double-fire (D-06).
      if (!claimDueTask(task.id, nextRun)) continue;
      runningTaskIds.add(task.id);

      const chatId = ALLOWED_CHAT_ID || 'scheduler';
      // Background gate context (P-5): scheduled aos-cron runs are unattended,
      // so an "ask" outcome enqueues + denies (never blocks the subprocess, P-2).
      const aosGateCtx: GateContext = {
        attended: false,
        runId: task.id,
        agentId: schedulerAgentId,
        chatId,
      };
      messageQueue.enqueue(chatId, async () => {
        try {
          await runAosCronTaskOnce(task, nextRun, {
            sender,
            runAgent: (prompt, abortController) =>
              runAgent(prompt, undefined, () => {}, undefined, task.model ?? undefined, abortController, undefined, agentMcpAllowlist, undefined, aosGateCtx),
          });
        } finally {
          runningTaskIds.delete(task.id);
        }
      });
      continue;
    }

    // ── Routine firing branch (Phase 2, RTN-04 / D-03 / D-09 / D-10) ──
    // Mirrors the aos-cron branch exactly: ONE atomic claim per routine run
    // (never per step — Pitfall 1 / T-02-04), runningTaskIds guard, run through
    // the message queue so it serializes against in-flight user turns. The
    // multi-step execution + outcome derivation + state-change notify all live in
    // runRoutineOnce.
    if (task.source === 'routine') {
      if (!claimDueTask(task.id, nextRun)) continue;
      runningTaskIds.add(task.id);

      const chatId = ALLOWED_CHAT_ID || 'scheduler';
      messageQueue.enqueue(chatId, async () => {
        try {
          await runRoutineOnce(task, getRoutineSteps(task.id), nextRun, {
            sender,
            delegateToAgent,
            isAgentPaused,
            getLastRoutineOutcome,
          });
        } finally {
          runningTaskIds.delete(task.id);
        }
      });
      continue;
    }

    // ── User-created task path (source='user') — unchanged ──
    runningTaskIds.add(task.id);
    markTaskRunning(task.id, nextRun);

    logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 60) }, 'Firing task');

    // Route through the message queue so scheduled tasks wait for any
    // in-flight user message to finish before running. This prevents
    // two Claude processes from hitting the same session simultaneously.
    const chatId = ALLOWED_CHAT_ID || 'scheduler';
    // Heartbeat tasks run on a silence rule: no start announcement, and
    // timeout/failure chatter goes to the log + dashboard only. The result
    // itself is suppressed below when it carries [HEARTBEAT_OK].
    const quiet = isHeartbeatPrompt(task.prompt);
    messageQueue.enqueue(chatId, async () => {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);

      try {
        if (!quiet) await sender(`Scheduled task running: "${task.prompt.slice(0, 80)}${task.prompt.length > 80 ? '...' : ''}"`);

        // Run as a fresh agent call (no session — scheduled tasks are autonomous).
        // Background gate context (P-5): unattended user-scheduled task → ask/queue.
        const userTaskGateCtx: GateContext = {
          attended: false,
          runId: task.id,
          agentId: schedulerAgentId,
          chatId,
        };
        const result = await runAgent(task.prompt, undefined, () => {}, undefined, undefined, abortController, undefined, agentMcpAllowlist, undefined, userTaskGateCtx);
        clearTimeout(timeout);

        if (result.aborted) {
          updateTaskAfterRun(task.id, nextRun, 'Timed out after 10 minutes', 'timeout');
          if (!quiet) await sender(`⏱ Task timed out after 10m: "${task.prompt.slice(0, 60)}..." — killed.`);
          logger.warn({ taskId: task.id }, 'Task timed out');
          return;
        }

        const raw = result.text?.trim() || 'Task completed with no output.';
        const hb = extractHeartbeatMarker(raw);
        if (hb.silent) {
          // Silent beat: record the run for the dashboard, skip the chat post
          // AND the session injection — a 30-min cadence would otherwise bloat
          // the active session with all-clear noise.
          updateTaskAfterRun(task.id, nextRun, raw, 'success');
          logger.info({ taskId: task.id, nextRun }, 'Heartbeat OK — suppressed');
          return;
        }

        // Marker + substantial text = a real finding; post it marker-stripped.
        const text = hb.text || raw;
        for (const chunk of splitMessage(formatForTelegram(text))) {
          await sender(chunk);
        }

        // Inject task output into the active chat session so user replies have context
        if (ALLOWED_CHAT_ID) {
          const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'user', `[Scheduled task]: ${task.prompt}`, activeSession ?? undefined, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
        }

        updateTaskAfterRun(task.id, nextRun, text, 'success');

        logger.info({ taskId: task.id, nextRun }, 'Task complete, next run scheduled');
      } catch (err) {
        clearTimeout(timeout);
        const errMsg = err instanceof Error ? err.message : String(err);
        updateTaskAfterRun(task.id, nextRun, errMsg.slice(0, 500), 'failed');

        logger.error({ err, taskId: task.id }, 'Scheduled task failed');
        try {
          if (!quiet) await sender(`❌ Task failed: "${task.prompt.slice(0, 60)}..." — ${errMsg.slice(0, 200)}`);
        } catch {
          // ignore send failure
        }
      } finally {
        runningTaskIds.delete(task.id);
      }
    });
  }

  // Also check for queued mission tasks (one-shot async tasks from Mission Control)
  await runDueMissionTasks();
}

/**
 * Fire a routine immediately (RTN-04 run-now), reusing the EXACT one-claim +
 * enqueue mechanism the scheduler tick uses so a manual run and a scheduled tick
 * can never double-fire the same routine. 02-03's `POST /api/routines/:id/run`
 * route calls this. Returns false if the claim is lost (already running) so the
 * route can answer 409; true once the run is enqueued.
 *
 * The dashboard runs in the same `main` process as the scheduler, so the shared
 * `runningTaskIds` set + the atomic `claimDueTask` cover both entry points.
 */
export function triggerRoutineRun(task: ScheduledTask, nextRun: number): boolean {
  if (runningTaskIds.has(task.id)) return false;
  if (!claimDueTask(task.id, nextRun)) return false;
  runningTaskIds.add(task.id);

  const chatId = ALLOWED_CHAT_ID || 'scheduler';
  messageQueue.enqueue(chatId, async () => {
    try {
      await runRoutineOnce(task, getRoutineSteps(task.id), nextRun, {
        sender,
        delegateToAgent,
        isAgentPaused,
        getLastRoutineOutcome,
      });
    } finally {
      runningTaskIds.delete(task.id);
    }
  });
  return true;
}

async function runDueMissionTasks(): Promise<void> {
  if (!isEnabled('SCHEDULER_ENABLED')) return;

  // Route unassigned tasks first so a task created without an agent (chat,
  // CLI, capture bar) is claimable on this same tick instead of sitting in
  // "Needs you" until someone opens the dashboard. Main only — one router.
  if (schedulerAgentId === 'main') {
    try {
      await autoAssignUnassignedTasks();
    } catch (err) {
      logger.warn({ err }, 'Auto-assign sweep failed — unassigned tasks wait for the next tick');
    }
  }

  // Tasks assigned to this process's own agent (unless the operator paused it).
  if (!isAgentPaused(schedulerAgentId)) {
    startMissionTask(claimNextMissionTask(schedulerAgentId), null);
  }

  // The main process also executes tasks assigned to agents that have no
  // standalone process running (delegation-only agents, or stopped services).
  // Without this, those tasks would sit queued forever. Paused teammates are
  // skipped here too, so their queued work waits until they resume.
  if (schedulerAgentId === 'main') {
    for (const agent of getAvailableAgents()) {
      if (agent.id === schedulerAgentId || isAgentRunning(agent.id) || isAgentPaused(agent.id)) continue;
      startMissionTask(claimNextMissionTask(agent.id), agent.id);
    }
  }
}

/**
 * Execute a claimed mission task. When `delegateAgentId` is set, the task is
 * run through the orchestrator on behalf of an offline agent (loading that
 * agent's CLAUDE.md, memory context, and MCP allowlist).
 */
function startMissionTask(mission: MissionTask | null, delegateAgentId: string | null): void {
  if (!mission) return;

  const missionKey = 'mission-' + mission.id;
  if (runningTaskIds.has(missionKey)) return;
  runningTaskIds.add(missionKey);

  logger.info(
    { missionId: mission.id, title: mission.title, delegateAgentId },
    'Running mission task',
  );

  const chatId = ALLOWED_CHAT_ID || 'mission';
  messageQueue.enqueue(chatId, async () => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), TASK_TIMEOUT_MS);

    // Cross-process cancel signal: dashboard flips status to 'cancelled' in
    // SQLite, this poll picks it up within 5s and aborts the runAgent call.
    let cancelledByUser = false;
    const cancelPoll = setInterval(() => {
      const current = getMissionTask(mission.id);
      if (current?.status === 'cancelled') {
        cancelledByUser = true;
        abortController.abort();
        clearInterval(cancelPoll);
      }
    }, 5_000);

    // Background gate context (P-5): missions are unattended → an "ask" outcome
    // enqueues + denies, never blocks the subprocess (P-2).
    const missionGateCtx: GateContext = {
      attended: false,
      runId: mission.id,
      agentId: delegateAgentId ?? schedulerAgentId,
      chatId,
    };
    // The base prompt plus any prior blocked-back conversation (operator
    // answers fold in here so a resumed needs_you task sees them), plus the
    // [BLOCKED:] protocol so every agent — not just main — can kick a task
    // back to the operator instead of shipping an "I'm stuck" as done.
    const runPrompt = buildTaskRunPrompt(mission) + BLOCKED_PROTOCOL_FOOTER;
    try {
      let result: { text: string | null; aborted?: boolean };
      if (delegateAgentId) {
        const delegated = await delegateToAgent(
          delegateAgentId,
          runPrompt,
          chatId,
          'main',
          undefined,
          TASK_TIMEOUT_MS,
          abortController,
          missionGateCtx,
        );
        result = { text: delegated.text, aborted: abortController.signal.aborted };
      } else {
        result = await runAgent(runPrompt, undefined, () => {}, undefined, undefined, abortController, undefined, agentMcpAllowlist, undefined, missionGateCtx);
      }
      clearTimeout(timeout);
      clearInterval(cancelPoll);

      if (result.aborted) {
        if (cancelledByUser) {
          // Status is already 'cancelled' from the dashboard write — leave it.
          logger.info({ missionId: mission.id }, 'Mission task cancelled by user');
        } else {
          completeMissionTask(mission.id, null, 'failed', 'Timed out after 10 minutes');
          logger.warn({ missionId: mission.id }, 'Mission task timed out');
          try {
            await sender('Mission task timed out: "' + mission.title + '"');
          } catch (sendErr) {
            // Sender can fail for Telegram API blips or chat-not-found. We
            // still want to see it so the user isn't silently unnotified.
            logger.warn({ err: sendErr, missionId: mission.id }, 'Failed to send mission timeout notification');
          }
        }
      } else {
        const rawText = result.text?.trim() || 'Task completed with no output.';
        // A run can finish without throwing yet still not have shipped anything.
        // Two distinct dead ends, both "needs the operator":
        //   1. A Tier 3/4 gate enqueued an approval and denied the tool inline,
        //      so the run ends with a please-approve message. Detect via the
        //      pending approvals this run left (run_id === mission.id) and park
        //      it as waiting — once approved, the operator re-runs it.
        //   2. The agent hit a missing path / decision only the operator can
        //      make and said so with a [BLOCKED:…] marker → route to needs_you.
        // Either way it must not parade under "Shipped" as if delivered.
        const { blocked, reason, text } = extractBlockedMarker(rawText);
        const pendingGates = countPendingByRun(mission.id);
        if (pendingGates > 0) {
          setMissionTaskBlocked(mission.id, 'you (tool approval)');
          logger.info({ missionId: mission.id, pendingGates }, 'Mission task parked — waiting on operator approval');
        } else if (blocked) {
          const blockReason = reason || 'Needs your input to continue';
          completeMissionTask(mission.id, text, 'needs_you', blockReason);
          // Record the agent's turn so the Home card shows the full back-and-
          // forth, not just the latest snapshot (task_messages is the thread).
          addTaskMessage(mission.id, 'agent', text, blockReason);
          logger.info({ missionId: mission.id, delegateAgentId, reason }, 'Mission task blocked back to operator');
        } else {
          completeMissionTask(mission.id, text, 'completed');
          logger.info({ missionId: mission.id, delegateAgentId }, 'Mission task completed');
        }

        // Send result to the user. On the full Slack transport, a delivered
        // result (completed or needs_you) posts as a rich, thread-anchored Block
        // Kit message whose ts we remember, so a threaded reply routes feedback
        // back onto this task (the "manage output through chat" loop). A re-run
        // posts into the existing thread (mission.slack_message_ts) so the whole
        // correction back-and-forth stays in one place.
        //   - waiting-on-approval (pendingGates) is NOT a shippable result — it's
        //     a please-approve notice, so it goes out plain and un-anchored.
        //   - non-Slack transports fall back to the plain sender with Telegram
        //     formatting and the delegated-agent prefix, as before.
        const deliveredResult = pendingGates === 0;
        if (taskPoster && deliveredResult) {
          try {
            const ts = await taskPoster({
              title: mission.title,
              body: text,
              status: blocked ? 'needs_you' : 'completed',
              taskId: mission.id,
              agentId: delegateAgentId,
              threadTs: mission.slack_message_ts ?? undefined,
            });
            if (ts && !mission.slack_message_ts) setMissionTaskChatRef(mission.id, ts);
          } catch (postErr) {
            // taskPoster is only wired on Slack, whose `sender` formats for Slack
            // itself — hand it raw text so we don't double-format.
            logger.warn({ err: postErr, missionId: mission.id }, 'Rich task post failed — falling back to plain sender');
            for (const chunk of splitMessage(text)) await sender(chunk);
          }
        } else if (taskPoster) {
          // Slack, but a please-approve notice — plain, not anchored as a result.
          for (const chunk of splitMessage(text)) await sender(chunk);
        } else {
          const outText = delegateAgentId
            ? '[' + delegateAgentId + '] ' + mission.title + '\n\n' + text
            : text;
          for (const chunk of splitMessage(formatForTelegram(outText))) {
            await sender(chunk);
          }
        }

        // Inject into conversation context so agent can reference it
        // (own-agent tasks only — delegated runs are logged via hive mind)
        if (ALLOWED_CHAT_ID && !delegateAgentId) {
          const activeSession = getSession(ALLOWED_CHAT_ID, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'user', '[Mission task: ' + mission.title + ']: ' + mission.prompt, activeSession ?? undefined, schedulerAgentId);
          logConversationTurn(ALLOWED_CHAT_ID, 'assistant', text, activeSession ?? undefined, schedulerAgentId);
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      clearInterval(cancelPoll);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (cancelledByUser) {
        logger.info({ missionId: mission.id }, 'Mission task cancelled by user (threw on abort)');
      } else {
        completeMissionTask(mission.id, null, 'failed', errMsg.slice(0, 500));
        logger.error({ err, missionId: mission.id }, 'Mission task failed');
      }
    } finally {
      clearInterval(cancelPoll);
      runningTaskIds.delete(missionKey);
    }
  });
}

export function computeNextRun(cronExpression: string): number {
  const interval = CronExpressionParser.parse(cronExpression);
  return Math.floor(interval.next().getTime() / 1000);
}
