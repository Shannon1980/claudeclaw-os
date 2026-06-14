---
phase: 02-skills-over-chat
plan: 01
status: complete
requirements: [SK-03]
---

# Plan 02-01 Summary — Delegation file-marker fix + regression guards

## What was built

Closed the delegation-path file-delivery gap so a delegated agent (`@id:`) can deliver a real file as a chat attachment, fleet-wide.

- **Task 1 (guard):** Added a `format.test.ts` case proving a bracketed `[SEND_PHOTO:/Users/x/App Repo/.../d.png|caption]` marker parses to the full path (not truncated at the space). Guards the workspace path-with-spaces behavior. The bracketed form already preserved spaces, so this is a regression guard, not a fix.
- **Task 2 (fix + tests):** Patched the delegation branch in `src/message-core.ts`. It now runs `extractFileMarkers(response)` and a guarded `sendPhoto`/`sendFile` loop (mirroring the main-path loop at lines ~441-456 and `mission-files.ts`) before posting the stripped reply. Previously the branch posted `result.text` raw, so any marker leaked into chat as text and the file never uploaded. Added two `message-core.test.ts` cases: a delegated reply with a `[SEND_PHOTO:]` marker routes to `sendPhoto` and strips the marker from the posted text; a marker-free delegated reply posts normally and sends no file. Also fixed a latent test-isolation issue: `beforeEach` now restores `parseDelegation` to its default (`null`) since `clearAllMocks` does not reset implementations.
- **Task 3 (regression gate):** Full `vitest run` — 519 passed / 4 failed / 4 skipped. The 4 failures are the exact documented Phase 1 baseline (3 environmental `schedule-cli` tests that exec `dist/` + need the runtime `.env` DB key; 1 pre-existing `dashboard.contract` chatId bug, filed as `task_aa93cb02`). None trace to `message-core.ts`, `format.ts`, or the new tests. 3 new tests added (516 → 519 passing).

## Key files / changes

- `src/message-core.ts` — delegation branch (~lines 212-250): added `extractFileMarkers` + guarded file-send loop; posts the stripped `delegatedText`; emits stripped text to SSE.
- `src/format.test.ts` — space-in-path bracketed-marker case.
- `src/message-core.test.ts` — two delegation cases + `beforeEach` parseDelegation reset.

## Decisions / deviations

- **`saveConversationTurn` left on the raw `response`** (with marker), matching the main path's `rawResponse` semantics so memory attribution is unchanged. Only the displayed/posted text is stripped.
- **SSE `emitChatEvent` uses the stripped text** (minor divergence from the main path, which emits raw): cleaner for the dashboard, and the file is delivered as an attachment regardless. Documented here so it is intentional, not accidental.
- No new packages; reused the existing `extractFileMarkers` parser and `fs` import.

## Verification

- `npx vitest run src/format.test.ts src/message-core.test.ts` → 23/23 green.
- `npm run build` (vite + tsc) succeeds.
- Full suite: no new failures vs Phase 1 baseline.

## Self-Check: PASSED

SK-03 code path is in place and regression-guarded. Live attachment proof happens in plan 02-02.
