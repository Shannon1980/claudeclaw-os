// ClaudeClaw desktop shell — Electron main process.
//
// Build steps 1–2 from specs/operator-product/:
//   01-foundations: launch with no terminal, bootstrap the Node service
//     internally, open the dashboard as the app window, register as a login
//     item.
//   02-onboarding: on first run (no transport configured), show a native
//     wizard that handles the Claude dependency + sign-in, picks a transport,
//     and writes the config the service reads — the operator never edits .env.
//
// The shell never reimplements backend behaviour. It spawns the same Node
// service (dist/index.js, the thing launchd used to run; tsx in dev) as a
// child, waits for the Hono dashboard to bind, then loads the existing Preact
// SPA. CommonJS so it is independent of the project's "type": "module".

const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const cfg = require('./config.cjs');

// ── App root resolution ───────────────────────────────────────────────
// In dev, the repo is the parent of this electron/ directory. In a packaged
// build the app files live under resourcesPath/app. The Node service runs with
// this as cwd so its relative paths (store/, agents/, .env) resolve as before.
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..');

// ── Writable data dir ──────────────────────────────────────────────────
// In a signed .app, APP_ROOT (resourcesPath/app) is read-only under Gatekeeper,
// so all writable state (.env, store/, db, migration backups) must live in a
// writable per-user dir. Electron's app.getPath('userData') is the supported
// location (~/Library/Application Support/ClaudeClaw). The service (src/config.ts
// + src/env.ts) honors CLAUDECLAW_DATA_DIR; the migration runner honors its
// dataDir arg. In dev (not packaged) we keep the old behavior (state under the
// repo) so the terminal path is untouched.
//   Secrets (DASHBOARD_TOKEN, DB_ENCRYPTION_KEY) written here survive app
//   updates because the bundle is replaced but userData is not.
const DATA_DIR = app.isPackaged ? app.getPath('userData') : APP_ROOT;

// .env lives in the writable data dir (packaged) or the repo (dev). The service
// reads it from the same place via CLAUDECLAW_DATA_DIR.
const ENV_PATH = path.join(DATA_DIR, '.env');

// Service logs: the Node service logs via pino to stdout/stderr only (no file
// writes, no repo-relative logs/ dir — verified in src/logger.ts), so there is
// nothing log-path-related to redirect for the launchd space-in-path trap (MED-2).

// ── Derived dashboard config ──────────────────────────────────────────
// Recomputed after onboarding writes config, so finish() can load the live
// dashboard without a relaunch.
const HOST = '127.0.0.1';
let PORT = 3141;
let TOKEN = '';
let DASHBOARD_URL = `http://${HOST}:${PORT}/`;

function refreshConfig() {
  const env = cfg.readEnv(ENV_PATH, ['DASHBOARD_PORT', 'DASHBOARD_TOKEN']);
  PORT = parseInt(env.DASHBOARD_PORT || '3141', 10) || 3141;
  TOKEN = env.DASHBOARD_TOKEN || '';
  DASHBOARD_URL = TOKEN
    ? `http://${HOST}:${PORT}/?token=${encodeURIComponent(TOKEN)}`
    : `http://${HOST}:${PORT}/`;
}

// ── Service lifecycle ──────────────────────────────────────────────────
let serviceProc = null;
let mainWindow = null;

