---
phase: 04
slug: activity-feed
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-24
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.0.0 (built-in expect, `@vitest/coverage-v8`) |
| **Config file** | `vitest.config.ts` (root) — glob `src/**/*.test.ts`, setupFiles `src/test-env-setup.ts`. NOTE: web (`web/src/**`) is NOT in the vitest glob and has no web vitest harness; web logic is verified via `cd web && npx tsc --noEmit -p tsconfig.json` + `npx vite build`. |
| **Quick run command** | `npx vitest run src/activity.test.ts src/undo-executor.test.ts` |
| **Full suite command** | `npm test` (vitest run) |
| **Typecheck (server)** | `npm run typecheck` (tsc --noEmit, src only) |
| **Typecheck (web)** | `cd web && npx tsc --noEmit -p tsconfig.json` |
| **Web build gate** | `cd web && npx vite build` |
| **Estimated runtime** | ~15s quick · ~60s full suite |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/activity.test.ts src/undo-executor.test.ts` + the task's `<automated>` command.
- **After every plan wave:** Run `npm test` (full vitest) + `npm run typecheck` + (for web-touching waves) `cd web && npx tsc --noEmit && npx vite build`.
- **Before `/gsd-verify-work`:** Full suite green + both typechecks clean + web build succeeds.
- **Max feedback latency:** 60 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 0 | TRUST-01 (UI clock) | — | formatClock surfaces no secret; pure fn | typecheck | `cd web && npx tsc --noEmit -p tsconfig.json` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 0 | TRUST-01 (Summarize seam) | T-04-10 | JSON-prose parse; shared defaults untouched | unit | `npx vitest run src/gemini.test.ts` | ⚠️ extend | ⬜ pending |
| 04-01-03 | 01 | 0 | TRUST-01 + TRUST-02 (RED scaffolding) | T-04-01 / T-04-04 | secret not surfaced in phrase; Tier-4 no-dispatch | unit | `npx vitest run src/activity.test.ts src/undo-executor.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | TRUST-01 | T-04-01 / T-04-02 / T-04-03 | tags derived server-side; dedup queue-wins; phrase param allowlist | unit | `npx vitest run src/activity.test.ts -t "deriveTag\|dedup\|describeAction"` | ✅ (from W0) | ⬜ pending |
| 04-02-02 | 02 | 1 | TRUST-01 | T-04-05 | GET inherits token + CSRF gate | contract | `npx vitest run src/dashboard.contract.test.ts -t "activity"` | ✅ (from W0, un-skip) | ⬜ pending |
| 04-02-03 | 02 | 1 | TRUST-01 | T-04-02 | client renders server verdict; no monospace; no stray weight-500; no em dash | typecheck+build | `cd web && npx tsc --noEmit -p tsconfig.json && npx vite build` | n/a (web) | ⬜ pending |
| 04-03-01 | 03 | 2 | TRUST-02 | T-04-04 / T-04-06 | Tier-4 lock before dispatch; no eval; scrubbed-env MCP; never throws | unit | `npx vitest run src/undo-executor.test.ts` | ✅ (from W0) | ⬜ pending |
| 04-03-02 | 03 | 2 | TRUST-02 | T-04-07 / T-04-08 | `:id` int-validated; status-guarded; mutation kill-switch | contract | `npx vitest run src/dashboard.contract.test.ts -t "undo"` | ✅ (from W0, un-skip) | ⬜ pending |
| 04-03-03 | 03 | 2 | TRUST-02 | T-04-04 / T-04-09 | no disabled-Undo; no browser provider fetch; no theater; no em dash | typecheck+build | `cd web && npx tsc --noEmit -p tsconfig.json && npx vite build` | n/a (web) | ⬜ pending |
| 04-04-01 | 04 | 3 | TRUST-01 (D-10) | T-04-10 / T-04-11 / T-04-12 | phrase-only prompt; one LLM call; honest empty | contract | `npx vitest run src/dashboard.contract.test.ts -t "summarize"` | ⚠️ add | ⬜ pending |
| 04-04-02 | 04 | 3 | TRUST-01 (D-10) | T-04-12 | honest loading/empty/error; no fabricated digest; no em dash | typecheck+build | `cd web && npx tsc --noEmit -p tsconfig.json && npx vite build` | n/a (web) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/activity.test.ts` — RED tests: `deriveTag`, `dedup`, `describeAction` (TRUST-01)
- [ ] `src/undo-executor.test.ts` — RED tests: `tier 4`, `allowlist`, `never throws` (TRUST-02)
- [ ] `web/src/lib/format.ts` `formatClock()` + `web/src/lib/format.test.ts` (UI-SPEC clock gap)
- [ ] `src/gemini.test.ts` — JSON-wrapped-prose parse seam for Summarize (extend if exists)
- [ ] `src/dashboard.contract.test.ts` — skipped/todo stubs for `activity`, `undo`, `summarize` shapes
- Framework install: none — vitest present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual: Activity looks unlike the dense monospace Audit page (Inter, color dots, spacing) | TRUST-01 | Visual fidelity not asserted by unit tests; `human_verify_mode=end-of-phase` | Open `/activity`, compare to `/audit`; confirm reverse-chrono day grouping, teammate dots, tag pills, no monospace |
| Undo a label/draft row runs a real inverse end-to-end against the operator's live MCP server | TRUST-02 | Depends on the operator's configured MCP servers (per-operator availability, A1) | Create a label/draft action, open Activity, click Undo, confirm, verify the real label/draft is removed and toast reads "Undone." |
| Summarize produces a sensible daily digest from a live Gemini call | TRUST-01 (D-10) | LLM output quality is non-deterministic; contract test mocks the call | Click Summarize with real activity present; confirm a plain-language recap renders |

*All deterministic behaviors have automated verification; the three above are inherently visual/external/non-deterministic and run at the end-of-phase human-verify checkpoint.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (activity/undo test modules, formatClock, gemini seam, contract stubs)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
