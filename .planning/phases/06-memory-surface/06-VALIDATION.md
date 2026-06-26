---
phase: 6
slug: memory-surface
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-26
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^2.0.0 |
| **Config file** | `package.json` `vitest` block (`environment: node`, `include: src/**/*.test.ts`) |
| **Quick run command** | `npx vitest run src/<module>.test.ts` (the module touched by the task) |
| **Full suite command** | `npm test` (= `vitest run`) |
| **Estimated runtime** | ~30-60 seconds full suite |

---

## Sampling Rate

- **After every task commit:** Run the task's `npx vitest run src/<module>.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | MEM-01/02 | T-06-01 / T-06-02 | No migration drift; existing rows grandfathered confirmed=1 | unit | `npx vitest run src/migrations.test.ts src/migrate-runner.test.ts` | ✅ | ⬜ pending |
| 06-01-02 | 01 | 1 | MEM-01/02 | — | Wave 0 RED net pins all behaviors (incl. grouped reader + Add mutator in src/db.test.ts) | unit | `npx vitest run src/memory-provenance.test.ts src/db.test.ts` (RED expected) | ❌ W0 (memory-provenance.test.ts new; db.test.ts cases new) | ⬜ pending |
| 06-02-01 | 02 | 2 | MEM-01/02 | T-06-03 / T-06-05 | Curated DTO only; email tag honest-coverage gated; grouped reader returns both confirmed states + empty categories suppressed | unit | `npx vitest run src/memory-provenance.test.ts src/db.test.ts` | ✅ | ⬜ pending |
| 06-02-02 | 02 | 2 | MEM-01 | T-06-04 | Token-gated read; surface shows unconfirmed w/ marker | build | `npm run build` | ✅ (web build) | ⬜ pending |
| 06-03-01 | 03 | 3 | MEM-02 | T-06-09 | Deleted fact not re-derived (ingest + consolidation); Add mutator inserts confirmed/operator-source/high-salience fact | unit | `npx vitest run src/memory-ingest.test.ts src/memory-consolidate.test.ts src/db.test.ts` | ✅ | ⬜ pending |
| 06-03-02 | 03 | 3 | MEM-02 | T-06-06 / T-06-07 / T-06-08 / T-06-10 / T-06-11 | Parameterized SQL; inherited CSRF/kill-switch; enum + status guards | unit/integration | `npx vitest run src/dashboard.contract.test.ts` | ✅ | ⬜ pending |
| 06-04-01 | 04 | 4 | MEM-01/02 | T-06-12 | Unconfirmed excluded from BOTH behavior read paths | unit | `npx vitest run src/memory.test.ts src/memory-projection.test.ts` | ✅ | ⬜ pending |
| 06-04-02 | 04 | 4 | MEM-01 | T-06-13 / T-06-14 | Category clamped to enum; scrubbed extractor path | unit | `npx vitest run src/memory-ingest.test.ts` | ✅ | ⬜ pending |
| 06-04-03 | 04 | 4 | MEM-01/02 | T-06-12 | Operator end-to-end sign-off | manual | human-verify checkpoint | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/memory-provenance.test.ts` (NEW) — deriveProvenance mapping + D-05 honest email coverage (MEM-02)
- [ ] Grouped-reader + Add-mutator cases in `src/db.test.ts` — getMemoriesForOperatorSurface (empty-category suppression + BOTH confirmed states, MEM-01/crit 1, load-bearing for D-04 surface correctness) and the Add mutator (confirmed/operator-source/high-salience, crit 4)
- [ ] Tombstone suppression cases in `src/memory-ingest.test.ts` + `src/memory-consolidate.test.ts` — success criterion 3 (D-08)
- [ ] Confirmed-gate cases in `src/memory.test.ts` + `src/memory-projection.test.ts` — D-04, BOTH behavior read paths
- [ ] Migration cases in `src/migrations.test.ts` — category + confirmed columns + memory_tombstones table, idempotent, existing rows grandfathered confirmed=1
- [ ] Add/Edit/Delete/Confirm route-contract cases in `src/dashboard.contract.test.ts` — MEM-02 + D-09

*All target test files exist except `src/memory-provenance.test.ts` (created in Wave 0, Plan 01 Task 2). `src/db.test.ts` exists; new grouped-reader + Add-mutator cases are added to it in Wave 0. Framework is installed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator surface visual layout, provenance-as-hero, "needs review" marker, Labs demotion of /memories | MEM-01, D-02, D-04 | Visual/interaction verification of the live dashboard | Plan 04 Task 3 checkpoint steps 2-7 |

*All logic-bearing behaviors (provenance derivation, confirmed gate, tombstone suppression, grouped read, Add) have automated verification; only the visual surface is manual.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a Wave 0 dependency (Task 06-04-03 is the single allowed human-verify checkpoint; all logic tasks are automated)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (memory-provenance.test.ts + new cases in existing files)
- [x] No watch-mode flags (all commands are `vitest run`)
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-26
