// Non-interactive migration runner.
//
// scripts/migrate.ts is the interactive CLI: it prompts [y/N], asks "proceed
// without backup?", and calls process.exit on every branch. None of that can
// survive in the desktop shell — there is no TTY behind the spawned service,
// and a process.exit silently kills the Electron-forked child so the dashboard
// never binds (RESEARCH Pitfall 3 / T-02-02 DoS).
//
// This module is the non-interactive core: runMigrations({ assumeYes }) NEVER
// reads stdin and NEVER calls process.exit — it RETURNS a status object and the
// caller (electron/main.cjs, or the CLI wrapper) decides what to render. The
// pre-migration backup + 3-deep rotation behavior is preserved verbatim. The
// migrations registry is read from projectRoot/migrations; writable state
// (store/, db, backups) resolves under dataDir when supplied (packaged mode),
// else projectRoot (dev/terminal).

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { compareSemver } from './migrations.js';

interface VersionRegistry {
  migrations: Record<string, string[]>;
}

interface AppliedState {
  lastApplied: string | null;
}

interface MigrationModule {
  description: string;
  run: () => Promise<void>;
}

export interface RunMigrationsOptions {
  /** When true, skip both readline prompts (apply-confirm + proceed-without-backup). */
  assumeYes: boolean;
  /** Where migrations/ lives (the code/bundle dir). */
  projectRoot: string;
  /** Where writable state (store/, db, backups) lives. Defaults to projectRoot. */
  dataDir?: string;
}

export type RunMigrationsResult =
  | { status: 'none-pending'; from: string | null; to: string | null }
  | { status: 'applied'; from: string | null; to: string }
  | { status: 'fresh-init'; from: null; to: string | null }
  | { status: 'failed'; from: string | null; to: string | null; error: string };

/**
 * Apply all pending migrations without reading stdin or calling process.exit.
 * Returns a status object describing the outcome.
 *
 * - assumeYes:false is currently equivalent to assumeYes:true on the apply path
 *   because this runner is the non-interactive core; the interactive CLI
 *   (scripts/migrate.ts) keeps its own prompts and calls this only after the
 *   user has already confirmed. The runner itself never prompts.
 */
