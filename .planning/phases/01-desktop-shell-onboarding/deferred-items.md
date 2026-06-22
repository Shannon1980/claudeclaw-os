# Deferred Items — Phase 01

Out-of-scope discoveries logged during execution. NOT fixed (scope boundary: pre-existing failures in files not touched by the current plan).

## From Plan 01-01

- **`src/schedule-cli.test.ts` (4 tests) + `src/chat-task-tracker.test.ts` (2 tests) fail** in this worktree.
  - **Cause:** Both are CLI integration tests that `execSync` against `dist/schedule-cli.js` (and related compiled entrypoints). The worktree has no `dist/` build, so `node dist/schedule-cli.js` throws `MODULE_NOT_FOUND`.
  - **Pre-existing:** Neither file was modified by plan 01-01 (`git diff ecea5f6..HEAD` confirms). The failure is environmental (no build), not a regression.
  - **Resolution:** Run `npm run build` before `npm test` in CI/worktree, or gate these integration tests behind a built-dist precondition. Not a code defect.
