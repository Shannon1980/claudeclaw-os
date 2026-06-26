import fs from 'fs';
import path from 'path';
import os from 'os';

import { logger } from './logger.js';
import { readEnvFile } from './env.js';
import { audit } from './security.js';

type Sender = (text: string) => Promise<void>;

type AlertLevel = 'none' | 'warning' | 'expired';

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');

/** Don't spam - track last alert level to avoid repeating */
let lastAlertLevel: AlertLevel = 'none';

/**
 * Injectable deps for {@link checkOAuthHealth}. Defaults read the real
 * credentials file + env; the auth-emission test seam (oauth-health.test.ts)
 * supplies in-memory readers to drive each alert level without touching
 * ~/.claude/.credentials.json. `alertThresholdMs` is resolved from env when
 * omitted (the live caller never passes it).
 */
export interface OAuthHealthDeps {
  readEnv?: (keys: string[]) => Record<string, string | undefined>;
  readCredentials?: () => Credentials | null;
  credentialsFileExists?: () => boolean;
  alertThresholdMs?: number;
}

interface Credentials {
  claudeAiOauth?: {
    expiresAt?: number;
    subscriptionType?: string;
  };
}

function readCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

function getCheckIntervalMs(): number {
  const env = readEnvFile(['OAUTH_CHECK_MINUTES']);
  const minutes = parseInt(env.OAUTH_CHECK_MINUTES || '30', 10);
  return (isNaN(minutes) || minutes < 1 ? 30 : minutes) * 60 * 1000;
}

function getAlertThresholdMs(): number {
  const env = readEnvFile(['OAUTH_ALERT_HOURS']);
  const hours = parseInt(env.OAUTH_ALERT_HOURS || '2', 10);
  return (isNaN(hours) || hours < 1 ? 2 : hours) * 60 * 60 * 1000;
}

/**
 * Emit one D-12 'auth' audit event for an OAuth health determination through the
 * single audit() choke point. detail carries ONLY the event tag + the alert
 * level — never the token, expiry, or any secret material (Pattern D / L-4).
 * Point-in-time event: durationMs is legitimately omitted → NULL → "not
 * captured" in the UI (honest, not a gap — Pattern 4).
 */
function emitAuthEvent(level: AlertLevel): void {
  audit({
    agentId: 'main',
    chatId: '',
    action: 'auth',
    eventType: 'auth',
    detail: JSON.stringify({ event: 'oauth_check', level }),
    blocked: level === 'expired',
  });
}

/**
 * Run a single OAuth health determination. Resolves an alert level
 * (none|warning|expired), emits exactly one 'auth' audit event for it (D-12),
 * and — gated by the anti-spam transition check — alerts the operator via the
 * sender on a level change.
 *
 * Exported + dependency-injected so the auth-emission seam (oauth-health.test.ts)
 * can drive each level deterministically. Per Open Q3, true SDK-internal token
 * refreshes are not observable here; we emit only at the health-check
 * determinations we control, and the UI coverage banner states the rest. We do
 * NOT fake refresh events.
 */
export async function checkOAuthHealth(sender: Sender, deps: OAuthHealthDeps = {}): Promise<void> {
  const readEnv = deps.readEnv ?? readEnvFile;
  const readCreds = deps.readCredentials ?? readCredentials;
  const credsFileExists = deps.credentialsFileExists ?? (() => fs.existsSync(CREDENTIALS_PATH));
  const alertThresholdMs = deps.alertThresholdMs ?? getAlertThresholdMs();

  // If a long-lived token or API key is configured, the credentials file is irrelevant
  const env = readEnv(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
  if (env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_API_KEY) {
    logger.debug('Using env-based auth, skipping OAuth credentials check');
    lastAlertLevel = 'none';
    emitAuthEvent('none');
    return;
  }

  const creds = readCreds();

  // No credentials file and no env-based auth: only alert if the file existed before
  // (i.e. don't spam users who use CLI OAuth and just haven't logged in yet)
  if (!creds?.claudeAiOauth?.expiresAt) {
    if (!credsFileExists()) {
      // No credentials file at all. Auth might work via other means (e.g. claude login session).
      // No determination we can stand behind → no audit event, just log.
      logger.debug('No credentials file found at %s, skipping OAuth health check', CREDENTIALS_PATH);
      return;
    }
    // File exists but is unreadable/malformed → treat as expired (a real
    // determination we control).
    emitAuthEvent('expired');
    if (lastAlertLevel !== 'expired') {
      lastAlertLevel = 'expired';
      await sender(
        '<b>OAuth Health Check</b>\n\n' +
        'Cannot read OAuth token.\n' +
        'File missing or invalid structure.\n\n' +
        'Run: <code>claude auth login</code>',
      );
    }
    return;
  }

  const expiresAt = creds.claudeAiOauth.expiresAt;
  const now = Date.now();
  const remainingMs = expiresAt - now;
  const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
  const remainingMinutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

  if (remainingMs <= 0) {
    emitAuthEvent('expired');
    if (lastAlertLevel !== 'expired') {
      lastAlertLevel = 'expired';
      logger.error({ remainingMs }, 'OAuth token EXPIRED');
      await sender(
        '<b>OAuth Health Check - TOKEN EXPIRED</b>\n\n' +
        `The OAuth token expired ${Math.abs(remainingMinutes)} minutes ago.\n` +
        'All API calls will fail until renewed.\n\n' +
        '<b>Action required:</b>\n' +
        '<code>claude auth logout && claude auth login</code>',
      );
    }
  } else if (remainingMs <= alertThresholdMs) {
    emitAuthEvent('warning');
    if (lastAlertLevel !== 'warning') {
      lastAlertLevel = 'warning';
      logger.warn({ remainingHours, remainingMinutes }, 'OAuth token expiring soon');
      await sender(
        '<b>OAuth Health Check - Expiring soon</b>\n\n' +
        `The OAuth token expires in <b>${remainingHours}h${remainingMinutes}min</b>.\n\n` +
        '<b>Recommended action:</b>\n' +
        '<code>claude auth logout && claude auth login</code>',
      );
    }
  } else {
    emitAuthEvent('none');
    if (lastAlertLevel !== 'none') {
      lastAlertLevel = 'none';
      logger.info({ remainingHours }, 'OAuth token healthy again');
    }
    logger.debug({ remainingHours, remainingMinutes }, 'OAuth token OK');
  }
}

/**
 * Start periodic OAuth health checks.
 * Monitors ~/.claude/.credentials.json for token expiration.
 * Alerts via the provided sender callback when expiration is near.
 *
 * Configure via env vars:
 * - OAUTH_CHECK_MINUTES: check interval (default 30)
 * - OAUTH_ALERT_HOURS: alert threshold before expiry (default 2)
 *
 * Automatically skips when CLAUDE_CODE_OAUTH_TOKEN is set.
 */
export function initOAuthHealthCheck(sender: Sender): void {
  const checkIntervalMs = getCheckIntervalMs();
  const alertThresholdMs = getAlertThresholdMs();

  // Initial check after 10s (let bot fully start)
  setTimeout(() => void checkOAuthHealth(sender), 10_000);

  // Periodic checks
  setInterval(() => void checkOAuthHealth(sender), checkIntervalMs);

  logger.info(
    { intervalMin: checkIntervalMs / 60_000, alertThresholdHours: alertThresholdMs / (60 * 60 * 1000) },
    'OAuth health check initialized',
  );
}
