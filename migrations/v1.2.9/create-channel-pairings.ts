import Database from 'better-sqlite3';
import path from 'path';

export const description =
  'Create the channel_pairings table for Slack/Telegram sender admission codes';

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
    // createSchema, the live store builds it here (P-4 drift guard).
    db.exec(`
      CREATE TABLE IF NOT EXISTS channel_pairings (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        channel       TEXT NOT NULL,
        sender_id     TEXT NOT NULL,
        display_name  TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'pending',
        pairing_code  TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        decided_at    INTEGER,
        last_seen_at  INTEGER NOT NULL,
        UNIQUE (channel, sender_id),
        UNIQUE (pairing_code)
      );
    `);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_pairings_status ON channel_pairings(status, created_at DESC);`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_pairings_channel ON channel_pairings(channel, status);`,
    );
  } finally {
    db.close();
  }
}
