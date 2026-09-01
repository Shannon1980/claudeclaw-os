#!/usr/bin/env npx tsx
/**
 * Claude Code PreToolUse runner. Reads the hook event on stdin and applies
 * src/claude-code-policy.ts. Exit 2 + JSON deny payload blocks the tool.
 * A crash exits 1 so Claude Code keeps working (fail-open on hook errors).
 */
import { evaluatePreToolUse, hookDenyPayload } from '../../src/claude-code-policy.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) process.exit(0);

  let event: { tool_name?: string; tool_input?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const decision = evaluatePreToolUse(event.tool_name ?? '', event.tool_input ?? {});
  if (decision.deny && decision.reason) {
    process.stdout.write(hookDenyPayload(decision.reason));
    process.exit(2);
  }
  process.exit(0);
}

main().catch(() => process.exit(1));
