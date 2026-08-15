import { describe, it, expect } from 'vitest';
import { nextReconnectDelay, networkErrorMessage, isBackendUnreachable, shouldTearDownSseOnError } from './network';

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

describe('shouldTearDownSseOnError', () => {
  it('keeps a healthy stream up for application event: error', () => {
    const ev = new MessageEvent('error', { data: JSON.stringify({ type: 'error', content: 'agent failed' }) });
    expect(shouldTearDownSseOnError(ev, 1)).toBe(false);
    expect(shouldTearDownSseOnError(ev, 0)).toBe(false);
  });

  it('tears down on a transport error while connecting or closed', () => {
    const ev = new Event('error');
    expect(shouldTearDownSseOnError(ev, 0)).toBe(true);
    expect(shouldTearDownSseOnError(ev, 2)).toBe(true);
    expect(shouldTearDownSseOnError(ev, 1)).toBe(false);
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
