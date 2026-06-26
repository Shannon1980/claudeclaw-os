import Database from 'better-sqlite3';
import path from 'path';

export const description =
  'Enrich audit_log with per-event technical columns (Phase 5 Audit, AUD-01/D-01)';

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
    // This MIRRORS the addColumnIfMissing calls in db.ts runMigrations
    // (dual-write, P-4): the in-memory test DB builds these from createSchema +
    // runMigrations, the live store builds them here. The column names + types
    // MUST stay byte-identical to db.ts — drift crash-loops the live service on
    // the next restart's checkPendingMigrations (Pitfall 1). cost_usd is
    // intentionally absent: cost is resolved read-side via a JOIN on token_usage
    // (D-11), never written onto the append-only audit row.
    const have = new Set(
      (db.prepare(`PRAGMA table_info(audit_log)`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    const add = (col: string, type: string) => {
      if (!have.has(col)) db.exec(`ALTER TABLE audit_log ADD COLUMN ${col} ${type}`);
    };
    add('event_type', 'TEXT');
    add('tool', 'TEXT');
    add('target', 'TEXT');
    add('project', 'TEXT');
    add('decision', 'TEXT');
    add('decided_by', 'TEXT');
    add('decided_at', 'INTEGER');
    add('result', 'TEXT');
    add('duration_ms', 'INTEGER');
    add('model', 'TEXT');
    add('session_id', 'TEXT');
  } finally {
    db.close();
  }
}
