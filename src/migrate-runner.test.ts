import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { runMigrations } from './migrate-runner.js';

// Build a throwaway project layout (migrations/version.json + a store/ dir) in a
// temp dir so runMigrations operates on real files without touching the repo.
function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeclaw-migrate-'));
  fs.mkdirSync(path.join(root, 'migrations'), { recursive: true });
  fs.mkdirSync(path.join(root, 'store'), { recursive: true });
  return root;
}

function writeRegistry(root: string, migrations: Record<string, string[]>): void {
  fs.writeFileSync(
    path.join(root, 'migrations', 'version.json'),
    JSON.stringify({ migrations }, null, 2),
  );
}

function writeApplied(root: string, lastApplied: string | null): void {
  fs.writeFileSync(
    path.join(root, 'migrations', '.applied.json'),
    JSON.stringify({ lastApplied }, null, 2),
  );
}

// Write a migration module the runner can dynamically import. body is the JS
// inside run(); throwIt makes it reject to exercise the failure path.
function writeMigration(
  root: string,
  version: string,
  name: string,
  opts: { throwIt?: boolean } = {},
): void {
  const dir = path.join(root, 'migrations', version);
  fs.mkdirSync(dir, { recursive: true });
  const body = opts.throwIt
    ? `export const description = 'boom'; export async function run(){ throw new Error('migration blew up'); }`
    : `export const description = 'noop ${name}'; export async function run(){ /* no-op */ }`;
  fs.writeFileSync(path.join(dir, `${name}.ts`), body);
}

// A migration file that loads fine but exports NO run() (typo / wrong name).
function writeMigrationNoRun(root: string, version: string, name: string): void {
  const dir = path.join(root, 'migrations', version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${name}.ts`),
    `export const description = 'missing run'; export async function runn(){ /* typo */ }`,
  );
}

describe('runMigrations (non-interactive runner)', () => {
  // Spy type is awkward to express; the spy itself only needs .not.toHaveBeenCalled().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createInterfaceSpy: any;

  beforeEach(() => {
    // Spy on readline.createInterface so any stdin prompt attempt is detectable.
    createInterfaceSpy = vi.spyOn(readline, 'createInterface');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns none-pending WITHOUT reading stdin when nothing is pending', async () => {
    const root = makeProject();
    writeRegistry(root, { '1.0.0': ['init'] });
    writeMigration(root, '1.0.0', 'init');
    writeApplied(root, '1.0.0'); // already at latest

    const res = await runMigrations({ assumeYes: true, projectRoot: root });
    expect(res.status).toBe('none-pending');
    expect(createInterfaceSpy).not.toHaveBeenCalled();
  });

  it('applies pending migrations with assumeYes WITHOUT invoking readline', async () => {
    const root = makeProject();
    writeRegistry(root, { '1.0.0': ['init'], '1.1.0': ['add'] });
    writeMigration(root, '1.0.0', 'init');
    writeMigration(root, '1.1.0', 'add');
    writeApplied(root, '1.0.0'); // 1.1.0 is pending

    const res = await runMigrations({ assumeYes: true, projectRoot: root });
    expect(res.status).toBe('applied');
    expect(res.from).toBe('1.0.0');
    expect(res.to).toBe('1.1.0');
    expect(createInterfaceSpy).not.toHaveBeenCalled();

    // .applied.json advanced to the new latest.
    const applied = JSON.parse(
      fs.readFileSync(path.join(root, 'migrations', '.applied.json'), 'utf-8'),
    );
    expect(applied.lastApplied).toBe('1.1.0');
  });

  it('returns failed (not a process.exit) when a migration throws', async () => {
    const root = makeProject();
    writeRegistry(root, { '1.0.0': ['init'], '1.1.0': ['boom'] });
    writeMigration(root, '1.0.0', 'init');
    writeMigration(root, '1.1.0', 'boom', { throwIt: true });
    writeApplied(root, '1.0.0');

    const res = await runMigrations({ assumeYes: true, projectRoot: root });
    expect(res.status).toBe('failed');
    if (res.status === 'failed') expect(res.error).toBeTruthy();
    expect(createInterfaceSpy).not.toHaveBeenCalled();
  });

  it('fails in pre-flight (before touching the DB) when a migration has no run() export', async () => {
    const root = makeProject();
    writeRegistry(root, { '1.0.0': ['init'], '1.1.0': ['norun'] });
    writeMigration(root, '1.0.0', 'init');
    writeMigrationNoRun(root, '1.1.0', 'norun');
    writeApplied(root, '1.0.0');

    const res = await runMigrations({ assumeYes: true, projectRoot: root });
    expect(res.status).toBe('failed');
    if (res.status === 'failed') expect(res.error).toMatch(/no run\(\) export/);
    // .applied.json must NOT have advanced — pre-flight caught it first.
    const applied = JSON.parse(
      fs.readFileSync(path.join(root, 'migrations', '.applied.json'), 'utf-8'),
    );
    expect(applied.lastApplied).toBe('1.0.0');
  });

  it('keeps the just-created backup during rotation when older backups exist', async () => {
    // store/claudeclaw.db exists so a pre-migration backup is written. Three
    // older .bak files are pre-seeded with mtimes NEWER than the run will set,
    // so a naive "keep 3 newest" would delete the fresh backup. WR-02 pins it.
    const root = makeProject();
    writeRegistry(root, { '1.0.0': ['init'], '1.1.0': ['add'] });
    writeMigration(root, '1.0.0', 'init');
    writeMigration(root, '1.1.0', 'add');
    writeApplied(root, '1.0.0'); // 1.1.0 pending

    const storeDir = path.join(root, 'store');
    fs.writeFileSync(path.join(storeDir, 'claudeclaw.db'), 'db');
    const future = Date.now() / 1000 + 3600;
    for (const v of ['0.1.0', '0.2.0', '0.3.0']) {
      const f = path.join(storeDir, `claudeclaw.db.pre-${v}.bak`);
      fs.writeFileSync(f, 'old');
      fs.utimesSync(f, future, future); // mtime in the future
    }

    const res = await runMigrations({ assumeYes: true, projectRoot: root });
    expect(res.status).toBe('applied');
    // The backup created for THIS run (pre-1.1.0) must survive rotation.
    expect(fs.existsSync(path.join(storeDir, 'claudeclaw.db.pre-1.1.0.bak'))).toBe(true);
    // Total .bak count capped at 3 (current + 2 newest others).
    const baks = fs
      .readdirSync(storeDir)
      .filter((f) => f.startsWith('claudeclaw.db.pre-') && f.endsWith('.bak'));
    expect(baks.length).toBe(3);
  });

  it('honors dataDir for store/ and migrations resolution', async () => {
    // projectRoot holds the migrations registry; dataDir holds store/ where the
    // backup would land. We assert the runner reads from dataDir's store.
    const root = makeProject();
    writeRegistry(root, { '1.0.0': ['init'] });
    writeMigration(root, '1.0.0', 'init');
    writeApplied(root, '1.0.0');

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeclaw-data-'));
    fs.mkdirSync(path.join(dataDir, 'store'), { recursive: true });

    const res = await runMigrations({ assumeYes: true, projectRoot: root, dataDir });
    expect(res.status).toBe('none-pending');
  });
});
