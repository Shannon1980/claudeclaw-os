import crypto from 'crypto';

import { CHAT_TO_KANBAN_ENABLED } from './config.js';
import { createRunningMissionTask, completeMissionTask, cancelMissionTask } from './db.js';
import { generateContent, parseJsonResponse } from './gemini.js';
import { logger } from './logger.js';
import { classifyMessageComplexity } from './message-classifier.js';
import { extractViaClaude } from './memory-ingest.js';

/**
 * Chat -> Mission Control bridge.
 *
 * Explicit task requests sent through chat (Slack/Telegram) are mirrored onto
 * the kanban as live cards so delegated and ad-hoc work share one board. The
 * card is created as a `running` mission task (see `createRunningMissionTask`)
 * the moment we recognise a task, and settled to completed/failed/cancelled
 * when the chat turn finishes. Because the row is never `queued`, the
 * scheduler never re-runs it — the chat handler is the one doing the work.
 *
 * Cost control: a free local heuristic (`classifyMessageComplexity`) filters
 * out acknowledgments and small talk before any model call. Only genuinely
 * substantive messages reach the classifier.
 */

interface ChatTaskClassification {
  isTask: boolean;
  title?: string;
}

const TITLE_MAX = 200;
const PROMPT_MAX = 10_000;

function buildClassificationPrompt(message: string): string {
  return `You are triaging a message sent to a personal AI assistant in chat.

Decide whether it is an EXPLICIT TASK REQUEST: the user asking the assistant to DO something or produce a deliverable. Examples of tasks: send or draft an email, check or schedule the calendar, research a topic, write or edit code or a document, summarize a file, run a multi-step job, manage a to-do list, scrape a site.

It is NOT a task if it is casual conversation, a greeting, an acknowledgment ("ok", "thanks"), an opinion, a question about the assistant itself, or a trivial one-off factual question that needs no real action.

Message: "${message.slice(0, 1000)}"

Reply with ONLY JSON: {"isTask": true|false, "title": "<imperative 3-8 word label>"}`;
}

/** Classify a message via Haiku, falling back to Gemini. Returns null if both fail. */
async function classifyChatTask(message: string): Promise<ChatTaskClassification | null> {
  const prompt = buildClassificationPrompt(message);

  // Primary: Claude Haiku via the same OAuth the agents use (no free-tier wall).
  try {
    const raw = await extractViaClaude(prompt);
    const parsed = parseJsonResponse<ChatTaskClassification>(raw);
    if (parsed && typeof parsed.isTask === 'boolean') return parsed;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'Haiku chat-task classify failed, trying Gemini');
  }

  // Fallback: Gemini.
  try {
    const raw = await generateContent(prompt);
    const parsed = parseJsonResponse<ChatTaskClassification>(raw);
    if (parsed && typeof parsed.isTask === 'boolean') return parsed;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'Gemini chat-task classify failed');
  }

  return null;
}

/**
 * If `message` is an explicit task request, create a live (running) mission
 * task mirroring it and return its id. Returns null when the bridge is off,
 * the message is trivial, the classifier declines, or anything throws.
 *
 * Safe to call fire-and-forget concurrently with the agent run: it never
 * throws and never blocks the chat reply.
 */
export async function maybeStartChatTask(
  message: string,
  agentId: string,
  source: string,
): Promise<string | null> {
  if (!CHAT_TO_KANBAN_ENABLED) return null;

  const trimmed = message.trim();
  if (!trimmed) return null;
  // Slash commands are control input, not tasks.
  if (trimmed.startsWith('/')) return null;
  // Acks / small talk: filtered for free, no model call.
  if (classifyMessageComplexity(trimmed) === 'simple') return null;

  try {
    const cls = await classifyChatTask(trimmed);
    if (!cls?.isTask) return null;

    const id = crypto.randomBytes(4).toString('hex');
    const title = (cls.title?.trim() || trimmed.slice(0, 80)).slice(0, TITLE_MAX);
    createRunningMissionTask(id, title, trimmed.slice(0, PROMPT_MAX), agentId, `chat:${source}`);
    logger.info({ id, agentId, source }, 'Mirrored chat task onto kanban');
    return id;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'Chat task tracking failed');
    return null;
  }
}

/**
 * Settle a mirrored chat task. `idOrPromise` may be the id, null, or the
 * pending promise from `maybeStartChatTask` (awaited internally). Never throws.
 */
export function finishChatTask(
  idOrPromise: string | null | Promise<string | null>,
  status: 'completed' | 'failed' | 'cancelled',
  result?: string | null,
  error?: string,
): void {
  void Promise.resolve(idOrPromise)
    .then((id) => {
      if (!id) return;
      if (status === 'cancelled') {
        cancelMissionTask(id);
      } else {
        completeMissionTask(id, result ?? null, status, error);
      }
    })
    .catch((err) => {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'Failed to settle chat task');
    });
}
