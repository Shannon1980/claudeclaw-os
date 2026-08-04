/**
 * Structured error taxonomy for ClaudeClaw agent failures.
 *
 * Classifies errors from the Claude Code SDK into actionable categories
 * with recovery hints, so the user gets helpful messages instead of
 * "Something went wrong."
 */

export type ErrorCategory =
  | 'auth'
  | 'stale_session'
  | 'rate_limit'
  | 'session_limit'
  | 'context_exhausted'
  | 'timeout'
  | 'subprocess_crash'
  | 'network'
  | 'billing'
  | 'overloaded'
  | 'unknown';

export interface ErrorRecovery {
  shouldRetry: boolean;
  shouldNewChat: boolean;
  shouldSwitchModel: boolean;
  retryAfterMs: number;
  userMessage: string;
}

export class AgentError extends Error {
  category: ErrorCategory;
  recovery: ErrorRecovery;
  originalError: Error | undefined;

  constructor(category: ErrorCategory, recovery: ErrorRecovery, originalError?: Error) {
    super(recovery.userMessage);
    this.name = 'AgentError';
    this.category = category;
    this.recovery = recovery;
    this.originalError = originalError;
  }
}

// ── Pattern matchers ────────────────────────────────────────────────

const AUTH_PATTERNS = [
  'authentication',
  'unauthorized',
  'invalid api key',
  'invalid x-api-key',
  'api key not found',
  'not authenticated',
  'permission denied',
  'oauth',
  'token expired',
  'invalid_grant',
  'login required',
];

// The stored session id points at a transcript the CLI can't find, so
// `--resume` fails before a single token is spent. This happens whenever the
// SDK cwd changes (dev checkout -> packaged .app, or a moved repo): the
// transcript lives under ~/.claude/projects/<slug-of-cwd>/ and the new slug
// has no such file. Zero cost + immediate exit makes it look exactly like a
// rejected credential, so it MUST be matched before the auth default.
const STALE_SESSION_PATTERNS = [
  'no conversation found',
  'no conversation with session id',
  'session id not found',
  'could not find session',
];

const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'rate_limit',
  'too many requests',
  'throttled',
  'requests per minute',
  '429',
];

const BILLING_PATTERNS = [
  'insufficient credits',
  'credits exhausted',
  'payment required',
  'billing',
  'quota exceeded',
  '402',
];

// claude.ai account-level caps (Pro/Max plans). The CLI prints things like
// "You've hit your session limit · resets 9:50pm" or "usage limit reached".
// This is an account usage cap, NOT a credentials or billing problem, so it
// gets its own category to avoid sending debugging down the wrong path.
const SESSION_LIMIT_PATTERNS = [
  'session limit',
  'usage limit',
  'hit your limit',
  'reached your limit',
  'limit reached',
  'limit will reset',
  'limit resets',
];

const OVERLOADED_PATTERNS = [
  'overloaded',
  'service unavailable',
  'capacity',
  '529',
  '503',
];

const NETWORK_PATTERNS = [
  'enotfound',
  'econnrefused',
  'econnreset',
  'etimedout',
  'socket hang up',
  'network',
  'dns',
  'fetch failed',
  'certificate',
];

const TIMEOUT_PATTERNS = [
  'timed out',
  'timeout',
  'deadline exceeded',
];

const CONTEXT_PATTERNS = [
  'context length',
  'context window',
  'max_tokens',
  'maximum tokens',
  'max input tokens',
  'too long',
  'token limit',
];

