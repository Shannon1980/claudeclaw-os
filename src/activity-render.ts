/**
 * Activity feed render helpers (D-04 / D-05). The deterministic tool->phrase
 * map that turns a stored tool call into a plain-language one-liner for the
 * Activity surface.
 *
 * This is a NEW sibling of `gate.ts` `summarize()`, NOT a replacement: it takes
 * the captured `tool_input` params so a queued/approved row can read richer
 * (e.g. "Sent email to a@b.com"), whereas `summarize()` stays the params-free
 * fallback for "Ran on its own" audit rows that carry no params (L-4).
 *
 * Honesty rules (D-05): an unmapped tool gets an honest generic ("Ran <tool>"),
 * never a fabricated detail and never a hidden row. No LLM is called here.
 * The map is deterministic and unit-tested. No em dash appears in any returned
 * phrase (CLAUDE.md hard rule).
 */

/** Strip the `mcp__<server>__` prefix from an MCP tool name, leaving the bare tool. */
function stripMcpPrefix(toolName: string): string {
  return toolName.replace(/^mcp__[^_]+__/, '');
}

/**
 * Map a stored tool call to a plain-language phrase for the Activity feed.
 *
 * Mapped families return a curated phrase from the tool name plus a few known
 * params; unmapped tools return an honest generic ("Ran <tool>") with the
 * `mcp__server__` prefix stripped. Never fabricates a detail, never hides a
 * row, never emits an em dash.
 *
 * @param toolName - The forward tool name (e.g. `mcp__gmail__send-email`).
 * @param input - The captured tool params (already JSON-parsed; may be empty).
 * @param tier - The permission tier (1..4); reserved for future tier-aware copy.
 * @returns A plain one-line phrase, free of em dashes.
 */
export function phraseFor(
  toolName: string,
  input: Record<string, unknown>,
  tier: number,
): string {
  void tier; // reserved: phrasing is currently tier-independent.

  // gmail send: name the recipient when we honestly have one.
  if (/gmail__send/i.test(toolName)) {
    const to = String(input.to ?? input.recipients ?? '').trim();
    return to ? `Sent email to ${to}` : 'Sent an email';
  }

  // draft creation across providers.
  if (/draft/i.test(toolName)) {
    return 'Prepared a draft';
  }

  // Honest generic for everything unmapped (D-05): the bare tool name, no fabrication.
  return `Ran ${stripMcpPrefix(toolName)}`;
}
