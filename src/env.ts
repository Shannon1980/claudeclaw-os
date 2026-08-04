import fs from 'fs';
import path from 'path';

/**
 * Absolute path of the .env this process reads.
 *
 * In a packaged .app the bundle is read-only, so the desktop shell points the
 * service at a writable per-user data dir via CLAUDECLAW_DATA_DIR. When set,
 * .env lives at <data-dir>/.env (where the shell's config.cjs wrote it).
 * Unset => process.cwd()/.env (unchanged dev/terminal default). The var comes
 * from the shell env, never .env itself (it locates the .env).
 *
 * Exported so non-Node children that load the .env themselves (warroom's
 * server.py) can be handed the same path instead of guessing at PROJECT_ROOT.
 */
export function resolveEnvFile(): string {
  const dataDir = process.env.CLAUDECLAW_DATA_DIR;
  return dataDir ? path.join(dataDir, '.env') : path.join(process.cwd(), '.env');
}

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  const envFile = resolveEnvFile();
  let content: string;
  try {
    content = fs.readFileSync(envFile, 'utf-8');
  } catch {
    return {};
  }

  const result: Record<string, string> = {};
  const wanted = new Set(keys);

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!wanted.has(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) result[key] = value;
  }

  return result;
}