// How to launch the Node service:
//   - CLAUDECLAW_SERVICE_CMD: explicit override ("node dist/index.js").
//   - dist/index.js built: run it with the Electron-bundled Node.
//   - otherwise (dev, not built): run the TS entry via local tsx.
// A fully bundled Node + native-module rebuild is a later packaging step.
function resolveServiceCommand() {
  const override = process.env.CLAUDECLAW_SERVICE_CMD;
  if (override && override.trim()) {
    const parts = override.trim().split(/\s+/);
    return { cmd: parts[0], args: parts.slice(1) };
  }
  const distEntry = path.join(APP_ROOT, 'dist', 'index.js');
  if (fs.existsSync(distEntry)) {
    return { cmd: process.execPath, args: [distEntry], runAsNode: true };
  }
  const tsxBin = path.join(
    APP_ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  return { cmd: tsxBin, args: [path.join('src', 'index.ts')] };
}

function startService() {
  if (serviceProc) return; // already running
  const { cmd, args, runAsNode } = resolveServiceCommand();
  const childEnv = { ...process.env };
  if (runAsNode) childEnv.ELECTRON_RUN_AS_NODE = '1';
  // Point the forked service at the writable data dir so its config.ts/env.ts
  // resolve store/, db, and .env there (task 1). cwd stays APP_ROOT so the SDK
  // still loads CLAUDE.md/skills from the code dir.
  childEnv.CLAUDECLAW_DATA_DIR = DATA_DIR;

  serviceProc = spawn(cmd, args, {
    cwd: APP_ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serviceProc.stdout.on('data', (b) => process.stdout.write(`[service] ${b}`));
  serviceProc.stderr.on('data', (b) => process.stderr.write(`[service] ${b}`));
  serviceProc.on('exit', (code, signal) => {
    console.log(`[shell] service exited code=${code} signal=${signal}`);
    serviceProc = null;
  });
  serviceProc.on('error', (err) => {
    console.error('[shell] failed to spawn service:', err);
    serviceProc = null;
  });
}

function stopService() {
  if (serviceProc) {
    try {
      serviceProc.kill();
    } catch {
      /* already gone */
    }
    serviceProc = null;
  }
}

// Poll the dashboard port until it accepts a TCP connection or we time out.
function waitForDashboard(timeoutMs = 30000, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const sock = net.connect({ host: HOST, port: PORT });
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        sock.destroy();
        if (ok) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(attempt, intervalMs);
      };
      sock.setTimeout(intervalMs);
      sock.once('connect', () => done(true));
      sock.once('timeout', () => done(false));
      sock.once('error', () => done(false));
    };
    attempt();
  });
}

