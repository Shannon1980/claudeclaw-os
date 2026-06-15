import fs from 'fs';

import { runAgentWithRetry, UsageInfo, AgentProgressEvent } from './agent.js';
import { AgentError } from './errors.js';
import {
  CONTEXT_LIMIT,
  agentDefaultModel,
  agentMcpAllowlist,
  agentSystemPrompt,
  TYPING_REFRESH_MS,
  AGENT_TIMEOUT_MS,
  STREAM_STRATEGY,
  MODEL_FALLBACK_CHAIN,
  SHOW_COST_FOOTER,
  SMART_ROUTING_ENABLED,
  SMART_ROUTING_CHEAP_MODEL,
  EXFILTRATION_GUARD_ENABLED,
  PROTECTED_ENV_VARS,
  DAILY_COST_BUDGET,
  HOURLY_TOKEN_BUDGET,
} from './config.js';
import { getRecentTaskOutputs, getSession, setSession, saveTokenUsage, saveCompactionEvent, getCompactionCount } from './db.js';
import { logger } from './logger.js';
import { buildMemoryContext, evaluateMemoryRelevance, saveConversationTurn, shouldNudgeMemory, MEMORY_NUDGE_TEXT } from './memory.js';
import { classifyMessageComplexity } from './message-classifier.js';
import { scanForSecrets, redactSecrets } from './exfiltration-guard.js';
import { trackUsage, getRateStatus } from './rate-tracker.js';
import { buildCostFooter } from './cost-footer.js';
import { parseDelegation, delegateToAgent } from './orchestrator.js';
import { isWorkspaceAgent, workspaceMemoryKey } from './agent-config.js';
import { maybeStartChatTask, finishChatTask } from './chat-task-tracker.js';
import { emitChatEvent, setProcessing, setActiveAbort, ChatEventSource } from './state.js';
import { checkKillPhrase, executeEmergencyKill, audit } from './security.js';
import { voiceCapabilities, synthesizeSpeech } from './voice.js';
import { splitMessage, extractFileMarkers } from './format.js';

// ── Streaming rate limiter ───────────────────────────────────────────
const globalStreamLastEdit = new Map<string, number>();
const GLOBAL_STREAM_INTERVAL_MS = 2500;

// ── Context window tracking ──────────────────────────────────────────
// Uses input_tokens from the last API call (= actual context window size:
// system prompt + conversation history + tool results for that call).
// Compares against CONTEXT_LIMIT (default 1M for Opus 4.6 1M, configurable).
//
// On a fresh session the base overhead (system prompt, skills, CLAUDE.md,
// MCP tools) can be 200-400k+ tokens. We track that baseline per session
// so the warning reflects conversation growth, not fixed overhead.
const CONTEXT_WARN_PCT = 0.75; // Warn when conversation fills 75% of available space
const lastUsage = new Map<string, UsageInfo>();
const sessionBaseline = new Map<string, number>(); // sessionId -> first turn's input_tokens

/** Forget the context-window baseline for a session or chat key (called on /newchat, /forget). */
export function clearSessionBaseline(key: string): void {
  sessionBaseline.delete(key);
}

/**
 * Check if context usage is getting high and return a warning string, or null.
 * Uses input_tokens (total context) not cache_read_input_tokens (partial metric).
 */
function checkContextWarning(chatId: string, sessionId: string | undefined, usage: UsageInfo): string | null {
  lastUsage.set(chatId, usage);

  if (usage.didCompact) {
    return '⚠️ Context window was auto-compacted this turn. Some earlier conversation may have been summarized. Consider /newchat + /respin if things feel off.';
  }

  const contextTokens = usage.lastCallInputTokens;
  if (contextTokens <= 0) return null;

  // Record baseline on first turn of session (system prompt overhead)
  const baseKey = sessionId ?? chatId;
  if (!sessionBaseline.has(baseKey)) {
    sessionBaseline.set(baseKey, contextTokens);
    // First turn — no warning, just establishing baseline
    return null;
  }

  const baseline = sessionBaseline.get(baseKey)!;
  const available = CONTEXT_LIMIT - baseline;
  if (available <= 0) return null;

  const conversationTokens = contextTokens - baseline;
  const pct = Math.round((conversationTokens / available) * 100);

  if (pct >= Math.round(CONTEXT_WARN_PCT * 100)) {
    return `⚠️ Context window at ~${pct}% of available space (~${Math.round(conversationTokens / 1000)}k / ${Math.round(available / 1000)}k conversation tokens). Consider /newchat + /respin soon.`;
  }

  return null;
}

