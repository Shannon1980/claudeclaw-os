/**
 * Pure auth-precedence + .env-merge helpers for the ClaudeClaw desktop shell.
 *
 * These formalize the precedence rule currently inlined in
 * electron/main.cjs `onb:saveAuth` (per decision D1, requirement PKG-05) and the
 * merge semantics of electron/config.cjs `writeEnv`. They operate on plain
 * objects only — no filesystem, no process.env — so they are unit-testable
 * without I/O. Plan 03 wires electron/config.cjs to re-export these.
 *
 * The load-bearing invariant: the two Claude auth env vars
 * (ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN) must NEVER both hold a
 * non-null value, because a stale ANTHROPIC_API_KEY silently outranks an OAuth
 * login (the known crash-loop trap).
 *
 * Official auth precedence order (code.claude.com/docs/en/authentication):
 *   1. cloud-provider creds (Bedrock/Vertex/Foundry)
 *   2. ANTHROPIC_AUTH_TOKEN
 *   3. ANTHROPIC_API_KEY
 *   4. apiKeyHelper output
 *   5. CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`)
 *   6. subscription OAuth from /login
 * For this phase's two-way OAuth-vs-API-key choice, ANTHROPIC_API_KEY outranks
 * CLAUDE_CODE_OAUTH_TOKEN — that ordering drives activeAuthSource below.
 */

export const ANTHROPIC_API_KEY = 'ANTHROPIC_API_KEY';
export const CLAUDE_CODE_OAUTH_TOKEN = 'CLAUDE_CODE_OAUTH_TOKEN';

export type AuthMode = 'oauth' | 'apikey';

/** A delta applied to an env map: string = set, null = delete. */
export type EnvDelta = Record<string, string | null>;

export type EnvMap = Record<string, string>;

/**
 * Resolve the env-delta for choosing an auth mode. The chosen credential's var
 * is the ONLY auth var set; the other is always cleared (null). A missing or
 * blank credential clears BOTH, so there is never a half-set state.
 */
export function resolveAuthWrite(mode: AuthMode, credential?: string): EnvDelta {
  const value = (credential ?? '').trim();

  if (mode === 'oauth') {
    return {
      [CLAUDE_CODE_OAUTH_TOKEN]: value || null,
      [ANTHROPIC_API_KEY]: null,
    };
  }
  // mode === 'apikey'
  return {
    [ANTHROPIC_API_KEY]: value || null,
    [CLAUDE_CODE_OAUTH_TOKEN]: null,
  };
}

/**
 * Merge a delta into an existing env map, returning a NEW map (no mutation).
 * null / undefined / '' delete the key; other values are coerced to strings and
 * overwrite. Unrelated keys are preserved. Mirrors config.cjs writeEnv merge.
 */
export function mergeEnv(existing: EnvMap, delta: EnvDelta | Record<string, unknown>): EnvMap {
  const out: EnvMap = { ...existing };
  for (const [key, value] of Object.entries(delta)) {
    if (value === null || value === undefined || value === '') {
      delete out[key];
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

/**
 * Has the operator configured enough that the service will boot? A transport is
 * the gate: both Slack tokens, OR a Telegram token. Mirrors config.cjs:isConfigured.
 */
export function isConfigured(env: EnvMap): boolean {
  const slack = Boolean(env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN);
  const telegram = Boolean(env.TELEGRAM_BOT_TOKEN);
  return slack || telegram;
}

/**
 * Which auth source the CLI will actually use, for Settings > Account (D1).
 * Follows the official precedence order: ANTHROPIC_API_KEY outranks
 * CLAUDE_CODE_OAUTH_TOKEN. Empty-string values count as absent.
 */
export function activeAuthSource(env: EnvMap): AuthMode | 'none' {
  if (env[ANTHROPIC_API_KEY]) return 'apikey';
  if (env[CLAUDE_CODE_OAUTH_TOKEN]) return 'oauth';
  return 'none';
}
