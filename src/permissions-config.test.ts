// Wave 0 RED tests for permissions-config (PERM-01/02 + D-11).
//
// References `./permissions-config.js`, which does NOT exist yet — the import
// failing is the intended RED state. Pins:
//   - getMode() defaults to 'balanced' when unset (D-11).
//   - setMode/getMode round-trip; setOverride/getOverrides round-trip.
//   - Malformed stored overrides JSON falls back to {} without throwing.

import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase, setDashboardSetting } from './db.js';
import { setAuditCallback, type AuditEntry } from './security.js';
import {
  getMode,
  setMode,
  getOverrides,
  setOverride,
  setAuditRetention,
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

// Config changes must carry eventType 'config' so the Audit surface's honest
// type chip for "config" lights up on real data, instead of these events hiding
// under the "permission" chip (which would falsely read "config: not yet
// captured" while config changes are in fact recorded). action stays
// 'permission' — the AuditAction union has no 'config' member; the type chip is
// driven by event_type.
describe('permissions-config audit eventType', () => {
  let entries: AuditEntry[];

  beforeEach(() => {
    entries = [];
    setAuditCallback((e) => entries.push(e));
  });

  it('setMode emits eventType "config"', () => {
    setMode('autonomous');
    const ev = entries.filter((e) => e.action === ('permission' as AuditEntry['action']));
    expect(ev).toHaveLength(1);
    expect(ev[0].eventType).toBe('config');
  });

  it('setOverride emits eventType "config"', () => {
    setOverride('send', 'always');
    const ev = entries.filter((e) => e.action === ('permission' as AuditEntry['action']));
    expect(ev).toHaveLength(1);
    expect(ev[0].eventType).toBe('config');
  });

  it('setAuditRetention emits eventType "config" for an accepted value', () => {
    setAuditRetention(45);
    const ev = entries.filter((e) => e.action === ('permission' as AuditEntry['action']));
    expect(ev).toHaveLength(1);
    expect(ev[0].eventType).toBe('config');
  });

  it('setAuditRetention emits no audit event for rejected (non-positive) input', () => {
    setAuditRetention(0);
    expect(entries).toHaveLength(0);
  });
});
