// Preload for the ClaudeClaw desktop shell.
//
// Runs in an isolated context with access to a limited Node surface. Right now
// the dashboard is a self-contained web app that talks to the local service
// over HTTP, so it needs nothing from the shell. This bridge exists as the
// seam for native surfaces the spec calls for later — settings screens that
// replace .env editing, and the first-run Claude login flow
// (01-foundations.md). Keep the exposed surface minimal and explicit.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('claudeclaw', {
  isDesktop: true,
  platform: process.platform,
});
