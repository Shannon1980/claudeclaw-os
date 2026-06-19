import { describe, it, expect, beforeEach } from 'vitest';
import {
  _initTestDatabase,
  setSession,
  getSession,
  clearSession,
  saveStructuredMemory,
  searchMemories,
  getRecentMemories,
  getRecentHighImportanceMemories,
  touchMemory,
  decayMemories,
  getUnconsolidatedMemories,
  saveConsolidation,
  markMemoriesConsolidated,
  getRecentConsolidations,
  searchConsolidations,
  updateMemoryConnections,
  getDashboardMemoryStats,
  getDashboardLowSalienceMemories,
  getDashboardTopAccessedMemories,
  getDashboardMemoriesList,
  getDashboardMemoryTimeline,
  logConversationTurn,
  getConversationPage,
  createScheduledTask,
  getDueTasks,
  claimDueTask,
  upsertAosCronTask,
  deactivateAosCronTask,
  getAosCronTaskIds,
  getAllScheduledTasks,
  _getScheduledTaskColumns,
} from './db.js';
import path from 'path';
import { STORE_DIR, PROJECT_ROOT, TRANSPORT } from './config.js';

describe('database', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  // ── Conversation log ────────────────────────────────────────────

  describe('logConversationTurn source tagging', () => {
    it('tags rows with the configured TRANSPORT, not a hardcoded telegram default', () => {
      logConversationTurn('chat-src', 'user', 'hello', undefined, 'aos');
      const [row] = getConversationPage('chat-src', 10) as unknown as Array<{ source: string }>;
      expect(row.source).toBe(TRANSPORT);
    });

    it('honors an explicit source override', () => {
      logConversationTurn('chat-src2', 'assistant', 'hi', undefined, 'aos', 'dashboard');
      const [row] = getConversationPage('chat-src2', 10) as unknown as Array<{ source: string }>;
      expect(row.source).toBe('dashboard');
    });
  });

  // ── Sessions ────────────────────────────────────────────────────

  describe('sessions', () => {
    it('returns undefined for missing session', () => {
      expect(getSession('unknown')).toBeUndefined();
    });

    it('setSession then getSession returns the session ID', () => {
      setSession('chat1', 'sess-abc');
      expect(getSession('chat1')).toBe('sess-abc');
    });

    it('setSession overwrites existing session', () => {
      setSession('chat1', 'sess-1');
      setSession('chat1', 'sess-2');
      expect(getSession('chat1')).toBe('sess-2');
    });

    it('clearSession removes the session', () => {
      setSession('chat1', 'sess-abc');
      clearSession('chat1');
      expect(getSession('chat1')).toBeUndefined();
    });

    it('clearSession on missing session does not throw', () => {
      expect(() => clearSession('nonexistent')).not.toThrow();
    });
  });

  // ── Structured Memories ────────────────────────────────────────

  describe('saveStructuredMemory', () => {
    it('saves a memory with all fields persisted', () => {
      saveStructuredMemory('chat1', 'I like pizza', 'User enjoys pizza', ['pizza'], ['food', 'preferences'], 0.7);
      const mems = getRecentMemories('chat1', 10);
      expect(mems).toHaveLength(1);
      expect(mems[0].chat_id).toBe('chat1');
      expect(mems[0].raw_text).toBe('I like pizza');
      expect(mems[0].summary).toBe('User enjoys pizza');
      expect(JSON.parse(mems[0].entities)).toEqual(['pizza']);
      expect(JSON.parse(mems[0].topics)).toEqual(['food', 'preferences']);
      expect(mems[0].importance).toBe(0.7);
      expect(mems[0].salience).toBe(1.0);
      expect(mems[0].consolidated).toBe(0);
      expect(mems[0].source).toBe('conversation');
      expect(mems[0].created_at).toBeGreaterThan(0);
    });

    it('returns the memory ID', () => {
      const id = saveStructuredMemory('chat1', 'test', 'test summary', [], [], 0.5);
      expect(id).toBeGreaterThan(0);
    });
  });

  describe('searchMemories', () => {
    it('finds matching summary via FTS5', () => {
      saveStructuredMemory('chat1', 'raw text about TypeScript', 'User enjoys TypeScript programming', ['TypeScript'], ['coding'], 0.6);
      saveStructuredMemory('chat1', 'weather stuff', 'The weather is nice today', [], ['weather'], 0.3);
      const results = searchMemories('chat1', 'TypeScript', 5);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].summary).toContain('TypeScript');
    });

    it('returns empty array for no match', () => {
      saveStructuredMemory('chat1', 'raw', 'I love TypeScript', [], [], 0.5);
      const results = searchMemories('chat1', 'xyznonexistent', 5);
      expect(results).toEqual([]);
    });

    it('returns empty array for empty query', () => {
      saveStructuredMemory('chat1', 'raw', 'something', [], [], 0.5);
      const results = searchMemories('chat1', '', 5);
      expect(results).toEqual([]);
    });

    it('does not return memories from other chats', () => {
      saveStructuredMemory('chat1', 'raw', 'I love TypeScript', [], [], 0.5);
      saveStructuredMemory('chat2', 'raw', 'I love Python', [], [], 0.5);
      const results = searchMemories('chat1', 'Python', 5);
      expect(results).toEqual([]);
    });

    it('respects limit parameter', () => {
      saveStructuredMemory('chat1', 'raw', 'first topic about coding', [], ['coding'], 0.5);
      saveStructuredMemory('chat1', 'raw', 'second topic about coding', [], ['coding'], 0.5);
      saveStructuredMemory('chat1', 'raw', 'third topic about coding', [], ['coding'], 0.5);
      const results = searchMemories('chat1', 'coding', 2);
      expect(results).toHaveLength(2);
    });
  });

  describe('getRecentHighImportanceMemories', () => {
    it('only returns memories with importance >= 0.5', () => {
      saveStructuredMemory('chat1', 'raw', 'low importance', [], [], 0.3);
      saveStructuredMemory('chat1', 'raw', 'high importance', [], [], 0.8);
      const mems = getRecentHighImportanceMemories('chat1', 10);
      expect(mems).toHaveLength(1);
      expect(mems[0].summary).toBe('high importance');
    });
  });

  describe('touchMemory', () => {
    it('increments salience by 0.1', () => {
      saveStructuredMemory('chat1', 'raw', 'test memory', [], [], 0.5);
      const before = getRecentMemories('chat1', 1)[0];
      expect(before.salience).toBe(1.0);

      touchMemory(before.id);
      const after = getRecentMemories('chat1', 1)[0];
      expect(after.salience).toBeCloseTo(1.1, 5);
    });

    it('caps salience at 5.0', () => {
      saveStructuredMemory('chat1', 'raw', 'test memory', [], [], 0.5);
      const mem = getRecentMemories('chat1', 1)[0];

      for (let i = 0; i < 50; i++) {
        touchMemory(mem.id);
      }

      const after = getRecentMemories('chat1', 1)[0];
      expect(after.salience).toBe(5.0);
    });
  });

  describe('decayMemories', () => {
    it('does not throw on empty database', () => {
      expect(() => decayMemories()).not.toThrow();
    });

    it('does not decay recent memories', () => {
      saveStructuredMemory('chat1', 'raw', 'fresh memory', [], [], 0.5);
      const before = getRecentMemories('chat1', 1)[0];

      decayMemories();

      const after = getRecentMemories('chat1', 1)[0];
      expect(after.salience).toBe(before.salience);
    });
  });

  // ── Consolidation ────────────────────────────────────────────────

  describe('consolidation', () => {
    it('getUnconsolidatedMemories returns only unconsolidated', () => {
      saveStructuredMemory('chat1', 'raw', 'mem1', [], [], 0.5);
      saveStructuredMemory('chat1', 'raw', 'mem2', [], [], 0.6);
      const uncon = getUnconsolidatedMemories('chat1', 10);
      expect(uncon).toHaveLength(2);
    });

    it('markMemoriesConsolidated marks them', () => {
      const id1 = saveStructuredMemory('chat1', 'raw', 'mem1', [], [], 0.5);
      const id2 = saveStructuredMemory('chat1', 'raw', 'mem2', [], [], 0.6);
      markMemoriesConsolidated([id1, id2]);
      const uncon = getUnconsolidatedMemories('chat1', 10);
      expect(uncon).toHaveLength(0);
    });

    it('saveConsolidation creates a record', () => {
      const id1 = saveStructuredMemory('chat1', 'raw', 'mem1', [], [], 0.5);
      const id2 = saveStructuredMemory('chat1', 'raw', 'mem2', [], [], 0.6);
      saveConsolidation('chat1', [id1, id2], 'Both relate to work', 'User is focused on productivity');
      const cons = getRecentConsolidations('chat1', 5);
      expect(cons).toHaveLength(1);
      expect(cons[0].insight).toBe('User is focused on productivity');
      expect(JSON.parse(cons[0].source_ids)).toEqual([id1, id2]);
    });

    it('getUnconsolidatedMemories respects limit', () => {
      for (let i = 0; i < 5; i++) {
        saveStructuredMemory('chat1', 'raw', `mem${i}`, [], [], 0.5);
      }
      const uncon = getUnconsolidatedMemories('chat1', 3);
      expect(uncon).toHaveLength(3);
    });

    it('getUnconsolidatedMemories does not return memories from other chats', () => {
      saveStructuredMemory('chat1', 'raw', 'mine', [], [], 0.5);
      saveStructuredMemory('chat2', 'raw', 'theirs', [], [], 0.5);
      const uncon = getUnconsolidatedMemories('chat1', 10);
      expect(uncon).toHaveLength(1);
      expect(uncon[0].summary).toBe('mine');
    });

    it('markMemoriesConsolidated handles empty array', () => {
      expect(() => markMemoriesConsolidated([])).not.toThrow();
    });

    it('getRecentConsolidations respects limit', () => {
      const id1 = saveStructuredMemory('chat1', 'raw', 'mem1', [], [], 0.5);
      saveConsolidation('chat1', [id1], 'summary1', 'insight1');
      saveConsolidation('chat1', [id1], 'summary2', 'insight2');
      saveConsolidation('chat1', [id1], 'summary3', 'insight3');
      const cons = getRecentConsolidations('chat1', 2);
      expect(cons).toHaveLength(2);
    });

    it('getRecentConsolidations returns empty for chat with no consolidations', () => {
      const cons = getRecentConsolidations('empty-chat', 5);
      expect(cons).toEqual([]);
    });
  });

  // ── searchConsolidations ──────────────────────────────────────────

  describe('searchConsolidations', () => {
    it('finds consolidations matching summary', () => {
      const id1 = saveStructuredMemory('chat1', 'raw', 'mem', [], [], 0.5);
      saveConsolidation('chat1', [id1], 'Morning email routine is important', 'User has structured mornings');
      const results = searchConsolidations('chat1', 'email', 5);
      expect(results).toHaveLength(1);
      expect(results[0].summary).toContain('email');
    });

    it('finds consolidations matching insight', () => {
      const id1 = saveStructuredMemory('chat1', 'raw', 'mem', [], [], 0.5);
      saveConsolidation('chat1', [id1], 'General summary', 'User prefers TypeScript for all projects');
      const results = searchConsolidations('chat1', 'TypeScript', 5);
      expect(results).toHaveLength(1);
    });

    it('returns empty for no match', () => {
      const id1 = saveStructuredMemory('chat1', 'raw', 'mem', [], [], 0.5);
      saveConsolidation('chat1', [id1], 'About coding', 'Coding insight');
      const results = searchConsolidations('chat1', 'xyznonexistent', 5);
      expect(results).toEqual([]);
    });
  });

  // ── updateMemoryConnections ───────────────────────────────────────

  describe('updateMemoryConnections', () => {
    it('appends connections to an existing memory', () => {
      const id = saveStructuredMemory('chat1', 'raw', 'mem', [], [], 0.5);
      updateMemoryConnections(id, [{ linked_to: 99, relationship: 'related to' }]);
      const mem = getRecentMemories('chat1', 1)[0];
      const conns = JSON.parse(mem.connections);
      expect(conns).toHaveLength(1);
      expect(conns[0]).toEqual({ linked_to: 99, relationship: 'related to' });
    });

    it('appends to existing connections without overwriting', () => {
      const id = saveStructuredMemory('chat1', 'raw', 'mem', [], [], 0.5);
      updateMemoryConnections(id, [{ linked_to: 10, relationship: 'first' }]);
      updateMemoryConnections(id, [{ linked_to: 20, relationship: 'second' }]);
      const mem = getRecentMemories('chat1', 1)[0];
      const conns = JSON.parse(mem.connections);
      expect(conns).toHaveLength(2);
      expect(conns[0].linked_to).toBe(10);
      expect(conns[1].linked_to).toBe(20);
    });

    it('does not throw for nonexistent memory ID', () => {
      expect(() => updateMemoryConnections(99999, [{ linked_to: 1, relationship: 'test' }])).not.toThrow();
    });
  });

  // ── FTS5 multi-column search ──────────────────────────────────────

  describe('FTS5 multi-column search', () => {
    it('finds memory by entity match', () => {
      saveStructuredMemory('chat1', 'raw text', 'summary text', ['OpenAI', 'GPT-4'], ['AI'], 0.6);
      const results = searchMemories('chat1', 'OpenAI', 5);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('finds memory by topic match', () => {
      saveStructuredMemory('chat1', 'raw text', 'summary text', [], ['productivity', 'workflow'], 0.6);
      const results = searchMemories('chat1', 'productivity', 5);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('finds memory by raw_text match', () => {
      saveStructuredMemory('chat1', 'I absolutely love hiking in the mountains', 'User enjoys outdoor activities', ['hiking'], ['hobbies'], 0.5);
      const results = searchMemories('chat1', 'hiking mountains', 5);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('handles special characters in search query', () => {
      saveStructuredMemory('chat1', 'raw', 'summary', [], [], 0.5);
      const results = searchMemories('chat1', '!!!???', 5);
      expect(results).toEqual([]);
    });
  });

  // ── getRecentHighImportanceMemories edge cases ────────────────────

  describe('getRecentHighImportanceMemories edge cases', () => {
    it('includes memories with importance exactly 0.5', () => {
      saveStructuredMemory('chat1', 'raw', 'borderline', [], [], 0.5);
      const mems = getRecentHighImportanceMemories('chat1', 10);
      expect(mems).toHaveLength(1);
    });

    it('excludes memories with importance 0.49', () => {
      saveStructuredMemory('chat1', 'raw', 'just below', [], [], 0.49);
      const mems = getRecentHighImportanceMemories('chat1', 10);
      expect(mems).toHaveLength(0);
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        saveStructuredMemory('chat1', 'raw', `high${i}`, [], [], 0.8);
      }
      const mems = getRecentHighImportanceMemories('chat1', 3);
      expect(mems).toHaveLength(3);
    });
  });

  // ── Dashboard queries ─────────────────────────────────────────────

  describe('dashboard queries', () => {
    it('getDashboardMemoryStats returns correct totals', () => {
      saveStructuredMemory('chat1', 'raw', 'high', [], [], 0.9);
      saveStructuredMemory('chat1', 'raw', 'mid', [], [], 0.6);
      saveStructuredMemory('chat1', 'raw', 'low', [], [], 0.3);
      saveConsolidation('chat1', [1], 'summary', 'insight');

      const stats = getDashboardMemoryStats('chat1');
      expect(stats.total).toBe(3);
      expect(stats.consolidations).toBe(1);
      expect(stats.avgImportance).toBeCloseTo(0.6, 1);
      expect(stats.importanceDistribution.length).toBeGreaterThan(0);
    });

    it('getDashboardMemoryStats returns zeroes for empty chat', () => {
      const stats = getDashboardMemoryStats('empty');
      expect(stats.total).toBe(0);
      expect(stats.consolidations).toBe(0);
    });

    it('getDashboardLowSalienceMemories returns nothing for fresh memories', () => {
      saveStructuredMemory('chat1', 'raw', 'fresh', [], [], 0.5);
      const fading = getDashboardLowSalienceMemories('chat1', 10);
      // Fresh memory has salience 1.0, threshold is 0.5
      expect(fading).toHaveLength(0);
    });

    it('getDashboardTopAccessedMemories only returns importance >= 0.5', () => {
      saveStructuredMemory('chat1', 'raw', 'low imp', [], [], 0.3);
      saveStructuredMemory('chat1', 'raw', 'high imp', [], [], 0.7);
      const top = getDashboardTopAccessedMemories('chat1', 10);
      expect(top).toHaveLength(1);
      expect(top[0].summary).toBe('high imp');
    });

    it('getDashboardMemoriesList sorts by importance', () => {
      saveStructuredMemory('chat1', 'raw', 'low', [], [], 0.2);
      saveStructuredMemory('chat1', 'raw', 'high', [], [], 0.9);
      saveStructuredMemory('chat1', 'raw', 'mid', [], [], 0.5);

      const result = getDashboardMemoriesList('chat1', 10, 0, 'importance');
      expect(result.total).toBe(3);
      expect(result.memories[0].summary).toBe('high');
      expect(result.memories[1].summary).toBe('mid');
      expect(result.memories[2].summary).toBe('low');
    });

    it('getDashboardMemoriesList supports pagination', () => {
      for (let i = 0; i < 5; i++) {
        saveStructuredMemory('chat1', 'raw', `mem${i}`, [], [], 0.5);
      }
      const page1 = getDashboardMemoriesList('chat1', 2, 0);
      const page2 = getDashboardMemoriesList('chat1', 2, 2);
      expect(page1.memories).toHaveLength(2);
      expect(page2.memories).toHaveLength(2);
      expect(page1.total).toBe(5);
      // No overlap between pages
      const ids1 = page1.memories.map(m => m.id);
      const ids2 = page2.memories.map(m => m.id);
      expect(ids1.filter(id => ids2.includes(id))).toHaveLength(0);
    });

    it('getDashboardMemoryTimeline returns data', () => {
      saveStructuredMemory('chat1', 'raw', 'today', [], [], 0.5);
      const timeline = getDashboardMemoryTimeline('chat1', 30);
      expect(timeline.length).toBeGreaterThanOrEqual(1);
      expect(timeline[0]).toHaveProperty('date');
      expect(timeline[0]).toHaveProperty('count');
    });
  });

  // ── Phase 4: memory agent scoping + single store ───────────────────
  describe('memory agent scoping (MEM-02)', () => {
    it('getRecentHighImportanceMemories scopes by agent_id (no cross-agent leakage)', () => {
      saveStructuredMemory('chat1', 'raw a', 'aos shared topic note', [], ['shared'], 0.8, 'conversation', 'aos');
      saveStructuredMemory('chat1', 'raw m', 'main shared topic note', [], ['shared'], 0.8, 'conversation', 'main');

      const aos = getRecentHighImportanceMemories('chat1', 10, 'aos');
      const main = getRecentHighImportanceMemories('chat1', 10, 'main');
      const both = getRecentHighImportanceMemories('chat1', 10);

      expect(aos.map((m) => m.summary)).toEqual(['aos shared topic note']);
      expect(main.map((m) => m.summary)).toEqual(['main shared topic note']);
      expect(both.length).toBe(2);
    });

    it('searchMemories scopes by agent_id for the same chat_id', () => {
      saveStructuredMemory('chat1', 'raw a', 'aos likes TypeScript', ['TypeScript'], ['coding'], 0.6, 'conversation', 'aos');
      saveStructuredMemory('chat1', 'raw m', 'main likes TypeScript', ['TypeScript'], ['coding'], 0.6, 'conversation', 'main');

      const aos = searchMemories('chat1', 'TypeScript', 5, undefined, 'aos');
      expect(aos.map((m) => m.summary)).toEqual(['aos likes TypeScript']);
    });
  });

  describe('memory store path (MEM-01)', () => {
    it('resolves a single store under PROJECT_ROOT, never under agentic-os', () => {
      expect(path.isAbsolute(STORE_DIR)).toBe(true);
      expect(STORE_DIR.startsWith(PROJECT_ROOT)).toBe(true);
      expect(STORE_DIR.includes('agentic-os')).toBe(false);
    });
  });

  // ── aos-cron columns + atomic claim (SCH-02/SCH-03/SCH-04) ──────────

  describe('aos-cron scheduled_tasks columns', () => {
    it('scheduled_tasks exposes source, job_path, model, timeout, notify, retry', () => {
      const cols = _getScheduledTaskColumns();
      for (const c of ['source', 'job_path', 'model', 'timeout', 'notify', 'retry']) {
        expect(cols).toContain(c);
      }
    });

    it('source defaults to user for plain createScheduledTask rows', () => {
      createScheduledTask('plain-1', 'do thing', '0 9 * * *', 9999999999, 'main');
      const [row] = getAllScheduledTasks('main') as Array<{ source: string; retry: number }>;
      expect(row.source).toBe('user');
      expect(row.retry).toBe(0);
    });
  });

  describe('claimDueTask atomic claim (SCH-04)', () => {
    it('returns true exactly once for a fresh active row and false on a second claim', () => {
      createScheduledTask('claim-1', 'p', '0 9 * * *', 1, 'aos');
      const first = claimDueTask('claim-1', 9999999999);
      const second = claimDueTask('claim-1', 9999999999);
      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    it('returns false for a non-existent id', () => {
      expect(claimDueTask('nope', 9999999999)).toBe(false);
    });
  });

  describe('aos-cron row helpers', () => {
    it('upsertAosCronTask creates exactly one row per id and updates on re-run without duplicating', () => {
      upsertAosCronTask({
        id: 'job-a', prompt: 'body v1', schedule: '0 9 * * *', nextRun: 100,
        jobPath: '/jobs/a.md', model: 'sonnet', timeout: '10m', notify: 'on_finish', retry: 1, active: true,
      });
      upsertAosCronTask({
        id: 'job-a', prompt: 'body v2', schedule: '0 17 * * *', nextRun: 200,
        jobPath: '/jobs/a.md', model: 'opus', timeout: '15m', notify: 'on_failure', retry: 2, active: true,
      });
      const rows = getAllScheduledTasks('aos') as Array<{
        id: string; schedule: string; model: string; timeout: string; notify: string; retry: number; source: string; status: string;
      }>;
      expect(rows.length).toBe(1);
      expect(rows[0].schedule).toBe('0 17 * * *');
      expect(rows[0].model).toBe('opus');
      expect(rows[0].timeout).toBe('15m');
      expect(rows[0].notify).toBe('on_failure');
      expect(rows[0].retry).toBe(2);
      expect(rows[0].source).toBe('aos-cron');
      expect(rows[0].status).toBe('active');
    });

    it('dormant jobs (active:false) are written paused so they never fire', () => {
      upsertAosCronTask({
        id: 'job-dormant', prompt: 'b', schedule: '0 9 * * *', nextRun: 1,
        jobPath: '/jobs/d.md', model: null, timeout: null, notify: null, retry: 0, active: false,
      });
      const due = getDueTasks('aos');
      expect(due.find((t) => t.id === 'job-dormant')).toBeUndefined();
      const [row] = getAllScheduledTasks('aos') as Array<{ status: string }>;
      expect(row.status).toBe('paused');
    });

    it('deactivateAosCronTask sets status paused and preserves last_result (no DELETE)', () => {
      upsertAosCronTask({
        id: 'job-orphan', prompt: 'b', schedule: '0 9 * * *', nextRun: 1,
        jobPath: '/jobs/o.md', model: null, timeout: null, notify: null, retry: 0, active: true,
      });
      deactivateAosCronTask('job-orphan');
      const [row] = getAllScheduledTasks('aos') as Array<{ status: string }>;
      expect(row.status).toBe('paused');
    });

    it('getAosCronTaskIds returns only aos-cron rows, scoped to agent_id=aos', () => {
      createScheduledTask('user-row', 'p', '0 9 * * *', 1, 'main');
      upsertAosCronTask({
        id: 'aos-row', prompt: 'b', schedule: '0 9 * * *', nextRun: 1,
        jobPath: '/jobs/x.md', model: null, timeout: null, notify: null, retry: 0, active: true,
      });
      const ids = getAosCronTaskIds();
      expect(ids).toContain('aos-row');
      expect(ids).not.toContain('user-row');
    });
  });
});
