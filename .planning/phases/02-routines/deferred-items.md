# Phase 2 — Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed here.

## 02-03 (Slice B — routines HTTP)

- **Pre-existing contract-test failures (unrelated to routines):**
  `src/dashboard.contract.test.ts > auth gate > serves SPA shell at /` and
  `... at /warroom` both fail with `expected 401 not to be 401`. Verified these
  fail identically on commit `aec53d5` (Task 1, before any dashboard.ts edits),
  so they are pre-existing and out of scope for the routines work. The other SPA
  shell paths (`/mission`, `/scheduled`, `/agents`, …) all pass. Root cause looks
  like the SPA-shell middleware gating `/` and `/warroom` (legacy `?mode=` HTML
  embeds a token, but the bare paths should pass). Needs a separate fix.
