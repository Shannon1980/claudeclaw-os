import fs from 'fs';
import os from 'os';
import path from 'path';

// Resolve the .env location. Mirrors DATA_DIR in config.ts but is inlined
// here because config.ts imports this module (importing it back would be a
// cycle). When CLAUDECLAW_DATA_DIR is set (the packaged desktop app), .env
// lives in that writable dir; otherwise it stays at process.cwd() as before
// (the launchd service runs with cwd = the checkout, where .env already is).
function envFilePath(): string {
  const dir = process.env.CLAUDECLAW_DATA_DIR;
  if (dir) {
    const expanded = dir.startsWith('~/') || dir === '~'
      ? path.join(os.homedir(), dir.slice(1))
      : dir;
    return path.join(path.resolve(expanded), '.env');
  }
  return path.join(process.cwd(), '.env');
}

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  const envFile = envFilePath();
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
