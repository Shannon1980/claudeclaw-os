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
const os = require('os');
const path = require('path');
const cfg = require('./config.cjs');

// Child stdio used to vanish in a packaged .app (no terminal). Tee it so a
// mid-request crash leaves more than ERR_CONNECTION_RESET in DevTools.
const SERVICE_LOG = path.join(os.tmpdir(), 'claudeclaw-service.log');
function appendServiceLog(chunk) {
  try {
    fs.appendFileSync(SERVICE_LOG, chunk);
  } catch {
    /* ignore */
  }
}

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
let serviceStopping = false;
let serviceRespawnTimer = null;
let serviceRespawnAttempts = 0;
const MAX_SERVICE_RESPAWNS = 8;

function clearServiceRespawn() {
  if (serviceRespawnTimer) {
    clearTimeout(serviceRespawnTimer);
    serviceRespawnTimer = null;
  }
}

function serviceRespawnDelayMs(attempt) {
  return Math.min(30000, 500 * 2 ** Math.min(Math.max(attempt - 1, 0), 6));
}

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
  // In a packaged build the tsx fallback is never valid (node_modules is not
  // shipped), so a missing dist/ is a build error, not a dev situation. Fail
  // with a clear message instead of spawning a nonexistent tsx (IN-04).
  if (app.isPackaged) {
    throw new Error(
      `Build incomplete: ${distEntry} is missing from the packaged app. Rebuild with \`npm run build\`.`,
    );
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
  serviceProc.stdout.on('data', (b) => {
    process.stdout.write(`[service] ${b}`);
    appendServiceLog(b);
  });
  serviceProc.stderr.on('data', (b) => {
    process.stderr.write(`[service] ${b}`);
    appendServiceLog(b);
  });
  // `error` (ENOENT) and `exit` can both fire for one failed spawn. Only
  // schedule one respawn so the backoff counter stays honest.
  let gone = false;
  const handleGone = () => {
    if (gone) return;
    gone = true;
    serviceProc = null;
    if (!serviceStopping) scheduleServiceRespawn();
  };
  serviceProc.on('exit', (code, signal) => {
    console.log(`[shell] service exited code=${code} signal=${signal}`);
    handleGone();
  });
  serviceProc.on('error', (err) => {
    console.error('[shell] failed to spawn service:', err);
    handleGone();
  });
}

function scheduleServiceRespawn() {
  if (serviceStopping) return;
  clearServiceRespawn();
  serviceRespawnAttempts += 1;
  if (serviceRespawnAttempts > MAX_SERVICE_RESPAWNS) {
    console.error(`[shell] service crashed ${MAX_SERVICE_RESPAWNS} times; giving up`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(
        bootUrl('error', `The assistant stopped and could not be restarted on port ${PORT}.`),
      );
    }
    return;
  }
  const delayMs = serviceRespawnDelayMs(serviceRespawnAttempts);
  console.log(`[shell] respawning service in ${delayMs}ms (attempt ${serviceRespawnAttempts})`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(bootUrl('starting', 'The assistant stopped. Bringing it back…'));
  }
  serviceRespawnTimer = setTimeout(() => {
    serviceRespawnTimer = null;
    startService();
    waitForDashboard().then((ready) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (ready) {
        serviceRespawnAttempts = 0;
        refreshConfig();
        mainWindow.loadURL(DASHBOARD_URL);
        return;
      }
      scheduleServiceRespawn();
    });
  }, delayMs);
}

