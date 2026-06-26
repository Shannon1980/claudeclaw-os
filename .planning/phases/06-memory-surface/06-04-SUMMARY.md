---
phase: 06-memory-surface
plan: 04
subsystem: memory
tags: [memory, tombstone, category, ingest, consolidation, backfill, enforcement]
requires:
  - "06-01 RED behavioral contract (tombstone suppression + category-on-ingest specs)"
  - "06-02 db spine (isTombstoned, normalizeSummary, memories.category column, saveStructuredMemory* with confirmed)"
provides:
  - "Category classification on ingest: EXTRACTION_PROMPT returns a 3-value enum, validated + persisted (D-06)"
  - "normalizeOperatorCategory: single-source enum validator reused by ingest + backfill + save path (D-07)"
  - "category threaded through saveStructuredMemory + saveStructuredMemoryAtomic (nullable, backward-compatible)"
  - "scripts/backfill-memory-categories.ts: idempotent category-IS-NULL backfill via existing Haiku extractor"
  - "Confirmed D-08 two-point tombstone suppression GREEN on both write paths (ingest + consolidate)"
affects:
  - src/db.ts
  - src/memory-ingest.ts
  - src/memory-ingest.test.ts
  - scripts/backfill-memory-categories.ts
tech-stack:
  added: []
  patterns:
    - "Category enum validated like importance is clamped: model value -> normalizeOperatorCategory -> NULL on unknown (D-07)"
    - "Single-source enum: normalizeOperatorCategory references OPERATOR_FACT_CATEGORIES at call time, no duplicated literal list"
    - "Backfill reuses extractViaClaude (Haiku-via-OAuth) + the ingest 429 backoff model; no new LLM path / API key"
    - "Idempotent backfill: SELECT category IS NULL only; parameterized UPDATE (T-06-03 SQLi mitigation)"
    - "Tombstone gate already wired by 06-02 (d190ac1 consolidate, be27c92 ingest) — reconciled, not duplicated"
key-files:
  created:
    - scripts/backfill-memory-categories.ts
  modified:
    - src/db.ts
    - src/memory-ingest.ts
    - src/memory-ingest.test.ts
decisions:
  - "Task 2 (consolidation tombstone gate) was already landed by 06-02 commit d190ac1; verified GREEN (12 tests) and NOT re-committed — no duplicate wiring"
  - "category added as a trailing nullable param to saveStructuredMemory/saveStructuredMemoryAtomic so all existing call sites stay valid (confirmed default unchanged at 0)"
  - "Backfill script implemented + tsc-verified but NOT run against the live store: 24 NULL-category rows pending, three agents (main/social/aos) are live, store is symlinked from main, and the plan verify is tsc-only. Deferred to the operator (safe + idempotent to run)"
metrics:
  duration: ~6min
  completed: 2026-06-26
---

# Phase 06 Plan 04: Memory Enforcement Slice Summary

Turned the last Wave 0 RED behaviors GREEN: category classification on ingest (the model now classifies each new fact into the 3-value operator enum, validated and persisted; unknown -> NULL), an idempotent backfill script for existing NULL-category rows, and a confirmed end-to-end D-08 two-point tombstone suppression on both write paths.

## What Was Built

**Task 1 (commit 7a36076) — category classification on ingest (D-06/D-07).**
- Extended `EXTRACTION_PROMPT` in `memory-ingest.ts` with a `category` field constrained to `your-business | your-clients | how-you-work | null`, plus a category guide block telling the model how to pick.
- Added `normalizeOperatorCategory(value)` to `db.ts` — the single source of truth for the enum, referencing `OPERATOR_FACT_CATEGORIES` at call time (no duplicated literal). Unknown / absent / invalid -> `null` (D-07).
- Threaded `category` through `saveStructuredMemory` (now INSERTs the `category` column) and `saveStructuredMemoryAtomic` as a trailing nullable param, so every existing call site stays valid and `confirmed` keeps its `0` default.
- `ingestConversationTurn` validates the model's category the same way importance is clamped and passes it to the atomic save.
- Added 3 category-on-ingest tests (valid category persisted; unknown -> NULL; absent -> NULL); updated the 3 existing `toHaveBeenCalledWith` assertions for the new 10th arg. `memory-ingest.test.ts` 20 -> 23 GREEN.

