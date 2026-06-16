#!/usr/bin/env node
/**
 * recall-cli: terminal semantic recall over ClaudeClaw's single SQLite
 * embedding index (D-01). Positional-arg query (NOT stdin, which would hang
 * waiting for input that never arrives in a recall flow).
 *
 * Routes only through recallForWorkspace, which shares the bot's exact
 * embedText + searchMemories path. There is deliberately no second semantic
 * index in this path. Agent attribution is fixed server-side
 * (RECALL_AGENT_ID), never read from argv (spoofing guard, mirrors
 * capture-cli's CAPTURE_AGENT_ID).
 *
 * The DB resolves from PROJECT_ROOT (via config.ts __dirname anchor), not
 * process.cwd(), so it hits the claudeclaw store even when the terminal
 * spawns this from the agentic-os cwd. Reached through the ~/.claudeclaw-app
 * symlink as `node dist/recall-cli.js "<query>" [--top-k N]`.
 */

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Package root is one level up from dist/ (or src/), the same anchor config.ts
// uses for PROJECT_ROOT. We chdir here before loading the config-dependent
// modules so .env resolution (config.ts reads cwd/.env at import time) finds
// the claudeclaw secrets even when this CLI is invoked from the agentic-os
// workspace terminal. db.js + memory.js are therefore loaded dynamically,
// after the chdir in runRecallCli.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The fixed workspace agent this CLI recalls for. Server-side, never from argv. */
const RECALL_AGENT_ID = 'aos';

/** Cap the query so a runaway argument cannot abuse the search path (T-06-04). */
const MAX_QUERY_CHARS = 4000;

/** Default and ceiling for --top-k (T-06-04 bound). */
const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 100;

interface ParsedArgs {
  query: string;
  topK: number;
}

/** Parse positional query + optional --top-k from argv (adapts schedule-cli). */
function parseArgs(argv: string[]): ParsedArgs {
  let topK = DEFAULT_TOP_K;

  const topKIdx = argv.indexOf('--top-k');
  let cleaned: string[];
  if (topKIdx !== -1) {
    const raw = Number(argv[topKIdx + 1]);
    if (Number.isFinite(raw) && raw > 0) {
      topK = Math.min(Math.floor(raw), MAX_TOP_K);
    }
    // Filter the flag and its value out of argv.
    cleaned = argv.filter((_, i) => i !== topKIdx && i !== topKIdx + 1);
  } else {
    cleaned = [...argv];
  }

  // Drop argv[0] (node) and argv[1] (script path); join the rest as the query.
  const query = cleaned.slice(2).join(' ').trim().slice(0, MAX_QUERY_CHARS);
  return { query, topK };
}

export async function runRecallCli(): Promise<void> {
  const { query, topK } = parseArgs(process.argv);

  if (!query) {
    process.stderr.write('usage: recall-cli "<query>" [--top-k N]\n');
    process.exit(2);
  }

  // Normalize cwd to the package root so config.ts (which reads cwd/.env at
  // import time) resolves the claudeclaw .env, then load the DB + memory
  // modules. Without this the CLI crashes on a missing DB_ENCRYPTION_KEY when
  // run from the agentic-os workspace cwd (its actual AGENTS.md usage).
  process.chdir(PACKAGE_ROOT);
  const { initDatabase } = await import('./db.js');
  const { recallForWorkspace } = await import('./memory.js');

  initDatabase();

  const results = await recallForWorkspace(query, { agentId: RECALL_AGENT_ID, topK });

  if (results.length === 0) {
    process.stdout.write('No matching memories found.\n');
  } else {
    for (const summary of results) {
      process.stdout.write(`- ${summary}\n`);
    }
  }
  process.exit(0);
}

// Only run the CLI glue when invoked directly (not when imported by tests).
// ESM "run as main" idiom. process.argv[1] is the path the user invoked, which
// is the ~/.claudeclaw-app SYMLINK in the live AGENTS.md command; import.meta.url
// is always realpath-resolved by Node. A raw compare therefore never matches
// through the symlink and the CLI silently no-ops. realpathSync canonicalizes
// argv[1] so both sides agree, and pathToFileURL encodes the spaces in the repo
// path correctly (a raw `file://${path}` would not).
let invokedDirectly = false;
if (typeof process.argv[1] === 'string') {
  try {
    invokedDirectly = import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    invokedDirectly = false;
  }
}
if (invokedDirectly) {
  runRecallCli();
}