function stopService() {
  serviceStopping = true;
  clearServiceRespawn();
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
  // Packaged builds ship dist/ but not node_modules, so the tsx fallback can
  // only resolve a nonexistent binary and fail with an opaque spawn error.
  // Treat a missing dist/ runner as a hard build error in packaged mode (IN-04).
  if (app.isPackaged) {
    throw new Error(
      `Build incomplete: ${distRunner} is missing from the packaged app. Rebuild with \`npm run build\`.`,
    );
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
    let cmd, runnerPath, runAsNode;
    try {
      ({ cmd, runnerPath, runAsNode } = resolveMigrationRunner());
    } catch (err) {
      // Preserve the "always resolves to a status" contract (IN-04): a packaged
      // build-incomplete error must surface as a failed migration state, not an
      // unhandled rejection that crashes the boot.
      resolve({ status: 'failed', error: String(err && err.message || err) });
      return;
    }
    // A tiny driver that imports the runner, runs it against APP_ROOT/DATA_DIR,
    // and prints exactly one JSON line prefixed so we can find it in the output.
    const driver =
      'import(process.env.__MIGRATE_RUNNER).then(async (m) => {' +
      '  const r = await m.runMigrations({ assumeYes: true, projectRoot: process.env.__MIGRATE_ROOT, dataDir: process.env.__MIGRATE_DATA });' +
      '  process.stdout.write("__MIGRATE_RESULT__" + JSON.stringify(r) + "\\n");' +
      '}).catch((e) => {' +
      '  process.stdout.write("__MIGRATE_RESULT__" + JSON.stringify({ status: "failed", error: String(e && e.message || e) }) + "\\n");' +
      '});';
    // Pass a MINIMAL env to the migration child (WR-04): migrations run
    // arbitrary code, so they must not inherit the whole Electron parent
    // environment (ANTHROPIC_API_KEY and other secrets). Allowlist only the
    // process plumbing needed to launch (PATH/HOME/locale/runtime dir) plus the
    // DB credential migrations legitimately need to open the encrypted store.
    // This mirrors the scrubbing discipline getScrubbedSdkEnv applies to the
    // verify spawn.
    const ENV_ALLOWLIST = [
      'PATH',
      'HOME',
      'TMPDIR',
      'LANG',
      'LC_ALL',
      'LC_CTYPE',
      'USER',
      'LOGNAME',
      'SHELL',
      'XDG_RUNTIME_DIR',
      'NODE_PATH',
      'NODE_OPTIONS',
      'SystemRoot', // Windows: required for child process startup
      'TEMP',
      'TMP',
    ];
    const childEnv = {
      __MIGRATE_RUNNER: runAsNode
        ? require('url').pathToFileURL(runnerPath).href
        : runnerPath,
      __MIGRATE_ROOT: APP_ROOT,
      __MIGRATE_DATA: DATA_DIR,
      // The migration runner resolves writable state under CLAUDECLAW_DATA_DIR.
      CLAUDECLAW_DATA_DIR: DATA_DIR,
    };
    for (const key of ENV_ALLOWLIST) {
      if (process.env[key] !== undefined) childEnv[key] = process.env[key];
    }
    // DB_ENCRYPTION_KEY is the one secret migrations need (to open the encrypted
    // DB). Source it from the managed .env, not the inherited process env, so a
    // stale exported value can't leak in.
    const dbKey = cfg.readEnvFromFile(ENV_PATH, ['DB_ENCRYPTION_KEY']).DB_ENCRYPTION_KEY;
    if (dbKey) childEnv.DB_ENCRYPTION_KEY = dbKey;
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
  // Packaged builds take the icon from the bundle; in dev point at the source
  // PNG so the dock/taskbar shows the app mark instead of the Electron default.
  const devIcon = path.join(__dirname, '..', 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    title: 'ClaudeClaw',
    ...(!app.isPackaged && fs.existsSync(devIcon) ? { icon: devIcon } : {}),
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
  serviceStopping = false;
  serviceRespawnAttempts = 0;
  clearServiceRespawn();
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
    const url = require('url').pathToFileURL(
      path.join(APP_ROOT, 'dist', 'security.js'),
    ).href;
    // Cache only on success (WR-05): if import() rejects (e.g. dist/security.js
    // missing in a partial build) we clear the cache so a later verifyAuth can
    // retry once the file appears, instead of permanently re-returning the same
    // rejected promise.
    _securityPromise = import(url).catch((e) => {
      _securityPromise = null;
      throw e;
    });
  }
  return _securityPromise;
}

// Spawn a command, stream stdout+stderr to the wizard, and ALSO capture stdout
// so callers that need to parse output (e.g. setup-token) can read it. Resolves
// on exit with { code, stdout, error? }.
//   SECURITY: stdout may contain a credential (the setup-token). The captured
//   string is returned to the caller for parsing only; before any chunk reaches
//   the renderer log it is run through redactTokens so a sk-ant-oat/api token
//   never lands in the visible #log element or renderer memory (CR-01). The raw
//   (unredacted) stdout is still accumulated for extractOauthToken.
const TOKEN_RE = /sk-ant-(?:oat|api)[0-9A-Za-z._-]+/g;
function redactTokens(s) {
  return s.replace(TOKEN_RE, 'sk-ant-***redacted***');
}
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
      stdout += s; // keep raw for extractOauthToken
      sendLog(redactTokens(s)); // never stream the raw token to the renderer
    });
    proc.stderr.on('data', (b) => sendLog(redactTokens(b.toString())));
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
  // Drop '.' from the class (IN-02): the OAuth token format does not contain
  // dots, so including it would swallow a trailing period from surrounding prose
  // (e.g. "...token sk-ant-oat01abc.") into the captured value, producing an
  // invalid token that later fails verifyAuth with a confusing error.
  const m = stdout.match(/sk-ant-oat[0-9A-Za-z_-]+/);
  return m ? m[0] : '';
}

