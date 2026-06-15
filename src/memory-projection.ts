import fs from 'fs';
import path from 'path';

import { resolveAgentRuntime, workspaceMemoryKey } from './agent-config.js';
import { getRecentHighImportanceMemories } from './db.js';

/**
 * Render recent ClaudeClaw memories for a workspace agent into a derived
 * markdown projection a terminal Claude Code session reads (MEM-03).
 *
 * SQLite is the single source of record; the markdown is a one-directional
 * projection FROM it, never round-tripped back as truth (PROJECT.md).
 *
 * MEM-06: this reads ONLY through the in-process db.ts access path
 * (`getRecentHighImportanceMemories`). The memories table is plaintext (only
 * messaging tables are AES-GCM encrypted), so there is nothing to decrypt.
 * This module never opens the sqlite file directly, never invokes the
 * field-level crypto helpers, and never reads the encrypted messaging tables.
 * A source-guard test enforces the absence of those identifiers.
 *
 * The projection is written to a SEPARATE file
 * `context/memory/{YYYY-MM-DD}.claudeclaw.md` so it never clobbers the agent's
 * own `{date}.md` session blocks (locked decision 4 / Pitfall 1).
 *
 * Returns the absolute path written, or null when the resolved workspace has
 * no `context/memory/` directory (the agent is not pointed at a workspace),
 * in which case nothing is written.
 */
export function renderMemoryProjection(
  agentId = 'aos',
  date = new Date(),
): string | null {
  // Resolve the workspace via the same predicate the SDK cwd uses. The write
  // target is a FIXED filename under this resolved dir, never a path taken
  // from untrusted input (T-05-05 path-traversal mitigation).
  const ws = resolveAgentRuntime(agentId).cwd;
  const memDir = path.join(ws, 'context', 'memory');
  if (!fs.existsSync(memDir)) return null; // not pointed at a workspace, skip silently

  // MEM-06 in-process access path. Agent-scoped, keyed on the shared pool so
  // the projection reflects the same memories the bot and terminal share.
  const memories = getRecentHighImportanceMemories(workspaceMemoryKey(agentId), 10, agentId);

  const d = date.toISOString().slice(0, 10);
  const lines = memories.map((m) => `- ${m.summary}`);
  const body =
    `# ClaudeClaw memory projection: ${d}\n\n` +
    `Derived from ClaudeClaw SQLite (the source of record). Do not edit; the bot regenerates this file. One directional, out only.\n\n` +
    (lines.length > 0 ? lines.join('\n') : '(no recent high-importance memories)') +
    '\n';

  const out = path.join(memDir, `${d}.claudeclaw.md`);
  fs.writeFileSync(out, body, 'utf8'); // separate file, never touches {date}.md
  return out;
}