export async function runMigrations(
  opts: RunMigrationsOptions,
): Promise<RunMigrationsResult> {
  const projectRoot = opts.projectRoot;
  const stateRoot = opts.dataDir || projectRoot;
  const migrationsDir = path.join(projectRoot, 'migrations');
  const versionFile = path.join(migrationsDir, 'version.json');
  const appliedFile = path.join(migrationsDir, '.applied.json');
  const storeDir = path.join(stateRoot, 'store');

  if (!fs.existsSync(versionFile)) {
    return { status: 'failed', from: null, to: null, error: 'migrations/version.json not found.' };
  }

  let registry: VersionRegistry;
  try {
    registry = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));
  } catch (e) {
    return {
      status: 'failed',
      from: null,
      to: null,
      error: `Could not read version.json: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const allVersions = Object.keys(registry.migrations).sort(compareSemver);
  const latest = allVersions[allVersions.length - 1] ?? null;

  let lastApplied: string | null = null;
  if (fs.existsSync(appliedFile)) {
    try {
      const state: AppliedState = JSON.parse(fs.readFileSync(appliedFile, 'utf-8'));
      lastApplied = state.lastApplied;
    } catch (e) {
      return {
        status: 'failed',
        from: null,
        to: latest,
        error: `Could not read .applied.json: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  } else if (!fs.existsSync(storeDir)) {
    // Fresh install — store/ has never been created. Initialise .applied.json
    // to the latest version; nothing to migrate.
    if (latest) {
      fs.writeFileSync(appliedFile, JSON.stringify({ lastApplied: latest }, null, 2) + '\n');
    }
    return { status: 'fresh-init', from: null, to: latest };
  }
  // If .applied.json is absent but store/ exists, this is a pre-migration
  // install. Fall through with lastApplied = null so all migrations are pending.

  const pendingVersions =
    lastApplied === null
      ? allVersions
      : allVersions.filter((v) => compareSemver(v, lastApplied!) > 0);

  if (pendingVersions.length === 0) {
    return { status: 'none-pending', from: lastApplied, to: latest };
  }

  // Load + validate every pending migration module up front so a missing/broken
  // file fails before we touch the DB.
  for (const version of pendingVersions) {
    const filenames = registry.migrations[version];
    for (const filename of filenames) {
      const filePath = path.join(migrationsDir, version, `${filename}.ts`);
      if (!fs.existsSync(filePath)) {
        return {
          status: 'failed',
          from: lastApplied,
          to: latest,
          error: `Migration file not found: ${filePath}`,
        };
      }
      let mod: Partial<MigrationModule>;
      try {
        mod = (await import(pathToFileURL(filePath).href)) as Partial<MigrationModule>;
      } catch (e) {
        return {
          status: 'failed',
          from: lastApplied,
          to: latest,
          error: `Failed to load migration ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      // Validate the export shape now (WR-03): a file that loads fine but is
      // missing a callable run() would otherwise throw "mod.run is not a
      // function" mid-apply, AFTER the backup/rotation and possibly after
      // earlier versions already mutated the DB and advanced .applied.json.
      if (typeof mod.run !== 'function') {
        return {
          status: 'failed',
          from: lastApplied,
          to: latest,
          error: `Migration ${filePath} has no run() export.`,
        };
      }
    }
  }

  // Pre-migration backup (preserved from scripts/migrate.ts): snapshot the DB to
  // store/claudeclaw.db.pre-{version}.bak (0600) + WAL, keeping the last 3.
  const dbPath = path.join(storeDir, 'claudeclaw.db');
  if (fs.existsSync(dbPath)) {
    const targetVersion = pendingVersions[0] ?? 'unknown';
    const backupPath = path.join(storeDir, `claudeclaw.db.pre-${targetVersion}.bak`);
    try {
      fs.copyFileSync(dbPath, backupPath);
      fs.chmodSync(backupPath, 0o600);
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        fs.copyFileSync(walPath, `${backupPath}-wal`);
        fs.chmodSync(`${backupPath}-wal`, 0o600);
      }
    } catch (e) {
      // The interactive CLI would prompt "proceed without backup?" here. The
      // non-interactive runner honors assumeYes: when true it proceeds, when
      // false it refuses (returns failed) rather than blocking on a prompt.
      if (!opts.assumeYes) {
        return {
          status: 'failed',
          from: lastApplied,
          to: latest,
          error: `Could not create pre-migration backup: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }
    // Rotation: keep the 3 most recent .bak files. Exclude the backup just
    // created for THIS run from the rotation candidates (WR-02): mtime ties or
    // clock skew on a restored backup could otherwise sort it among the oldest
    // and delete the only pre-migration snapshot before migrations run. We pin
    // the current backup and keep 2 of the remaining (current + 2 = 3 total).
    try {
      const currentBak = path.basename(backupPath);
      const baks = fs
        .readdirSync(storeDir)
        .filter(
          (f) =>
            f.startsWith('claudeclaw.db.pre-') &&
            f.endsWith('.bak') &&
            f !== currentBak,
        )
        .map((f) => ({ f, mtime: fs.statSync(path.join(storeDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const old of baks.slice(2)) {
        fs.rmSync(path.join(storeDir, old.f), { force: true });
        fs.rmSync(path.join(storeDir, `${old.f}-wal`), { force: true });
      }
    } catch {
      /* rotation failure is non-fatal */
    }
  }

  // Run migrations in order. On a failure, return status 'failed' (never exit).
  for (const version of pendingVersions) {
    const filenames = registry.migrations[version];
    for (const filename of filenames) {
      const filePath = path.join(migrationsDir, version, `${filename}.ts`);
      try {
        const mod = (await import(pathToFileURL(filePath).href)) as MigrationModule;
        await mod.run();
      } catch (e) {
        return {
          status: 'failed',
          from: lastApplied,
          to: latest,
          error: `Migration ${filename} (${version}) failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }
    // Persist lastApplied after each version fully succeeds.
    fs.writeFileSync(appliedFile, JSON.stringify({ lastApplied: version }, null, 2) + '\n');
  }

  const finalVersion = pendingVersions[pendingVersions.length - 1];
  return { status: 'applied', from: lastApplied, to: finalVersion };
}
