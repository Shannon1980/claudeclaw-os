import Database from 'better-sqlite3';
import path from 'path';

export const description =
  'Create the approval_queue table for background gate "ask" outcomes (Phase 3 Permissions, PERM-04)';

export async function run(): Promise<void> {
  // Migrations run standalone via `tsx scripts/migrate.ts`, so open our own
  // better-sqlite3 handle relative to the repo root. Derive the path from
  // process.cwd() and never hardcode an absolute out-of-repo path — the migrate
  // runner scans for such paths and warns on them.
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);
  try {
    // Additive CREATE TABLE/INDEX IF NOT EXISTS — a second `npm run migrate`
    // is a no-op (idempotent). This MIRRORS the same DDL added to db.ts
    // createSchema (dual-write): the in-memory test DB builds it from
    // createSchema, the live store builds it here (P-4 drift guard). Skipping
    // this registration crash-loops the live service on the next restart that
    // expects the table (L-6).
    db.exec(`
      CREATE TABLE IF NOT EXISTS approval_queue (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id      TEXT NOT NULL DEFAULT 'main',
        chat_id       TEXT NOT NULL DEFAULT '',
        run_id        TEXT,
        routine_id    TEXT,
        tool_name     TEXT NOT NULL,
        tool_input    TEXT NOT NULL,
        tier          INTEGER NOT NULL,
        mode_at_decision TEXT NOT NULL,
        summary       TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'pending',
        decided_at    INTEGER,
        result        TEXT,
        created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_approval_pending ON approval_queue(status, created_at DESC);`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_approval_agent ON approval_queue(agent_id, created_at DESC);`,
    );
  } finally {
    db.close();
  }
}
