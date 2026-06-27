import Database from 'better-sqlite3';
import path from 'path';

export const description =
  'Create the task_messages table for per-task operator<->agent threads (blocked-on-you replies)';

export async function run(): Promise<void> {
  // Migrations run standalone via `tsx scripts/migrate.ts`, so open our own
  // better-sqlite3 handle relative to the repo root. Derive the path from
  // process.cwd() and never hardcode an absolute out-of-repo path — the migrate
  // runner scans for such paths and warns on them.
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);
  try {
    // Additive CREATE TABLE/INDEX IF NOT EXISTS — a second `npm run migrate`
    // is a no-op (idempotent). MIRRORS the same DDL added to db.ts createSchema
    // (dual-write): the in-memory test DB builds it from createSchema, the live
    // store builds it here (P-4 drift guard). Skipping this registration
    // crash-loops the live service on the next restart that expects the table.
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id     TEXT NOT NULL,
        role        TEXT NOT NULL,
        body        TEXT NOT NULL,
        reason      TEXT,
        created_at  INTEGER NOT NULL
      );
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_task_messages ON task_messages(task_id, created_at);`,
    );
  } finally {
    db.close();
  }
}
