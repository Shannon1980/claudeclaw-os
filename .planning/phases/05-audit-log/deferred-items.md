# Phase 05 Audit Log — Deferred Items

Out-of-scope discoveries logged during plan 05-02 execution. NOT fixed here.

## Pre-existing failures (not caused by 05-02)

- `src/dashboard.contract.test.ts > auth gate > serves SPA shell at / without a token` — fails on clean HEAD (3d3166d) before any 05-02 change. Web SPA shell serving, unrelated to audit log. Verified via clean-tree run.
- `src/dashboard.contract.test.ts > auth gate > serves SPA shell at /warroom without a token` — same, pre-existing.
- `src/schedule-cli.test.ts` (3 cases: agent routing / --agent override / default-main) — fail with `Cannot find module dist/schedule-cli.js`. The worktree has no `dist/` build; these spawn the compiled CLI. Environment artifact, not 05-02 code. No audit reference in the file.
- `src/chat-task-tracker.test.ts > maybeStartChatTask > returns null when the classifier fails` — expects null, receives a task id; classifier-mock/timing issue. No audit reference in the file. Unrelated to 05-02.

## Wave 0 RED tests owned by later plans (intentionally still RED after 05-02)

These are 05-01 Wave 0 contracts for plan 03 (read/export/UI). 05-02 (Slice A data spine) does not implement them; they turn GREEN in plan 03.

- `src/audit-export.test.ts` — imports `toCsv` / `toJsonEnvelope` from `src/dashboard.ts` (tsc TS2305/TS2339). Plan 03 implements these serializers. (05-01-SUMMARY: "toCsv + toJsonEnvelope exported from src/dashboard.ts (plan 03 implements)".)
- `src/dashboard.contract.test.ts > GET /api/audit enriched (Pitfall 4 ...)` — read-side cost JOIN on `/api/audit`. Plan 03.
- `src/dashboard.contract.test.ts > GET /api/audit/export (Pitfall 6 ...)` (3 cases: CSV full set, JSON full set, invalid-format fallback) — the `/api/audit/export` route. Plan 03.
