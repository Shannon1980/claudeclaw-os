import Database from 'better-sqlite3';
import path from 'path';

export const description =
  'Add the Memory surface data spine: memories.category (D-06) + memories.confirmed (D-04) + memory_tombstones (D-08), Phase 6 MEM-01/MEM-02';

export async function run(): Promise<void> {
  // Migrations run standalone via `tsx scripts/migrate.ts`, so open our own
  // better-sqlite3 handle relative to the repo root. Derive the path from
  // process.cwd() and never hardcode an absolute out-of-repo path — the migrate
  // runner scans for such paths and warns on them.
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);
  try {
    // Additive, idempotent ADD COLUMNs. SQLite has no `ADD COLUMN IF NOT
    // EXISTS`, so PRAGMA-guard each one: a second `npm run migrate` is a no-op.
    // This MIRRORS the PRAGMA-guarded block in db.ts createSchema (dual-write,
    // P-4): the in-memory test DB builds these from createSchema + runMigrations,
    // the live store builds them here. The column names + types MUST stay
    // byte-identical to db.ts — drift crash-loops the live service on the next
    // restart's checkPendingMigrations (Pitfall 1 / T-06-01).
    const have = new Set(
      (db.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    if (!have.has('category')) {
      db.exec(`ALTER TABLE memories ADD COLUMN category TEXT`);
    }
    if (!have.has('confirmed')) {
      db.exec(`ALTER TABLE memories ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0`);
    }

    // Suppression / no-re-derivation table (D-08). text_hash is the sha256 of
    // the normalized summary; the (chat_id, text_hash) index backs the floor
    // lookup. Optional embedding backs the secondary cosine match.
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_tombstones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT,
        text_hash TEXT NOT NULL,
        embedding TEXT,
        summary TEXT,
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_memory_tombstones_chat_hash
        ON memory_tombstones(chat_id, text_hash);
    `);

    // Grandfather every row present at migration time to confirmed=1 (RESEARCH
    // Open Q1): the D-04 behavior gate must not strip the operator's whole
    // existing memory the moment the migration runs. New inserts still default
    // to 0 via the column default above. This UPDATE belongs to the migration
    // ONLY — createSchema must never run it (fresh DBs have nothing to grandfather).
    db.exec(`UPDATE memories SET confirmed = 1`);
  } finally {
    db.close();
  }
}
