---
phase: 06-memory-surface
plan: 01
subsystem: memory
tags: [tdd, wave-0, red-tests, memory, provenance, tombstone, migration]
requires: []
provides:
  - "Failing (RED) behavioral contract for the entire memory-surface phase"
  - "Schema artifact assertions: memories.category (D-06), memories.confirmed (D-04), memory_tombstones (D-08)"
  - "deriveProvenance + honest email coverage spec (D-03/D-05)"
  - "confirmed-gate spec on buildMemoryContext + renderMemoryProjection (D-04)"
  - "tombstone suppression spec on ingest + consolidation (D-08)"
  - "four /api/memory* mutation route contracts (MEM-02/D-09)"
affects:
  - src/db.ts
  - src/dashboard.ts
  - src/memory.ts
  - src/memory-projection.ts
  - src/memory-ingest.ts
  - src/memory-consolidate.ts
  - migrations/version.json
  - migrations/v1.2.5
tech-stack:
  added: []
  patterns:
    - "Wave 0 RED scaffolding: tests reference modules/columns/routes that do not exist yet"
    - "Dual-write drift guard: createSchema artifacts asserted byte-identical to the migration (Pitfall 1)"
    - "Parameterized SQL (? placeholders) in every test DB write"
key-files:
  created:
    - src/memory-provenance.test.ts
  modified:
    - src/migrations.test.ts
    - src/db.test.ts
    - src/memory.test.ts
    - src/memory-projection.test.ts
    - src/memory-ingest.test.ts
    - src/memory-consolidate.test.ts
    - src/dashboard.contract.test.ts
decisions:
  - "deriveProvenance returns 'told'|'work'|'email'; a separate provenanceLabelsForSurface() enforces D-05 honest email coverage (email tag only when an email-sourced row exists)"
  - "confirmed-gate pinned at the read path via a small introspection seam (isMemoryReaderConfirmedGated) + a projection-module source grep, since both behavior readers are mocked in their unit suites"
  - "memory fixture factories default confirmed=1 so existing GREEN cases stay green; new RED cases drive confirmed=0 explicitly"
metrics:
  duration: ~12min
  completed: 2026-06-26
---

# Phase 06 Plan 01: Memory Surface Wave 0 Test Scaffolding Summary

Authored 25 failing (RED) tests across 8 files that pin every MEM-01/MEM-02 behavior plus D-03/D-04/D-05/D-06/D-08 enforcement before any implementation exists. No production code changed; plans 02-04 turn this bar GREEN.

## What Was Built

**Task 1 (commit 9487602) — migration + schema RED.** `src/migrations.test.ts` + `src/db.test.ts`:
- v1.2.5 registration in `version.json` + highest-version assertion.
- `memories.category` (TEXT, nullable, D-06) and `memories.confirmed` (INTEGER NOT NULL DEFAULT 0, D-04).
- `memory_tombstones` table (id, chat_id, text_hash NOT NULL, embedding, summary, created_at) + a (chat_id, text_hash) index (D-08), idempotent.
- Drift guard: `createSchema`/`runMigrations` artifacts match what the versioned migration would add (Pitfall 1).
- New-row default behavior: an inserted memory defaults `confirmed=0`, `category=NULL`.

**Task 2 (commit cc2441a) — provenance + confirmed gate RED.** `src/memory-provenance.test.ts` (new) + `memory.test.ts` + `memory-projection.test.ts`:
- `deriveProvenance`: `you-told-me`/`checkpoint` -> `told`, `conversation` -> `work`, `email` -> `email` (D-03).
- `provenanceLabelsForSurface`: emits `email` ONLY when an email-sourced row exists; omits otherwise (D-05).
- `buildMemoryContext` omits unconfirmed facts, includes once `confirmed=1` (D-04).
- `renderMemoryProjection` (second behavior read path) does not project unconfirmed facts (D-04).

**Task 3 (commit c9a0e89) — tombstone + mutation routes RED.** `memory-ingest.test.ts` + `memory-consolidate.test.ts` + `dashboard.contract.test.ts`:
- Ingest: `isTombstoned` consulted before save; a re-fed deleted fact yields no new row (D-08, crit 3). Non-tombstoned fact still saves.
- Consolidation: a synthesized summary matching a tombstone is not saved; a novel one is.
- Four routes pinned: `POST /api/memory` (confirmed=1, source='you-told-me', category, D-09), `PATCH /api/memory/:id` (summary/category, Number.isInteger id guard), `DELETE /api/memory/:id` (writes tombstone BEFORE removing row, Pitfall 6), `POST /api/memory/:id/confirm` (confirmed=1, double-call no-op). Category validated against {your-business, your-clients, how-you-work}.

## Verification

- `npx vitest run` over all 8 files: 8 files failed, 25 new cases RED, 261 pre-existing cases GREEN. This is the expected Wave 0 outcome.
- Per-task `<verify>` grep gates (`fail|category|confirmed|tombstone`, `fail|deriveProvenance|confirmed`, `fail|tombstone|/api/memory`) all matched.
- No production source modified: `git diff --name-only` across the plan shows only `*.test.ts` files (verified `NO PRODUCTION SOURCE MODIFIED`).

## How the RED bar is expressed

- `memory-provenance.test.ts` fails to resolve `./memory-provenance.js` (module absent).
- Schema/migration tests fail on missing `category`/`confirmed`/`memory_tombstones`.
- Behavior-gate tests fail on the missing `isMemoryReaderConfirmedGated` seam and the missing `confirmed` reference in `memory-projection.ts`.
- Ingest/consolidate tests fail because the engines do not yet consult `isTombstoned`.
- Dashboard route tests fail with 404 (routes unregistered) and `no column named confirmed`.

## Deviations from Plan

None - plan executed exactly as written. The plan's `<read_first>` references to `src/memory-ingest.ts:205-244`, the v1.2.4 migration analog, and the db.ts PRAGMA-guarded ADD pattern all matched the worktree; assertions were modeled on those existing shapes.

## Known Stubs

None. This is a test-only RED scaffolding plan; the absent modules/columns/routes are the intended RED bar, tracked by plans 02-04 (not stubs in shipped code).

## Self-Check: PASSED

- Created file exists: `src/memory-provenance.test.ts` FOUND.
- Modified files present and committed: migrations.test.ts, db.test.ts, memory.test.ts, memory-projection.test.ts, memory-ingest.test.ts, memory-consolidate.test.ts, dashboard.contract.test.ts.
- Commits exist: 9487602 (Task 1), cc2441a (Task 2), c9a0e89 (Task 3).
