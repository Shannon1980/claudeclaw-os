import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock every side-effecting dependency so the test exercises only the
// transport callback wiring in processUserMessage. format.js, config.js,
// errors.js and logger.js are left real.
vi.mock('./agent.js', () => ({ runAgentWithRetry: vi.fn(), runAgent: vi.fn() }));
vi.mock('./db.js', () => ({
  getRecentTaskOutputs: vi.fn(() => []),
  getSession: vi.fn(() => undefined),
  setSession: vi.fn(),
  saveTokenUsage: vi.fn(),
  saveCompactionEvent: vi.fn(),
  getCompactionCount: vi.fn(() => 0),
}));
vi.mock('./memory.js', () => ({
  buildMemoryContext: vi.fn(async () => ({ contextText: '', surfacedMemoryIds: [], surfacedMemorySummaries: [] })),
  evaluateMemoryRelevance: vi.fn(),
  saveConversationTurn: vi.fn(),
  shouldNudgeMemory: vi.fn(() => false),
  MEMORY_NUDGE_TEXT: '',
}));
vi.mock('./message-classifier.js', () => ({ classifyMessageComplexity: vi.fn(() => 'complex') }));
vi.mock('./exfiltration-guard.js', () => ({ scanForSecrets: vi.fn(() => []), redactSecrets: vi.fn((t: string) => t) }));
vi.mock('./rate-tracker.js', () => ({ trackUsage: vi.fn(), getRateStatus: vi.fn(() => ({ warnings: [] })) }));
vi.mock('./cost-footer.js', () => ({ buildCostFooter: vi.fn(() => '') }));
vi.mock('./orchestrator.js', () => ({ parseDelegation: vi.fn(() => null), delegateToAgent: vi.fn() }));
vi.mock('./chat-task-tracker.js', () => ({ maybeStartChatTask: vi.fn(async () => null), finishChatTask: vi.fn() }));
vi.mock('./state.js', () => ({ emitChatEvent: vi.fn(), setProcessing: vi.fn(), setActiveAbort: vi.fn() }));
vi.mock('./security.js', () => ({
  checkKillPhrase: vi.fn(() => false),
  executeEmergencyKill: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./voice.js', () => ({ voiceCapabilities: vi.fn(() => ({ stt: false, tts: false })), synthesizeSpeech: vi.fn() }));

import { runAgentWithRetry } from './agent.js';
import { formatForSlack } from './format.js';
import { processUserMessage, type TransportCallbacks } from './message-core.js';
import { parseDelegation, delegateToAgent } from './orchestrator.js';
import { audit } from './security.js';
import { AgentError } from './errors.js';

const USAGE = {
  inputTokens: 1, outputTokens: 1, lastCallCacheRead: 0, lastCallInputTokens: 1,
  totalCostUsd: 0, didCompact: false,
};

function mockCb(over: Partial<TransportCallbacks> = {}): TransportCallbacks {
  return {
    chatId: 'slack:U1',
    agentId: 'main',
    source: 'slack',
    format: formatForSlack,
    maxLen: 3900,
    sendFormatted: vi.fn(async () => ({})),
    sendPlain: vi.fn(async () => ({})),
    editPlain: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
    sendTyping: vi.fn(),
    sendFile: vi.fn(async () => {}),
    sendPhoto: vi.fn(async () => {}),
    sendVoice: vi.fn(async () => {}),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks resets call history but not implementations; restore the
  // default (no delegation) so a delegation test does not leak into the next.
  vi.mocked(parseDelegation).mockReturnValue(null);
});

describe('processUserMessage', () => {
  it('sends the formatted agent reply via sendFormatted', async () => {
    vi.mocked(runAgentWithRetry).mockResolvedValue({
      text: 'Hello **world**', newSessionId: 's1', usage: USAGE, aborted: false,
    } as any);

    const cb = mockCb();
    await processUserMessage('hi', cb);

    expect(cb.sendFormatted).toHaveBeenCalledTimes(1);
    // formatForSlack turns **world** into *world*
    expect(cb.sendFormatted).toHaveBeenCalledWith('Hello *world*');
    expect(cb.sendFile).not.toHaveBeenCalled();
  });

  it('routes a [SEND_FILE] marker to sendFile and strips it from the text', async () => {
    const tmp = path.join(os.tmpdir(), `claudeclaw-test-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'hi');
    try {
      vi.mocked(runAgentWithRetry).mockResolvedValue({
        text: `Here is your file [SEND_FILE:${tmp}|report]`, newSessionId: 's1', usage: USAGE, aborted: false,
      } as any);

      const cb = mockCb();
      await processUserMessage('send it', cb);

      expect(cb.sendFile).toHaveBeenCalledWith(tmp, 'report');
      // The remaining text ("Here is your file") is still sent.
      expect(cb.sendFormatted).toHaveBeenCalledWith('Here is your file');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('delegation: routes a file marker to sendPhoto and strips it from the reply', async () => {
    const tmp = path.join(os.tmpdir(), `claudeclaw-deleg-${Date.now()}.png`);
    fs.writeFileSync(tmp, 'png');
    try {
      vi.mocked(parseDelegation).mockReturnValue({ agentId: 'aos', prompt: 'draw it' });
      vi.mocked(delegateToAgent).mockResolvedValue({
        agentId: 'aos', text: `Done. [SEND_PHOTO:${tmp}|diagram]`, durationMs: 1000,
      } as any);

      const cb = mockCb();
      await processUserMessage('@aos: draw it', cb);

      expect(cb.sendPhoto).toHaveBeenCalledWith(tmp, 'diagram');
      // The marker must not leak into the posted text.
      const posted = vi.mocked(cb.sendFormatted).mock.calls.map((c) => c[0]).join('\n');
      expect(posted).not.toContain('SEND_PHOTO');
      expect(posted).toContain('Done.');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('delegation: a marker-free reply posts via sendFormatted and sends no file', async () => {
    vi.mocked(parseDelegation).mockReturnValue({ agentId: 'aos', prompt: 'hi' });
    vi.mocked(delegateToAgent).mockResolvedValue({
      agentId: 'aos', text: 'just text, no file', durationMs: 1000,
    } as any);

    const cb = mockCb();
    await processUserMessage('@aos: hi', cb);

    expect(cb.sendFormatted).toHaveBeenCalled();
    expect(cb.sendPhoto).not.toHaveBeenCalled();
    expect(cb.sendFile).not.toHaveBeenCalled();
  });

  it('reports an abort without sending a formatted reply', async () => {
    vi.mocked(runAgentWithRetry).mockResolvedValue({
      text: null, newSessionId: undefined, usage: undefined, aborted: true,
    } as any);

    const cb = mockCb();
    await processUserMessage('long task', cb);

    expect(cb.sendPlain).toHaveBeenCalled();
    expect(cb.sendFormatted).not.toHaveBeenCalled();
  });

  // ── D-12: error event emission (Slice C) ──────────────────────────────────
  //
  // A caught error in the turn emits exactly one audit({action:'error'}) through
  // the single audit() choke point, carrying a category + a capped, scrubbed
  // message. NEVER stack frames, NEVER secrets (Pattern D / T-05-10).

  it('emits one error audit event on a classified AgentError, reusing err.category', async () => {
    const agentErr = new AgentError(
      'auth',
      { userMessage: 'Auth failed, please re-login.', shouldRetry: false },
    );
    vi.mocked(runAgentWithRetry).mockRejectedValue(agentErr);

    const cb = mockCb();
    await processUserMessage('do a thing', cb);

    const errorCalls = vi.mocked(audit).mock.calls.filter(
      (c) => (c[0] as { action?: string }).action === 'error',
    );
    expect(errorCalls).toHaveLength(1);
    const entry = errorCalls[0][0] as Record<string, unknown>;
    expect(entry.eventType).toBe('error');
    expect(entry.result).toBe('error');
    expect(entry.blocked).toBe(false);
    const detail = JSON.parse(entry.detail as string);
    expect(detail.category).toBe('auth');
    expect(typeof detail.message).toBe('string');
    // Operator still gets the recovery message.
    expect(cb.sendPlain).toHaveBeenCalled();
  });

  it('emits an error event for an unclassified throw with category=unknown and a capped, stack-free message', async () => {
    // A long error string with a fake stack frame line and a secret-shaped token.
    const SECRET = 'sk-live-DEADBEEF-secret-key';
    const longMsg = 'boom '.repeat(200) + `\n    at Object.<anonymous> (/Users/x/secret.ts:1:1) ${SECRET}`;
    vi.mocked(runAgentWithRetry).mockRejectedValue(new Error(longMsg));

    const cb = mockCb();
    await processUserMessage('do a thing', cb);

    const errorCalls = vi.mocked(audit).mock.calls.filter(
      (c) => (c[0] as { action?: string }).action === 'error',
    );
    expect(errorCalls).toHaveLength(1);
    const entry = errorCalls[0][0] as Record<string, unknown>;
    const detail = JSON.parse(entry.detail as string);
    expect(detail.category).toBe('unknown');
    // Message capped at 500 chars.
    expect(detail.message.length).toBeLessThanOrEqual(500);
    // No stack frame markers leak through.
    expect(detail.message).not.toContain('at Object.<anonymous>');
  });
});
