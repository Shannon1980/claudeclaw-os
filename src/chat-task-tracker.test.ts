import { describe, it, expect, beforeEach, vi } from 'vitest';

// Control the classifier: extractViaClaude (Haiku) is the primary path. We
// return canned JSON so no real model is called. parseJsonResponse stays real.
vi.mock('./memory-ingest.js', () => ({ extractViaClaude: vi.fn() }));

import { _initTestDatabase, getMissionTask, claimNextMissionTask } from './db.js';
import { extractViaClaude } from './memory-ingest.js';
import { maybeStartChatTask, finishChatTask } from './chat-task-tracker.js';

const mockClaude = vi.mocked(extractViaClaude);

beforeEach(() => {
  _initTestDatabase();
  vi.clearAllMocks();
});

describe('maybeStartChatTask', () => {
  it('mirrors an explicit task as a running mission card', async () => {
    mockClaude.mockResolvedValue('{"isTask": true, "title": "Email the Q3 report"}');

    const id = await maybeStartChatTask('email finance the Q3 report by friday', 'main', 'slack');
    expect(id).not.toBeNull();

    const task = getMissionTask(id!)!;
    expect(task.status).toBe('running');
    expect(task.title).toBe('Email the Q3 report');
    expect(task.assigned_agent).toBe('main');
    expect(task.created_by).toBe('chat:slack');
    expect(task.started_at).toBeGreaterThan(0);
  });

  it('does NOT create a card when the classifier says it is not a task', async () => {
    mockClaude.mockResolvedValue('{"isTask": false}');
    const id = await maybeStartChatTask('what do you think about typescript vs go', 'main', 'slack');
    expect(id).toBeNull();
  });

  it('skips acknowledgments without calling the classifier', async () => {
    const id = await maybeStartChatTask('thanks', 'main', 'slack');
    expect(id).toBeNull();
    expect(mockClaude).not.toHaveBeenCalled();
  });

  it('skips slash commands', async () => {
    const id = await maybeStartChatTask('/newchat', 'main', 'telegram');
    expect(id).toBeNull();
    expect(mockClaude).not.toHaveBeenCalled();
  });

  it('returns null (not throw) when the classifier fails', async () => {
    mockClaude.mockRejectedValue(new Error('no creds'));
    // Gemini fallback also unavailable in tests -> classification returns null.
    const id = await maybeStartChatTask('research the competitive landscape for X', 'main', 'slack');
    expect(id).toBeNull();
  });

  it('creates a card the scheduler will never claim (running, not queued)', async () => {
    mockClaude.mockResolvedValue('{"isTask": true, "title": "Do the thing"}');
    const id = await maybeStartChatTask('go scrape the pricing page and summarize it', 'main', 'slack');
    expect(id).not.toBeNull();
    // The whole point: chat work is run by the chat handler, so the scheduler
    // must not pick this up and execute it a second time.
    expect(claimNextMissionTask('main')).toBeNull();
  });
});

describe('finishChatTask', () => {
  it('settles a card to completed with the response', async () => {
    mockClaude.mockResolvedValue('{"isTask": true, "title": "Summarize doc"}');
    const id = await maybeStartChatTask('summarize the attached spec document', 'main', 'slack');

    finishChatTask(id, 'completed', 'Here is the summary.');
    // finishChatTask is fire-and-forget; let the microtask settle.
    await Promise.resolve();
    await Promise.resolve();

    const task = getMissionTask(id!)!;
    expect(task.status).toBe('completed');
    expect(task.result).toBe('Here is the summary.');
    expect(task.completed_at).toBeGreaterThan(0);
  });

  it('settles a card to cancelled', async () => {
    mockClaude.mockResolvedValue('{"isTask": true, "title": "Long job"}');
    const id = await maybeStartChatTask('run the full migration and verify every table', 'main', 'slack');

    finishChatTask(id, 'cancelled');
    await Promise.resolve();
    await Promise.resolve();

    expect(getMissionTask(id!)!.status).toBe('cancelled');
  });

  it('is a no-op for a null id', () => {
    expect(() => finishChatTask(null, 'completed', 'x')).not.toThrow();
  });
});
