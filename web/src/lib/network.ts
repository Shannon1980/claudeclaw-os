/**
 * EventSource uses the same `error` event for a dead socket and for a
 * named SSE frame (`event: error`). Chat delivers agent failures that way
 * via ChatEvent. Only tear the stream down when this looks like transport
 * failure: readyState is no longer OPEN, and the event is not a payload
 * MessageEvent.
 */
export function shouldTearDownSseOnError(ev: Event, readyState: number): boolean {
  if (readyState === 1) return false;
  if (typeof MessageEvent !== 'undefined' && ev instanceof MessageEvent) {
    return !(typeof ev.data === 'string' && ev.data.length > 0);
  }
  return true;
}

/** Backoff for EventSource / poll retries when the API is unreachable. */
export function nextReconnectDelay(attempts: number, baseMs = 1000, maxMs = 30_000): number {
  const exp = Math.min(Math.max(0, attempts - 1), 5);
  return Math.min(maxMs, baseMs * 2 ** exp);
}

/** Map browser network failures to a line the operator can act on. */
export function networkErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed|err_connection|network request failed/i.test(raw)) {
    return "Can't reach the assistant. Is ClaudeClaw running?";
  }
  return raw;
}

/**
 * Vite's proxy turns ECONNREFUSED into HTTP 500 text/plain (empty body).
 * A live ClaudeClaw API 500 is JSON. Treat the proxy shape, plus gateway
 * statuses, as "backend is not reachable" so Mission Control doesn't
 * show "GET /api/home/summary failed: 500".
 */
export function isBackendUnreachable(status: number, contentType: string | null | undefined): boolean {
  if (status === 0 || status === 502 || status === 503 || status === 504) return true;
  if (status !== 500) return false;
  return !String(contentType || '').toLowerCase().includes('application/json');
}
