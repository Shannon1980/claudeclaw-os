// D-12 auth-event emission seam (Phase 5 Audit, Slice C).
//
// checkOAuthHealth determines an alert level (none | warning | expired) from the
// OAuth credentials it can read. At each determination it now emits exactly one
// audit({action:'auth'}) through the single audit() choke point. This is the
// REAL automated coverage for the auth row (not manual-only): we stub the
// module-level audit() callback via setAuditCallback and assert the emitted
// entry shape for each alert level.
//
// The credentials read + env read are injected (checkOAuthHealthForTest deps) so
// the test drives each branch without touching ~/.claude/.credentials.json.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setAuditCallback, type AuditEntry } from './security.js';
import { checkOAuthHealth } from './oauth-health.js';

const HOUR_MS = 60 * 60 * 1000;

describe('checkOAuthHealth emits an auth audit event per alert level (D-12)', () => {
  let entries: AuditEntry[];
  beforeEach(() => {
    entries = [];
    setAuditCallback((e) => entries.push(e));
  });

  function authEvents() {
    return entries.filter((e) => e.action === ('auth' as AuditEntry['action']));
  }

  it("emits level='none', blocked=false when the token is healthy", async () => {
    await checkOAuthHealth(vi.fn(async () => {}), {
      readEnv: () => ({}),
      readCredentials: () => ({ claudeAiOauth: { expiresAt: Date.now() + 48 * HOUR_MS } }),
      credentialsFileExists: () => true,
      alertThresholdMs: 2 * HOUR_MS,
    });

    const ev = authEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0].eventType).toBe('auth');
    expect(ev[0].blocked).toBe(false);
    const detail = JSON.parse(ev[0].detail);
    expect(detail).toMatchObject({ event: 'oauth_check', level: 'none' });
  });

  it("emits level='warning', blocked=false when the token expires within the threshold", async () => {
    await checkOAuthHealth(vi.fn(async () => {}), {
      readEnv: () => ({}),
      readCredentials: () => ({ claudeAiOauth: { expiresAt: Date.now() + 1 * HOUR_MS } }),
      credentialsFileExists: () => true,
      alertThresholdMs: 2 * HOUR_MS,
    });

    const ev = authEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0].blocked).toBe(false);
    expect(JSON.parse(ev[0].detail)).toMatchObject({ event: 'oauth_check', level: 'warning' });
  });

  it("emits level='expired', blocked=true when the token has expired", async () => {
    await checkOAuthHealth(vi.fn(async () => {}), {
      readEnv: () => ({}),
      readCredentials: () => ({ claudeAiOauth: { expiresAt: Date.now() - 1 * HOUR_MS } }),
      credentialsFileExists: () => true,
      alertThresholdMs: 2 * HOUR_MS,
    });

    const ev = authEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0].blocked).toBe(true);
    expect(JSON.parse(ev[0].detail)).toMatchObject({ event: 'oauth_check', level: 'expired' });
  });

  it("emits level='expired' when the credentials file exists but is unreadable", async () => {
    await checkOAuthHealth(vi.fn(async () => {}), {
      readEnv: () => ({}),
      readCredentials: () => null,
      credentialsFileExists: () => true,
      alertThresholdMs: 2 * HOUR_MS,
    });

    const ev = authEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0].blocked).toBe(true);
    expect(JSON.parse(ev[0].detail)).toMatchObject({ event: 'oauth_check', level: 'expired' });
  });

  it("emits level='none' when env-based auth is configured (credentials file irrelevant)", async () => {
    await checkOAuthHealth(vi.fn(async () => {}), {
      readEnv: () => ({ ANTHROPIC_API_KEY: 'sk-something' }),
      readCredentials: () => null,
      credentialsFileExists: () => false,
      alertThresholdMs: 2 * HOUR_MS,
    });

    const ev = authEvents();
    expect(ev).toHaveLength(1);
    expect(JSON.parse(ev[0].detail)).toMatchObject({ event: 'oauth_check', level: 'none' });
  });

  it('detail never contains the token/secret material', async () => {
    await checkOAuthHealth(vi.fn(async () => {}), {
      readEnv: () => ({ ANTHROPIC_API_KEY: 'sk-super-secret-AKIA1234' }),
      readCredentials: () => null,
      credentialsFileExists: () => false,
      alertThresholdMs: 2 * HOUR_MS,
    });
    const ev = authEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0].detail).not.toContain('sk-super-secret-AKIA1234');
  });
});
