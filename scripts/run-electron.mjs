#!/usr/bin/env node
// Cross-platform Electron launcher. Cursor (and some IDEs) set
// ELECTRON_RUN_AS_NODE, which makes `electron .` run as plain Node and break
// the main process. Unset it before spawning so npm scripts work on macOS,
// Linux, and Windows without relying on POSIX `env -u`.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

delete process.env.ELECTRON_RUN_AS_NODE;

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const child = spawn(electronBinary, process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
  windowsHide: false,
});

child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
