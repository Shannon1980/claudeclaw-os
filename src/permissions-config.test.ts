// Wave 0 RED tests for permissions-config (PERM-01/02 + D-11).
//
// References `./permissions-config.js`, which does NOT exist yet — the import
// failing is the intended RED state. Pins:
//   - getMode() defaults to 'balanced' when unset (D-11).
//   - setMode/getMode round-trip; setOverride/getOverrides round-trip.
//   - Malformed stored overrides JSON falls back to {} without throwing.

import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase, setDashboardSetting } from './db.js';
import {
  getMode,
  setMode,
  getOverrides,
  setOverride,
} from './permissions-config.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('permissions-config', () => {
  it('default balanced: getMode() returns balanced when permissions.mode is unset (D-11)', () => {
    expect(getMode()).toBe('balanced');
  });

  it('setMode persists and getMode reads it back', () => {
    setMode('autonomous');
    expect(getMode()).toBe('autonomous');
    setMode('cautious');
    expect(getMode()).toBe('cautious');
  });

  it('override round-trip: setOverride writes and getOverrides reads back the object', () => {
    setOverride('send', 'always');
    setOverride('post', 'ask');
    const overrides = getOverrides();
    expect(overrides).toMatchObject({ send: 'always', post: 'ask' });
  });

  it('getOverrides returns {} when no overrides are stored', () => {
    expect(getOverrides()).toEqual({});
  });

  it('malformed stored overrides JSON falls back to {} without throwing', () => {
    setDashboardSetting('permissions.overrides', '{not valid json');
    expect(() => getOverrides()).not.toThrow();
    expect(getOverrides()).toEqual({});
  });
});