// Strip ANSI escape sequences and stray control chars so a token rendered by the
// CLI's Ink TUI (under a PTY — see runSetupTokenPty) can be matched even when
// wrapped in styling codes. Newlines/tabs are preserved so streamed log lines
// stay readable; carriage returns and other control bytes are dropped.
function stripAnsi(s) {
  return String(s)
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[@-Z\\-_]/g, '')
    .replace(/[\r\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// Like extractOauthToken, but only returns a token that is ALREADY followed by a
// boundary character in `text`. Used for early-resolve on the live PTY stream: a
// chunk that splits the token mid-string must not yield a truncated value (we
// wait for the next chunk to land the trailing boundary).
function extractOauthTokenBounded(text) {
  const m = text.match(/sk-ant-oat[0-9A-Za-z_-]+/);
  if (!m) return '';
  if (m.index + m[0].length >= text.length) return ''; // token may be mid-stream
  return m[0];
}

// ── Auth probe (keychain-aware) ────────────────────────────────────────
// The live service authenticates a spawned `claude` through HOME-resolved creds
// (macOS Keychain) when no token is in .env — getScrubbedSdkEnv keeps HOME. So
// "are you signed in?" is answered the same way the service answers it: spawn a
// trivial non-interactive prompt and see if the model replies. Exit 0 with a
// reply = authenticated; a non-zero exit or a "Not logged in" notice = not.
//   This is what lets onboarding accept an existing Keychain login WITHOUT
//   demanding a CLAUDE_CODE_OAUTH_TOKEN/ANTHROPIC_API_KEY string in the .env.
function runAuthProbe(sdkEnv, timeoutMs = 60000) {
  const bin = cfg.claudeBinaryPath();
  return new Promise((resolve) => {
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
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* gone */
      }
      done({ ok: false, error: 'Verification timed out. Check your connection and try again.' });
    }, timeoutMs);
    proc.stdout.on('data', (b) => {
      out += b.toString();
    });
    proc.stderr.on('data', (b) => {
      errOut += b.toString();
    });
    proc.on('error', (err) => done({ ok: false, error: String(err) }));
    proc.on('exit', (code) => {
      // CLI 2.1.x prints "Not logged in · Please run /login" to stdout and exits
      // non-zero when unauthenticated; guard on both so a stray reply can't read
      // as success.
      if (code === 0 && out.trim() && !/not logged in/i.test(out)) {
        done({ ok: true });
      } else {
        done({
          ok: false,
          error: (errOut.trim() || out.trim() || 'Sign-in could not be verified.').slice(0, 400),
        });
      }
    });
  });
}

