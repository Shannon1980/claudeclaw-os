// Preload for the ClaudeClaw desktop shell.
//
// Runs in an isolated context. Exposes a minimal, explicit surface to the
// renderer. The dashboard itself needs nothing (it talks to the local service
// over HTTP); the onboarding wizard needs the setup IPC below. This bridge is
// also the seam for the native settings surfaces the spec calls for later.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeclaw', {
  isDesktop: true,
  platform: process.platform,

  // Boot-screen controls. The migrating-failed state offers a Retry that
  // re-runs the migration gate + service boot from the main process.
  boot: {
    retryMigration: () => ipcRenderer.invoke('boot:retryMigration'),
  },

  // First-run onboarding. Each call maps to an ipcMain handler in main.cjs.
  // The renderer drives the wizard one row/step at a time so failures surface
  // per row (spec 02-onboarding step 2), not as one opaque spinner.
  onboarding: {
    // { configured, hasCli, cliVersion, loggedIn }
    getState: () => ipcRenderer.invoke('onb:getState'),
    // { ok, version }
    checkCli: () => ipcRenderer.invoke('onb:checkCli'),
    // installs the CLI via the native installer (~/.local/bin/claude) → { ok, version, error }
    installCli: () => ipcRenderer.invoke('onb:installCli'),
    // { loggedIn }
    checkLogin: () => ipcRenderer.invoke('onb:checkLogin'),
    // Accepts an existing login (macOS Keychain or a credential in .env); if
    // none, drives `claude setup-token` under a PTY (opens its own browser,
    // captures a 1-year CLAUDE_CODE_OAUTH_TOKEN), then re-probes →
    // { ok, error, alreadySignedIn? }
    claudeLogin: () => ipcRenderer.invoke('onb:claudeLogin'),
    // mode: 'oauth' clears any stored key; 'apikey' stores it; both via the
    // tested never-coexist precedence helper → { ok, error }
    saveAuth: (payload) => ipcRenderer.invoke('onb:saveAuth', payload),
    // which auth source is live (D1) → { ok, source: 'oauth'|'apikey'|'none' }
    getAuthSource: () => ipcRenderer.invoke('onb:getAuthSource'),
    // prove the credential actually authenticates a spawned claude (MED-3) → { ok, error }
    verifyAuth: () => ipcRenderer.invoke('onb:verifyAuth'),
    // persist transport choice + tokens → { ok, error }
    saveTransport: (payload) => ipcRenderer.invoke('onb:saveTransport', payload),
    // finalize: ensure dashboard token + db key, then boot into the dashboard
    finish: () => ipcRenderer.invoke('onb:finish'),
    // live log lines from install / login subprocesses
    onLog: (cb) => {
      const handler = (_e, line) => cb(line);
      ipcRenderer.on('onb:log', handler);
      return () => ipcRenderer.removeListener('onb:log', handler);
    },
  },
});
