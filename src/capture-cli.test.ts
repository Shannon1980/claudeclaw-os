import path from 'path';

import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory conversation_log substitute. The mocked saveConversationTurn
// appends assistant turns; the mocked getRecentConversation reads them back so
// the dedup guard is exercised end-to-end without a real DB.
interface FakeTurn {
  role: string;
  content: string;
  session_id: string | null;
}
const conversationLog: FakeTurn[] = [];
const saveCalls: Array<{ chatId: string; user: string; assistant: string; sessionId?: string; agentId: string }> = [];

vi.mock('./db.js', () => ({
  initDatabase: vi.fn(),
  getRecentConversation: vi.fn((_chatId: string, limit: number, _agentId?: string) =>
    [...conversationLog].reverse().slice(0, limit),
  ),
}));

vi.mock('./memory.js', () => ({
  saveConversationTurnAwaited: vi.fn(async (chatId: string, user: string, assistant: string, sessionId?: string, agentId = 'main') => {
    saveCalls.push({ chatId, user, assistant, sessionId, agentId });
    conversationLog.push({ role: 'user', content: user, session_id: sessionId ?? null });
    conversationLog.push({ role: 'assistant', content: assistant, session_id: sessionId ?? null });
  }),
}));

vi.mock('./agent-config.js', () => ({
  workspaceMemoryKey: vi.fn((id: string) => `ws:${id}`),
}));

import { captureFromStop } from './capture-cli.js';

beforeEach(() => {
  vi.clearAllMocks();
  conversationLog.length = 0;
  saveCalls.length = 0;
});

describe('captureFromStop', () => {
  it('writes one turn under (ws:aos, aos) for a Stop payload with assistant text', async () => {
    const res = await captureFromStop({ session_id: 'sess-1', last_assistant_message: 'Wired the unified pool.' });

    expect(res).toEqual({ captured: true, chatId: 'ws:aos' });
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0].chatId).toBe('ws:aos');
    expect(saveCalls[0].agentId).toBe('aos');
    expect(saveCalls[0].assistant).toBe('Wired the unified pool.');
    expect(saveCalls[0].sessionId).toBe('sess-1');
    // Meaningful user label so importance gating does not drop it (Pitfall 3).
    expect(saveCalls[0].user).toContain('sess-1');
  });

  it('is idempotent: a re-fire with the same session_id + content adds no second turn', async () => {
    await captureFromStop({ session_id: 'sess-1', last_assistant_message: 'Same content.' });
    const second = await captureFromStop({ session_id: 'sess-1', last_assistant_message: 'Same content.' });

    expect(second).toEqual({ captured: false, reason: 'duplicate' });
    expect(saveCalls).toHaveLength(1);
  });

  it('captures distinct content for the same session', async () => {
    await captureFromStop({ session_id: 'sess-1', last_assistant_message: 'First turn.' });
    const second = await captureFromStop({ session_id: 'sess-1', last_assistant_message: 'Second, different turn.' });

    expect(second).toEqual({ captured: true, chatId: 'ws:aos' });
    expect(saveCalls).toHaveLength(2);
  });

  it('is a no-op for empty / whitespace assistant text', async () => {
    expect(await captureFromStop({ session_id: 's', last_assistant_message: '' })).toEqual({ captured: false, reason: 'empty' });
    expect(await captureFromStop({ session_id: 's', last_assistant_message: '   \n  ' })).toEqual({ captured: false, reason: 'empty' });
    expect(await captureFromStop({ session_id: 's' })).toEqual({ captured: false, reason: 'empty' });
    expect(saveCalls).toHaveLength(0);
  });

  it('length-caps the captured text at 4000 chars', async () => {
    const huge = 'x'.repeat(5000);
    await captureFromStop({ session_id: 'sess-big', last_assistant_message: huge });

    expect(saveCalls[0].assistant.length).toBe(4000);
    expect(saveCalls[0].assistant.endsWith('...')).toBe(true);
  });

  it('dedups the feedback loop: a projected memory re-captured does not double-write', async () => {
    // Simulate the terminal echoing previously-captured content (Pitfall 6).
    await captureFromStop({ session_id: 'sess-loop', last_assistant_message: 'Projected memory echoed back.' });
    const echo = await captureFromStop({ session_id: 'sess-loop', last_assistant_message: 'Projected memory echoed back.' });

    expect(echo.captured).toBe(false);
    expect(saveCalls).toHaveLength(1);
  });
});

describe('store resolution (foreign cwd)', () => {
  it('derives the store path from PROJECT_ROOT, not process.cwd()', async () => {
    // The capture CLI is spawned by the terminal in the agentic-os cwd. The DB
    // path must still resolve to the claudeclaw store. config.ts anchors
    // PROJECT_ROOT on __dirname, so STORE_DIR is cwd-independent.
    const original = process.cwd();
    try {
      process.chdir(path.parse(original).root); // a foreign cwd (filesystem root)
      const { PROJECT_ROOT, STORE_DIR } = await import('./config.js');
      // STORE_DIR lives under PROJECT_ROOT (the claudeclaw repo), absolute, and
      // is NOT derived from the foreign cwd we just chdir'd into.
      expect(STORE_DIR.startsWith(PROJECT_ROOT)).toBe(true);
      expect(STORE_DIR.startsWith(process.cwd())).toBe(PROJECT_ROOT.startsWith(process.cwd()));
      expect(path.isAbsolute(STORE_DIR)).toBe(true);
    } finally {
      process.chdir(original);
    }
  });
});
