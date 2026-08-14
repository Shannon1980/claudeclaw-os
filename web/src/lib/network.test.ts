import { describe, it, expect } from 'vitest';
import { nextReconnectDelay, networkErrorMessage, isBackendUnreachable } from './network';

describe('nextReconnectDelay', () => {
  it('starts at the base interval and doubles up to the cap', () => {
    expect(nextReconnectDelay(1)).toBe(1000);
    expect(nextReconnectDelay(2)).toBe(2000);
    expect(nextReconnectDelay(3)).toBe(4000);
    expect(nextReconnectDelay(6)).toBe(30_000);
    expect(nextReconnectDelay(20)).toBe(30_000);
  });
});

describe('networkErrorMessage', () => {
  it('rewrites the browser Failed to fetch TypeError', () => {
    expect(networkErrorMessage(new TypeError('Failed to fetch'))).toBe(
      "Can't reach the assistant. Is ClaudeClaw running?",
    );
  });

  it('passes through other errors', () => {
    expect(networkErrorMessage(new Error('GET /api/health failed: 500'))).toBe(
      'GET /api/health failed: 500',
    );
  });
});

describe('isBackendUnreachable', () => {
  it('treats Vite proxy 500 text/plain as unreachable', () => {
    expect(isBackendUnreachable(500, 'text/plain')).toBe(true);
    expect(isBackendUnreachable(500, null)).toBe(true);
  });

  it('does not mask a real JSON API 500', () => {
    expect(isBackendUnreachable(500, 'application/json')).toBe(false);
    expect(isBackendUnreachable(401, 'application/json')).toBe(false);
  });

  it('treats gateway statuses as unreachable', () => {
    expect(isBackendUnreachable(502, 'text/plain')).toBe(true);
    expect(isBackendUnreachable(503, 'text/html')).toBe(true);
    expect(isBackendUnreachable(504, null)).toBe(true);
  });
});
