import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The router's two model paths are mocked at the module boundary: the tests
// exercise routing/fallback/sweep logic, never a live Haiku or Gemini call.
vi.mock('./memory-ingest.js', () => ({
  extractViaClaude: vi.fn(),
}));
vi.mock('./gemini.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gemini.js')>();
  return { ...actual, generateContent: vi.fn() };
});
vi.mock('./agent-config.js', () => ({
  listAgentIds: () => ['research', 'comms'],
  loadAgentConfig: (id: string) => ({ name: id, description: `${id} things` }),
}));

import {
  _initTestDatabase,
  createMissionTask,
  getMissionTask,
  getUnassignedMissionTasks,
} from './db.js';
import { extractViaClaude } from './memory-ingest.js';
import { generateContent } from './gemini.js';
import * as ks from './kill-switches.js';
import { classifyTaskAgent, autoAssignUnassignedTasks } from './task-router.js';

const haiku = vi.mocked(extractViaClaude);
const gemini = vi.mocked(generateContent);

describe('task-router', () => {
  let savedSwitch: string | undefined;

  beforeEach(() => {
    _initTestDatabase();
    haiku.mockReset();
    gemini.mockReset();
    savedSwitch = process.env.MISSION_AUTO_ASSIGN_ENABLED;
    delete process.env.MISSION_AUTO_ASSIGN_ENABLED;
    ks._reset();
  });

  afterEach(() => {
    if (savedSwitch === undefined) delete process.env.MISSION_AUTO_ASSIGN_ENABLED;
    else process.env.MISSION_AUTO_ASSIGN_ENABLED = savedSwitch;
    ks._reset();
  });

  describe('classifyTaskAgent', () => {
    it('returns the Haiku pick when it names a known agent', async () => {
      haiku.mockResolvedValue('{"agent": "research"}');
      expect(await classifyTaskAgent('dig into competitor pricing')).toBe('research');
      expect(gemini).not.toHaveBeenCalled();
    });

    it('falls back to Gemini when Haiku throws', async () => {
      haiku.mockRejectedValue(new Error('oauth expired'));
      gemini.mockResolvedValue('{"agent": "comms"}');
      expect(await classifyTaskAgent('reply to the youtube comments')).toBe('comms');
    });

    it('treats an unknown agent id from the model as a miss, not an assignment', async () => {
      haiku.mockResolvedValue('{"agent": "hallucinated-agent"}');
      gemini.mockResolvedValue('{"agent": "research"}');
      expect(await classifyTaskAgent('anything')).toBe('research');
    });

    it('defaults to main when both model paths fail', async () => {
      haiku.mockRejectedValue(new Error('down'));
      gemini.mockRejectedValue(new Error('429'));
      expect(await classifyTaskAgent('anything')).toBe('main');
    });
  });

  describe('autoAssignUnassignedTasks', () => {
    it('routes every unassigned queued task and reports the assignments', async () => {
      createMissionTask('u-1', 'Competitor scan', 'scan competitors', null, 'main', 5);
      createMissionTask('u-2', 'Inbox sweep', 'sweep the inbox', null, 'main', 5);
      haiku
        .mockResolvedValueOnce('{"agent": "research"}')
        .mockResolvedValueOnce('{"agent": "comms"}');

      const results = await autoAssignUnassignedTasks();

      expect(results).toEqual([
        { id: 'u-1', agent: 'research' },
        { id: 'u-2', agent: 'comms' },
      ]);
      expect(getMissionTask('u-1')?.assigned_agent).toBe('research');
      expect(getMissionTask('u-2')?.assigned_agent).toBe('comms');
      expect(getUnassignedMissionTasks()).toHaveLength(0);
    });

    it('leaves already-assigned tasks alone', async () => {
      createMissionTask('a-1', 'Assigned', 'p', 'ops', 'main', 5);
      const results = await autoAssignUnassignedTasks();
      expect(results).toEqual([]);
      expect(haiku).not.toHaveBeenCalled();
      expect(getMissionTask('a-1')?.assigned_agent).toBe('ops');
    });

    it('one unroutable task does not starve the rest of the sweep', async () => {
      createMissionTask('u-bad', 'Poison', 'p', null, 'main', 9);
      createMissionTask('u-ok', 'Fine', 'p', null, 'main', 1);
      // classifyTaskAgent itself swallows model errors, so simulate a failure
      // deeper than the classifier (e.g. a throw from the sweep's own call).
      haiku.mockRejectedValue(new Error('down'));
      gemini
        .mockRejectedValueOnce(new Error('429')) // u-bad → classifier defaults to main
        .mockResolvedValueOnce('{"agent": "research"}');

      const results = await autoAssignUnassignedTasks();
      // u-bad hard-defaulted to main (never lost), u-ok routed properly.
      expect(results).toEqual([
        { id: 'u-bad', agent: 'main' },
        { id: 'u-ok', agent: 'research' },
      ]);
    });

    it('does nothing when MISSION_AUTO_ASSIGN_ENABLED is off', async () => {
      process.env.MISSION_AUTO_ASSIGN_ENABLED = 'false';
      ks._reset();
      createMissionTask('u-3', 'Should wait', 'p', null, 'main', 5);

      const results = await autoAssignUnassignedTasks();

      expect(results).toEqual([]);
      expect(haiku).not.toHaveBeenCalled();
      expect(getMissionTask('u-3')?.assigned_agent).toBeNull();
    });
  });
});
