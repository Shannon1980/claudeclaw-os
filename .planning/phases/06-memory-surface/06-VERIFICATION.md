---
phase: 06-memory-surface
verified: 2026-06-26T14:00:00Z
status: human_needed
score: 4/4
overrides_applied: 0
human_verification:
  - test: "Walk the live /memory surface against the 7-step operator checklist"
    expected: "Grouped categories, provenance pills, Add/Edit/Delete/Confirm all function; assurance line visible; /memories demoted from nav but reachable by URL"
    why_human: "Visual + interactive UI verification of the live dashboard; operator already approved live surface during 06-03 Task 3 checkpoint"
---

# Phase 06: Memory Surface Verification Report

**Phase Goal:** An operator can see, correct, and control what the assistant knows about them and their business, with every fact showing where it came from.
**Verified:** 2026-06-26T14:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A user can view what the assistant knows, grouped by category (your business / your clients / how you like to work) | VERIFIED | `getMemoriesForOperatorSurface` returns all rows ordered for category grouping; `Memory.tsx` uses `useMemo` to group by `CATEGORY_ORDER = ['your-business','your-clients','how-you-work']`, rendering each group only when non-empty (D-07). |
| 2 | Each fact shows provenance ("You told me" / "Learned from your work" / "Learned from email") | VERIFIED | `src/memory-provenance.ts` exports `deriveProvenance` (source-to-tag mapping D-03) and `provenanceLabelsForSurface` (D-05 email omission). GET `/api/memory` maps every row through `deriveProvenance` and calls `provenanceLabelsForSurface(rows)` to enforce honest email coverage. `Memory.tsx` renders a `Pill` with the provenance tag as the hero element on each fact card. |
| 3 | A user can edit or delete any fact in place, and a deleted fact is not silently re-derived | VERIFIED | PATCH `/api/memory/:id` and DELETE `/api/memory/:id` routes wired in `dashboard.ts`. DELETE calls `writeTombstoneForMemory(id)` BEFORE `deleteMemory(id)` (tombstone-first, Pitfall 6). `isTombstoned` is checked in `memory-ingest.ts` before `saveStructuredMemoryAtomic` and in `memory-consolidate.ts` before `saveConsolidationAtomic`. Both engine paths confirmed green (296 tests pass, including tombstone suppression cases). |
| 4 | A user can add a fact, and a prominent assurance states it is stored on this machine | VERIFIED | POST `/api/memory` route in `dashboard.ts` calls `addOperatorFact` (stamps `source='you-told-me'`, `confirmed=1`, validated category). `Memory.tsx` renders "Stored on this machine. Edit or delete anything." in the `PageHeader` action slot and "Stored on this machine. You can edit or delete it anytime." inside the Add modal (lines 124, 404). |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/memory-provenance.ts` | deriveProvenance + provenanceLabelsForSurface | VERIFIED | 49 lines, exports both functions, no Preact import |
| `migrations/v1.2.5/add-memory-surface-columns.ts` | Dual-write migration: category + confirmed + memory_tombstones | VERIFIED | exports `description` and `run`; PRAGMA-guarded ADD COLUMN; grandfather UPDATE memories SET confirmed=1; tombstone table + index |
| `src/db.ts` | createSchema dual-write, confirmed gate, operator-surface reader, tombstone helpers | VERIFIED | `confirmed = 1` gate present 8 times; `getMemoriesForOperatorSurface`, `writeTombstoneForMemory`, `isTombstoned`, `addOperatorFact`, `confirmMemory`, `updateOperatorFact`, `deleteMemory` all present; `TOMBSTONE_COSINE_THRESHOLD = 0.88` named constant |
| `web/src/pages/Memory.tsx` | Operator Memory surface: grouped facts, provenance pills, Add/Edit/Delete/Confirm | VERIFIED | 487 lines; all verbatim copy strings present; 16 `var(--color-*)` tokens; zero hard-coded hex |
| `src/dashboard.ts` | GET + POST + PATCH + DELETE + confirm /api/memory* routes | VERIFIED | All 5 routes registered under `/api/memory`; SQL delegated entirely to db.ts functions |
| `src/memory-ingest.ts` | Tombstone gate + category classification on ingest | VERIFIED | `isTombstoned` called before `saveStructuredMemoryAtomic` (2 hits); `normalizeOperatorCategory` validates model output |
| `src/memory-consolidate.ts` | Tombstone gate before saveConsolidationAtomic | VERIFIED | `isTombstoned` called before `saveConsolidationAtomic` (2 hits) |
| `scripts/backfill-memory-categories.ts` | Idempotent category backfill | VERIFIED | 141 lines; `WHERE category IS NULL` filter (idempotent); `UPDATE memories SET category = ?` parameterized; reuses `extractViaClaude`; no new LLM path |
| `migrations/version.json` | v1.2.5 registered | VERIFIED | `"v1.2.5": ["add-memory-surface-columns"]` present |
| `web/src/lib/routes.ts` | /memory RouteDef in intelligence section; /memories demoted | VERIFIED | `/memory` with `section: 'intelligence'` at line 34; `/memories` absent from all routes |
| `web/src/App.tsx` | /memory route added; /memory -> /memories redirect removed | VERIFIED | `<Route path="/memory"><Memory /></Route>` at line 58; redirect comment at line 71 confirms removal |
| `web/src/lib/vocabulary.ts` | nav.memory term | VERIFIED | `'nav.memory': { operator: 'Memory', builder: 'Memory' }` at line 57 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `web/src/pages/Memory.tsx` | `/api/memory` | `apiGet('/api/memory')` in load() callback | WIRED | Line 79: `apiGet<MemoryResponse>('/api/memory')` |
| `web/src/pages/Memory.tsx` | POST/PATCH/DELETE `/api/memory` | `apiPost`, `apiPatch`, `apiDelete` calls in confirmFact, deleteFact, EditFactModal, AddFactModal | WIRED | Lines 191, 213, 338, 361 |
| `src/dashboard.ts DELETE /api/memory/:id` | `writeTombstoneForMemory + deleteMemory` | tombstone-first then delete (Pitfall 6) | WIRED | Lines 2405-2407: `writeTombstoneForMemory(id)` called before `deleteMemory(id)` |
| `src/dashboard.ts GET /api/memory` | `deriveProvenance + provenanceLabelsForSurface` | map + call in handler | WIRED | Lines 2354, 2361 |
| `src/memory-ingest.ts ingestConversationTurn` | `isTombstoned` | checked before `saveStructuredMemoryAtomic` | WIRED | Line 237 |
| `src/memory-consolidate.ts runConsolidation` | `isTombstoned` | checked before `saveConsolidationAtomic` | WIRED | Line 101 |
| `src/db.ts getMemoriesWithEmbeddings / searchMemories / getRecentHighImportanceMemories` | `confirmed = 1` gate | AND clause beside superseded_by IS NULL | WIRED | 8 occurrences of `confirmed = 1` in db.ts |
| `web/src/lib/routes.ts /memory RouteDef` | `Memory` component | `<Route path="/memory"><Memory /></Route>` in App.tsx | WIRED | Lines 11, 58 in App.tsx |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `web/src/pages/Memory.tsx` | `rows` (MemoryFact[]) | `apiGet('/api/memory')` -> `getMemoriesForOperatorSurface(chatId)` -> SQLite `SELECT` on `memories` | Yes — real SQL SELECT, no static fallback | FLOWING |
| `src/dashboard.ts GET /api/memory` | `rows` | `getMemoriesForOperatorSurface` SELECT from memories table with category/confirmed/source | Yes — DB query over real SQLite | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 8 memory test suites GREEN | `npx vitest run src/memory-provenance.test.ts src/memory.test.ts src/memory-projection.test.ts src/memory-ingest.test.ts src/memory-consolidate.test.ts src/dashboard.contract.test.ts src/db.test.ts src/migrations.test.ts` | 8 files passed, 296 tests passed | PASS |
| `isTombstoned` gate present in both engine paths | `grep -c isTombstoned src/memory-ingest.ts src/memory-consolidate.ts` | 2 / 2 | PASS |
| `confirmed = 1` gate present on behavior readers | `grep -c 'confirmed = 1' src/db.ts` | 8 (>= 4) | PASS |
| DELETE handler calls tombstone before delete | Code read of dashboard.ts lines 2405-2407 | `writeTombstoneForMemory` on 2405, `deleteMemory` on 2407 | PASS |
| Zero hard-coded hex colors in Memory.tsx | `grep -Ec '#[0-9a-fA-F]{6}' web/src/pages/Memory.tsx` | 0 | PASS |
| Verbatim copy present: "Stored on this machine. Edit or delete anything." | grep of Memory.tsx | Found at line 124 | PASS |
| Verbatim copy present: "Deleted. It will not come back." | grep of Memory.tsx | Found at line 215 | PASS |
| Verbatim copy present: "Delete this fact?" | grep of Memory.tsx | Found at line 286 | PASS |
| Verbatim copy present: "Needs review" | grep of Memory.tsx | Found at line 239 | PASS |
| Backfill script idempotent (WHERE category IS NULL) | grep of backfill-memory-categories.ts | Found at line 75 | PASS |

---

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files exist for this phase; no probe-based verification was declared in any PLAN.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MEM-01 | 06-01, 06-02, 06-03, 06-04 | Operator can view facts grouped by category with provenance | SATISFIED | `getMemoriesForOperatorSurface` + `Memory.tsx` category grouping + `deriveProvenance` on all rows |
| MEM-02 | 06-01, 06-02, 06-03, 06-04 | Operator can edit, delete (tombstone-backed), add, and confirm facts with provenance shown | SATISFIED | 5 `/api/memory*` routes + Edit/Delete/Add/Confirm modals in Memory.tsx + tombstone gate on both ingest paths |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `web/src/pages/Memory.tsx` | 399-400 | `placeholder=` attribute | Info | HTML input placeholder text — not a code stub. Describes the fact text field to the user. Not a blocker. |

No `TBD`, `FIXME`, or `XXX` debt markers found in files modified by this phase. No stub implementations. No empty returns in logic paths. No hardcoded data.

---

### Human Verification Required

The operator already walked the 7-step live surface checklist during the 06-03 Task 3 blocking human-verify checkpoint and typed "approved". That approval is documented in `06-03-SUMMARY.md`. The items below are retained as the formal end-of-phase record per the VALIDATION.md manual-only verifications table.

#### 1. Live operator Memory surface walkthrough

**Test:** Start the dashboard and open `/memory`. Confirm:
1. Header reads "What I know about you" with assurance "Stored on this machine. Edit or delete anything."
2. Facts are grouped under Your business / Your clients / How you like to work; empty categories are not shown.
3. Each row shows a provenance pill (You told me / Learned from your work; email pill only if email data exists).
4. Click "Add a fact", add one in a category, save — it appears with a "You told me" pill.
5. Edit that fact's text and save — it persists.
6. Delete it via the confirm modal — toast "Deleted. It will not come back."; confirm it does not reappear on reload.
7. If an unconfirmed fact exists: confirm it shows the amber "Needs review" marker and a "Confirm" action; click Confirm — toast confirms it can now inform behavior.
8. Confirm `/memories` (developer Brain Graph) is no longer in the daily sidebar but still loads via direct URL.

**Expected:** All 8 steps pass.

**Why human:** Visual + interactive UI verification of a live dashboard. Automated grep and test suite confirm structure and behavior contracts; only a human can confirm pixel-accurate rendering, toast sequencing, and the live data flow from real store rows.

**Prior approval:** Operator approved this checkpoint on 2026-06-26 during 06-03 Task 3 (documented in `06-03-SUMMARY.md`). No code has changed since that approval.

---

### Gaps Summary

No gaps found. All 4 success criteria are verified by real code, not just claims.

The one known non-blocking state documented across the SUMMARYs is the category backfill script (`scripts/backfill-memory-categories.ts`) being implemented and tsc-verified but not yet RUN against the live DB (existing rows have `category=NULL`). This is an operational choice explicitly documented in `06-04-SUMMARY.md` as a deliberate defer-to-operator decision, not a code stub. The script is fully wired and idempotent; running it is one command. This does not affect any success criterion — the page renders `category=NULL` rows under an "Other" group (D-07 compliance), so the operator sees all facts regardless.

---

_Verified: 2026-06-26T14:00:00Z_
_Verifier: Claude (gsd-verifier)_
