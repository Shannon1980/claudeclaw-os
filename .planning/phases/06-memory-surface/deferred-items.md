# Phase 06 — Deferred / Out-of-Scope Items

Items discovered during execution that are NOT caused by this phase's tasks and
were intentionally left alone (scope boundary).

## Pre-existing `web` TypeScript errors (06-03, Task 2)

`cd web && npx tsc --noEmit` reports errors in files this plan never touched.
They predate plan 06-03 and are unrelated to the Memory surface. My four edited
files (Memory.tsx, App.tsx, routes.ts, vocabulary.ts) compile clean.

- `src/components/AgentSuggestions.tsx` — possibly-null `suggestion` (TS18047/TS2345)
- `src/components/BrainGraph3D.tsx` — unused locals + `ImportMeta.env` typing (TS6133/TS2339)
- `src/pages/Activity.tsx` — unused `formatRelativeTime` import (TS6133)
- `src/pages/HiveMind.tsx` — unused `useEffect`; `boolean | undefined` props (TS6133/TS2322)
- `src/pages/Scheduled.tsx` — unused `Pencil`; `boolean | undefined` props (TS6133/TS2322/TS2345)
- `src/pages/StandupConfig.tsx` — unused `willRun` (TS6133)

Disposition: left untouched (not caused by 06-03). The plan acceptance criterion
is scoped to "no errors in Memory.tsx / App.tsx / routes.ts", which holds.

## Pre-existing full-suite failures (06-04, Task 1/3 final `npm test`)

`npm test` reports 6 failures in files outside 06-04's scope (memory-ingest,
memory-consolidate, db save-path, backfill). All 7 memory suites are GREEN
(176/176). The 6 failures predate 06-04 and are not caused by it:

- `src/schedule-cli.test.ts` (3) — `Cannot find module dist/schedule-cli.js`.
  The test spawns the COMPILED CLI from `dist/`, which is not built in this
  worktree. Build-artifact dependency, unrelated to memory.
- `src/chat-task-tracker.test.ts` (1) — `maybeStartChatTask` returns an id
  where the test expects null when the classifier "fails"; the in-test
  classifier path returns a value. Unrelated to memory category/tombstone.
- `src/warroom-text-db.test.ts` (2) — `searchMemories` returns 0 because the
  06-02 `confirmed = 1` behavior gate filters out the `confirmed = 0` rows
  these tests save via `saveStructuredMemory`. Same family the 06-02 SUMMARY
  documented (reader tests must save confirmed=1 rows to exercise the reader).
  Caused by 06-02's gate, not by 06-04's category/backfill work.

Disposition: left untouched (SCOPE BOUNDARY). 06-04 only adds a nullable
`category` column to the INSERT and a category enum validator — neither can
reduce `searchMemories` results or affect the CLI/classifier tests. The 06-04
verify (`grep isTombstoned`, ingest/consolidate/db suites, backfill tsc) holds.