**Task 2 (no new commit — already landed by 06-02 d190ac1) — consolidation tombstone gate (D-08).**
- The plan's prompt flagged this overlap: 06-02 already wired `isTombstoned(chatId, result.summary)` before `saveConsolidationAtomic` in `runConsolidation` (`memory-consolidate.ts:101`). Verified the wiring is correct and the plan-01 RED suppression case is GREEN (12/12). Reconciled per the orchestrator instruction: marked done, NOT duplicated.

**Task 3 (commit f501bfb) — idempotent category backfill script (D-06).**
- `scripts/backfill-memory-categories.ts` (runnable via `npx tsx`): `SELECT ... WHERE category IS NULL`, classifies each summary through a small classify-only prompt via the existing `extractViaClaude` (Haiku-via-OAuth — no new LLM path / API key), validates via `normalizeOperatorCategory`, and `UPDATE memories SET category = ? WHERE id = ?` (parameterized, T-06-03).
- Idempotent (only touches NULL rows, safe to re-run), rate-aware (copies the ingest 429/RESOURCE_EXHAUSTED backoff with a single post-cooldown retry), fail-soft (a single classify failure skips + continues, never aborts the run). Logs `updated/leftNull/skipped` counts.

## Verification

- `grep -c isTombstoned src/memory-ingest.ts src/memory-consolidate.ts` = 2 / 2 (gate present in both engine paths).
- Memory suites GREEN: `memory-ingest` (23), `memory-consolidate` (12), `db` (82), `memory` (18), `memory-projection` (6), `memory-provenance` (7), `migrations` (28) — **176 passed**.
- `npx tsc --noEmit` clean (project) and standalone for the backfill script (project tsconfig only includes `src/**`, so the script was also checked directly).
- Backfill checks: `category IS NULL` filter present, `SET category = ?` parameterized, reuses `extractViaClaude`, 0 new LLM clients / API keys.

## Run-or-Defer decision (backfill)

Implemented + tsc-verified; **NOT run against the live store.** The live DB has 24 memory rows, all `category IS NULL`. Running would make 24 real LLM calls on the OAuth subscription and mutate the live store while three agents (main/social/aos) are running, and the plan's Task 3 verify is tsc-only (it does not call for running it). The script is safe and idempotent to run later — left to the operator:

```
npx tsx scripts/backfill-memory-categories.ts
```

## Deviations from Plan

### Reconciled overlap (not a deviation, per orchestrator instruction)

**Task 2 consolidation gate already done by 06-02.** The 06-02 executor wired the consolidate-path `isTombstoned` consult (commit d190ac1, "D-08 second consult"). Verified correct + GREEN and did not re-implement or re-commit. The ingest-path gate (be27c92) was likewise already present; Task 1 added category classification around it without touching the gate.

### None other

Tasks 1 and 3 executed as written.

## Out of Scope (logged to deferred-items.md, not fixed)

Full `npm test` shows 6 failures outside this plan's scope — all pre-existing, none caused by 06-04 (which only adds a nullable `category` column + an enum validator):

- `src/schedule-cli.test.ts` (3) — `Cannot find module dist/schedule-cli.js` (test spawns the compiled CLI; `dist/` not built in this worktree).
- `src/chat-task-tracker.test.ts` (1) — classifier returns an id where the test expects null; unrelated to memory.
- `src/warroom-text-db.test.ts` (2) — `searchMemories` returns 0 because 06-02's `confirmed = 1` behavior gate filters the `confirmed = 0` rows these tests save. Caused by 06-02's gate (same family the 06-02 SUMMARY noted), not by 06-04.

## Known Stubs

None. Category is real data on the write path; the backfill is fully wired to live SQLite + the existing extractor. The only deliberate non-action is leaving the live-DB backfill RUN to the operator (documented above), which is an operational choice, not a code stub.

## Self-Check: PASSED

- Created file exists: `scripts/backfill-memory-categories.ts` FOUND.
- Commits exist: 7a36076 (Task 1), f501bfb (Task 3); Task 2 reconciled to pre-existing d190ac1.
- `grep -c isTombstoned` = 2/2; memory suites 176/176 GREEN; tsc clean.