// Resolve whether a usable login already exists, exactly the way the service
// would use it. Reads auth secrets from the managed .env (file-only, CR-02): if
// one is present, forward ONLY the single active source (never-coexist, WR-01);
// if NONE is present, probe with the Keychain fallback (getScrubbedSdkEnv() with
// no forced auth — mirrors src/agent.ts running against an empty .env). Returns
// { ok, error?, source }.
async function probeExistingAuth() {
  let getScrubbedSdkEnv;
  try {
    ({ getScrubbedSdkEnv } = await loadSecurity());
  } catch (err) {
    return { ok: false, error: `Could not load auth verifier: ${String(err)}`, source: 'none' };
  }
  const secrets = cfg.readEnvFromFile(ENV_PATH, [
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
  ]);
  const source = await cfg.activeAuthSource(secrets); // 'apikey' | 'oauth' | 'none'
  const sdkEnv =
    source === 'apikey'
      ? getScrubbedSdkEnv({ ANTHROPIC_API_KEY: secrets.ANTHROPIC_API_KEY })
      : source === 'oauth'
        ? getScrubbedSdkEnv({ CLAUDE_CODE_OAUTH_TOKEN: secrets.CLAUDE_CODE_OAUTH_TOKEN })
        : getScrubbedSdkEnv(); // Keychain fallback — no token required in .env
  const res = await runAuthProbe(sdkEnv);
  return { ...res, source };
}

