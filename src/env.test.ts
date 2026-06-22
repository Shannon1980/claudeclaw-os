import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { readEnvFile } from './env.js';

const TMP_DIR = '/tmp/claudeclaw-env-test';
const TMP_ENV = path.join(TMP_DIR, '.env');

function writeEnv(content: string): void {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(TMP_ENV, content, 'utf-8');
}

function cleanup(): void {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe('readEnvFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  function mockCwd(): void {
    vi.spyOn(process, 'cwd').mockReturnValue(TMP_DIR);
  }

  it('parses KEY=value correctly', () => {
    writeEnv('FOO=bar\nBAZ=qux\n');
    mockCwd();
    const result = readEnvFile(['FOO', 'BAZ']);
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('handles double-quoted values', () => {
    writeEnv('GREETING="hello world"\n');
    mockCwd();
    const result = readEnvFile(['GREETING']);
    expect(result).toEqual({ GREETING: 'hello world' });
  });

  it('handles single-quoted values', () => {
    writeEnv("NAME='John Doe'\n");
    mockCwd();
    const result = readEnvFile(['NAME']);
    expect(result).toEqual({ NAME: 'John Doe' });
  });

  it('ignores comment lines', () => {
    writeEnv('# This is a comment\nKEY=value\n# Another comment\n');
    mockCwd();
    const result = readEnvFile(['KEY']);
    expect(result).toEqual({ KEY: 'value' });
  });

  it('ignores blank lines', () => {
    writeEnv('\n\nKEY=value\n\n\n');
    mockCwd();
    const result = readEnvFile(['KEY']);
    expect(result).toEqual({ KEY: 'value' });
  });

  it('returns empty object if .env does not exist', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/nonexistent-dir-xyz');
    const result = readEnvFile(['FOO']);
    expect(result).toEqual({});
  });

  it('only returns requested keys', () => {
    writeEnv('A=1\nB=2\nC=3\n');
    mockCwd();
    const result = readEnvFile(['A', 'C']);
    expect(result).toEqual({ A: '1', C: '3' });
    expect(result).not.toHaveProperty('B');
  });

  it('strips surrounding whitespace from keys and values', () => {
    writeEnv('  MY_KEY  =  my_value  \n');
    mockCwd();
    const result = readEnvFile(['MY_KEY']);
    expect(result).toEqual({ MY_KEY: 'my_value' });
  });

  it('handles values containing = sign', () => {
    writeEnv('URL=https://example.com?a=1&b=2\n');
    mockCwd();
    const result = readEnvFile(['URL']);
    expect(result).toEqual({ URL: 'https://example.com?a=1&b=2' });
  });

  it('skips lines without = sign', () => {
    writeEnv('NOEQUALS\nKEY=value\n');
    mockCwd();
    const result = readEnvFile(['KEY', 'NOEQUALS']);
    expect(result).toEqual({ KEY: 'value' });
  });

  // The desktop shell (electron/config.cjs:writeEnv) prepends a managed header
  // whose lines all begin with '#'. readEnvFile must ignore them on re-read so
  // the desktop-written .env round-trips cleanly through the service's reader.
  it('ignores the managed-header lines config.cjs writeEnv produces', () => {
    writeEnv(
      '# ClaudeClaw — managed by the desktop app.\n' +
        '# You can edit this, but the app may rewrite it.\n' +
        '\n' +
        'CLAUDE_CODE_OAUTH_TOKEN=tok-123\n' +
        'TRANSPORT=slack\n'
    );
    mockCwd();
    const result = readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'TRANSPORT']);
    expect(result).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'tok-123', TRANSPORT: 'slack' });
  });

  // A null-delete in writeEnv removes the line entirely; on re-read the key must
  // be absent (not present as empty). This is the OAuth-clears-stale-key path.
  it('returns nothing for a key that was deleted (null-delete round-trip)', () => {
    // Simulates an .env after writeEnv({ ANTHROPIC_API_KEY: null }): the line
    // is gone, only the surviving keys remain.
    writeEnv(
      '# ClaudeClaw — managed by the desktop app.\n' +
        'CLAUDE_CODE_OAUTH_TOKEN=tok-123\n'
    );
    mockCwd();
    const result = readEnvFile(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);
    expect(result).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(result).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'tok-123' });
  });

  // An empty-valued key (the value side of writeEnv would never produce this,
  // but a hand-edited .env might) is treated as absent by readEnvFile.
  it('omits keys with empty values', () => {
    writeEnv('ANTHROPIC_API_KEY=\nKEY=value\n');
    mockCwd();
    const result = readEnvFile(['ANTHROPIC_API_KEY', 'KEY']);
    expect(result).toEqual({ KEY: 'value' });
  });
});
