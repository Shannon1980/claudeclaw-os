import Database from 'better-sqlite3';
import path from 'path';

export const description =
  'Add project_id to scheduled_tasks so routines can be scoped to a project (Phase 2 Routines, 06-routines.md "Routines scope to Projects")';

export async function run(): Promise<void> {
  // Migrations run standalone via `tsx scripts/migrate.ts`, so open our own
  // better-sqlite3 handle relative to the repo root. Derive the path from
  // process.cwd() and never hardcode an absolute out-of-repo path — the migrate
  // runner scans for such paths and warns on them.
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db');
  const db = new Database(dbPath);
  try {
    // Additive, nullable column guarded by a PRAGMA existence check so a second
    // `npm run migrate` is a no-op (idempotent). NULL = "no project" (unscoped),
    // matching every pre-migration routine. No FK to projects: detaching a
    // routine on project delete is handled application-side (deleteProject
    // nulls scheduled_tasks.project_id), mirroring how mission_tasks detach.
    const cols = db
      .prepare(`PRAGMA table_info(scheduled_tasks)`)
      .all() as Array<{ name: string }>;
    const has = (name: string) => cols.some((c) => c.name === name);
    if (!has('project_id')) {
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN project_id TEXT`);
    }
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_tasks_project ON scheduled_tasks(project_id)`,
    );
  } finally {
    db.close();
  }
}
