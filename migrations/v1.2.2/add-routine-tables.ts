import Database from 'better-sqlite3';
import path from 'path';

export const description =
  'Add routine_steps/routine_runs companion tables and the autonomy column to scheduled_tasks (Phase 2 Routines)';

export async function run(): Promise<void> {
  // Migrations run standalone via `tsx scripts/migrate.ts`, so open our own
  // better-sqlite3 handle relative to the repo root. Derive the path from
  // process.cwd() and never hardcode an absolute out-of-repo path — the migrate
  // runner scans for such paths and warns on them.
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);
  try {
    // Companion tables are additive CREATE TABLE IF NOT EXISTS — a second
    // `npm run migrate` is a no-op (idempotent). FK + ON DELETE CASCADE mirror
    // the warroom_meetings/warroom_transcript pair in createSchema (db.ts).
    db.exec(`
      CREATE TABLE IF NOT EXISTS routine_steps (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        routine_id  TEXT NOT NULL,
        step_order  INTEGER NOT NULL,
        action      TEXT NOT NULL,
        agent_id    TEXT NOT NULL DEFAULT 'main',
        on_error    TEXT NOT NULL DEFAULT 'continue',
        created_at  INTEGER NOT NULL,
        FOREIGN KEY (routine_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
      );
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_routine_steps ON routine_steps(routine_id, step_order);`,
    );

    db.exec(`
      CREATE TABLE IF NOT EXISTS routine_runs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        routine_id   TEXT NOT NULL,
        outcome      TEXT NOT NULL,
        detail       TEXT NOT NULL DEFAULT '',
        output       TEXT,
        step_results TEXT NOT NULL DEFAULT '[]',
        ran_at       INTEGER NOT NULL,
        FOREIGN KEY (routine_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
      );
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_routine_runs ON routine_runs(routine_id, ran_at DESC);`,
    );

    // The autonomy ADD COLUMN is guarded by a PRAGMA table_info existence check
    // so re-running is a no-op. Additive with a safe default; no DROP/rename, no
    // data rewrite. Default 'unattended' matches the in-memory addColumnIfMissing
    // mirror in runMigrations (db.ts).
    const cols = db
      .prepare(`PRAGMA table_info(scheduled_tasks)`)
      .all() as Array<{ name: string }>;
    const has = (name: string) => cols.some((c) => c.name === name);
    if (!has('autonomy')) {
      db.exec(
        `ALTER TABLE scheduled_tasks ADD COLUMN autonomy TEXT NOT NULL DEFAULT 'unattended'`,
      );
    }
  } finally {
    db.close();
  }
}