// ── setup-token under a PTY ────────────────────────────────────────────
// `claude setup-token` (CLI 2.1.x) renders its token through an Ink/React TUI
// (ConsoleOAuthFlow) that only paints to a TTY. A plain piped spawn therefore
// completes the browser OAuth but never emits a parseable token to stdout — the
// original "button stuck / nothing captured" bug. Allocate a real PTY with the
// system `script` so the UI renders and the token is capturable. No native pty
// dependency (the native build toolchain is unreliable here).
function setupTokenPtyCommand() {
  const bin = cfg.claudeBinaryPath();
  if (process.platform === 'darwin') {
    // BSD script: `script -q <file> <cmd> [args...]`.
    return { cmd: '/usr/bin/script', args: ['-q', '/dev/null', bin, 'setup-token'] };
  }
  // util-linux script: `script -qec "<cmd string>" <file>` (runs via /bin/sh, so
  // single-quote the binary path to survive spaces).
  const quoted = `'${bin.replace(/'/g, `'\\''`)}' setup-token`;
  return { cmd: 'script', args: ['-qec', quoted, '/dev/null'] };
}

// Drive `claude setup-token` under a PTY and capture the printed token. Resolves
// { ok, stdout, error? }. Early-resolves as soon as a complete token has been
// printed (so a possibly-lingering TUI does not stall the wizard), and is bounded
// by an overall timeout (browser OAuth needs human interaction).
//   SECURITY: stdout may contain the token; it is only returned for parsing.
//   Every chunk is ANSI-stripped and redactTokens'd before it reaches the
//   renderer log, so the raw token never lands in the visible #log (CR-01).
function runSetupTokenPty({ timeoutMs = 180000 } = {}) {
  return new Promise((resolve) => {
    const { cmd, args } = setupTokenPtyCommand();
    let proc;
    try {
      // stdin must be /dev/null ('ignore'), NOT the default pipe: BSD `script`
      // calls tcgetattr on its stdin to clone the terminal attrs onto the slave
      // pty, and a pipe/socket fails that with "Operation not supported on
      // socket" (the spawn aborts). /dev/null is tolerated and `script` still
      // allocates the pty the child needs to render its token UI. The Ink flow
      // does not read stdin for the loopback OAuth, so EOF on stdin is harmless.
      proc = spawn(cmd, args, {
        cwd: APP_ROOT,
        env: { ...process.env, TERM: process.env.TERM || 'xterm-256color' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ ok: false, stdout: '', error: String(err) });
      return;
    }
    let raw = '';
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        proc.kill();
      } catch {
        /* gone */
      }
      resolve(r);
    };
    const timer = setTimeout(
      () => finish({ ok: false, stdout: raw, error: 'timed out waiting for sign-in' }),
      timeoutMs,
    );
    const onData = (b) => {
      const s = b.toString();
      raw += s;
      sendLog(redactTokens(stripAnsi(s))); // never stream the raw token
      if (extractOauthTokenBounded(stripAnsi(raw))) finish({ ok: true, stdout: raw });
    };
    proc.stdout.on('data', onData);
    if (proc.stderr) proc.stderr.on('data', onData);
    proc.on('error', (err) => finish({ ok: false, stdout: raw, error: String(err) }));
    proc.on('exit', (code) => finish({ ok: code === 0, stdout: raw }));
  });
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

  // Sign in. Two paths, in order:
  //   1. If a usable login already exists (a prior `claude` login lives in the
  //      macOS Keychain, or a credential is already in .env), there is nothing to
  //      do — the service authenticates through the very same path. This is the
  //      common case and needs no browser and no token in .env (the onboarding
  //      gate used to wrongly demand one).
  //   2. Otherwise drive `claude setup-token` under a PTY to mint a portable
  //      1-year CLAUDE_CODE_OAUTH_TOKEN. CLI 2.1.x renders the token through an
  //      Ink TUI that only paints to a TTY, so the old piped spawn captured
  //      nothing (the stuck-button bug); the PTY makes it capturable. We persist
  //      any captured token, then RE-PROBE: success of the probe is the real
  //      signal, so even if the token could not be scraped, a login that
  //      setup-token established (Keychain) still advances the wizard.
  //   SECURITY: the token is never logged; only ANSI-stripped, redacted OAuth
  //   prompts stream to the wizard log, and a parsed token goes to writeEnv (0600).
  ipcMain.handle('onb:claudeLogin', async () => {
    const existing = await probeExistingAuth();
    if (existing.ok) return { ok: true, alreadySignedIn: true };

    sendLog('Opening Claude sign-in…\n');
    const res = await runSetupTokenPty();
    const token = extractOauthToken(stripAnsi(res.stdout || ''));
    if (token) {
      try {
        const delta = await cfg.resolveAuthWrite('oauth', token);
        cfg.writeEnv(ENV_PATH, delta);
      } catch (err) {
        return { ok: false, error: `Captured the token but could not save it: ${String(err)}` };
      }
    }

    // Whether or not a token was scraped, confirm the login actually works.
    const after = await probeExistingAuth();
    if (after.ok) return { ok: true };
    return {
      ok: false,
      error: res.error
        ? `Sign-in did not complete: ${res.error}`
        : after.error || 'Sign-in did not complete — no working login was detected. Try again.',
    };
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
      // File-only read (CR-02): the app owns auth precedence (D1), so a stale
      // exported ANTHROPIC_API_KEY in the Electron parent env must never outrank
      // the credential the wizard actually wrote to the .env.
      const env = cfg.readEnvFromFile(ENV_PATH, [
        'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN',
      ]);
      const source = await cfg.activeAuthSource(env);
      return { ok: true, source };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Prove a login ACTUALLY authenticates (MED-3): spawn the native `claude`
  // binary on a trivial non-interactive prompt and return ok only if it returns
  // a model reply — not merely if a token string exists. probeExistingAuth
  // mirrors the service exactly: it uses the credential in the managed .env when
  // present (single active source only, never-coexist), and otherwise falls back
  // to the HOME-resolved macOS Keychain login — so a machine signed in via
  // `claude login` (no token in .env) verifies as signed-in.
  //   SECURITY: the token is never logged; getScrubbedSdkEnv strips every other
  //   secret from the subprocess env so a compromised prompt can't read them.
  ipcMain.handle('onb:verifyAuth', async () => {
    sendLog('Checking your sign-in…\n');
    const res = await probeExistingAuth();
    return { ok: res.ok, error: res.error };
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
