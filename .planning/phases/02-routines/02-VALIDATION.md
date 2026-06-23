---
phase: 2
slug: routines
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-23
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` → "Validation Architecture". Task IDs are filled in by the planner;
> rows below are keyed by requirement + the test file that proves it until plans assign task IDs.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x (per TESTING.md, STACK.md) |
| **Config file** | `vitest.config.ts` + inline `vitest` block in `package.json` |
| **Quick run command** | `npx vitest run src/routine-runner.test.ts src/routine-draft.test.ts` |
| **Full suite command** | `npm test` (`vitest run`) |
| **Estimated runtime** | ~30–60 seconds (in-memory SQLite; `runAgent` mocked) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/routine-runner.test.ts src/routine-draft.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite green + `npm run typecheck`
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD (planner) | — | 0 | RTN-01 | — | Draft assembly parses NL → {cron, steps[]}; nothing persists until confirm | unit | `npx vitest run src/routine-draft.test.ts` | ❌ W0 | ⬜ pending |
| TBD (planner) | — | 0 | RTN-01 | — | Draft endpoint returns JSON without writing rows | contract | `npx vitest run src/dashboard.contract.test.ts -t routines` | ❌ W0 (extend) | ⬜ pending |
| TBD (planner) | — | 0 | RTN-02 | — | `describeCron` renders stored cron as plain-language; no raw cron leaks to operator UI | unit | `npx vitest run web/src/lib/cron.test.ts` + row-render assertion | ⚠️ partial (`cron.ts` covered) | ⬜ pending |
| TBD (planner) | — | 0 | RTN-02 | — | `computeNextRun` validates assembled cron | unit | `npx vitest run src/routine-draft.test.ts -t cron-valid` | ❌ W0 | ⬜ pending |
| TBD (planner) | — | 0 | RTN-03 | — | Steps stored ordered; per-step teammate honored; runner threads prior output forward | unit | `npx vitest run src/routine-runner.test.ts -t teammate` | ❌ W0 | ⬜ pending |
| TBD (planner) | — | 0 | RTN-04 | T-routine-claim | On/off via pause/resume; run-now claims the routine exactly ONCE (no double-fire) | unit + contract | `npx vitest run src/scheduler.test.ts -t routine` | ❌ W0 (extend) | ⬜ pending |
| TBD (planner) | — | 0 | RTN-05 | — | `deriveOutcome` ok/degraded/failed matches D-02 incl. all-continue-fail → failed edge | unit | `npx vitest run src/routine-runner.test.ts -t outcome` | ❌ W0 | ⬜ pending |
| TBD (planner) | — | 0 | RTN-05 | T-notify-leak | State-change notify fires once on ok→broken, not on subsequent breaks (D-10) | unit | `npx vitest run src/routine-runner.test.ts -t notify-transition` | ❌ W0 | ⬜ pending |
| TBD (planner) | — | 0 | RTN-05 | — | `routine_runs` CRUD round-trips outcome + step_results + output link | unit (in-mem DB) | `npx vitest run src/db.test.ts -t routine` | ❌ W0 (extend) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/routine-runner.test.ts` — `deriveOutcome` (D-02, incl. all-continue-fail edge), step output threading, paused-teammate skip→degraded, one-claim / no-double-fire, notify-transition (D-10). Covers RTN-03/04/05. Mock `delegateToAgent`/`runAgent`.
- [ ] `src/routine-draft.test.ts` — `parseJsonLoose` against fenced/prose model output, `agent_id` validation against roster, cron validity via `computeNextRun`. Covers RTN-01/02. Mock `runAgent`.
- [ ] Extend `src/db.test.ts` — `routine_steps` / `routine_runs` CRUD + `autonomy` column round-trip, using `_initTestDatabase()` (real in-memory SQLite).
- [ ] Extend `src/dashboard.contract.test.ts` — `/api/routines*` route shapes (CRUD, draft, run-now, history), auth gate, and the draft-does-not-persist assertion.
- [ ] Extend `src/scheduler.test.ts` — `source='routine'` branch fires the runner, claim-once, paused-owner skip. (Closes the CONCERNS.md gap: scheduler.test.ts does not test double-claim.)
- [ ] Framework install: none needed — vitest present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end conversational builder UX (operator describes a routine, reviews the draft step list, confirms) | RTN-01, RTN-03 | LLM-assembled step proposal is non-deterministic; the draft→confirm interaction is UI-driven | In the dashboard Routines page, click "New routine", describe "every weekday at 8 send me a calendar+inbox brief then chase overdue invoices", verify a draft (schedule + ordered steps with teammates) appears and nothing persists until Save |
| Plain-language schedule never shows raw cron in operator path | RTN-02 | Visual assertion across list + detail | Confirm list rows and detail "When" show plain-language only; raw cron appears solely behind the advanced toggle |
| State-change failure alert lands over the active transport (Slack) | RTN-05 | Requires a live transport + a routine that degrades/fails | Force a routine step to fail (e.g., unassign a connected tool), confirm one Slack alert on first break and no repeat on the next failing run |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
