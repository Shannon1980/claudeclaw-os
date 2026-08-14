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
