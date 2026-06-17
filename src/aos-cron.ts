/**
 * aos-cron — read agentic-os `cron/jobs/*.md` job files and project each into
 * the `scheduled_tasks` table as a single `source='aos-cron'`, `agent_id='aos'`
 * row (SCH-02). This module is SYNC ONLY: it parses YAML frontmatter + the
 * prompt body, translates the `time`/`days` grammar (or honours a verbatim
 * `cron:` override) into a cron string the existing `computeNextRun` engine
 * accepts, and upserts an idempotent row per job. It never fires anything and
 * never writes back to the `.md` files — the DB row is a derived projection
 * and the firing loop (plan 04) re-reads the body at fire time (D-07).
 *
 * No second scheduling engine is introduced: `toCron`'s output is a plain cron
 * string fed straight into `computeNextRun` (scheduler.ts) / CronExpressionParser.
 *
 * Pure helpers (parseJobFile, toCron, daysToCronField) are exported for unit
 * testing in isolation.
 */
import fs from 'fs';
import path from 'path';

import yaml from 'js-yaml';

import {
  upsertAosCronTask,
  deactivateAosCronTask,
  getAosCronTaskIds,
} from './db.js';
import { computeNextRun } from './scheduler.js';
import { resolveAgentRuntime } from './agent-config.js';
import { logger } from './logger.js';

export const AOS_CRON_AGENT_ID = 'aos';
export const AOS_CRON_SOURCE = 'aos-cron';

/** Frontmatter is author-controlled YAML; values arrive as (quoted) strings. */
export interface JobFrontmatter {
  name?: string;
  time?: string;
  days?: string;
  cron?: string;
  active?: string;
  model?: string;
  notify?: string;
  timeout?: string;
  retry?: string;
  description?: string;
  [key: string]: unknown;
}

/** Single-day token -> cron day-of-week number (0 = Sunday .. 6 = Saturday). */
const DOW: Record<string, string> = {
  sun: '0',
  mon: '1',
  tue: '2',
  wed: '3',
  thu: '4',
  fri: '5',
  sat: '6',
};

/**
 * Split a raw `.md` job string into its YAML frontmatter and prompt body.
 * Coerces the quoted-string `active` value to a boolean and `retry` to an
 * integer (absent -> 0); js-yaml returns `active: 'false'` as the truthy
 * non-empty string "false", so an explicit coercion is mandatory.
 */
export function parseJobFile(raw: string): {
  frontmatter: JobFrontmatter;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('No YAML frontmatter fences found in job file');
  }
  const frontmatter = (yaml.load(match[1]) ?? {}) as JobFrontmatter;
  const body = (match[2] ?? '').trim();
  return { frontmatter, body };
}

/**
 * Coerce the quoted `active` frontmatter value to a real boolean. Defaults to
 * false (dormant) when absent or anything other than the string "true".
 */
export function isActiveFrontmatter(active: unknown): boolean {
  return String(active ?? '').trim().toLowerCase() === 'true';
}

/**
 * Coerce the quoted `retry` frontmatter value to a non-negative integer.
 * Absent / unparseable -> 0.
 */
