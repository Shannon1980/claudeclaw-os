#!/usr/bin/env tsx
/**
 * One-time, idempotent category backfill (D-06).
 *
 * The Memory surface groups facts by category (your-business | your-clients |
 * how-you-work). New facts get a category on ingest, but rows created before
 * the classifier landed have `category IS NULL`. This script classifies those
 * existing rows via the SAME Haiku-via-OAuth extractor the live ingest uses
 * (no new LLM path, no extra API key) and UPDATEs them with a parameterized
 * statement.
 *
 * Properties:
 *  - Idempotent: only SELECTs rows WHERE category IS NULL, so re-running it
 *    never re-touches a row that already has a category. Safe to run repeatedly.
 *  - Rate-aware: mirrors the ingest 429/RESOURCE_EXHAUSTED backoff so a quota
 *    wall pauses instead of hammering the API and flooding the log.
 *  - Fail-soft: a single classify failure logs + skips that row and continues;
 *    it never aborts the whole run.
 *  - Safe writes: category validated against the 3-value enum
 *    (normalizeOperatorCategory); unknown/invalid -> left NULL (D-07). UPDATE
 *    binds via `?` placeholders (T-06-03 SQLi mitigation).
 *
 * Only already-stored fact summaries are sent to the model — the same trust
 * level as live ingest (threat T-06-09, accepted).
 *
 * Run with: npx tsx scripts/backfill-memory-categories.ts
 */
import { initDatabase, getDb, normalizeOperatorCategory } from '../src/db.js';
import { extractViaClaude } from '../src/memory-ingest.js';
import { parseJsonResponse } from '../src/gemini.js';

// Quota-aware backoff, copied from the ingest model: when the extractor hits
// 429 / RESOURCE_EXHAUSTED we pause rather than retry-spam.
const QUOTA_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|RESOURCE_EXHAUSTED|quota/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CLASSIFY_PROMPT = `You are a memory categorizer. Given a single stored fact about a user, assign the single best-fit category, or null if none clearly applies.

Categories:
- "your-business": facts about the user's own business, company, products, finances, or goals
- "your-clients": facts about the user's clients, customers, or the people they serve
- "how-you-work": the user's working preferences, habits, workflows, standing rules, and corrections
- null: the fact does not clearly fit any of the three categories

Return ONLY JSON, no prose:
{ "category": "your-business" | "your-clients" | "how-you-work" | null }

Fact: {SUMMARY}`;

interface ClassifyResult {
  category?: string | null;
}

async function classify(summary: string): Promise<string | null> {
  const prompt = CLASSIFY_PROMPT.replace('{SUMMARY}', summary.slice(0, 2000));
  const raw = await extractViaClaude(prompt);
  const parsed = parseJsonResponse<ClassifyResult>(raw);
  // Validate against the 3-value enum; unknown/absent -> NULL (D-07).
  return normalizeOperatorCategory(parsed?.category);
}

async function main(): Promise<void> {
  initDatabase();
  const db = getDb();

  const rows = db
    .prepare(`SELECT id, summary FROM memories WHERE category IS NULL`)
    .all() as Array<{ id: number; summary: string }>;

  console.log(`Found ${rows.length} memory rows with category IS NULL.`);
  if (rows.length === 0) {
    console.log('Nothing to backfill. Exiting.');
    return;
  }

  const update = db.prepare(`UPDATE memories SET category = ? WHERE id = ?`);

  let updated = 0;
  let leftNull = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const category = await classify(row.summary);
      if (category) {
        update.run(category, row.id);
        updated++;
        console.log(`  [${row.id}] -> ${category}`);
      } else {
        leftNull++;
        console.log(`  [${row.id}] -> (no clear category, left NULL)`);
      }
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn(
          `Quota wall hit. Pausing ${QUOTA_BACKOFF_MS / 1000}s before continuing...`,
        );
        await sleep(QUOTA_BACKOFF_MS);
        // Retry this same row once after the cooldown; on a second failure,
        // fall through to the skip path below.
        try {
          const category = await classify(row.summary);
          if (category) {
            update.run(category, row.id);
            updated++;
            console.log(`  [${row.id}] -> ${category} (after backoff)`);
            continue;
          }
          leftNull++;
          console.log(`  [${row.id}] -> (no clear category, left NULL)`);
          continue;
        } catch (retryErr) {
          skipped++;
          console.warn(`  [${row.id}] skipped after backoff: ${retryErr instanceof Error ? retryErr.message : retryErr}`);
          continue;
        }
      }
      // Non-quota failure: log + skip this row, never abort the whole run.
      skipped++;
      console.warn(`  [${row.id}] classify failed, skipping: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `\nBackfill complete. updated=${updated} leftNull=${leftNull} skipped=${skipped} (of ${rows.length}).`,
  );
  console.log('Re-running is safe: only category IS NULL rows are touched.');
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
