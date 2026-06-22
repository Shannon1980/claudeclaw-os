import { describe, it, expect } from 'vitest';
import {
  resolveAuthWrite,
  mergeEnv,
  isConfigured,
  activeAuthSource,
} from './desktop-config.js';

const OAUTH = 'CLAUDE_CODE_OAUTH_TOKEN';
const APIKEY = 'ANTHROPIC_API_KEY';

describe('resolveAuthWrite', () => {
  it('oauth path SETS CLAUDE_CODE_OAUTH_TOKEN and DELETES ANTHROPIC_API_KEY', () => {
    const delta = resolveAuthWrite('oauth', 'tok-123');
    expect(delta[OAUTH]).toBe('tok-123');
    expect(delta[APIKEY]).toBeNull();
  });

  it('apikey path SETS ANTHROPIC_API_KEY and DELETES CLAUDE_CODE_OAUTH_TOKEN', () => {
    const delta = resolveAuthWrite('apikey', 'sk-ant-abc');
    expect(delta[APIKEY]).toBe('sk-ant-abc');
    expect(delta[OAUTH]).toBeNull();
  });

  it('trims surrounding whitespace from the credential', () => {
    const delta = resolveAuthWrite('apikey', '  sk-ant-abc  ');
    expect(delta[APIKEY]).toBe('sk-ant-abc');
  });

  it('oauth path with empty credential clears BOTH (no half-set state)', () => {
    const delta = resolveAuthWrite('oauth', '');
    expect(delta[OAUTH]).toBeNull();
    expect(delta[APIKEY]).toBeNull();
  });

  it('apikey path with whitespace-only credential clears BOTH', () => {
    const delta = resolveAuthWrite('apikey', '   ');
    expect(delta[OAUTH]).toBeNull();
    expect(delta[APIKEY]).toBeNull();
  });

  it('oauth path with missing credential clears BOTH', () => {
    const delta = resolveAuthWrite('oauth');
    expect(delta[OAUTH]).toBeNull();
    expect(delta[APIKEY]).toBeNull();
  });

  // The load-bearing invariant from D1 / PKG-05.
  it('NEVER returns both auth vars as non-null (never-coexist invariant)', () => {
    const cases: Array<[Parameters<typeof resolveAuthWrite>[0], string | undefined]> = [
      ['oauth', 'tok'],
      ['apikey', 'key'],
      ['oauth', ''],
      ['apikey', ''],
      ['oauth', undefined],
      ['apikey', undefined],
      ['oauth', '   '],
      ['apikey', '   '],
    ];
    for (const [mode, cred] of cases) {
      const delta = resolveAuthWrite(mode, cred);
      const bothSet = delta[OAUTH] != null && delta[APIKEY] != null;
      expect(bothSet).toBe(false);
    }
  });
});

describe('mergeEnv', () => {
  it('overwrites matching keys and preserves unrelated keys', () => {
    const result = mergeEnv(
      { A: '1', B: '2', C: '3' },
      { B: 'two' }
    );
    expect(result).toEqual({ A: '1', B: 'two', C: '3' });
  });

  it('deletes keys when delta value is null', () => {
    const result = mergeEnv({ A: '1', B: '2' }, { B: null });
    expect(result).toEqual({ A: '1' });
  });

  it('deletes keys when delta value is undefined', () => {
    const result = mergeEnv({ A: '1', B: '2' }, { B: undefined });
    expect(result).toEqual({ A: '1' });
  });

  it('deletes keys when delta value is empty string', () => {
    const result = mergeEnv({ A: '1', B: '2' }, { B: '' });
    expect(result).toEqual({ A: '1' });
  });

  it('coerces non-string values to strings (mirrors config.cjs writeEnv)', () => {
    const result = mergeEnv({}, { N: 5, BFlag: true });
    expect(result).toEqual({ N: '5', BFlag: 'true' });
  });

  it('does not mutate the existing object', () => {
    const existing = { A: '1' };
    mergeEnv(existing, { A: 'changed', B: '2' });
    expect(existing).toEqual({ A: '1' });
  });

  it('applies an auth delta: oauth write clears a stale API key', () => {
    const existing = { ANTHROPIC_API_KEY: 'stale', TRANSPORT: 'slack' };
    const result = mergeEnv(existing, resolveAuthWrite('oauth', 'tok-1'));
    expect(result).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'tok-1', TRANSPORT: 'slack' });
  });
});

describe('isConfigured', () => {
  it('true when both Slack tokens present', () => {
    expect(isConfigured({ SLACK_BOT_TOKEN: 'b', SLACK_APP_TOKEN: 'a' })).toBe(true);
  });

  it('false when only one Slack token present', () => {
    expect(isConfigured({ SLACK_BOT_TOKEN: 'b' })).toBe(false);
    expect(isConfigured({ SLACK_APP_TOKEN: 'a' })).toBe(false);
  });

  it('true when Telegram token present', () => {
    expect(isConfigured({ TELEGRAM_BOT_TOKEN: 't' })).toBe(true);
  });

  it('false on empty env', () => {
    expect(isConfigured({})).toBe(false);
  });

  it('false when transport tokens are empty strings', () => {
    expect(isConfigured({ SLACK_BOT_TOKEN: '', SLACK_APP_TOKEN: '' })).toBe(false);
    expect(isConfigured({ TELEGRAM_BOT_TOKEN: '' })).toBe(false);
  });
});

describe('activeAuthSource', () => {
  it('returns none on empty env', () => {
    expect(activeAuthSource({})).toBe('none');
  });

  it('returns apikey when only ANTHROPIC_API_KEY is set', () => {
    expect(activeAuthSource({ ANTHROPIC_API_KEY: 'k' })).toBe('apikey');
  });

  it('returns oauth when only CLAUDE_CODE_OAUTH_TOKEN is set', () => {
    expect(activeAuthSource({ CLAUDE_CODE_OAUTH_TOKEN: 't' })).toBe('oauth');
  });

  // Official precedence: ANTHROPIC_API_KEY outranks CLAUDE_CODE_OAUTH_TOKEN.
  // If both somehow exist, the API key is the one the CLI actually uses.
  it('returns apikey when both are set (official precedence)', () => {
    expect(
      activeAuthSource({ ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't' })
    ).toBe('apikey');
  });

  it('treats empty-string values as absent', () => {
    expect(activeAuthSource({ ANTHROPIC_API_KEY: '', CLAUDE_CODE_OAUTH_TOKEN: '' })).toBe('none');
    expect(activeAuthSource({ ANTHROPIC_API_KEY: '', CLAUDE_CODE_OAUTH_TOKEN: 't' })).toBe('oauth');
  });
});
