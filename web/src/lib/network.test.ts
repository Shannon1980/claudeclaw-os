import { describe, it, expect } from 'vitest';
import { nextReconnectDelay, networkErrorMessage } from './network';

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
