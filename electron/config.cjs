// Shared config helpers for the ClaudeClaw desktop shell.
//
// The service owns real config parsing (src/config.ts, src/env.ts). These
// helpers exist so the shell can do three things without booting the service:
//   1. read the dashboard port/token to build the URL it loads,
//   2. decide on first run whether the assistant is configured yet,
//   3. write the same .env the service reads (process.cwd()/.env), owning auth
//      precedence so OAuth and an API key never fight (the stale-key crash-loop).
//
// CommonJS, no deps — mirrors the format setup.ts writes so the terminal and
// desktop paths stay interchangeable.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Resolve the canonical .env path. In a packaged .app the shell sets
// CLAUDECLAW_DATA_DIR to a writable per-user dir; the .env lives there (mirrors
// src/env.ts so the desktop and service paths read the same file). Callers that
// already know the path pass it explicitly; this is the fallback when they do
// not (so config.cjs never accidentally reads the read-only bundle's .env).
function resolveEnvPath() {
  const dataDir = process.env.CLAUDECLAW_DATA_DIR;
  if (dataDir) return path.join(dataDir, '.env');
  return path.join(process.cwd(), '.env');
}

// Parse a .env file into a flat key→value map. Strips comments and surrounding
// quotes, mirroring src/env.ts. Missing file → empty map.
function parseEnvFile(envPath) {
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// Read specific keys, preferring process.env then the .env file.
function readEnv(envPath, keys) {
  const fileVals = parseEnvFile(envPath || resolveEnvPath());
  const out = {};
  for (const key of keys) out[key] = process.env[key] || fileVals[key] || '';
  return out;
}

// Merge updates into the existing .env and write it back. Existing keys are
// preserved; `updates` overwrites matching keys. A key set to null/undefined is
// removed (used to clear ANTHROPIC_API_KEY when switching to OAuth). Secrets are
// written 0600.
function writeEnv(envPath, updates) {
  envPath = envPath || resolveEnvPath();
  const existing = parseEnvFile(envPath);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === undefined || v === '') delete existing[k];
    else existing[k] = String(v);
  }
  const header = [
    '# ClaudeClaw — managed by the desktop app.',
    '# You can edit this, but the app may rewrite it.',
    '',
  ];
  const body = Object.entries(existing).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(envPath, header.concat(body).join('\n') + '\n', { mode: 0o600 });
}

// Has the operator finished enough setup that the service will actually boot?
// The service exits(1) without a transport, so that is the gate. The dashboard
// token / encryption key are app-generated at finish() and not required here.
function isConfigured(envPath) {
  const e = parseEnvFile(envPath || resolveEnvPath());
  const slack = e.SLACK_BOT_TOKEN && e.SLACK_APP_TOKEN;
  const telegram = e.TELEGRAM_BOT_TOKEN;
  return Boolean(slack || telegram);
}

// Is the Claude CLI installed? Returns { ok, version }.
function checkClaudeCli() {
  try {
    const version = execFileSync('claude', ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
    })
      .toString()
      .trim();
    return { ok: true, version };
  } catch {
    return { ok: false, version: '' };
  }
}

// Is the user logged in to Claude? Heuristic shared with setup.ts: ~/.claude
// exists with more than the empty-dir marker. Not authoritative, but matches
// the existing check so the two paths agree.
function checkLogin() {
  try {
    const dir = path.join(os.homedir(), '.claude');
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 1;
  } catch {
    return false;
  }
}

// Generate a random hex token (dashboard token, db encryption key).
function generateHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
  parseEnvFile,
  resolveEnvPath,
  readEnv,
  writeEnv,
  isConfigured,
  checkClaudeCli,
  checkLogin,
  generateHex,
};
