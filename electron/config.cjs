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
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');

// ── CJS → compiled-ESM interop (MED-1) ─────────────────────────────────
// src/desktop-config.ts compiles to ESM dist/desktop-config.js (tsconfig
// module:NodeNext) and package.json declares "type":"module", so a bare
// require('../dist/desktop-config.js') from this .cjs throws ERR_REQUIRE_ESM.
// We therefore load it LAZILY via dynamic import() (allowed from CommonJS) and
// cache the module promise, so config.cjs and the unit tests share ONE auth
// precedence implementation. Callers use the async accessor loadAuthHelpers().
//   The path resolves to the real output of `npm run build` (vite build && tsc).
let _authHelpersPromise = null;
function loadAuthHelpers() {
  if (!_authHelpersPromise) {
    const compiled = path.join(__dirname, '..', 'dist', 'desktop-config.js');
    _authHelpersPromise = import(pathToFileURL(compiled).href);
  }
  return _authHelpersPromise;
}

// Convenience async wrappers so callers don't repeat the import dance. Each
// returns the same behavior as the tested src/desktop-config export.
async function resolveAuthWrite(mode, credential) {
  const m = await loadAuthHelpers();
  return m.resolveAuthWrite(mode, credential);
}
async function activeAuthSource(env) {
  const m = await loadAuthHelpers();
  return m.activeAuthSource(env);
}

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

// Read specific keys, preferring process.env then the .env file. Use this ONLY
// for non-secret operational values (e.g. DASHBOARD_PORT) where honoring an
// explicit environment override is desirable. NEVER use it for auth credentials:
// a stale inherited ANTHROPIC_API_KEY in the Electron parent env would outrank a
// fresh OAuth login written to the .env (the crash-loop trap, CR-02). Auth reads
// must go through readEnvFromFile.
function readEnv(envPath, keys) {
  const fileVals = parseEnvFile(envPath || resolveEnvPath());
  const out = {};
  for (const key of keys) out[key] = process.env[key] || fileVals[key] || '';
  return out;
}

// Read specific keys from the managed .env file ONLY (never process.env). This
// is the auth-precedence read: it keeps the desktop shell consistent with
// isConfigured/checkLogin (both file-only) so the app owns auth precedence (D1)
// and a stale exported ANTHROPIC_API_KEY cannot silently outrank a fresh OAuth
// login written to the .env (CR-02).
function readEnvFromFile(envPath, keys) {
  const fileVals = parseEnvFile(envPath || resolveEnvPath());
  const out = {};
  for (const key of keys) out[key] = fileVals[key] || '';
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

// Resolve the `claude` binary. The native installer lands it at
// ~/.local/bin/claude (RESEARCH: native install, NOT a global npm path), so we
// prefer that explicit path and only fall back to the bare name (PATH lookup)
// when the native-install location is absent. Returns the resolved invocation
// string for spawn/execFile.
function claudeBinaryPath() {
  const local = path.join(os.homedir(), '.local', 'bin', 'claude');
  if (fs.existsSync(local)) return local;
  return 'claude';
}

// Is the Claude CLI installed? Resolves the native-install path first
// (~/.local/bin/claude), then PATH, before running --version. Returns
// { ok, version }.
function checkClaudeCli() {
  try {
    const bin = claudeBinaryPath();
    const version = execFileSync(bin, ['--version'], {
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

// The native-installer invocation (curl-based, installs to ~/.local/bin/claude,
// auto-updates) — replaces the deprecated `npm i -g @anthropic-ai/claude-code`
// (RESEARCH: native installer is the same way claude is installed on this
// machine). Returns { cmd, args } for spawn. We run it through a shell so the
// curl|bash pipe works as a single streamed command.
function nativeInstallCommand() {
  return {
    cmd: '/bin/sh',
    args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'],
  };
}

// Cheap, synchronous "is a credential written to the managed .env?" hint. This
// is NOT the authoritative gate: the real check is the live auth probe in
// main.cjs (onb:verifyAuth → probeExistingAuth), which also recognizes a macOS
// Keychain login (from a prior `claude login`) where no token lives in .env.
// Reads only the app-managed .env so it agrees with what the wizard wrote; it
// returns false for a Keychain-only login, so callers must treat false as
// "unknown — probe to confirm", not "definitely signed out".
function checkLogin(envPath) {
  const e = parseEnvFile(envPath || resolveEnvPath());
  return Boolean(e.CLAUDE_CODE_OAUTH_TOKEN || e.ANTHROPIC_API_KEY);
}

// Generate a random hex token (dashboard token, db encryption key).
function generateHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = {
  parseEnvFile,
  resolveEnvPath,
  readEnv,
  readEnvFromFile,
  writeEnv,
  isConfigured,
  checkClaudeCli,
  claudeBinaryPath,
  nativeInstallCommand,
  checkLogin,
  generateHex,
  // Re-exported auth-precedence helpers (compiled src/desktop-config). Async
  // because of the CJS→ESM interop (MED-1); see loadAuthHelpers above.
  loadAuthHelpers,
  resolveAuthWrite,
  activeAuthSource,
};