function matchesAny(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

/**
 * Pull a reset time out of a session-limit message if the CLI included one,
 * e.g. "resets 9:50pm" or "resets at 21:50". Returns null when absent.
 */
function extractResetTime(text: string): string | null {
  const match = text.match(/reset[s]?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  return match ? match[1].trim() : null;
}

/**
 * Build the AgentError for a claude.ai account usage cap. Account caps are not
 * retryable here (the cap resets on the account's clock, not in seconds), and
 * they are explicitly NOT a credentials problem.
 */
/**
 * Build the AgentError for a `--resume` against a transcript the CLI can't
 * find. Recoverable without user action: the caller drops the stored session
 * id and re-runs the same turn as a fresh session, so it is marked retryable
 * with no backoff.
 */
function staleSessionError(raw: Error): AgentError {
  return new AgentError('stale_session', {
    shouldRetry: true,
    shouldNewChat: true,
    shouldSwitchModel: false,
    retryAfterMs: 0,
    userMessage:
      'Previous chat session was gone (its transcript no longer exists for this '
      + 'working directory). Starting a fresh session — prior context is lost.',
  }, raw);
}

function sessionLimitError(text: string, raw: Error): AgentError {
  const resetTime = extractResetTime(text);
  const resetClause = resetTime ? ` (resets ${resetTime})` : '';
  return new AgentError('session_limit', {
    shouldRetry: false,
    shouldNewChat: false,
    shouldSwitchModel: false,
    retryAfterMs: 0,
    userMessage:
      `Claude session/usage limit reached${resetClause}. `
      + 'This is an account usage cap, not a credentials problem. '
      + 'Wait for the limit to reset, or switch to an API key with available credits.',
  }, raw);
}

// ── Classification ──────────────────────────────────────────────────

/**
 * Classify a raw error from the Claude Code SDK into a structured AgentError.
 * Parses the error message and any stderr output for known patterns.
 * If the error is already an AgentError, returns it unchanged.
 */
export function classifyError(
  err: unknown,
  contextTokens?: number,
  resultError?: {
    isError?: boolean;
    apiErrorStatus?: string;
    resultText?: string | null;
    assistantText?: string | null;
  },
): AgentError {
  // Pass through already-classified errors
  if (err instanceof AgentError) return err;

  const raw = err instanceof Error ? err : new Error(String(err));
  const text = raw.message;

  // A session/usage cap notice ("You've hit your session limit") is printed by
  // the CLI to stdout / the last assistant message, not necessarily to
  // err.message or the result envelope. Captured assistant text is threaded in
  // here so the cap is recognised before it falls through to the crash or auth
  // defaults below.
  const assistantText = resultError?.assistantText ?? '';

  // A `result` event arrived with is_error:true *before* the subprocess
  // exited non-zero. The exit code alone looks like a crash (handled below),
  // but the real cause is an API-level rejection — most often auth: a
  // stale/expired ANTHROPIC_API_KEY in .env overriding `claude login`,
  // which yields a zero-cost "success"-subtype result with is_error:true and
  // then exit code 1. Classify from the API error detail so the user gets an
  // actionable message instead of an endless "subprocess crashed. Retrying...".
  // A stale `--resume` id fails identically to a rejected credential (zero
  // cost, immediate exit), so it is checked first, against both the raw error
  // and the result envelope.
  const resumeText = `${text} ${resultError?.resultText ?? ''} ${assistantText}`;
  if (matchesAny(resumeText, STALE_SESSION_PATTERNS)) {
    return staleSessionError(raw);
  }

  if (resultError?.isError) {
    const apiText = `${resultError.apiErrorStatus ?? ''} ${resultError.resultText ?? ''} ${assistantText}`.trim();
    // Check session/usage caps before rate_limit and the auth default: a
    // claude.ai cap can surface as a 429 but is an account cap, not credentials.
    if (matchesAny(apiText, SESSION_LIMIT_PATTERNS)) {
      return sessionLimitError(apiText, raw);
    }
    if (matchesAny(apiText, RATE_LIMIT_PATTERNS)) {
      return new AgentError('rate_limit', {
        shouldRetry: true,
        shouldNewChat: false,
        shouldSwitchModel: false,
        retryAfterMs: 30000,
        userMessage: 'Rate limited. Retrying in 30s...',
      }, raw);
    }
    if (matchesAny(apiText, OVERLOADED_PATTERNS)) {
      return new AgentError('overloaded', {
        shouldRetry: true,
        shouldNewChat: false,
        shouldSwitchModel: true,
        retryAfterMs: 5000,
        userMessage: 'Model is overloaded. Retrying...',
      }, raw);
    }
    if (matchesAny(apiText, BILLING_PATTERNS)) {
      return new AgentError('billing', {
        shouldRetry: false,
        shouldNewChat: false,
        shouldSwitchModel: true,
        retryAfterMs: 0,
        userMessage: 'API credits exhausted or billing issue. Check your Anthropic account, or try a different model.',
      }, raw);
    }
    // No more specific signal: a request that errored with zero cost is
    // overwhelmingly a credentials problem. Don't retry — retrying re-sends
    // the same bad credential. Point at the most common fix.
    return new AgentError('auth', {
      shouldRetry: false,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage:
        'Claude Code rejected the request (likely invalid or expired credentials). '
        + 'If ANTHROPIC_API_KEY is set in .env, remove or refresh it so the bot falls '
        + 'back to `claude login`, then restart.',
    }, raw);
  }

  // A usage cap can also surface as a bare exit-1 with no is_error result: the
  // cap text lands only in the subprocess stdout / last assistant message. Check
  // it before the exit-code branches so it isn't misread as a crash to retry.
  if (assistantText && matchesAny(assistantText, SESSION_LIMIT_PATTERNS)) {
    return sessionLimitError(assistantText, raw);
  }

  // Context exhaustion: process exits with code 1 when context is full
  if (text.includes('exited with code 1') && contextTokens && contextTokens > 0) {
    return new AgentError('context_exhausted', {
      shouldRetry: false,
      shouldNewChat: true,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: `Context window likely exhausted (~${Math.round(contextTokens / 1000)}k tokens). Use /newchat to start fresh, then /respin to pull recent conversation back in.`,
    }, raw);
  }

  // Subprocess crash without context data
  if (text.includes('exited with code 1')) {
    return new AgentError('subprocess_crash', {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 2000,
      userMessage: 'Claude Code subprocess crashed. Retrying...',
    }, raw);
  }

  if (text.includes('exited with code')) {
    return new AgentError('subprocess_crash', {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 2000,
      userMessage: 'Claude Code subprocess exited unexpectedly. Retrying...',
    }, raw);
  }

  // Session/usage caps come before auth and rate_limit: the claude.ai CLI
  // prints "You've hit your session limit" with no auth signal, and a cap can
  // also arrive as a 429. Classifying it as auth would send the user chasing a
  // credentials problem that doesn't exist.
  if (matchesAny(text, SESSION_LIMIT_PATTERNS)) {
    return sessionLimitError(text, raw);
  }

  if (matchesAny(text, AUTH_PATTERNS)) {
    return new AgentError('auth', {
      shouldRetry: false,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: 'Authentication failed. Run `claude login` in your terminal to re-authenticate.',
    }, raw);
  }

  if (matchesAny(text, BILLING_PATTERNS)) {
    return new AgentError('billing', {
      shouldRetry: false,
      shouldNewChat: false,
      shouldSwitchModel: true,
      retryAfterMs: 0,
      userMessage: 'API credits exhausted or billing issue. Check your Anthropic account, or try a different model.',
    }, raw);
  }

  if (matchesAny(text, RATE_LIMIT_PATTERNS)) {
    return new AgentError('rate_limit', {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 30000,
      userMessage: 'Rate limited. Retrying in 30s...',
    }, raw);
  }

  if (matchesAny(text, OVERLOADED_PATTERNS)) {
    return new AgentError('overloaded', {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: true,
      retryAfterMs: 5000,
      userMessage: 'Model is overloaded. Retrying...',
    }, raw);
  }

  if (matchesAny(text, NETWORK_PATTERNS)) {
    return new AgentError('network', {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 3000,
      userMessage: 'Network error. Check your connection. Retrying...',
    }, raw);
  }

  if (matchesAny(text, TIMEOUT_PATTERNS)) {
    return new AgentError('timeout', {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 2000,
      userMessage: 'Request timed out. Retrying...',
    }, raw);
  }

  if (matchesAny(text, CONTEXT_PATTERNS)) {
    return new AgentError('context_exhausted', {
      shouldRetry: false,
      shouldNewChat: true,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: 'Context window limit reached. Use /newchat to start fresh.',
    }, raw);
  }

  return new AgentError('unknown', {
    shouldRetry: false,
    shouldNewChat: false,
    shouldSwitchModel: false,
    retryAfterMs: 0,
    userMessage: 'Something went wrong. Check the logs and try again.',
  }, raw);
}
