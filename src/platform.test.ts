import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getVenvPython, resolveVenvPython } from './platform.js';

const TMP_ROOT = '/tmp/claudeclaw-platform-test';
const BUNDLE = path.join(TMP_ROOT, 'bundle'); // stands in for a read-only PROJECT_ROOT
const DATA = path.join(TMP_ROOT, 'data'); // stands in for the writable data dir

/** Create <root>/warroom/.venv with a real interpreter file. */
function makeVenv(root: string): string {
  const python = getVenvPython(path.join(root, 'warroom', '.venv'));
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, '');
  return python;
}

describe('resolveVenvPython', () => {
  afterEach(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('reports not-found and points at the first root when nothing exists', () => {
    const result = resolveVenvPython([DATA, BUNDLE], 'warroom');
    expect(result.found).toBe(false);
    // The error message must send the operator to the writable root, not the bundle.
    expect(result.venvDir).toBe(path.join(DATA, 'warroom', '.venv'));
    expect(result.candidates).toEqual([
      path.join(DATA, 'warroom', '.venv'),
      path.join(BUNDLE, 'warroom', '.venv'),
    ]);
  });

  // The packaged-.app case: PROJECT_ROOT is read-only, so the only venv the
  // operator could create is under the data dir.
  it('finds a venv that exists only under the data dir', () => {
    const python = makeVenv(DATA);
    const result = resolveVenvPython([DATA, BUNDLE], 'warroom');
    expect(result.found).toBe(true);
    expect(result.python).toBe(python);
  });

  // The dev/terminal case before this change: venv sits next to the code.
  it('falls through to a later root when the earlier one has no venv', () => {
    const python = makeVenv(BUNDLE);
    const result = resolveVenvPython([DATA, BUNDLE], 'warroom');
    expect(result.found).toBe(true);
    expect(result.python).toBe(python);
  });

  it('prefers the earlier root when both have a venv', () => {
    const preferred = makeVenv(DATA);
    makeVenv(BUNDLE);
    expect(resolveVenvPython([DATA, BUNDLE], 'warroom').python).toBe(preferred);
  });

  // In dev DATA_DIR === PROJECT_ROOT, so a naive implementation would list the
  // same path twice in the "looked in:" hint.
  it('collapses duplicate roots', () => {
    const result = resolveVenvPython([BUNDLE, BUNDLE], 'warroom');
    expect(result.candidates).toEqual([path.join(BUNDLE, 'warroom', '.venv')]);
  });
});