export function parseRetry(retry: unknown): number {
  const n = parseInt(String(retry ?? '').trim(), 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * Translate a `days` token (or comma list) to a cron day-of-week field.
 *   daily -> *, weekdays -> 1-5, weekends -> 0,6,
 *   mon -> 1, "mon,wed,fri" -> 1,3,5
 * Throws on an unknown token — never silently defaults to `*` (which would make
 * a job fire daily by mistake). Server-local interpretation (D-04).
 */
export function daysToCronField(days: string | undefined): string {
  const d = String(days ?? '').trim().toLowerCase();
  if (d === '' || d === 'daily') return '*';
  if (d === 'weekdays') return '1-5';
  if (d === 'weekends') return '0,6';
  const tokens = d.split(',').map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return '*';
  const mapped = tokens.map((t) => {
    if (!(t in DOW)) throw new Error(`Unknown days token: "${t}"`);
    return DOW[t];
  });
  return mapped.join(',');
}

/** Parse one `HH:MM` token into numeric minute + hour, validating range. */
function parseHHMM(time: string): { minute: number; hour: number } {
  const parts = time.trim().split(':');
  if (parts.length !== 2) throw new Error(`Invalid time: "${time}"`);
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Invalid time hour: "${time}"`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error(`Invalid time minute: "${time}"`);
  }
  return { minute, hour };
}

/**
 * Map a job's `time` + `days` (or a verbatim `cron:` override) to a single cron
 * string accepted by CronExpressionParser / computeNextRun. Grammar (D-08a):
 *   - raw cron present                -> returned verbatim (D-08 wins).
 *   - "every_Nm"                      -> "*\/N * * * *"
 *   - "every_Nh"                      -> "0 *\/N * * *"
 *   - exact "HH:MM"                   -> "<min> <hour> * * <days>"
 *   - multi-time "HH:MM,HH:MM"        -> "<min,min> <hour,hour> * * <days>" (one row)
 */
export function toCron(
  time: string | undefined,
  days: string | undefined,
  rawCron?: string,
): string {
  // Raw cron override wins and bypasses translation entirely (D-08).
  if (rawCron && String(rawCron).trim().length > 0) {
    return String(rawCron).trim();
  }

  const t = String(time ?? '').trim();
  if (t === '') {
    throw new Error('Job has neither a cron override nor a time');
  }

  // Interval forms: every_Nm (minutes) / every_Nh (hours).
  const everyMin = t.match(/^every_(\d+)m$/i);
  if (everyMin) {
    const n = Number(everyMin[1]);
    if (!Number.isInteger(n) || n < 1 || n > 59) {
      throw new Error(`Invalid minute interval: "${time}"`);
    }
    return `*/${n} * * * *`;
  }
  const everyHour = t.match(/^every_(\d+)h$/i);
  if (everyHour) {
    const n = Number(everyHour[1]);
    if (!Number.isInteger(n) || n < 1 || n > 23) {
      throw new Error(`Invalid hour interval: "${time}"`);
    }
    return `0 */${n} * * *`;
  }

  // Exact / multi-time: "HH:MM" or "HH:MM,HH:MM,...". Emit one comma-joined
  // minute field and one comma-joined hour field so the whole job stays a
  // single row (D-08a).
  const dow = daysToCronField(days);
  const slots = t.split(',').map((s) => s.trim()).filter(Boolean).map(parseHHMM);
  if (slots.length === 0) throw new Error(`Invalid time: "${time}"`);
  const minutes = slots.map((s) => String(s.minute)).join(',');
  const hours = slots.map((s) => String(s.hour)).join(',');
  return `${minutes} ${hours} * * ${dow}`;
}

/**
 * Resolve the agentic-os cron jobs directory (`<aos project_dir>/cron/jobs`)
 * from the `aos` agent's config. Returns null when the agent or its project_dir
 * can't be resolved.
 */
function resolveAosJobsDir(): string | null {
  try {
    const runtime = resolveAgentRuntime(AOS_CRON_AGENT_ID);
    if (!runtime.cwd) return null;
    return path.join(runtime.cwd, 'cron', 'jobs');
  } catch (err) {
    logger.warn(`aos-cron: cannot resolve aos agent runtime: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Read every `cron/jobs/*.md` in the resolved aos workspace, project each to one
 * idempotent `scheduled_tasks` row (agent_id='aos', source='aos-cron'), and
 * deactivate (pause, never delete) any existing aos-cron row whose `.md` is
 * gone (D-07). Dormant jobs (`active:'false'`, incl. nightly-memsearch-index)
 * are upserted paused and are never reactivated by sync. Strictly read-only on
 * the filesystem — never writes back to the `.md` files.
 *
 * `jobsDir` may be passed to override the resolved directory (used by tests).
 * A malformed/unschedulable job is logged + skipped so one bad file never
 * aborts the whole sync (T-07-04).
 */
export function syncAosCronJobs(jobsDir?: string): void {
  const dir = jobsDir ?? resolveAosJobsDir();
  if (!dir) {
    logger.warn('aos-cron: no aos jobs dir resolved; skipping sync');
    return;
  }

  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md') && f !== '.gitkeep')
      .sort();
  } catch (err) {
    logger.warn(`aos-cron: cannot read jobs dir ${dir}: ${(err as Error).message}`);
    return;
  }

  const syncedIds = new Set<string>();

  for (const file of files) {
    const filePath = path.join(dir, file);
    const slug = path.basename(file, '.md');
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { frontmatter, body } = parseJobFile(raw);
      // Stable id: prefer a slugified `name`, fall back to the filename stem.
      const id = slugify(frontmatter.name) || slug;
      const cron = toCron(frontmatter.time, frontmatter.days, frontmatter.cron);
      // Validate the cron before persisting (throws on malformed input —
      // caught below so one bad job never aborts the sync).
      const nextRun = computeNextRun(cron);

      upsertAosCronTask({
        id,
        prompt: body,
        schedule: cron,
        nextRun,
        jobPath: path.resolve(filePath),
        model: frontmatter.model ? String(frontmatter.model) : null,
        timeout: frontmatter.timeout ? String(frontmatter.timeout) : null,
        notify: frontmatter.notify ? String(frontmatter.notify) : null,
        retry: parseRetry(frontmatter.retry),
        active: isActiveFrontmatter(frontmatter.active),
      });
      syncedIds.add(id);
    } catch (err) {
      logger.warn(`aos-cron: skipping ${file}: ${(err as Error).message}`);
    }
  }

  // Orphan handling: pause (never delete) any aos-cron row no longer backed by
  // a file, preserving last_result history (D-07).
  for (const existingId of getAosCronTaskIds()) {
    if (!syncedIds.has(existingId)) {
      deactivateAosCronTask(existingId);
    }
  }
}

/** Slugify a frontmatter `name` into a stable, filesystem-safe id stem. */
function slugify(name: unknown): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
