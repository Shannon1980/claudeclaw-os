import fs from 'fs';
import os from 'os';
import path from 'path';

import { logger } from './logger.js';

/** Always /tmp so launchd and paths-with-spaces cannot hide the file. */
export const DEFAULT_CRASH_LOG = path.join(os.tmpdir(), 'claudeclaw-service-crash.log');

export function formatCrashRecord(kind: string, err: unknown, at = new Date()): string {
  const message = err instanceof Error ? (err.stack || err.message) : String(err);
  return `[${at.toISOString()}] ${kind}: ${message}\n`;
}

export function writeCrashLog(kind: string, err: unknown, file = DEFAULT_CRASH_LOG): void {
  try {
    fs.appendFileSync(file, formatCrashRecord(kind, err), { mode: 0o600 });
  } catch {
    /* never throw from a crash reporter */
  }
}

/**
 * Node 15+ exits on unhandledRejection. That is what leaves Mission Control
 * on a dead SPA (connection reset, then connection refused) with no log.
 * Swallow the rejection after writing a crash file so the dashboard stays up.
 * Uncaught exceptions still exit; the Electron shell respawns the child.
 */
export function installProcessGuards(opts?: { crashLog?: string }): void {
  const file = opts?.crashLog ?? DEFAULT_CRASH_LOG;
  process.on('unhandledRejection', (reason) => {
    writeCrashLog('unhandledRejection', reason, file);
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    writeCrashLog('uncaughtException', err, file);
    logger.error({ err }, 'Uncaught exception');
    process.exit(1);
  });
}
