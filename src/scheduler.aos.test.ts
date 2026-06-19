import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  _initTestDatabase,
  upsertAosCronTask,
  claimDueTask,
  getAllScheduledTasks,
  getDueTasks,
  type ScheduledTask,
} from './db.js';
import { parseTimeout, runAosCronTaskOnce, TASK_TIMEOUT_MS } from './scheduler.js';
import type { AosFireDeps } from './scheduler.js';

/**
 * Tests for the aos-cron firing branch (plan 07-04): atomic claim, prompt
 * re-read at fire time (D-07), per-job timeout (D-10) / retry (D-11),
 * preamble suppression (D-12), and notify gating (D-03).
 *
 * The firing work is exercised through `runAosCronTaskOnce(task, nextRun, deps)`
 * so the claim/notify/timeout/retry/re-read logic is unit-testable without the
 * 60s interval, the message queue, or a real agent subprocess.
 */

let tmpDir: string;

function writeJob(slug: string, frontmatter: string, body: string): string {
  const p = path.join(tmpDir, `${slug}.md`);
  fs.writeFileSync(p, `---\n${frontmatter}\n---\n${body}`);
  return p;
}

function seedAosRow(over: Partial<Parameters<typeof upsertAosCronTask>[0]> = {}): ScheduledTask {
  const nextRun = Math.floor(Date.now() / 1000) - 60; // due now
  upsertAosCronTask({
    id: 'job-1',
    prompt: 'STORED PROMPT BODY',
    schedule: '*/5 * * * *',
    nextRun,
    jobPath: null,
    model: null,
    timeout: null,
    notify: null,
    retry: 0,
    active: true,
    ...over,
  });
  const row = getAllScheduledTasks('aos').find((t) => t.id === (over.id ?? 'job-1'));
  if (!row) throw new Error('seed row missing');
  return row;
}

/** A deps bundle with stub sender + runAgent; overridable per test. */
function makeDeps(over: Partial<AosFireDeps> = {}): { deps: AosFireDeps; sent: string[] } {
  const sent: string[] = [];
  const deps: AosFireDeps = {
    sender: async (t: string) => { sent.push(t); },
    runAgent: vi.fn(async () => ({ text: 'AGENT RESULT', aborted: false })),
    ...over,
  };
  return { deps, sent };
}

describe('parseTimeout', () => {
  it('parses minutes', () => {
    expect(parseTimeout('5m')).toBe(5 * 60 * 1000);
    expect(parseTimeout('15m')).toBe(15 * 60 * 1000);
  });
  it('parses hours', () => {
    expect(parseTimeout('1h')).toBe(60 * 60 * 1000);
    expect(parseTimeout('2h')).toBe(2 * 60 * 60 * 1000);
  });
  it('falls back to TASK_TIMEOUT_MS for null/garbage', () => {
    expect(parseTimeout(null)).toBe(TASK_TIMEOUT_MS);
    expect(parseTimeout(undefined)).toBe(TASK_TIMEOUT_MS);
    expect(parseTimeout('nonsense')).toBe(TASK_TIMEOUT_MS);
    expect(parseTimeout('')).toBe(TASK_TIMEOUT_MS);
  });
});

