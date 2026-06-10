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
  isLocked: vi.fn(() => false),
  unlock: vi.fn(() => false),
  touchActivity: vi.fn(),
  checkKillPhrase: vi.fn(() => false),
  executeEmergencyKill: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./voice.js', () => ({ voiceCapabilities: vi.fn(() => ({ stt: false, tts: false })), synthesizeSpeech: vi.fn() }));

import { runAgentWithRetry } from './agent.js';
import { formatForSlack } from './format.js';
import { processUserMessage, type TransportCallbacks } from './message-core.js';

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

  it('reports an abort without sending a formatted reply', async () => {
    vi.mocked(runAgentWithRetry).mockResolvedValue({
      text: null, newSessionId: undefined, usage: undefined, aborted: true,
    } as any);

    const cb = mockCb();
    await processUserMessage('long task', cb);

    expect(cb.sendPlain).toHaveBeenCalled();
    expect(cb.sendFormatted).not.toHaveBeenCalled();
  });
});
