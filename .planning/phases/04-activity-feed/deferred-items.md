# Phase 04 Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed by this phase's plans.

| Found | Item | Why deferred |
|-------|------|--------------|
| 04-02 Task 1 | `src/dashboard.contract.test.ts` "auth gate > serves SPA shell at / without a token" and "at /warroom without a token" fail on unmodified HEAD | Pre-existing failures unrelated to the activity feed. They expect a non-401 SPA shell that depends on `DASHBOARD_LEGACY`, which the contract test harness does not set. Verified failing on `git show HEAD` originals before any 04-02 change. Out of scope per the executor scope boundary. |
