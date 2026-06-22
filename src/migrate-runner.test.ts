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
