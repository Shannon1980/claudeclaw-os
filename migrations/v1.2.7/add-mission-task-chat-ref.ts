import Database from 'better-sqlite3';
import path from 'path';

export const description =
  'Add mission_tasks.slack_message_ts (task output routing): the chat message a result was posted as, so operators reply in-thread to send feedback that routes back onto the task.';

export async function run(): Promise<void> {
  // Migrations run standalone via `tsx scripts/migrate.ts`, so open our own
  // better-sqlite3 handle relative to the repo root. Derive the path from
  // process.cwd() and never hardcode an absolute out-of-repo path — the migrate
  // runner scans for such paths and warns on them.
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);
  try {
    // Additive, idempotent ADD COLUMN. SQLite has no `ADD COLUMN IF NOT EXISTS`,
    // so PRAGMA-guard it: a second `npm run migrate` is a no-op. This MIRRORS the
    // addColumnIfMissing block in db.ts runMigrations (dual-write, P-4): the
    // in-memory test DB builds it from createSchema + runMigrations, the live
    // store builds it here. Column name + type MUST stay byte-identical to db.ts
    // or the live service crash-loops on the next restart's checkPendingMigrations.
    const have = new Set(
      (db.prepare(`PRAGMA table_info(mission_tasks)`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    if (!have.has('slack_message_ts')) {
      db.exec(`ALTER TABLE mission_tasks ADD COLUMN slack_message_ts TEXT`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mission_slack_ts ON mission_tasks(slack_message_ts)`);
  } finally {
    db.close();
  }
}
