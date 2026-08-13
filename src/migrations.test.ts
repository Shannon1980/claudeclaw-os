import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { checkPendingMigrations, compareSemver } from './migrations.js';
import { _initTestDatabase, getDb } from './db.js';

// ── compareSemver ────────────────────────────────────────────────────────────

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    expect(compareSemver('v1.0.0', 'v1.0.0')).toBe(0);
  });

  it('patch increment: older < newer', () => {
    expect(compareSemver('v1.0.0', 'v1.0.1')).toBeLessThan(0);
    expect(compareSemver('v1.0.1', 'v1.0.0')).toBeGreaterThan(0);
  });

  it('minor increment dominates patch', () => {
    expect(compareSemver('v1.0.9', 'v1.1.0')).toBeLessThan(0);
  });

  it('major increment dominates minor and patch', () => {
    expect(compareSemver('v1.9.9', 'v2.0.0')).toBeLessThan(0);
  });

  it('sorts a mixed array into ascending order', () => {
    const versions = ['v1.1.0', 'v1.0.0', 'v2.0.0', 'v1.0.1'];
    expect([...versions].sort(compareSemver)).toEqual([
      'v1.0.0',
      'v1.0.1',
      'v1.1.0',
      'v2.0.0',
    ]);
  });

  it('works without v prefix', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareSemver('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('throws on invalid version string', () => {
    expect(() => compareSemver('notaversion', 'v1.0.0')).toThrow('Invalid semver');
    expect(() => compareSemver('v1.0.0', 'notaversion')).toThrow('Invalid semver');
  });
});

// ── checkPendingMigrations ───────────────────────────────────────────────────

