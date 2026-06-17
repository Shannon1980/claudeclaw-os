import { describe, it, expect } from 'vitest';
import { CronExpressionParser } from 'cron-parser';

import {
  parseJobFile,
  toCron,
  daysToCronField,
  isActiveFrontmatter,
  parseRetry,
} from './aos-cron.js';
import { computeNextRun } from './scheduler.js';

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