// ── Migration gate (run BEFORE forking the service) ────────────────────
// The service's checkPendingMigrations() calls process.exit(1) on pending
// migrations; under Electron that silently kills the forked child and the
// dashboard never binds (RESEARCH Pitfall 3 / T-02-02 DoS). So we apply
// migrations here FIRST via the non-interactive runner (src/migrate-runner.ts),
// which never reads stdin and never exits — it returns a status. Because there
// is no prompt and no exit, the main process can never deadlock on a [y/N] with
// no TTY behind it.
//
// The runner is ESM/TS; we run it in a short-lived child process that prints a
// single JSON status line. Packaged: the compiled dist/migrate-runner.js with
// Electron's bundled Node (ELECTRON_RUN_AS_NODE). Dev: the TS source via tsx.
function resolveMigrationRunner() {
  const distRunner = path.join(APP_ROOT, 'dist', 'migrate-runner.js');
  if (fs.existsSync(distRunner)) {
    return { cmd: process.execPath, runnerPath: distRunner, runAsNode: true };
  }
  const tsxBin = path.join(
    APP_ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  // tsx can load the TS source directly in dev.
  return { cmd: tsxBin, runnerPath: path.join(APP_ROOT, 'src', 'migrate-runner.ts'), runAsNode: false };
}

// Run migrations and resolve to a status object (never throws on a migration
// failure — returns { status: 'failed', error }). Defensive: a spawn/parse
// failure also resolves to 'failed' so the caller always gets a status.
function runMigrationsStep() {
  return new Promise((resolve) => {
    const { cmd, runnerPath, runAsNode } = resolveMigrationRunner();
    // A tiny driver that imports the runner, runs it against APP_ROOT/DATA_DIR,
    // and prints exactly one JSON line prefixed so we can find it in the output.
    const driver =
      'import(process.env.__MIGRATE_RUNNER).then(async (m) => {' +
      '  const r = await m.runMigrations({ assumeYes: true, projectRoot: process.env.__MIGRATE_ROOT, dataDir: process.env.__MIGRATE_DATA });' +
      '  process.stdout.write("__MIGRATE_RESULT__" + JSON.stringify(r) + "\\n");' +
      '}).catch((e) => {' +
      '  process.stdout.write("__MIGRATE_RESULT__" + JSON.stringify({ status: "failed", error: String(e && e.message || e) }) + "\\n");' +
      '});';
    const childEnv = {
      ...process.env,
      __MIGRATE_RUNNER: runAsNode
        ? require('url').pathToFileURL(runnerPath).href
        : runnerPath,
      __MIGRATE_ROOT: APP_ROOT,
      __MIGRATE_DATA: DATA_DIR,
    };
    if (runAsNode) childEnv.ELECTRON_RUN_AS_NODE = '1';

    let proc;
    try {
      // node/electron-node: pass the driver via --input-type=module + -e. tsx
      // also accepts -e but loads the TS runner path from the env var.
      const args = runAsNode
        ? ['--input-type=module', '-e', driver]
        : ['--eval', driver];
      proc = spawn(cmd, args, { cwd: APP_ROOT, env: childEnv });
    } catch (err) {
      resolve({ status: 'failed', error: String(err) });
      return;
    }
    let out = '';
    proc.stdout.on('data', (b) => {
      out += b.toString();
    });
    proc.stderr.on('data', (b) => process.stderr.write(`[migrate] ${b}`));
    proc.on('error', (err) => resolve({ status: 'failed', error: String(err) }));
    proc.on('exit', () => {
      const marker = '__MIGRATE_RESULT__';
      const idx = out.lastIndexOf(marker);
      if (idx === -1) {
        resolve({ status: 'failed', error: 'migration runner produced no status' });
        return;
      }
      const line = out.slice(idx + marker.length).split('\n')[0];
      try {
        resolve(JSON.parse(line));
      } catch (e) {
        resolve({ status: 'failed', error: `could not parse migration status: ${String(e)}` });
      }
    });
  });
}

function bootUrl(state, detail) {
  const file = path.join(__dirname, 'boot.html');
  const q = new URLSearchParams({ state });
  if (detail) q.set('detail', detail);
  return `file://${file}?${q.toString()}`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    title: 'ClaudeClaw',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://${HOST}:${PORT}`)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Start the service and load the dashboard once it is up. Shared by the
// configured-boot path and onboarding's finish().
async function bootDashboard() {
  refreshConfig();

  // Ensure the writable data dir exists before anything writes to it (migration
  // backups, store/, .env). Recursive + idempotent.
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('[shell] could not create data dir:', err);
  }

  // Apply pending migrations BEFORE forking the service. Show a real "updating"
  // state, not a spinner that dies. On failure, render a retry state instead of
  // letting the service's process.exit(1) silently kill the boot.
  if (mainWindow) await mainWindow.loadURL(bootUrl('migrating'));
  const migration = await runMigrationsStep();
  if (!mainWindow) return;
  if (migration.status === 'failed') {
    await mainWindow.loadURL(
      bootUrl('migrating-failed', migration.error || 'A database update failed.'),
    );
    return;
  }

  startService();
  const ready = await waitForDashboard();
  if (!mainWindow) return;
  if (ready) {
    await mainWindow.loadURL(DASHBOARD_URL);
  } else if (!TOKEN) {
    await mainWindow.loadURL(
      bootUrl('needs-setup', 'The assistant is not configured yet.'),
    );
  } else {
    await mainWindow.loadURL(
      bootUrl('error', `Could not reach the dashboard on port ${PORT}.`),
    );
  }
}

async function boot() {
  createWindow();

  // First run: no transport configured → native onboarding wizard. Forcing it
  // for development is possible via CLAUDECLAW_FORCE_ONBOARDING=1.
  const force = process.env.CLAUDECLAW_FORCE_ONBOARDING === '1';
  if (force || !cfg.isConfigured(ENV_PATH)) {
    await mainWindow.loadFile(path.join(__dirname, 'onboarding.html'));
    return;
  }

  await mainWindow.loadURL(bootUrl('starting'));
  await bootDashboard();
}

// ── Onboarding IPC ─────────────────────────────────────────────────────
// Each handler is small and reuses the shared helpers so the desktop path and
// the terminal setup.ts stay in agreement.
function sendLog(line) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('onb:log', line);
  }
}