describe('checkPendingMigrations', () => {
  let tmpDir: string;

  function writeVersionJson(versions: Record<string, string[]>): void {
    const migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, 'version.json'),
      JSON.stringify({ migrations: versions }, null, 2),
    );
  }

  function writeAppliedJson(lastApplied: string | null): void {
    const migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, '.applied.json'),
      JSON.stringify({ lastApplied }, null, 2),
    );
  }

  function createStoreDir(): void {
    fs.mkdirSync(path.join(tmpDir, 'store'), { recursive: true });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-migrations-test-'));
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── fresh clone (no .applied.json, no store/) ───────────────────────────────

  describe('fresh clone', () => {
    it('does not call process.exit', () => {
      writeVersionJson({ 'v1.0.0': ['initial-migration'] });

      checkPendingMigrations(tmpDir);

      expect(process.exit).not.toHaveBeenCalled();
    });

    it('writes .applied.json initialised to the latest version', () => {
      writeVersionJson({ 'v1.0.0': ['initial-migration'] });

      checkPendingMigrations(tmpDir);

      const appliedFile = path.join(tmpDir, 'migrations', '.applied.json');
      expect(fs.existsSync(appliedFile)).toBe(true);
      const state = JSON.parse(fs.readFileSync(appliedFile, 'utf-8'));
      expect(state.lastApplied).toBe('v1.0.0');
    });

    it('picks the highest version when multiple versions exist', () => {
      writeVersionJson({
        'v1.0.0': ['initial-migration'],
        'v1.1.0': ['add-sessions-table'],
        'v1.0.1': ['fix-index'],
      });

      checkPendingMigrations(tmpDir);

      const state = JSON.parse(
        fs.readFileSync(path.join(tmpDir, 'migrations', '.applied.json'), 'utf-8'),
      );
      expect(state.lastApplied).toBe('v1.1.0');
    });

    it('second run does not call process.exit (.applied.json now present)', () => {
      writeVersionJson({ 'v1.0.0': ['initial-migration'] });
      checkPendingMigrations(tmpDir); // first run — writes .applied.json
      createStoreDir();               // store/ appears after first real startup

      checkPendingMigrations(tmpDir); // second run

      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  // ── up to date ────────────────────────────────────────────────────────────

  describe('up to date', () => {
    it('does not call process.exit when applied matches latest', () => {
      writeVersionJson({ 'v1.0.0': ['initial-migration'] });
      writeAppliedJson('v1.0.0');

      checkPendingMigrations(tmpDir);

      expect(process.exit).not.toHaveBeenCalled();
    });

    it('does not call process.exit when applied matches latest across multiple versions', () => {
      writeVersionJson({
        'v1.0.0': ['initial-migration'],
        'v1.1.0': ['add-sessions-table'],
      });
      writeAppliedJson('v1.1.0');

      checkPendingMigrations(tmpDir);

      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  // ── pending migrations ────────────────────────────────────────────────────

  describe('pending migrations', () => {
    it('calls process.exit(1) when applied is behind latest', () => {
      writeVersionJson({
        'v1.0.0': ['initial-migration'],
        'v1.1.0': ['add-sessions-table'],
      });
      writeAppliedJson('v1.0.0');

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('includes applied and latest versions in the error message', () => {
      writeVersionJson({
        'v1.0.0': ['initial-migration'],
        'v1.1.0': ['add-sessions-table'],
      });
      writeAppliedJson('v1.0.0');

      checkPendingMigrations(tmpDir);

      const msg = vi.mocked(console.error).mock.calls[0]?.[0] as string;
      expect(msg).toContain('v1.0.0');
      expect(msg).toContain('v1.1.0');
    });
  });

  // ── pre-migration install (no .applied.json but store/ exists) ─────────────

  describe('pre-migration install', () => {
    it('calls process.exit(1) when store/ exists but .applied.json does not', () => {
      writeVersionJson({ 'v1.0.0': ['initial-migration'] });
      createStoreDir();

      checkPendingMigrations(tmpDir);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('error message shows applied as none', () => {
      writeVersionJson({ 'v1.0.0': ['initial-migration'] });
      createStoreDir();

      checkPendingMigrations(tmpDir);

      const msg = vi.mocked(console.error).mock.calls[0]?.[0] as string;
      expect(msg).toContain('none');
    });
  });

  // ── edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('missing version.json does not throw or call process.exit', () => {
      expect(() => checkPendingMigrations(tmpDir)).not.toThrow();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('empty migrations registry does not call process.exit', () => {
      writeVersionJson({});

      checkPendingMigrations(tmpDir);

      expect(process.exit).not.toHaveBeenCalled();
    });
  });
});

// ── audit log migration v1.2.4 (Phase 5, AUD-01 — Wave 0 RED) ─────────────────
//
// These cases pin the dual-write (P-4) contract for the audit_log enrichment.
// They are RED on purpose: v1.2.4 is not yet registered in version.json and the
// new columns do not yet exist in createSchema/runMigrations. Plan 02 turns
// these GREEN by registering the version and adding the columns to BOTH the
// in-memory test DB (addColumnIfMissing in runMigrations) AND the versioned
// migrations/v1.2.4/enrich-audit-log.ts for the live store.

describe('audit log migration v1.2.4', () => {
  // The exact 11 nullable columns the enrichment adds (05-PATTERNS.md Pattern A).
  // cost_usd is deliberately NOT here: cost is resolved read-side via a JOIN on
  // token_usage (D-11 / Pitfall 5), never written onto the append-only row.
  const EXPECTED_NEW_COLUMNS = [
    'event_type',
    'tool',
    'target',
    'project',
    'decision',
    'decided_by',
    'decided_at',
    'result',
    'duration_ms',
    'model',
    'session_id',
  ];

  it('registers key "v1.2.4" mapping to ["enrich-audit-log"] in version.json', () => {
    const versionJson = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'migrations', 'version.json'),
        'utf-8',
      ),
    ) as { migrations: Record<string, string[]> };

    expect(versionJson.migrations).toHaveProperty('v1.2.4');
    expect(versionJson.migrations['v1.2.4']).toEqual(['enrich-audit-log']);
  });

  it('v1.2.4 is a clean increment over v1.2.3 (sorts immediately after it)', () => {
    const versionJson = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'migrations', 'version.json'),
        'utf-8',
      ),
    ) as { migrations: Record<string, string[]> };

    // v1.2.4 is no longer the highest version (v1.2.5 routine-scope + Phase 6's
    // v1.2.6 sit above it), but it must remain a clean increment sitting
    // directly after v1.2.3 in order.
    const ordered = Object.keys(versionJson.migrations).sort(compareSemver);
    const idx = ordered.indexOf('v1.2.4');
    expect(idx).toBeGreaterThan(0);
    expect(ordered[idx - 1]).toBe('v1.2.3');
  });

  it('applies idempotently — building the schema twice leaves all 11 new columns present exactly once', () => {
    // _initTestDatabase runs createSchema + runMigrations; calling it twice
    // exercises the addColumnIfMissing idempotency guard.
    _initTestDatabase();
    _initTestDatabase();

    const cols = (
      getDb().prepare(`PRAGMA table_info(audit_log)`).all() as Array<{ name: string }>
    ).map((c) => c.name);

    for (const col of EXPECTED_NEW_COLUMNS) {
      expect(cols, `audit_log should have column "${col}"`).toContain(col);
      expect(
        cols.filter((c) => c === col).length,
        `column "${col}" should appear exactly once (idempotent ADD COLUMN)`,
      ).toBe(1);
    }
  });

  it('does NOT add a cost_usd column to audit_log (cost is resolved read-side via JOIN, D-11)', () => {
    _initTestDatabase();

    const cols = (
      getDb().prepare(`PRAGMA table_info(audit_log)`).all() as Array<{ name: string }>
    ).map((c) => c.name);

    expect(cols).not.toContain('cost_usd');
  });
});

// ── memory surface migration v1.2.6 (Phase 6, MEM-01/MEM-02 — Wave 0 RED) ──────
//
// These cases pin the v1.2.6 dual-write (P-4) contract for the memory surface:
//   - D-06: a `category` column (TEXT, nullable) on memories.
//   - D-04: a `confirmed` column (INTEGER NOT NULL DEFAULT 0) on memories.
//   - D-08: a `memory_tombstones` table for provable no-re-derivation.
//
// Originally authored as v1.2.5, renumbered to v1.2.6 after main's
// add-routine-project-scope claimed v1.2.5 first (merge reconciliation).
// Plan 02 registers the version and adds the columns/table to BOTH the
// in-memory test DB (PRAGMA-guarded ADDs in runMigrations) AND the versioned
// migrations/v1.2.6/<name>.ts for the live store (byte-identical names/types,
// Pitfall 1).

describe('memory surface migration v1.2.6', () => {
  it('registers a "v1.2.6" key in version.json mapping to a one-element migration list', () => {
    const versionJson = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'migrations', 'version.json'),
        'utf-8',
      ),
    ) as { migrations: Record<string, string[]> };

    expect(versionJson.migrations).toHaveProperty('v1.2.6');
    expect(Array.isArray(versionJson.migrations['v1.2.6'])).toBe(true);
    expect(versionJson.migrations['v1.2.6']).toHaveLength(1);
  });

  it('v1.2.6 sorts after v1.2.5 in the registry', () => {
    const versionJson = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'migrations', 'version.json'),
        'utf-8',
      ),
    ) as { migrations: Record<string, string[]> };

    const versions = Object.keys(versionJson.migrations).sort(compareSemver);
    expect(versions.indexOf('v1.2.6')).toBeGreaterThan(versions.indexOf('v1.2.5'));
  });

  it('adds category (TEXT, nullable) + confirmed (INTEGER NOT NULL DEFAULT 0) to memories, idempotently', () => {
    // _initTestDatabase runs createSchema + runMigrations; calling it twice
    // exercises the PRAGMA-guarded ADD COLUMN idempotency (no drift, no throw).
    _initTestDatabase();
    _initTestDatabase();

    const cols = getDb().prepare(`PRAGMA table_info(memories)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;

    const category = cols.find((c) => c.name === 'category');
    expect(category, 'memories should have a "category" column').toBeTruthy();
    expect(category?.type.toUpperCase()).toBe('TEXT');
    expect(category?.notnull, 'category must be nullable').toBe(0);

    const confirmed = cols.find((c) => c.name === 'confirmed');
    expect(confirmed, 'memories should have a "confirmed" column').toBeTruthy();
    expect(confirmed?.type.toUpperCase()).toBe('INTEGER');
    expect(confirmed?.notnull, 'confirmed must be NOT NULL').toBe(1);
    expect(String(confirmed?.dflt_value), 'confirmed default must be 0').toBe('0');

    // Each new column appears exactly once (idempotent ADD COLUMN, no duplicate).
    expect(cols.filter((c) => c.name === 'category')).toHaveLength(1);
    expect(cols.filter((c) => c.name === 'confirmed')).toHaveLength(1);
  });

  it('creates a memory_tombstones table with the documented shape + (chat_id, text_hash) index, idempotently', () => {
    _initTestDatabase();
    _initTestDatabase();
    const db = getDb();

    const tombCols = db.prepare(`PRAGMA table_info(memory_tombstones)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const tombColNames = tombCols.map((c) => c.name);

    // id, chat_id, text_hash (TEXT NOT NULL), embedding (TEXT), summary (TEXT), created_at.
    for (const col of ['id', 'chat_id', 'text_hash', 'embedding', 'summary', 'created_at']) {
      expect(tombColNames, `memory_tombstones should have column "${col}"`).toContain(col);
    }
    const textHash = tombCols.find((c) => c.name === 'text_hash');
    expect(textHash?.type.toUpperCase()).toBe('TEXT');
    expect(textHash?.notnull, 'text_hash must be NOT NULL').toBe(1);

    // An index covering (chat_id, text_hash) so the suppression lookup is fast.
    const indexes = db.prepare(`PRAGMA index_list(memory_tombstones)`).all() as Array<{ name: string }>;
    const hasCompositeIndex = indexes.some((idx) => {
      const idxCols = (
        db.prepare(`PRAGMA index_info(${idx.name})`).all() as Array<{ name: string }>
      ).map((c) => c.name);
      return idxCols.includes('chat_id') && idxCols.includes('text_hash');
    });
    expect(hasCompositeIndex, 'expected an index on (chat_id, text_hash)').toBe(true);
  });

  it('drift guard: createSchema/runMigrations adds the same artifacts the migration would (no schema drift, Pitfall 1)', () => {
    // The in-memory DB built by _initTestDatabase (createSchema + runMigrations)
    // MUST carry the exact same column names the versioned migration adds. If the
    // dual-write halves drift, the live service crash-loops on the next restart.
    _initTestDatabase();
    const memCols = (
      getDb().prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>
    ).map((c) => c.name);

    expect(memCols).toContain('category');
    expect(memCols).toContain('confirmed');
  });
});

describe('channel pairings migration v1.2.9', () => {
  it('registers key "v1.2.9" mapping to ["create-channel-pairings"] in version.json', () => {
    const versionJson = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'migrations', 'version.json'),
        'utf-8',
      ),
    ) as { migrations: Record<string, string[]> };

    expect(versionJson.migrations).toHaveProperty('v1.2.9');
    expect(versionJson.migrations['v1.2.9']).toEqual(['create-channel-pairings']);
  });

  it('v1.2.9 is the highest registered version', () => {
    const versionJson = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'migrations', 'version.json'),
        'utf-8',
      ),
    ) as { migrations: Record<string, string[]> };

    const highest = Object.keys(versionJson.migrations).sort(compareSemver).pop();
    expect(highest).toBe('v1.2.9');
  });
});
