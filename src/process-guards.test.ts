import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { formatCrashRecord, writeCrashLog } from './process-guards.js';

const tmpFiles: string[] = [];

afterEach(() => {
  for (const file of tmpFiles) {
    try { fs.unlinkSync(file); } catch { /* ok */ }
  }
  tmpFiles.length = 0;
});

describe('formatCrashRecord', () => {
  it('includes kind, ISO time, and Error stack', () => {
    const at = new Date('2026-09-02T11:46:00.000Z');
    const err = new Error('socket hang up');
    const line = formatCrashRecord('unhandledRejection', err, at);
    expect(line).toContain('[2026-09-02T11:46:00.000Z] unhandledRejection:');
    expect(line).toContain('socket hang up');
  });

  it('stringifies non-Error reasons', () => {
    const line = formatCrashRecord('unhandledRejection', 'boom', new Date('2026-09-02T11:46:00.000Z'));
    expect(line).toBe('[2026-09-02T11:46:00.000Z] unhandledRejection: boom\n');
  });
});

describe('writeCrashLog', () => {
  it('appends a record to the crash file', () => {
    const file = path.join(os.tmpdir(), `claudeclaw-crash-test-${process.pid}.log`);
    tmpFiles.push(file);
    writeCrashLog('unhandledRejection', new Error('reset'), file);
    writeCrashLog('uncaughtException', 'gone', file);
    const body = fs.readFileSync(file, 'utf8');
    expect(body).toContain('unhandledRejection:');
    expect(body).toContain('reset');
    expect(body).toContain('uncaughtException: gone');
  });
});
