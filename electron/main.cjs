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

// Writable data dir. The packaged bundle (APP_ROOT) is read-only in
// /Applications, so the service's writable state (.env, store/, uploads) goes
// to Electron's per-user userData dir instead. The service honours this via the
// CLAUDECLAW_DATA_DIR env var (see DATA_DIR in src/config.ts); APP_ROOT stays
// the code root so bundled agents/migrations/warroom still resolve from cwd.
// In dev, DATA_DIR == APP_ROOT (the checkout), so behaviour is unchanged.
const DATA_DIR = app.isPackaged ? app.getPath('userData') : APP_ROOT;
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  console.error('[shell] could not create data dir:', err);
}
const ENV_PATH = path.join(DATA_DIR, '.env');

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
  // Tell the service where to read/write its data (.env, store/). Matches the
  // dir onboarding wrote the .env to above.
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

// Spawn a command, stream stdout+stderr to the wizard, resolve on exit.
function runStreaming(cmd, args) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmd, args, { cwd: APP_ROOT, env: { ...process.env } });
    } catch (err) {
      resolve({ code: -1, error: String(err) });
      return;
    }
    proc.stdout.on('data', (b) => sendLog(b.toString()));
    proc.stderr.on('data', (b) => sendLog(b.toString()));
    proc.on('error', (err) => resolve({ code: -1, error: String(err) }));
    proc.on('exit', (code) => resolve({ code: code ?? -1 }));
  });
}

function registerOnboardingHandlers() {
  ipcMain.handle('onb:getState', () => {
    const cli = cfg.checkClaudeCli();
    return {
      configured: cfg.isConfigured(ENV_PATH),
      hasCli: cli.ok,
      cliVersion: cli.version,
      loggedIn: cfg.checkLogin(),
    };
  });

  ipcMain.handle('onb:checkCli', () => cfg.checkClaudeCli());

  ipcMain.handle('onb:installCli', async () => {
    sendLog('Installing Claude Code…\n');
    const res = await runStreaming('npm', [
      'install',
      '-g',
      '@anthropic-ai/claude-code',
    ]);
    const cli = cfg.checkClaudeCli();
    return {
      ok: cli.ok,
      version: cli.version,
      error: cli.ok ? '' : res.error || 'Install failed. See the log above.',
    };
  });

  ipcMain.handle('onb:checkLogin', () => ({ loggedIn: cfg.checkLogin() }));

  ipcMain.handle('onb:claudeLogin', async () => {
    // `claude login` opens its own browser OAuth flow and exits when done.
    sendLog('Opening Claude sign-in…\n');
    const res = await runStreaming('claude', ['login']);
    const loggedIn = cfg.checkLogin();
    return {
      ok: loggedIn,
      error: loggedIn
        ? ''
        : res.error || 'Sign-in did not complete. Try again.',
    };
  });

  // Own auth precedence: OAuth and an API key must never both be active, or a
  // stale ANTHROPIC_API_KEY silently wins over the login (the crash-loop trap).
  ipcMain.handle('onb:saveAuth', (_e, payload) => {
    try {
      if (payload && payload.mode === 'apikey' && payload.key) {
        cfg.writeEnv(ENV_PATH, { ANTHROPIC_API_KEY: payload.key.trim() });
      } else {
        // OAuth path — clear any stored key so the login is the active source.
        cfg.writeEnv(ENV_PATH, { ANTHROPIC_API_KEY: null });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
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
        app.setLoginItemSettings({ openAtLogin: true });
      } catch (err) {
        console.warn('[shell] could not set login item:', err);
      }
    }

    registerOnboardingHandlers();

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
