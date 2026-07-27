import Database from 'better-sqlite3';
import path from 'path';

export const description =
  'Add mission_task_runs (task output versioning): per-run history so a re-run keeps every prior shipped result as its own version instead of overwriting it.';

export async function run(): Promise<void> {
  // Migrations run standalone via `tsx scripts/migrate.ts`, so open our own
  // better-sqlite3 handle relative to the repo root. Derive the path from
  // process.cwd() and never hardcode an absolute out-of-repo path — the migrate
  // runner scans for such paths and warns on them.
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);
  try {
    // Idempotent CREATE TABLE / INDEX. This MIRRORS the createSchema + runMigrations
    // blocks in db.ts (dual-write, P-4): the in-memory test DB builds it there,
    // the live store builds it here. DDL MUST stay byte-identical across all three
    // or the live service crash-loops on the next restart's checkPendingMigrations.
    db.exec(`
      CREATE TABLE IF NOT EXISTS mission_task_runs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id         TEXT NOT NULL,
        version         INTEGER NOT NULL,
        result          TEXT,
        status          TEXT NOT NULL,
        error           TEXT,
        feedback        TEXT,
        feedback_msg_id INTEGER,
        created_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mission_task_runs ON mission_task_runs(task_id, version);
    `);
  } finally {
    db.close();
  }
}
