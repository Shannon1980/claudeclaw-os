// THROWAWAY SPIKE — electron/spike-setup-token.cjs
//
// Purpose: resolve open question A1 from 01-RESEARCH.md — does
// `claude setup-token` capture a 1-year CLAUDE_CODE_OAUTH_TOKEN when spawned
// via child_process.spawn from an Electron main process (i.e. NOT a real TTY)?
//
// The answer dictates plan 03's onboarding sign-in mechanism:
//   "token captured"            => plan 03 uses the spawn+capture path
//   "NO token captured ..."     => plan 03 uses a fallback (pty wrapper, or
//                                  browser-flow + status check)
//
// This is diagnostic ONLY. It NEVER writes the token (or anything) to disk.
// On success it logs only the token's length and a short prefix, never the
// whole value, so the 1-year credential cannot leak into logs (threat T-01-01).
//
// Run from the repo root:  npx electron electron/spike-setup-token.cjs
//
// CLEANUP: delete this file once plan 03's real setup-token mechanism lands so
// the diagnostic harness never ships in the packaged app's build.files. It is
// also gitignored (see .gitignore) to keep it out of the shipped bundle.

const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TIMEOUT_MS = 120_000;
// CLAUDE_CODE_OAUTH_TOKEN values are printed by `claude setup-token`. Match the
// token-shaped line without assuming an exact prefix beyond the documented one.
const TOKEN_RE = /(sk-ant-oat[0-9A-Za-z._-]{10,})/;

// Resolve the claude binary: native-install path first, then PATH.
function resolveClaude() {
  const native = path.join(os.homedir(), '.local', 'bin', 'claude');
  try {
    if (fs.existsSync(native)) return native;
  } catch {
    /* fall through to PATH */
  }
  return 'claude'; // rely on PATH resolution
}

function report(line) {
  // Single, greppable result line. Never includes the full token.
  console.log(line);
}

function runSpike() {
  const bin = resolveClaude();
  console.log(`[spike] spawning: ${bin} setup-token (non-TTY)`);

  let stdoutBuf = '';
  let captured = null;
  let settled = false;

  // NOTE: no `shell: true`, no TTY — this is exactly the non-interactive
  // Electron-subprocess condition A1 asks about.
  const proc = spawn(bin, ['setup-token'], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const tryCapture = (chunk) => {
    stdoutBuf += chunk;
    if (captured) return;
    const m = stdoutBuf.match(TOKEN_RE);
    if (m) captured = m[1];
  };

  proc.stdout.on('data', (b) => {
    const s = b.toString();
    // Stream OAuth prompts/URLs to the operator, but redact anything that looks
    // like a token before echoing so it never lands in logs whole.
    process.stdout.write(`[spike:stdout] ${s.replace(TOKEN_RE, '<redacted-token>')}`);
    tryCapture(s);
  });
  proc.stderr.on('data', (b) => {
    process.stderr.write(`[spike:stderr] ${b.toString()}`);
  });

  const finish = (reason) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill();
    } catch {
      /* already gone */
    }
    if (captured) {
      report(
        `SPIKE RESULT: token captured (length=${captured.length}, prefix=${captured.slice(0, 12)}…)`,
      );
      console.log('[spike] A1 ANSWERED: setup-token CAN be captured from a non-TTY Electron subprocess.');
    } else {
      report('SPIKE RESULT: NO token captured — TTY likely required');
      console.log(`[spike] A1 ANSWERED: setup-token did NOT yield a token (reason: ${reason}). Plan 03 needs a fallback.`);
    }
    // Diagnostic only — never persist the token. Exit promptly.
    app.quit();
  };

  const timer = setTimeout(() => finish('120s timeout'), TIMEOUT_MS);

  proc.on('error', (err) => {
    console.error(`[spike] spawn error: ${err.message}`);
    finish(`spawn error: ${err.message}`);
  });
  proc.on('exit', (code, signal) => {
    console.log(`[spike] process exited code=${code} signal=${signal}`);
    finish(`exit code=${code} signal=${signal}`);
  });
}

app.whenReady().then(runSpike);

// Keep the app alive until the spike settles; quit explicitly in finish().
app.on('window-all-closed', () => {
  /* no windows opened by this spike — do nothing */
});