describe('aos-cron firing branch', () => {
  beforeEach(() => {
    _initTestDatabase();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoscron-'));
  });

  it('atomic claim: a second concurrent fire of the same row is skipped (no double-fire)', () => {
    const row = seedAosRow();
    const nextRun = Math.floor(Date.now() / 1000) + 300;

    // First claim wins, second loses — exactly-once (SCH-04).
    expect(claimDueTask(row.id, nextRun)).toBe(true);
    expect(claimDueTask(row.id, nextRun)).toBe(false);

    // While claimed (status='running'), the row is invisible to getDueTasks.
    expect(getDueTasks('aos')).toHaveLength(0);
  });

  it('re-reads the prompt body from job_path at fire time (not the stored projection)', async () => {
    const jobPath = writeJob('job-1', "name: 'job-1'\ntime: '09:00'", 'FRESH BODY FROM FILE');
    const row = seedAosRow({ jobPath });
    const { deps } = makeDeps();
    const nextRun = Math.floor(Date.now() / 1000) + 300;

    await runAosCronTaskOnce(row, nextRun, deps);

    expect(deps.runAgent).toHaveBeenCalledTimes(1);
    const firedPrompt = (deps.runAgent as any).mock.calls[0][0];
    expect(firedPrompt).toBe('FRESH BODY FROM FILE');
    expect(firedPrompt).not.toBe('STORED PROMPT BODY');
  });

  it('falls back to the stored prompt when job_path is unreadable', async () => {
    const row = seedAosRow({ jobPath: path.join(tmpDir, 'does-not-exist.md') });
    const { deps } = makeDeps();
    const nextRun = Math.floor(Date.now() / 1000) + 300;

    await runAosCronTaskOnce(row, nextRun, deps);

    expect(deps.runAgent).toHaveBeenCalledTimes(1);
    expect((deps.runAgent as any).mock.calls[0][0]).toBe('STORED PROMPT BODY');
  });

  it('suppresses the "Scheduled task running" preamble for aos-cron rows', async () => {
    const jobPath = writeJob('job-1', "name: 'job-1'", 'BODY');
    const row = seedAosRow({ jobPath, notify: 'on_finish' });
    const { deps, sent } = makeDeps();
    const nextRun = Math.floor(Date.now() / 1000) + 300;

    await runAosCronTaskOnce(row, nextRun, deps);

    expect(sent.some((m) => m.startsWith('Scheduled task running'))).toBe(false);
  });

  it("notify='on_finish' sends the result on success and writes last_status", async () => {
    const jobPath = writeJob('job-1', "name: 'job-1'", 'BODY');
    const row = seedAosRow({ jobPath, notify: 'on_finish' });
    const { deps, sent } = makeDeps();
    const nextRun = Math.floor(Date.now() / 1000) + 300;

    await runAosCronTaskOnce(row, nextRun, deps);

    expect(sent.some((m) => m.includes('AGENT RESULT'))).toBe(true);
    const after = getAllScheduledTasks('aos')[0];
    expect(after.last_status).toBe('success');
    expect(after.last_result).toContain('AGENT RESULT');
  });

  it("notify='on_failure' does NOT send on success but still writes last_status", async () => {
    const jobPath = writeJob('job-1', "name: 'job-1'", 'BODY');
    const row = seedAosRow({ jobPath, notify: 'on_failure' });
    const { deps, sent } = makeDeps();
    const nextRun = Math.floor(Date.now() / 1000) + 300;

    await runAosCronTaskOnce(row, nextRun, deps);

    expect(sent).toHaveLength(0);
    const after = getAllScheduledTasks('aos')[0];
    expect(after.last_status).toBe('success');
  });

  it("notify='on_failure' sends only on failure", async () => {
    const jobPath = writeJob('job-1', "name: 'job-1'", 'BODY');
    const row = seedAosRow({ jobPath, notify: 'on_failure', retry: 0 });
    const { deps, sent } = makeDeps({
      runAgent: vi.fn(async () => { throw new Error('boom'); }),
    });
    const nextRun = Math.floor(Date.now() / 1000) + 300;

    await runAosCronTaskOnce(row, nextRun, deps);

    expect(sent.some((m) => m.includes('boom') || m.includes('failed') || m.includes('Task failed'))).toBe(true);
    const after = getAllScheduledTasks('aos')[0];
    expect(after.last_status).toBe('failed');
  });

  it('retry-N re-runs the agent N+1 times before recording failure', async () => {
    const jobPath = writeJob('job-1', "name: 'job-1'", 'BODY');
    const row = seedAosRow({ jobPath, retry: 2, notify: 'on_failure' });
    const runAgent = vi.fn(async () => { throw new Error('always fails'); });
    const { deps } = makeDeps({ runAgent });
    const nextRun = Math.floor(Date.now() / 1000) + 300;

    await runAosCronTaskOnce(row, nextRun, deps);

    // retry=2 means 1 initial + 2 retries = 3 attempts
    expect(runAgent).toHaveBeenCalledTimes(3);
    const after = getAllScheduledTasks('aos')[0];
    expect(after.last_status).toBe('failed');
  });

  it('retry succeeds mid-sequence: stops retrying after first success', async () => {
    const jobPath = writeJob('job-1', "name: 'job-1'", 'BODY');
    const row = seedAosRow({ jobPath, retry: 3, notify: 'on_finish' });
    let calls = 0;
    const runAgent = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error('transient');
      return { text: 'OK NOW', aborted: false };
    });
    const { deps, sent } = makeDeps({ runAgent });
    const nextRun = Math.floor(Date.now() / 1000) + 300;

    await runAosCronTaskOnce(row, nextRun, deps);

    expect(runAgent).toHaveBeenCalledTimes(2); // failed once, succeeded on 2nd
    expect(sent.some((m) => m.includes('OK NOW'))).toBe(true);
    expect(getAllScheduledTasks('aos')[0].last_status).toBe('success');
  });

  it('timeout (aborted) records last_status=timeout and notifies on_failure', async () => {
    const jobPath = writeJob('job-1', "name: 'job-1'", 'BODY');
    const row = seedAosRow({ jobPath, notify: 'on_failure', retry: 0 });
    const { deps, sent } = makeDeps({
      runAgent: vi.fn(async () => ({ text: null, aborted: true })),
    });
    const nextRun = Math.floor(Date.now() / 1000) + 300;

    await runAosCronTaskOnce(row, nextRun, deps);

    const after = getAllScheduledTasks('aos')[0];
    expect(after.last_status).toBe('timeout');
    expect(sent.some((m) => m.toLowerCase().includes('timed out'))).toBe(true);
  });
});
