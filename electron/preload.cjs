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

  // First-run onboarding. Each call maps to an ipcMain handler in main.cjs.
  // The renderer drives the wizard one row/step at a time so failures surface
  // per row (spec 02-onboarding step 2), not as one opaque spinner.
  onboarding: {
    // { configured, hasCli, cliVersion, loggedIn }
    getState: () => ipcRenderer.invoke('onb:getState'),
    // { ok, version }
    checkCli: () => ipcRenderer.invoke('onb:checkCli'),
    // installs @anthropic-ai/claude-code globally → { ok, version, error }
    installCli: () => ipcRenderer.invoke('onb:installCli'),
    // { loggedIn }
    checkLogin: () => ipcRenderer.invoke('onb:checkLogin'),
    // drives `claude login` (opens its own browser) → { ok, error }
    claudeLogin: () => ipcRenderer.invoke('onb:claudeLogin'),
    // mode: 'oauth' clears any stored key; 'apikey' stores it → { ok, error }
    saveAuth: (payload) => ipcRenderer.invoke('onb:saveAuth', payload),
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
