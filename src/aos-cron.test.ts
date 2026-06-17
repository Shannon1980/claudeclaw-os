import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  parseJobFile,
  toCron,
  daysToCronField,
  isActiveFrontmatter,
  parseRetry,
  syncAosCronJobs,
} from './aos-cron.js';
import { computeNextRun } from './scheduler.js';
import { _initTestDatabase, getAllScheduledTasks } from './db.js';

// ── Parser + defensive coercion ──────────────────────────────────────────────

describe('parseJobFile', () => {
  it('splits YAML frontmatter from the prompt body', () => {
    const raw = `---\nname: Sample Job\ntime: '23:00'\ndays: daily\nactive: 'true'\n---\nDo the thing.\nSecond line.\n`;
    const { frontmatter, body } = parseJobFile(raw);
    expect(frontmatter.name).toBe('Sample Job');
    expect(frontmatter.time).toBe('23:00');
    expect(body).toBe('Do the thing.\nSecond line.');
  });

  it('throws when there are no frontmatter fences', () => {
    expect(() => parseJobFile('just a body, no fences')).toThrow(/frontmatter/i);
  });

  it("coerces quoted active:'false' to boolean false", () => {
    const { frontmatter } = parseJobFile(`---\nactive: 'false'\n---\nbody\n`);
    expect(isActiveFrontmatter(frontmatter.active)).toBe(false);
  });

  it("coerces quoted active:'true' to boolean true", () => {
    const { frontmatter } = parseJobFile(`---\nactive: 'true'\n---\nbody\n`);
    expect(isActiveFrontmatter(frontmatter.active)).toBe(true);
  });

  it("coerces quoted retry:'0' to integer 0", () => {
    const { frontmatter } = parseJobFile(`---\nretry: '0'\n---\nbody\n`);
    expect(parseRetry(frontmatter.retry)).toBe(0);
  });

  it('defaults missing retry to 0', () => {
    const { frontmatter } = parseJobFile(`---\nname: NoRetry\n---\nbody\n`);
    expect(parseRetry(frontmatter.retry)).toBe(0);
  });

  it("coerces quoted retry:'2' to integer 2", () => {
    expect(parseRetry("'2'".replace(/'/g, ''))).toBe(2);
    const { frontmatter } = parseJobFile(`---\nretry: '2'\n---\nbody\n`);
    expect(parseRetry(frontmatter.retry)).toBe(2);
  });
});

// ── days -> cron day-of-week field ────────────────────────────────────────────

describe('daysToCronField', () => {
  it('maps daily -> *', () => expect(daysToCronField('daily')).toBe('*'));
  it('maps weekdays -> 1-5', () => expect(daysToCronField('weekdays')).toBe('1-5'));
  it('maps weekends -> 0,6', () => expect(daysToCronField('weekends')).toBe('0,6'));
  it('maps a single day mon -> 1', () => expect(daysToCronField('mon')).toBe('1'));
  it('maps a list mon,wed,fri -> 1,3,5', () =>
    expect(daysToCronField('mon,wed,fri')).toBe('1,3,5'));
  it('maps sun -> 0 and sat -> 6', () => {
    expect(daysToCronField('sun')).toBe('0');
    expect(daysToCronField('sat')).toBe('6');
  });
  it('throws on an unknown days token', () =>
    expect(() => daysToCronField('someday')).toThrow(/unknown days/i));
});

// ── time/days -> cron string (D-08a grammar table) ────────────────────────────

describe('toCron (D-08a grammar)', () => {
  it('raw cron override wins verbatim (D-08)', () => {
    expect(toCron('09:00', 'daily', '15 6 * * 1')).toBe('15 6 * * 1');
  });

  it('exact time + daily -> 0 9 * * *', () => {
    expect(toCron('09:00', 'daily')).toBe('0 9 * * *');
  });

  it('multi-time + daily -> single comma string 0 9,17 * * * (one row)', () => {
    expect(toCron('09:00,17:00', 'daily')).toBe('0,0 9,17 * * *');
  });

  it('every_5m -> */5 * * * *', () => {
    expect(toCron('every_5m', undefined)).toBe('*/5 * * * *');
  });

  it('every_30m -> */30 * * * *', () => {
    expect(toCron('every_30m', undefined)).toBe('*/30 * * * *');
  });

  it('every_4h -> 0 */4 * * *', () => {
    expect(toCron('every_4h', undefined)).toBe('0 */4 * * *');
  });

  it('time + weekdays -> 0 9 * * 1-5', () => {
    expect(toCron('09:00', 'weekdays')).toBe('0 9 * * 1-5');
  });

  it('time + weekends -> 30 9 * * 0,6', () => {
    expect(toCron('09:30', 'weekends')).toBe('30 9 * * 0,6');
  });

  it('time + single day -> 0 10 * * 0 (sun)', () => {
    expect(toCron('10:00', 'sun')).toBe('0 10 * * 0');
  });

  it('time + day list -> 0 9 * * 1,3,5', () => {
    expect(toCron('09:00', 'mon,wed,fri')).toBe('0 9 * * 1,3,5');
  });

  it('throws when neither cron nor time present', () => {
    expect(() => toCron(undefined, 'daily')).toThrow();
  });
});

// ── every emitted string round-trips through the real cron engine ─────────────

describe('toCron output is parseable by the existing cron engine', () => {
  const cases: Array<[string | undefined, string | undefined, string | undefined]> = [
    ['09:00', 'daily', undefined],
    ['09:00,17:00', 'daily', undefined],
    ['every_5m', undefined, undefined],
    ['every_30m', undefined, undefined],
    ['every_4h', undefined, undefined],
    ['09:00', 'weekdays', undefined],
    ['09:30', 'weekends', undefined],
    ['10:00', 'sun', undefined],
    ['09:00', 'mon,wed,fri', undefined],
    [undefined, undefined, '15 6 * * 1'],
  ];

  it.each(cases)('CronExpressionParser.parse accepts toCron(%s, %s, %s)', (time, days, raw) => {
    const expr = toCron(time, days, raw);
    expect(() => CronExpressionParser.parse(expr)).not.toThrow();
  });

  it('computeNextRun returns a future epoch for each emitted string', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const [time, days, raw] of cases) {
      const expr = toCron(time, days, raw);
      expect(computeNextRun(expr)).toBeGreaterThan(nowSec);
    }
  });
});

// ── syncAosCronJobs: upsert + dormant + orphan lifecycle ──────────────────────

describe('syncAosCronJobs (upsert + deactivate-orphan lifecycle)', () => {
  let dir: string;

  // Mirrors the real agentic-os job set: 8 jobs, 3 active, 5 dormant. `name`
  // values match the real frontmatter so the derived slug ids are stable.
  const FIXTURES: Array<[string, Record<string, string>]> = [
    ['daily-memory-distill', { name: 'daily-memory-distill', time: '23:00', days: 'daily', active: 'true', model: 'sonnet', notify: 'on_finish', timeout: '10m', retry: '0' }],
    ['weekly-memory-curator', { name: 'weekly-memory-curator', time: '10:00', days: 'sun', active: 'true' }],
    ['weekly-memory-gaps', { name: 'weekly-memory-gaps', time: '09:30', days: 'sun', active: 'true' }],
    ['monthly-learnings-health', { name: 'monthly-learnings-health', time: '10:00', days: 'mon', active: 'false' }],
    ['nightly-memsearch-index', { name: 'nightly-memsearch-index', time: '23:30', days: 'daily', active: 'false' }],
    ['skill-update-check', { name: 'skill-update-check', time: '09:00', days: 'weekdays', active: 'false' }],
    ['weekly-activity-digest', { name: 'weekly-activity-digest', time: '17:00', days: 'fri', active: 'false' }],
    ['youtube-newsletter', { name: 'youtube-newsletter', time: '09:00', days: 'daily', active: 'false' }],
  ];

  function writeJob(slug: string, fm: Record<string, string>, body = 'job body text'): void {
    const lines = Object.entries(fm).map(([k, v]) => `${k}: '${v}'`);
    fs.writeFileSync(path.join(dir, `${slug}.md`), `---\n${lines.join('\n')}\n---\n${body}\n`);
  }

  beforeEach(() => {
    _initTestDatabase();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-aos-cron-'));
    for (const [slug, fm] of FIXTURES) writeJob(slug, fm);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('syncs all 8 fixtures to exactly 8 rows, scoped aos / aos-cron', () => {
    syncAosCronJobs(dir);
    const rows = getAllScheduledTasks();
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(r.agent_id).toBe('aos');
      expect(r.source).toBe('aos-cron');
    }
  });

  it('marks exactly the 3 active jobs active, the rest paused', () => {
    syncAosCronJobs(dir);
    const rows = getAllScheduledTasks();
    const active = rows.filter((r) => r.status === 'active').map((r) => r.id).sort();
    expect(active).toEqual(['daily-memory-distill', 'weekly-memory-curator', 'weekly-memory-gaps']);
    expect(rows.filter((r) => r.status === 'paused')).toHaveLength(5);
  });

  it('keeps nightly-memsearch-index dormant and never reactivates it on re-sync', () => {
    syncAosCronJobs(dir);
    let row = getAllScheduledTasks().find((r) => r.id === 'nightly-memsearch-index');
    expect(row?.status).toBe('paused');
    // Re-sync: dormant job must stay paused (sync never flips dormant -> active).
    syncAosCronJobs(dir);
    row = getAllScheduledTasks().find((r) => r.id === 'nightly-memsearch-index');
    expect(row?.status).toBe('paused');
  });

  it('is idempotent: double-sync yields 8 rows (not 16)', () => {
    syncAosCronJobs(dir);
    syncAosCronJobs(dir);
    expect(getAllScheduledTasks()).toHaveLength(8);
  });

  it('translates the 3 active jobs to the right cron strings', () => {
    syncAosCronJobs(dir);
    const byId = Object.fromEntries(getAllScheduledTasks().map((r) => [r.id, r]));
    expect(byId['daily-memory-distill'].schedule).toBe('0 23 * * *');
    expect(byId['weekly-memory-curator'].schedule).toBe('0 10 * * 0');
    expect(byId['weekly-memory-gaps'].schedule).toBe('30 9 * * 0');
  });

  it('persists job metadata (model/notify/timeout/retry/job_path) on the row', () => {
    syncAosCronJobs(dir);
    const row = getAllScheduledTasks().find((r) => r.id === 'daily-memory-distill')!;
    expect(row.model).toBe('sonnet');
    expect(row.notify).toBe('on_finish');
    expect(row.timeout).toBe('10m');
    expect(row.retry).toBe(0);
    expect(row.job_path).toContain('daily-memory-distill.md');
    expect(row.prompt).toBe('job body text');
  });

  it('deactivates (pauses, never deletes) a removed job on re-sync', () => {
    syncAosCronJobs(dir);
    expect(getAllScheduledTasks()).toHaveLength(8);

    // Remove an active job file and re-sync.
    fs.rmSync(path.join(dir, 'daily-memory-distill.md'));
    syncAosCronJobs(dir);

    const rows = getAllScheduledTasks();
    // Row count is preserved (D-07: never delete), the orphan is paused.
    expect(rows).toHaveLength(8);
    const orphan = rows.find((r) => r.id === 'daily-memory-distill');
    expect(orphan?.status).toBe('paused');
  });

  it('never writes back to the .md source files (read-only projection)', () => {
    const before = FIXTURES.map(([slug]) =>
      fs.readFileSync(path.join(dir, `${slug}.md`), 'utf-8'),
    );
    syncAosCronJobs(dir);
    const after = FIXTURES.map(([slug]) =>
      fs.readFileSync(path.join(dir, `${slug}.md`), 'utf-8'),
    );
    expect(after).toEqual(before);
  });

  it('skips a malformed job file without aborting the whole sync', () => {
    fs.writeFileSync(path.join(dir, 'broken.md'), 'no frontmatter here, just text');
    syncAosCronJobs(dir);
    // The 8 valid fixtures still sync; the broken one is skipped (logged).
    const rows = getAllScheduledTasks();
    expect(rows).toHaveLength(8);
    expect(rows.find((r) => r.id === 'broken')).toBeUndefined();
  });

  it('returns quietly when the jobs dir does not exist', () => {
    fs.rmSync(dir, { recursive: true, force: true });
    expect(() => syncAosCronJobs(dir)).not.toThrow();
    expect(getAllScheduledTasks()).toHaveLength(0);
    // re-create so afterEach cleanup is a no-op
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-aos-cron-'));
  });
});
