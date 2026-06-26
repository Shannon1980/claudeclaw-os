# Phase 05 Audit Log — Deferred Items

Out-of-scope discoveries logged during plan 05-02 execution. NOT fixed here.

## Pre-existing failures (not caused by 05-02)

- `src/dashboard.contract.test.ts > auth gate > serves SPA shell at / without a token` — fails on clean HEAD (3d3166d) before any 05-02 change. Web SPA shell serving, unrelated to audit log. Verified via clean-tree run.
- `src/dashboard.contract.test.ts > auth gate > serves SPA shell at /warroom without a token` — same, pre-existing.
- `src/schedule-cli.test.ts` (3 cases: agent routing / --agent override / default-main) — fail with `Cannot find module dist/schedule-cli.js`. The worktree has no `dist/` build; these spawn the compiled CLI. Environment artifact, not 05-02 code. No audit reference in the file.
- `src/chat-task-tracker.test.ts > maybeStartChatTask > returns null when the classifier fails` — expects null, receives a task id; classifier-mock/timing issue. No audit reference in the file. Unrelated to 05-02.

## Wave 0 RED tests owned by later plans (RESOLVED in plan 03)

These are 05-01 Wave 0 contracts for plan 03 (read/export/UI). 05-02 (Slice A data spine) did not implement them; plan 03 turned them GREEN.

- [x] `src/audit-export.test.ts` — `toCsv` / `toJsonEnvelope` now exported from `src/dashboard.ts`. GREEN (commit b7976c3).
- [x] `src/dashboard.contract.test.ts > GET /api/audit enriched (Pitfall 4 ...)` — read-side cost subquery on `/api/audit`. GREEN (commit b7976c3).
- [x] `src/dashboard.contract.test.ts > GET /api/audit/export (Pitfall 6 ...)` (CSV full set, JSON full set, invalid-format fallback, token gate). GREEN (commit b7976c3).

The pre-existing SPA-shell / schedule-cli / chat-task-tracker failures above remain out of scope for plan 03 (no audit reference; verified pre-existing on clean HEAD).