// ── Transport abstraction ─────────────────────────────────────────────
//
// The message pipeline below is transport-agnostic: every place the old
// Telegram handler called `ctx.*` is now a callback on this interface. A
// transport (Telegram in bot.ts, Slack in slack-bot.ts) builds these
// callbacks from its own SDK and hands them to `processUserMessage`.

export interface SentMessage {
  messageId?: string | number;
}

export interface TransportCallbacks {
  /** Namespaced chat id used as the session/memory key (e.g. "slack:U123" or a Telegram numeric id as string). */
  chatId: string;
  /** Agent id for attribution (usually the process AGENT_ID). */
  agentId: string;
  /** SSE event source label. */
  source: ChatEventSource;
  /** Rich formatter for the final response (Telegram HTML / Slack mrkdwn). */
  format: (text: string) => string;
  /** Max chunk length for splitMessage. */
  maxLen: number;
  /** Send a pre-formatted message (rich mode on). */
  sendFormatted: (text: string) => Promise<SentMessage | void>;
  /** Send a plain-text status/error/progress message (no rich parsing). */
  sendPlain: (text: string) => Promise<SentMessage | void>;
  /** Edit a previously-sent plain message (streaming). Omit => no streaming. */
  editPlain?: (messageId: string | number, text: string) => Promise<void>;
  /** Delete a previously-sent message (stream placeholder cleanup). */
  deleteMessage?: (messageId: string | number) => Promise<void>;
  /** Best-effort "typing"/keepalive indicator. */
  sendTyping: () => void | Promise<void>;
  /** Upload a document by local path. */
  sendFile: (filePath: string, caption?: string) => Promise<void>;
  /** Upload a photo by local path. */
  sendPhoto: (filePath: string, caption?: string) => Promise<void>;
  /** Send a synthesized-speech audio buffer. */
  sendVoice: (audio: Buffer) => Promise<void>;
}

export interface ProcessOptions {
  /** Always respond with audio (e.g. user sent a voice note). */
  forceVoiceReply?: boolean;
  /** Skip logging this turn to conversation_log (used by /respin). */
  skipLog?: boolean;
  /** Whether voice-back is toggled on for this chat. */
  voiceEnabled?: boolean;
  /** Per-chat model override, if any. */
  modelOverride?: string;
  /**
   * Run this turn as a specific sub-agent instead of the process-global agent.
   * Used by Slack channel routing: a single main process runs many agents,
   * one per channel, without flipping the (concurrency-unsafe) module globals.
   * When set, its cwd / model / systemPrompt / mcpAllowlist override the
   * agentCwd / agentDefaultModel / agentSystemPrompt / agentMcpAllowlist
   * globals for this turn. `cb.agentId` must match `agentRuntime.agentId` so
   * session and memory bucketing stay consistent.
   */
  agentRuntime?: {
    agentId: string;
    cwd?: string;
    model?: string;
    systemPrompt?: string;
    mcpAllowlist?: string[];
  };
}

/**
 * Transport-agnostic core message handler. Runs the full pipeline —
 * kill-phrase check, delegation, memory context, the Claude agent,
 * exfiltration guard, file markers, TTS, token accounting, and warnings —
 * driving all I/O through `cb`.
 *
 * Callers (transports) are responsible for access control and any
 * transport-specific first-run setup BEFORE calling this.
 */