// Lazily load getScrubbedSdkEnv from the compiled ESM dist/security.js (same
// CJS→ESM interop reason as config.cjs's auth helpers: package.json is
// "type":"module" so a bare require would throw ERR_REQUIRE_ESM). Used by
// onb:verifyAuth to build the SDK subprocess env exactly as the live service
// does (src/agent.ts), so only the chosen auth var reaches the spawned claude.
let _securityPromise = null;
function loadSecurity() {
  if (!_securityPromise) {
    const compiled = path.join(APP_ROOT, 'dist', 'security.js');
    _securityPromise = require('url').pathToFileURL(compiled).href;
    _securityPromise = import(_securityPromise);
  }
  return _securityPromise;
}

// Spawn a command, stream stdout+stderr to the wizard, and ALSO capture stdout
// so callers that need to parse output (e.g. setup-token) can read it. Resolves
// on exit with { code, stdout, error? }.
//   SECURITY: stdout may contain a credential (the setup-token). The captured
//   string is returned to the caller for parsing only — it is never logged in
//   full here; the live-log stream shows the CLI's own prompts, and the token
//   line is the CLI's responsibility (we do not echo the parsed token anywhere).
function runStreaming(cmd, args) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmd, args, { cwd: APP_ROOT, env: { ...process.env } });
    } catch (err) {
      resolve({ code: -1, stdout: '', error: String(err) });
      return;
    }
    let stdout = '';
    proc.stdout.on('data', (b) => {
      const s = b.toString();
      stdout += s;
      sendLog(s);
    });
    proc.stderr.on('data', (b) => sendLog(b.toString()));
    proc.on('error', (err) => resolve({ code: -1, stdout, error: String(err) }));
    proc.on('exit', (code) => resolve({ code: code ?? -1, stdout }));
  });
}

// Extract a CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token` stdout. The CLI
// prints the 1-year token (prefix sk-ant-oat01…) on its own line. Match the
// token shape rather than a label so we are robust to surrounding prose.
//   SECURITY: the matched token is returned to the caller; never logged.
function extractOauthToken(stdout) {
  if (!stdout) return '';
  const m = stdout.match(/sk-ant-oat[0-9A-Za-z._-]+/);
  return m ? m[0] : '';
}

