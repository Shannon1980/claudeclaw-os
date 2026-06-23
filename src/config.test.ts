import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

// config.ts computes STORE_DIR at module-eval time from process.env. To test
// the CLAUDECLAW_DATA_DIR override we reset the module registry and re-import
// with the env var set/unset, asserting STORE_DIR resolves accordingly.

const HERE = path.dirname(fileURLToPath(import.meta.url)); // .../src
const PROJECT_ROOT = path.resolve(HERE, '..');
const DEFAULT_STORE_DIR = path.resolve(PROJECT_ROOT, 'store');

describe('STORE_DIR data-dir resolution (CLAUDECLAW_DATA_DIR)', () => {
  const saved = process.env.CLAUDECLAW_DATA_DIR;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDECLAW_DATA_DIR;
    else process.env.CLAUDECLAW_DATA_DIR = saved;
    vi.restoreAllMocks();
  });

  it('resolves STORE_DIR under PROJECT_ROOT/store when CLAUDECLAW_DATA_DIR is unset (no regression)', async () => {
    delete process.env.CLAUDECLAW_DATA_DIR;
    const mod = await import('./config.js');
    expect(mod.STORE_DIR).toBe(DEFAULT_STORE_DIR);
  });

  it('resolves STORE_DIR under <CLAUDECLAW_DATA_DIR>/store when the shell sets it', async () => {
    const dataDir = '/tmp/claudeclaw-datadir-test';
    process.env.CLAUDECLAW_DATA_DIR = dataDir;
    const mod = await import('./config.js');
    expect(mod.STORE_DIR).toBe(path.join(dataDir, 'store'));
  });

  it('leaves PROJECT_ROOT pointing at the code dir even when CLAUDECLAW_DATA_DIR is set', async () => {
    process.env.CLAUDECLAW_DATA_DIR = '/tmp/claudeclaw-datadir-test';
    const mod = await import('./config.js');
    expect(mod.PROJECT_ROOT).toBe(PROJECT_ROOT);
  });
});