export async function processUserMessage(
  message: string,
  cb: TransportCallbacks,
  opts: ProcessOptions = {},
): Promise<void> {
  const { forceVoiceReply = false, skipLog = false } = opts;
  const chatIdStr = cb.chatId;
  const agentId = cb.agentId;

  // ── Emergency kill check (runs even when locked) ────────────────
  if (checkKillPhrase(message)) {
    audit({ agentId, chatId: chatIdStr, action: 'kill', detail: 'Emergency kill triggered', blocked: false });
    await cb.sendPlain('EMERGENCY KILL activated. All agents stopping.');
    executeEmergencyKill();
    return;
  }

  // Audit the incoming message
  audit({ agentId, chatId: chatIdStr, action: 'message', detail: message.slice(0, 200), blocked: false });

  logger.info({ chatId: chatIdStr, messageLen: message.length }, 'Processing message');

  // Emit user message to SSE clients
  emitChatEvent({ type: 'user_message', chatId: chatIdStr, content: message, source: cb.source });

  // ── Delegation detection ────────────────────────────────────────────
  // Intercept @agentId or /delegate syntax before running the main agent.
  const delegation = parseDelegation(message);
  if (delegation) {
    setProcessing(chatIdStr, true);
    await cb.sendTyping();
    try {
      const delegationResult = await delegateToAgent(
        delegation.agentId,
        delegation.prompt,
        chatIdStr,
        agentId,
        (progressMsg) => {
          emitChatEvent({ type: 'progress', chatId: chatIdStr, description: progressMsg });
          void cb.sendPlain(progressMsg).catch(() => {});
        },
      );

      const response = delegationResult.text?.trim() || 'Agent completed with no output.';
      const header = `[${delegationResult.agentId} — ${Math.round(delegationResult.durationMs / 1000)}s]`;

      // Extract file markers so a delegated agent (reached via @id:) can
      // deliver attachments. Without this the delegation branch posted the
      // raw text and any [SEND_FILE:]/[SEND_PHOTO:] marker leaked into chat
      // as literal text. Mirrors the main-path loop below and mission-files.ts.
      const { text: delegatedText, files: delegatedFiles } = extractFileMarkers(response);

      if (!skipLog) {
        // Attribute to the delegated agent, not the caller, so memories
        // created from this conversation are tagged with the correct agent.
        // Log the raw response (with marker) to match the main path's
        // rawResponse semantics; the marker is stripped only for display.
        //
        // For a workspace agent, save into the SHARED workspace pool
        // (`ws:<agentId>`) instead of the caller's chat_id so the bot's
        // delegated turns and a terminal session's captured turns land in one
        // pool (unified-pool decision). Non-workspace agents and the main path
        // keep the caller chatId unchanged (COMPAT-02).
        const saveChatId = isWorkspaceAgent(delegation.agentId)
          ? workspaceMemoryKey(delegation.agentId)
          : chatIdStr;
        saveConversationTurn(saveChatId, delegation.prompt, response, undefined, delegation.agentId);
      }
      emitChatEvent({ type: 'assistant_message', chatId: chatIdStr, content: delegatedText, source: cb.source });

      // Send any attached files first (guarded), mirroring the main path.
      for (const file of delegatedFiles) {
        try {
          if (!fs.existsSync(file.filePath)) {
            await cb.sendPlain(`Could not send file: ${file.filePath} (not found)`);
            continue;
          }
          if (file.type === 'photo') {
            await cb.sendPhoto(file.filePath, file.caption);
          } else {
            await cb.sendFile(file.filePath, file.caption);
          }
        } catch (fileErr) {
          logger.error({ err: fileErr, filePath: file.filePath }, 'Failed to send file');
          await cb.sendPlain(`Failed to send file: ${file.filePath}`);
        }
      }

      for (const part of splitMessage(cb.format(`${header}\n\n${delegatedText}`), cb.maxLen)) {
        await cb.sendFormatted(part);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, agentId: delegation.agentId }, 'Delegation failed');
      await cb.sendPlain(`Delegation to ${delegation.agentId} failed: ${errMsg}`);
    } finally {
      setProcessing(chatIdStr, false);
    }
    return;
  }

  // Fetch session first: if resuming, the model already has the system prompt in context.
  const sessionId = getSession(chatIdStr, agentId);

  // Resolve the effective agent runtime. A routed sub-agent (Slack channel)
  // supplies its own cwd / model / system prompt / MCP allowlist; otherwise
  // fall back to the process-global agent overrides.
  const runtime = opts.agentRuntime;
  const effectiveSystemPrompt = runtime ? runtime.systemPrompt : agentSystemPrompt;
  const effectiveMcpAllowlist = runtime ? runtime.mcpAllowlist : agentMcpAllowlist;
  const effectiveCwd = runtime?.cwd;

  // Build memory context and prepend to message
  const { contextText: memCtx, surfacedMemoryIds, surfacedMemorySummaries } = await buildMemoryContext(chatIdStr, message, agentId);
  const parts: string[] = [];
  if (effectiveSystemPrompt && !sessionId) parts.push(`[Agent role — follow these instructions]\n${effectiveSystemPrompt}\n[End agent role]`);
  if (memCtx) parts.push(memCtx);

  // Inject recent scheduled task outputs so the user can reply to them naturally.
  // Without this, Claude has no idea what a scheduled task just showed the user.
  const recentTasks = getRecentTaskOutputs(agentId, 30);
  if (recentTasks.length > 0) {
    const taskLines = recentTasks.map((t) => {
      const ago = Math.round((Date.now() / 1000 - t.last_run) / 60);
      return `[Scheduled task ran ${ago}m ago]\nTask: ${t.prompt}\nOutput:\n${t.last_result}`;
    });
    parts.push(`[Recent scheduled task context — the user may be replying to this]\n${taskLines.join('\n\n')}\n[End task context]`);
  }

  // Memory nudge: remind the agent to persist knowledge if it's been a while
  if (shouldNudgeMemory(chatIdStr, agentId)) {
    parts.push(MEMORY_NUDGE_TEXT);
  }

  parts.push(message);
  const fullMessage = parts.join('\n\n');

  // Smart model routing: use cheap model for simple acknowledgments
  const userModel = opts.modelOverride ?? (runtime ? runtime.model : agentDefaultModel);
  const effectiveModel = (SMART_ROUTING_ENABLED && !userModel && classifyMessageComplexity(message) === 'simple')
    ? SMART_ROUTING_CHEAP_MODEL
    : (userModel ?? 'claude-opus-4-6');

  // Start typing immediately, then refresh on interval
  await cb.sendTyping();
  const typingInterval = setInterval(() => void cb.sendTyping(), TYPING_REFRESH_MS);

  setProcessing(chatIdStr, true);

  // Chat -> Mission Control bridge. If this turn is an explicit task request,
  // mirror it onto the kanban as a live (running) card. Runs concurrently with
  // the agent so classification never delays the reply, and is settled in every
  // terminal branch below. Skipped for synthetic turns (e.g. /respin).
  const chatTaskPromise: Promise<string | null> = skipLog
    ? Promise.resolve(null)
    : maybeStartChatTask(message, agentId, cb.source);

  try {
    // Progress callback: surface agent activity to chat + SSE.
    // Tool activity is throttled to one update per 30s to avoid spam.
    let lastToolNotifyTime = 0;
    let lastToolDesc = '';
    const TOOL_NOTIFY_INTERVAL_MS = 30_000;

    const onProgress = (event: AgentProgressEvent) => {
      if (event.type === 'task_started') {
        emitChatEvent({ type: 'progress', chatId: chatIdStr, description: event.description });
        void cb.sendPlain(`🔄 ${event.description}`).catch(() => {});
      } else if (event.type === 'task_completed') {
        emitChatEvent({ type: 'progress', chatId: chatIdStr, description: event.description });
        void cb.sendPlain(`✓ ${event.description}`).catch(() => {});
      } else if (event.type === 'tool_active') {
        emitChatEvent({ type: 'progress', chatId: chatIdStr, description: event.description });
        lastToolDesc = event.description;
        // Only send tool notifications to chat if streaming is off.
        // When streaming is active, the live text updates already show progress.
        if (!streamingEnabled) {
          const now = Date.now();
          if (now - lastToolNotifyTime >= TOOL_NOTIFY_INTERVAL_MS) {
            lastToolNotifyTime = now;
            void cb.sendPlain(`⚙️ ${event.description}...`).catch(() => {});
          }
        }
      }
    };

    const abortCtrl = new AbortController();
    setActiveAbort(chatIdStr, abortCtrl);

    // Auto-abort if the agent runs too long (prevents runaway commands from blocking the bot)
    const timeoutId = setTimeout(() => {
      logger.warn({ chatId: chatIdStr, timeoutMs: AGENT_TIMEOUT_MS }, 'Agent query timed out, aborting');
      abortCtrl.abort();
    }, AGENT_TIMEOUT_MS);

    // Streaming: send a placeholder message and edit it as text arrives
    let streamMsgId: string | number | undefined;
    let lastEditLength = 0;
    const streamingEnabled = STREAM_STRATEGY !== 'off' && !!cb.editPlain;

    const onStreamText = streamingEnabled ? (accumulated: string) => {
      const now = Date.now();
      const globalLast = globalStreamLastEdit.get(chatIdStr) ?? 0;
      const deltaLen = accumulated.length - lastEditLength;

      if (now - globalLast < GLOBAL_STREAM_INTERVAL_MS || deltaLen < 20) return;

      let displayText = accumulated;
      if (displayText.length > 4000) {
        displayText = '...' + displayText.slice(displayText.length - 3900);
      }
      displayText += ' ▍';

      globalStreamLastEdit.set(chatIdStr, now);
      lastEditLength = accumulated.length;

      if (streamMsgId === undefined) {
        void cb.sendPlain(displayText).then((sent) => {
          streamMsgId = sent && typeof sent === 'object' ? sent.messageId : undefined;
        }).catch(() => {});
      } else {
        void cb.editPlain?.(streamMsgId, displayText).catch(() => {});
      }
    } : undefined;

    const result = await runAgentWithRetry(
      fullMessage,
      sessionId,
      () => void cb.sendTyping(),
      onProgress,
      effectiveModel,
      abortCtrl,
      onStreamText,
      (attempt, error) => {
        void cb.sendPlain(`${error.recovery.userMessage} (retry ${attempt}/${2})`).catch(() => {});
      },
      MODEL_FALLBACK_CHAIN.length > 0 ? MODEL_FALLBACK_CHAIN : undefined,
      effectiveMcpAllowlist,
      effectiveCwd,
    );

    clearTimeout(timeoutId);
    setActiveAbort(chatIdStr, null);
    clearInterval(typingInterval);

    // Clean up the streaming placeholder before sending the final formatted response
    if (streamMsgId !== undefined) {
      try { await cb.deleteMessage?.(streamMsgId); } catch { /* best effort */ }
    }

    // Handle abort (manual /stop or timeout)
    if (result.aborted) {
      setProcessing(chatIdStr, false);
      finishChatTask(chatTaskPromise, 'cancelled');
      const msg = result.text === null
        ? `Timed out after ${Math.round(AGENT_TIMEOUT_MS / 1000)}s. The task may have been too complex or a command got stuck. Try breaking it into smaller steps.`
        : 'Stopped.';
      emitChatEvent({ type: 'assistant_message', chatId: chatIdStr, content: msg, source: cb.source });
      await cb.sendPlain(msg);
      return;
    }

    if (result.newSessionId) {
      setSession(chatIdStr, result.newSessionId, agentId);
      logger.info({ newSessionId: result.newSessionId }, 'Session saved');
    }

    let rawResponse = result.text?.trim() || 'Done.';

    // Exfiltration guard: scan for leaked secrets before sending out
    if (EXFILTRATION_GUARD_ENABLED) {
      const protectedValues = PROTECTED_ENV_VARS
        .map((key) => process.env[key])
        .filter((v): v is string => !!v && v.length > 8);
      const secretMatches = scanForSecrets(rawResponse, protectedValues);
      if (secretMatches.length > 0) {
        rawResponse = redactSecrets(rawResponse, secretMatches);
        logger.warn(
          { matchCount: secretMatches.length, types: secretMatches.map((m) => m.type) },
          'Exfiltration guard: redacted secrets from response',
        );
      }
    }

    // Extract file markers before any formatting
    const { text: responseText, files: fileMarkers } = extractFileMarkers(rawResponse);

    // Add cost footer
    const costFooter = buildCostFooter(SHOW_COST_FOOTER, result.usage, effectiveModel);

    // Save conversation turn to memory (including full log).
    // Skip logging for synthetic messages like /respin to avoid self-referential growth.
    if (!skipLog) {
      saveConversationTurn(chatIdStr, message, rawResponse, result.newSessionId ?? sessionId, agentId);
      // Fire-and-forget: evaluate which surfaced memories were useful
      if (surfacedMemoryIds.length > 0) {
        void evaluateMemoryRelevance(surfacedMemoryIds, surfacedMemorySummaries, message, rawResponse).catch(() => {});
      }
    }

    // Settle the mirrored kanban card with the agent's response.
    finishChatTask(chatTaskPromise, 'completed', rawResponse);

    // Emit assistant response to SSE clients
    emitChatEvent({ type: 'assistant_message', chatId: chatIdStr, content: rawResponse, source: cb.source });

    // Send any attached files first
    for (const file of fileMarkers) {
      try {
        if (!fs.existsSync(file.filePath)) {
          await cb.sendPlain(`Could not send file: ${file.filePath} (not found)`);
          continue;
        }
        if (file.type === 'photo') {
          await cb.sendPhoto(file.filePath, file.caption);
        } else {
          await cb.sendFile(file.filePath, file.caption);
        }
      } catch (fileErr) {
        logger.error({ err: fileErr, filePath: file.filePath }, 'Failed to send file');
        await cb.sendPlain(`Failed to send file: ${file.filePath}`);
      }
    }

    // Voice response: send audio if user sent a voice note (forceVoiceReply)
    // OR if they've toggled /voice on for text messages.
    const caps = voiceCapabilities();
    const shouldSpeakBack = caps.tts && (forceVoiceReply || !!opts.voiceEnabled);

    // Send text response (if there's any left after stripping markers)
    const textWithFooter = responseText ? responseText + costFooter : '';
    if (textWithFooter) {
      if (shouldSpeakBack) {
        try {
          // Don't speak the cost footer, just the actual response
          const audioBuffer = await synthesizeSpeech(responseText);
          await cb.sendVoice(audioBuffer);
        } catch (ttsErr) {
          logger.error({ err: ttsErr }, 'TTS failed, falling back to text');
          for (const part of splitMessage(cb.format(textWithFooter), cb.maxLen)) {
            await cb.sendFormatted(part);
          }
        }
      } else {
        for (const part of splitMessage(cb.format(textWithFooter), cb.maxLen)) {
          await cb.sendFormatted(part);
        }
      }
    }

    // Log token usage to SQLite and check for context warnings
    if (result.usage) {
      const activeSessionId = result.newSessionId ?? sessionId;
      try {
        saveTokenUsage(
          chatIdStr,
          activeSessionId,
          result.usage.inputTokens,
          result.usage.outputTokens,
          result.usage.lastCallCacheRead,
          result.usage.lastCallCacheRead + result.usage.lastCallInputTokens,
          result.usage.totalCostUsd,
          result.usage.didCompact,
          agentId,
        );
      } catch (dbErr) {
        logger.error({ err: dbErr }, 'Failed to save token usage');
      }

      // Track usage for rate limiting
      trackUsage(result.usage.inputTokens + result.usage.outputTokens, result.usage.totalCostUsd);

      // Compaction tracking
      if (result.usage.didCompact && activeSessionId) {
        saveCompactionEvent(
          activeSessionId,
          result.usage.preCompactTokens ?? 0,
          result.usage.lastCallInputTokens,
          0,
        );
        const compactionCount = getCompactionCount(activeSessionId);
        if (compactionCount >= 2) {
          await cb.sendPlain('Context compacted multiple times. Consider /newchat to keep response quality high.');
        }
      }

      const warning = checkContextWarning(chatIdStr, activeSessionId, result.usage);
      if (warning) {
        await cb.sendPlain(warning);
      }

      // Rate limit warnings
      const rateStatus = getRateStatus(DAILY_COST_BUDGET, HOURLY_TOKEN_BUDGET);
      for (const rateWarning of rateStatus.warnings) {
        await cb.sendPlain(rateWarning);
      }
    }

    setProcessing(chatIdStr, false);
  } catch (err) {
    clearInterval(typingInterval);
    setActiveAbort(chatIdStr, null);
    setProcessing(chatIdStr, false);
    finishChatTask(chatTaskPromise, 'failed', null, err instanceof Error ? err.message : String(err));

    if (err instanceof AgentError) {
      logger.error(
        { category: err.category, recovery: err.recovery },
        'Agent error (classified)',
      );
      await cb.sendPlain(err.recovery.userMessage);
    } else {
      logger.error({ err }, 'Agent error (unclassified)');
      await cb.sendPlain('Something went wrong. Check the logs and try again.');
    }
  }
}
