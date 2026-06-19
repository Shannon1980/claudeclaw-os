import Database from 'better-sqlite3';
import path from 'path';

export const description =
  'Add aos-cron columns (source, job_path, model, timeout, notify, retry) to scheduled_tasks';

export async function run(): Promise<void> {
  // Migrations run standalone via `tsx scripts/migrate.ts`, so open our own
  // better-sqlite3 handle relative to the repo root. Derive the path from
  // process.cwd() and never hardcode an absolute out-of-repo path — the migrate
  // runner scans for such paths and warns on them.
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);
  try {
    const cols = db
      .prepare(`PRAGMA table_info(scheduled_tasks)`)
      .all() as Array<{ name: string }>;
    const has = (name: string) => cols.some((c) => c.name === name);

    // Each ADD COLUMN is guarded by a PRAGMA table_info existence check so a
    // second `npm run migrate` is a no-op (idempotent). Columns are additive
    // with safe defaults — no DROP/rename, no data rewrite. `source` defaults
    // to 'user' so pre-existing user tasks stay distinct from 'aos-cron' rows.
    if (!has('source')) {
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'user'`);
    }
    if (!has('job_path')) {
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN job_path TEXT`);
    }
    if (!has('model')) {
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN model TEXT`);
    }
    if (!has('timeout')) {
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN timeout TEXT`);
    }
    if (!has('notify')) {
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN notify TEXT`);
    }
    if (!has('retry')) {
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN retry INTEGER NOT NULL DEFAULT 0`);
    }
  } finally {
    db.close();
  }
}
