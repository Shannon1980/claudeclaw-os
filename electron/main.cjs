// ClaudeClaw desktop shell — Electron main process.
//
// Build step 1 from specs/operator-product/01-foundations.md:
//   1. Launch with no terminal (double-click the .app).
//   2. Bootstrap the existing Node service internally.
//   3. Open the dashboard as the app window.
//   5. Register as a login item so it persists across reboots.
//
// The shell does NOT reimplement any backend behaviour. It spawns the same
// Node service (`dist/index.js`, the thing launchd used to run) as a child
// process, waits for the Hono dashboard to bind its port, then loads the
// existing Preact SPA into a BrowserWindow. Everything the service already
// does — Slack/Telegram, scheduler, memory, war room — keeps working
// unchanged.
//
// Written as CommonJS (.cjs) so it is independent of the project's
// "type": "module" setting and loads identically across Electron versions.

const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

// ── App root resolution ───────────────────────────────────────────────
// In dev, the repo is the parent of this electron/ directory. In a packaged
// build the app files live under resourcesPath (electron-builder copies them
// there). The Node service runs with this as its working directory so its
// relative paths (store/, agents/, warroom/) resolve exactly as before.
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..');

// ── Minimal .env reader ───────────────────────────────────────────────
// The service owns real config parsing (src/config.ts). The shell only needs
// the dashboard port and token so it can build the URL to load. Read the same
// .env the service reads, falling back to process.env then defaults. This is
// intentionally tiny — not a full dotenv — it only pulls the keys we need.
function readEnv(keys) {
  const out = {};
  const envPath = path.join(APP_ROOT, '.env');
  let fileVals = {};
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      // Strip surrounding quotes if present.
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      fileVals[key] = val;
    }
  } catch {
    /* no .env — fall back to process.env / defaults */
  }
  for (const key of keys) {
    out[key] = process.env[key] || fileVals[key] || '';
  }
  return out;
}

const env = readEnv(['DASHBOARD_PORT', 'DASHBOARD_TOKEN', 'DASHBOARD_BIND']);
const PORT = parseInt(env.DASHBOARD_PORT || '3141', 10) || 3141;
const TOKEN = env.DASHBOARD_TOKEN || '';
// The service defaults to loopback; mirror that. The shell always talks to the
// service over localhost regardless of how the service is bound for remote.
const HOST = '127.0.0.1';
const DASHBOARD_URL = TOKEN
  ? `http://${HOST}:${PORT}/?token=${encodeURIComponent(TOKEN)}`
  : `http://${HOST}:${PORT}/`;

// ── Service lifecycle ──────────────────────────────────────────────────
let serviceProc = null;
let mainWindow = null;

// Decide how to launch the Node service.
//   - CLAUDECLAW_SERVICE_CMD: explicit override ("node dist/index.js"), split
//     on whitespace. Escape hatch for unusual setups.
//   - dist/index.js built: run it with Node (closest to production).
//   - otherwise (dev, not built): run the TypeScript entry via local tsx.
// Native-module rebuild for a fully bundled Node is a packaging concern handled
// in a later build step; here we lean on a Node already resolvable on PATH in
// dev and on the built dist in packaged form.
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

  // Dev fallback: not built yet — run the TS entry through tsx.
  const tsxBin = path.join(
    APP_ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  return { cmd: tsxBin, args: [path.join('src', 'index.ts')] };
}

function startService() {
  const { cmd, args, runAsNode } = resolveServiceCommand();
  const childEnv = { ...process.env };
  // process.execPath is the Electron binary; ELECTRON_RUN_AS_NODE makes it
  // behave as a plain Node runtime so it can run dist/index.js directly.
  if (runAsNode) childEnv.ELECTRON_RUN_AS_NODE = '1';

  serviceProc = spawn(cmd, args, {
    cwd: APP_ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Surface service logs in the Electron console for debugging. Not shown to
  // the operator; the dashboard is their surface.
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
// A successful connect means Hono has bound the port and the SPA is servable.
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

  // Open external links (mailto, docs, OAuth pop-outs) in the system browser
  // rather than inside the app frame.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://${HOST}:${PORT}`)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function boot() {
  createWindow();
  await mainWindow.loadURL(bootUrl('starting'));

  startService();

  const ready = await waitForDashboard();
  if (!mainWindow) return; // window closed during boot

  if (ready) {
    await mainWindow.loadURL(DASHBOARD_URL);
  } else if (!TOKEN) {
    // No DASHBOARD_TOKEN means the service intentionally left the dashboard
    // disabled. This is the first-run / not-yet-configured state that
    // onboarding (build step 2) will own. For now, explain it.
    await mainWindow.loadURL(
      bootUrl(
        'needs-setup',
        'The assistant is not configured yet. Onboarding is coming next.',
      ),
    );
  } else {
    await mainWindow.loadURL(
      bootUrl('error', `Could not reach the dashboard on port ${PORT}.`),
    );
  }
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
    // Register as a login item so the assistant persists across reboots
    // (replaces the hand-managed launchd plist). Only in a real install — we
    // don't want dev runs hijacking the user's login items.
    if (app.isPackaged) {
      try {
        app.setLoginItemSettings({ openAtLogin: true });
      } catch (err) {
        console.warn('[shell] could not set login item:', err);
      }
    }

    boot().catch((err) => {
      console.error('[shell] boot failed:', err);
      dialog.showErrorBox('ClaudeClaw failed to start', String(err));
    });

    app.on('activate', () => {
      // macOS: re-open a window when the dock icon is clicked and none are open.
      if (BrowserWindow.getAllWindows().length === 0) boot();
    });
  });

  // The service is a child of the shell. Tear it down when the app quits so we
  // don't leave an orphaned bot/dashboard running.
  app.on('before-quit', stopService);
  app.on('will-quit', stopService);

  // Standard desktop behaviour: closing the last window quits the app (and via
  // before-quit, stops the service). An always-on background mode is a later
  // decision tied to the login-item / tray work.
  app.on('window-all-closed', () => {
    app.quit();
  });
}
