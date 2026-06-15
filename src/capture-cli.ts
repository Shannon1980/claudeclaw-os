#!/usr/bin/env node
/**
 * ClaudeClaw Capture CLI (MEM-04)
 *
 * Stop-hook entrypoint for the agentic-os terminal workspace. A terminal
 * Claude Code session's Stop hook pipes its JSON on stdin to this CLI, which
 * ingests the turn into ClaudeClaw's SQLite memory so the bot sees terminal
 * work. Mirrors the schedule-cli.ts / mission-cli.ts entrypoint shape.
 *
 * Wired into agentic-os .claude/settings.json "Stop" array (Plan 02):
 *   node <claudeclaw>/dist/capture-cli.js
 *
 * Stop fires after EVERY turn (not just session end), so re-fires for the same
 * session_id + content are deduped (Pitfall 4/6) on top of the existing 0.85
 * cosine dedup in ingest.
 *
 * The captured turn lands under the SHARED workspace pool
 * (workspaceMemoryKey('aos') = 'ws:aos', agent_id='aos') so the bot's
 * delegated turns and the terminal share ONE memory pool (unified-pool
 * decision). The 'aos-terminal' chat_id in 05-RESEARCH.md examples is
 * superseded by this key.
 *
 * Security (V5): stdin JSON is untrusted. Parse in try/catch, length-cap the
 * captured text, attribute server-side (never trust a stdin agent_id), and run
 * a stdin timeout safety net. The DB resolves from PROJECT_ROOT (via config.ts
 * __dirname anchor), not process.cwd(), so it works when the terminal spawns
 * this from the agentic-os cwd.
 */

import fs from 'fs';

import { initDatabase, getRecentConversation } from './db.js';
import { saveConversationTurnAwaited } from './memory.js';
import { workspaceMemoryKey } from './agent-config.js';

/**
 * Extract the last assistant message text from a Claude Code transcript JSONL.
 * Claude Code's Stop hook provides `transcript_path` (not `last_assistant_message`),
 * so this is the reliable source. Each line is a record; assistant turns have
 * `type:'assistant'` and `message.content` (string or an array of text blocks).
 * Returns '' on any problem (unreadable file, no assistant turn) so capture is a
 * safe no-op rather than throwing into the terminal session.
 */
export function lastAssistantFromTranscript(transcriptPath?: string): string {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let o: { type?: string; message?: { content?: unknown } };
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o.type !== 'assistant') continue;
      const content = o.message?.content;
      if (typeof content === 'string') return content.trim();
      if (Array.isArray(content)) {
        const text = content
          .filter((b): b is { type: string; text: string } =>
            !!b && typeof b === 'object' && (b as { type?: string }).type === 'text' && typeof (b as { text?: unknown }).text === 'string',
          )
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (text) return text;
      }
    }
  } catch {
    /* unreadable transcript is a safe no-op */
  }
  return '';
}

/** Mirror session-sync-stop.js:41 cap so a runaway response cannot flood the DB. */
const MAX_CAPTURE_CHARS = 4000;

/** The fixed workspace agent this CLI captures for. Server-side, never from stdin. */
const CAPTURE_AGENT_ID = 'aos';

export interface StopHookInput {
  session_id?: string;
  last_assistant_message?: string;
  transcript_path?: string;
  cwd?: string;
}

export type CaptureResult =
  | { captured: true; chatId: string }
  | { captured: false; reason: 'empty' | 'duplicate' };

/**
 * Ingest a single Stop-hook payload into the shared (ws:aos, aos) pool.
 * Idempotent: a re-fire with the same session_id + assistant content is a
 * no-op. Pure of process concerns (no stdin / exit) so it is unit-testable.
 */
export async function captureFromStop(input: StopHookInput): Promise<CaptureResult> {
  // Prefer an explicit stdin field if present; otherwise read the last assistant
  // turn from the transcript (Claude Code's Stop hook provides transcript_path,
  // not last_assistant_message).
  const assistant = (
    (input.last_assistant_message || '').trim() || lastAssistantFromTranscript(input.transcript_path)
  ).trim();
  if (!assistant) return { captured: false, reason: 'empty' };

  // Length-cap the captured text (T-05-01).
  const capped =
    assistant.length > MAX_CAPTURE_CHARS
      ? assistant.slice(0, MAX_CAPTURE_CHARS - 3) + '...'
      : assistant;

  const sessionId = typeof input.session_id === 'string' ? input.session_id : undefined;
  const chatId = workspaceMemoryKey(CAPTURE_AGENT_ID);

  // Dedup guard (Pitfall 4/6): skip if this content was already captured.
  // Stop fires every turn, so without this a growing session re-ingests
  // repeatedly. Match on content (and session_id where present).
  const recent = getRecentConversation(chatId, 10, CAPTURE_AGENT_ID);
  const alreadyCaptured = recent.some((t) => {
    if (t.role !== 'assistant') return false;
    if (t.content !== capped) return false;
    // When both sides carry a session_id, require it to match; otherwise a
    // content match alone is enough to treat as a re-fire.
    if (sessionId && t.session_id) return t.session_id === sessionId;
    return true;
  });
  if (alreadyCaptured) return { captured: false, reason: 'duplicate' };

  // Feed a meaningful user label so importance gating does not silently drop
  // the turn (Pitfall 3). Attribution is fixed server-side (T-05-06).
  const userLabel = `[terminal session ${sessionId ?? 'unknown'}]`;
  // Await ingestion: this is a short-lived process; a fire-and-forget save
  // would exit before the memories row (what the bot recalls) is written.
  await saveConversationTurnAwaited(chatId, userLabel, capped, sessionId, CAPTURE_AGENT_ID);

  return { captured: true, chatId };
}

/** Thin stdin glue. Kept minimal; all logic lives in captureFromStop. */
export function runCaptureCli(): void {
  initDatabase();

  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    let parsed: StopHookInput;
    try {
      parsed = JSON.parse(raw) as StopHookInput;
    } catch {
      process.exit(0); // untrusted/malformed stdin is a silent no-op (V5)
      return;
    }
    // Await ingestion before exiting, then exit promptly. Without the await
    // the process would die before the memories row is written.
    captureFromStop(parsed)
      .catch(() => {
        // Never let a capture failure surface to the terminal session.
      })
      .finally(() => process.exit(0));
  });

  // Hard safety net: exit even if stdin never ends or ingestion hangs. Set well
  // above a normal LLM ingestion latency so a legit capture is not cut short.
  setTimeout(() => process.exit(0), 30000);
}

// Only run the CLI glue when invoked directly (not when imported by tests).
// import.meta.url vs argv[1] is the ESM "run as main" idiom.
const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  runCaptureCli();
}
