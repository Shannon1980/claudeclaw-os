/**
 * The Summarize Today daily digest (D-10). The one acceptable on-demand LLM
 * affordance on the Activity surface: an operator-invoked, plain-language
 * paragraph summarizing what the team did today.
 *
 * This reuses the existing shared Haiku path (extractViaClaude in
 * memory-ingest.ts) directly: same subscription auth the agents use, scrubbed
 * environment, no extra credential, bounded timeout. It deliberately does NOT
 * use the alternative quota-bound LLM path, which needs a separate
 * credential and is 429-prone (04-RESEARCH A4).
 *
 * Security (ASVS V8 / T-04-summarize-infodisc): the prompt carries ONLY the
 * plain-language phrase, teammate, and time from each feed row. Raw captured
 * params, environment, and secrets are NEVER copied into the prompt. The feed
 * row's `phrase` is already the params-free, deterministic one-liner from
 * activity-render's phraseFor, so it is the safe field to summarize.
 *
 * Honesty (D-05): on any failure, timeout, or empty model output, callers get
 * the honest degrade string and the real feed below stays the source of truth.
 * summarizeDay never throws to the caller and never fabricates a summary.
 */

import { extractViaClaude } from './memory-ingest.js';
import type { ActivityRow } from './activity.js';

/** The honest degrade copy (UI-SPEC). Shown when the digest cannot be produced. */
export const SUMMARIZE_DEGRADE = "Couldn't summarize right now. The feed below is complete.";

/** Bounded timeout for the one outbound LLM call (T-04-llm-dos). */
const SUMMARIZE_TIMEOUT_MS = 20_000;

/** Format a feed row's local clock time, e.g. "9:12am". No monospace, no em dash. */
function clockTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()
    .replace(/\s/g, '');
}

/**
 * Build the plain-text prompt from the feed rows. Carries ONLY the row's
 * params-free phrase, the teammate id, and the time. No raw params, no env, no
 * secrets, and no em dashes (ASVS V8, CLAUDE.md hard rule).
 */
function buildPrompt(rows: ActivityRow[]): string {
  const lines = rows.map((r) => `- ${r.agent_id} at ${clockTime(r.created_at)}: ${r.phrase}`);
  return [
    'Here is what the team did today, one action per line:',
    '',
    lines.join('\n'),
    '',
    'Write a short plain-language summary of the day in 3 to 4 sentences.',
    'Be factual and grounded only in the lines above. Do not invent actions.',
    'Use plain words, no em dashes, no jargon, no headings, no bullet points.',
    'Return only the paragraph.',
  ].join('\n');
}

/**
 * Produce a plain-language daily digest of the feed via the shared Haiku
 * subscription path. Operator-invoked only (the route gates on the kill
 * switch); this
 * module never runs on its own. Returns the model paragraph, or the honest
 * degrade string on an empty feed, a failure, a timeout, or empty output.
 *
 * @param rows - The curated feed rows to summarize (params-free phrases only).
 * @returns The plain-language digest, or the honest degrade string. Never throws.
 */
export async function summarizeDay(rows: ActivityRow[]): Promise<string> {
  if (!rows || rows.length === 0) return SUMMARIZE_DEGRADE;
  try {
    const text = await extractViaClaude(buildPrompt(rows), SUMMARIZE_TIMEOUT_MS);
    const trimmed = (text || '').trim();
    return trimmed.length > 0 ? trimmed : SUMMARIZE_DEGRADE;
  } catch {
    // Honest degrade: the feed below is complete and remains the source of truth.
    return SUMMARIZE_DEGRADE;
  }
}