function registerOnboardingHandlers() {
  ipcMain.handle('onb:getState', () => {
    const cli = cfg.checkClaudeCli();
    return {
      configured: cfg.isConfigured(ENV_PATH),
      hasCli: cli.ok,
      cliVersion: cli.version,
      loggedIn: cfg.checkLogin(ENV_PATH),
    };
  });

  ipcMain.handle('onb:checkCli', () => cfg.checkClaudeCli());

  // Install the CLI via the native installer (curl-based, lands ~/.local/bin/claude
  // and auto-updates) — NOT the deprecated `npm i -g @anthropic-ai/claude-code`,
  // which needs a global npm/Node the operator may not have. Per-row retry stays
  // the wizard's contract (it re-invokes this on failure).
  ipcMain.handle('onb:installCli', async () => {
    sendLog('Installing Claude Code…\n');
    const { cmd, args } = cfg.nativeInstallCommand();
    const res = await runStreaming(cmd, args);
    const cli = cfg.checkClaudeCli();
    return {
      ok: cli.ok,
      version: cli.version,
      error: cli.ok ? '' : res.error || 'Install failed. See the log above.',
    };
  });

  ipcMain.handle('onb:checkLogin', () => ({ loggedIn: cfg.checkLogin(ENV_PATH) }));

  // Sign in via `claude setup-token` (A1: spawn+capture works from a non-TTY
  // Electron subprocess). The CLI walks the user through browser OAuth and prints
  // a 1-year CLAUDE_CODE_OAUTH_TOKEN to stdout; we capture it and persist it via
  // the tested precedence helper. Success = token captured, NOT a filesystem
  // heuristic (creds otherwise live in the encrypted macOS Keychain).
  //   SECURITY: the token is never logged; only the OAuth prompts stream to the
  //   wizard log, and the parsed token goes straight to writeEnv (0600).
  ipcMain.handle('onb:claudeLogin', async () => {
    sendLog('Opening Claude sign-in…\n');
    const bin = cfg.claudeBinaryPath();
    const res = await runStreaming(bin, ['setup-token']);
    const token = extractOauthToken(res.stdout);
    if (!token) {
      return {
        ok: false,
        error: res.error || 'Sign-in did not complete — no token was captured. Try again.',
      };
    }
    try {
      const delta = await cfg.resolveAuthWrite('oauth', token);
      cfg.writeEnv(ENV_PATH, delta);
    } catch (err) {
      return { ok: false, error: `Captured the token but could not save it: ${String(err)}` };
    }
    return { ok: true };
  });

  // Own auth precedence: OAuth and an API key must never both be active, or a
  // stale ANTHROPIC_API_KEY silently wins over the login (the crash-loop trap).
  // Delegate ENTIRELY to the tested resolveAuthWrite so the never-coexist
  // invariant has one source of truth.
  ipcMain.handle('onb:saveAuth', async (_e, payload) => {
    try {
      const p = payload || {};
      const mode = p.mode === 'apikey' ? 'apikey' : 'oauth';
      const credential = mode === 'apikey' ? (p.key || '').trim() : undefined;
      const delta = await cfg.resolveAuthWrite(mode, credential);
      cfg.writeEnv(ENV_PATH, delta);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Which auth source is live, for Settings > Account confirmation (D1).
  // 'apikey' | 'oauth' | 'none'.
  ipcMain.handle('onb:getAuthSource', async () => {
    try {
      const env = cfg.readEnv(ENV_PATH, [
        'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN',
      ]);
      const source = await cfg.activeAuthSource(env);
      return { ok: true, source };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Prove the captured credential ACTUALLY authenticates (MED-3): read the
  // credential from the data-dir .env, build the SDK subprocess env via
  // getScrubbedSdkEnv (so only the chosen auth var is present, exactly like
  // src/agent.ts), spawn the native `claude` binary on a trivial non-interactive
  // prompt, and return ok only if it returns a model reply — not merely if a
  // token string exists. On failure return the stderr reason.
  //   SECURITY: the token is never logged; getScrubbedSdkEnv strips every other
  //   secret from the subprocess env so a compromised prompt can't read them.
  ipcMain.handle('onb:verifyAuth', async () => {
    let getScrubbedSdkEnv;
    try {
      ({ getScrubbedSdkEnv } = await loadSecurity());
    } catch (err) {
      return { ok: false, error: `Could not load auth verifier: ${String(err)}` };
    }
    const secrets = cfg.readEnv(ENV_PATH, [
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_API_KEY',
    ]);
    if (!secrets.CLAUDE_CODE_OAUTH_TOKEN && !secrets.ANTHROPIC_API_KEY) {
      return { ok: false, error: 'No credential to verify. Sign in first.' };
    }
    const sdkEnv = getScrubbedSdkEnv({
      CLAUDE_CODE_OAUTH_TOKEN: secrets.CLAUDE_CODE_OAUTH_TOKEN || undefined,
      ANTHROPIC_API_KEY: secrets.ANTHROPIC_API_KEY || undefined,
    });
    const bin = cfg.claudeBinaryPath();
    sendLog('Checking your sign-in…\n');
    return await new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(bin, ['-p', 'reply with the single word: ok'], {
          cwd: APP_ROOT,
          env: sdkEnv,
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
        return;
      }
      let out = '';
      let errOut = '';
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* gone */
        }
        resolve({ ok: false, error: 'Verification timed out. Check your connection and try again.' });
      }, 60000);
      proc.stdout.on('data', (b) => {
        out += b.toString();
      });
      proc.stderr.on('data', (b) => {
        errOut += b.toString();
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: String(err) });
      });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0 && out.trim()) {
          resolve({ ok: true });
        } else {
          resolve({
            ok: false,
            error:
              (errOut.trim() || 'Sign-in could not be verified.').slice(0, 400),
          });
        }
      });
    });
  });

  ipcMain.handle('onb:saveTransport', (_e, payload) => {
    try {
      const p = payload || {};
      if (p.type === 'telegram') {
        cfg.writeEnv(ENV_PATH, {
          TRANSPORT: 'telegram',
          TELEGRAM_BOT_TOKEN: (p.telegramBotToken || '').trim(),
          ALLOWED_CHAT_ID: (p.allowedChatId || '').trim(),
        });
      } else {
        cfg.writeEnv(ENV_PATH, {
          TRANSPORT: 'slack',
          SLACK_BOT_TOKEN: (p.slackBotToken || '').trim(),
          SLACK_APP_TOKEN: (p.slackAppToken || '').trim(),
          ALLOWED_SLACK_USER_ID: (p.allowedSlackUserId || '').trim(),
        });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('onb:finish', async () => {
    try {
      // App-generated secrets the service needs but the operator never sees.
      const have = cfg.readEnv(ENV_PATH, ['DASHBOARD_TOKEN', 'DB_ENCRYPTION_KEY']);
      const updates = {};
      if (!have.DASHBOARD_TOKEN) updates.DASHBOARD_TOKEN = cfg.generateHex(24);
      if (!have.DB_ENCRYPTION_KEY) updates.DB_ENCRYPTION_KEY = cfg.generateHex(32);
      if (Object.keys(updates).length) cfg.writeEnv(ENV_PATH, updates);
    } catch (err) {
      return { ok: false, error: String(err) };
    }
    // Hand off to the live dashboard. Done in the next tick so the IPC reply
    // returns before we navigate away from the wizard.
    if (mainWindow) {
      mainWindow.loadURL(bootUrl('starting'));
      setImmediate(() => {
        bootDashboard().catch((err) => console.error('[shell] bootDashboard:', err));
      });
    }
    return { ok: true };
  });
}

// ── Single-instance + app lifecycle ────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (app.isPackaged) {
      try {
        // PKG-04 reboot persistence. A5: on macOS 13+ the registration is more
        // reliable with type:'mainAppService' (Electron routes it through the
        // SMAppService API); on older macOS the param is ignored. We pin the
        // minimum supported macOS at 13.0 (Ventura) — recorded in the SUMMARY —
        // so the mainAppService path is always the one in effect for this build.
        app.setLoginItemSettings({ openAtLogin: true, type: 'mainAppService' });
      } catch (err) {
        console.warn('[shell] could not set login item:', err);
      }
    }

    registerOnboardingHandlers();

    // Boot-screen Retry for the migrating-failed state: re-run the migration
    // gate + service boot. Returns nothing useful; bootDashboard drives the UI.
    ipcMain.handle('boot:retryMigration', async () => {
      await bootDashboard().catch((err) =>
        console.error('[shell] retry bootDashboard:', err),
      );
      return { ok: true };
    });

    boot().catch((err) => {
      console.error('[shell] boot failed:', err);
      dialog.showErrorBox('ClaudeClaw failed to start', String(err));
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) boot();
    });
  });

  app.on('before-quit', stopService);
  app.on('will-quit', stopService);
  app.on('window-all-closed', () => {
    app.quit();
  });
}
