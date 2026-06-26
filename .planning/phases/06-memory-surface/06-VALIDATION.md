---
phase: 6
slug: memory-surface
status: approved
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
| **Quick run command** | `npx vitest run src/memory.test.ts src/memory-ingest.test.ts` |
| **Full suite command** | `npm test` (= `vitest run`) |
| **Estimated runtime** | ~30 seconds (full suite); quick run ~5s |

---

## Sampling Rate

- **After every task commit:** Run the relevant `npx vitest run src/<module>.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 0/1 | MEM-01 / MEM-02 | T-06-03 | Wave 0 test stubs (provenance, tombstone, confirmed-gate, migration cases) compile and run red | unit | `npx vitest run src/memory.test.ts src/memory-ingest.test.ts src/memory-consolidate.test.ts src/memory-projection.test.ts src/migrations.test.ts` | ✅ all exist | ⬜ pending |
| 06-02-01 | 02 | 2 | MEM-01 / MEM-02 | T-06-04 | Dual-write migration applies idempotently (no drift); `confirmed=1` backfill on existing rows | unit | `npx vitest run src/migrations.test.ts src/migrate-runner.test.ts` | ✅ src/migrations.test.ts, src/migrate-runner.test.ts | ⬜ pending |
| 06-02-02 | 02 | 2 | MEM-02 | T-06-03 | `deriveProvenance` maps source+agent_id to 3 tags; D-05 email tag only if email row exists; SQL bound via `?` | unit | `npx vitest run src/db.test.ts src/memory.test.ts` | ✅ src/db.test.ts, src/memory.test.ts | ⬜ pending |
| 06-02-03 | 02 | 2 | MEM-01 / D-04 | T-06-05 (EoP) | Unconfirmed facts excluded from `buildMemoryContext` AND `renderMemoryProjection`; present after confirm | unit | `npx vitest run src/memory.test.ts src/memory-projection.test.ts` | ✅ src/memory.test.ts, src/memory-projection.test.ts | ⬜ pending |
| 06-03-01 | 03 | 3 | MEM-01 / MEM-02 | T-06-05 / T-06-03 | Mutations inherit token gate + CSRF + kill switch; id/category validated; tombstone-first delete; status-guarded confirm | unit/integration | `npx vitest run src/dashboard.contract.test.ts` | ✅ src/dashboard.contract.test.ts | ⬜ pending |
| 06-03-02 | 03 | 3 | MEM-01 / MEM-02 | — | TypeScript compiles clean (operator page + nav wiring); no hard-coded hex; redirect removed | typecheck | `! (cd web && npx tsc --noEmit 2>&1 \| grep -v node_modules \| grep -qi error)` | n/a (tsc) | ⬜ pending |
| 06-03-03 | 03 | 3 | MEM-01 / MEM-02 | — | Operator walks live surface (grouped view, provenance, Add/Edit/Delete/Confirm, demoted developer view) | manual | human-verify checkpoint | n/a | ⬜ pending |
| 06-04-01 | 04 | 4 | MEM-02 / D-08, D-06 | T-06-04 | Tombstone checked before save on ingest (hash floor + cosine); category from extractor validated or NULL | unit | `npx vitest run src/memory-ingest.test.ts` | ✅ src/memory-ingest.test.ts | ⬜ pending |
| 06-04-02 | 04 | 4 | MEM-02 / D-08 | T-06-08 | Tombstone checked before `saveConsolidationAtomic`; synthesized tombstoned fact not re-saved | unit | `npx vitest run src/memory-consolidate.test.ts` | ✅ src/memory-consolidate.test.ts | ⬜ pending |
| 06-04-03 | 04 | 4 | MEM-01 / D-06 | T-06-03 | Backfill script compiles; selects `category IS NULL` only; UPDATE binds via `?`; enum-validated | typecheck | `! (npx tsc --noEmit scripts/backfill-memory-categories.ts 2>&1 \| grep -qi error)` | n/a (tsc) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Framework + test files all exist; Wave 0 gaps are new test cases within existing files plus optionally one new provenance test file:

- [ ] Provenance cases in `src/memory.test.ts` (or new `src/memory-provenance.test.ts`) — covers MEM-02 derivation + D-05 honest email coverage
- [ ] Tombstone suppression cases in `src/memory-ingest.test.ts` + `src/memory-consolidate.test.ts` — covers crit 3
- [ ] `confirmed`-gate cases in `src/memory.test.ts` and `src/memory-projection.test.ts` — covers D-04 (both behavior read paths)
- [ ] Migration cases in `src/migrations.test.ts` for the new columns + tombstone table + `confirmed=1` existing-row backfill

*No framework install needed: vitest ^2.0.0 is present and all module test files exist.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live operator Memory surface (grouped view, provenance pills, Add/Edit/Delete/Confirm, on-this-machine assurance, demoted developer view) | MEM-01, MEM-02 | Visual + interactive UI verification of the live dashboard | 06-03 Task 3 checkpoint: open `/memory`, confirm header/assurance copy, grouped categories, provenance pills, Add a fact, Edit, Delete (tombstone toast), Confirm an unconfirmed fact, and that `/memories` is off the daily nav but reachable by URL |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-26
