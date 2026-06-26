# Phase 6: Memory Surface - Pattern Map

**Mapped:** 2026-06-26
**Files analyzed:** 13 (new + modified)
**Analogs found:** 13 / 13 (all in-repo; no new external patterns)

> All line references verified against this worktree
> (`.claude/worktrees/compassionate-jepsen-3745c6`), not the main checkout.
> This is an MVP / vertical-slice frontend phase with no UI-SPEC; UI analogs are
> the named operator pages (Activity.tsx primary).

## File Classification

| New/Modified File | New? | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `web/src/pages/Memory.tsx` | NEW | component (operator page) | request-response (grouped read + row mutations) | `web/src/pages/Activity.tsx` | exact |
| `web/src/lib/routes.ts` | MOD | config (nav source of truth) | — | self (Audit D-13 demotion at `:38-42`) | exact |
| `web/src/App.tsx` | MOD | route (router table) | — | self (`/audit` route + `/memory` redirect at `:69`) | exact |
| `web/src/lib/vocabulary.ts` | MOD | config (term registry) | — | existing `nav.*` / `page.*` keys | exact |
| `web/src/pages/Memories.tsx` | MOD (relocate) | component (developer view) | — | Audit relocation precedent (route stays, nav pulled) | exact |
| `web/src/components/BrainGraph*.tsx` | unchanged (moves w/ Memories) | component | — | n/a (relocated as-is) | n/a |
| `src/dashboard.ts` | MOD | controller (Hono routes) | CRUD / request-response | approve `:3587`, task DELETE `:1603`, task PATCH `:1612` | exact |
| `src/db.ts` | MOD | model + migration (schema + readers/mutators) | CRUD / dual-write migration | ALTER pattern `:743/:783/:791`; readers `:1020/:1131/:1150`; `saveStructuredMemoryAtomic :1118`; dashboard reader `:2346` | exact |
| `migrations/v1.2.5/<name>.ts` | NEW | migration | batch (DDL) | `migrations/v1.2.4/enrich-audit-log.ts` | exact |
| `migrations/version.json` | MOD | config | — | self (register `v1.2.4`) | exact |
| `src/memory-ingest.ts` | MOD | service (ingest engine) | event-driven (per-turn) | self — dedupe loop `:219-232`, save `:234`, `EXTRACTION_PROMPT :111`, `extractViaClaude :39` | exact |
| `src/memory-consolidate.ts` | MOD | service (consolidation engine) | batch | self — `saveConsolidationAtomic :142` in `runConsolidation :59` | exact |
| `src/memory.ts` / `src/memory-projection.ts` | MOD | service (behavior read paths) | request-response | `buildMemoryContext :63` / `renderMemoryProjection :42` | exact |
| `scripts/backfill-memory-categories.ts` | NEW | utility (data migration) | batch / transform | ingest classify path + 429 backoff model in `memory-ingest.ts` | role-match |
| `src/memory-provenance.test.ts` (+ cases in existing tests) | NEW | test | — | `src/memory.test.ts`, `src/dashboard.contract.test.ts` | role-match |

---

## Pattern Assignments

### `web/src/pages/Memory.tsx` (NEW operator page, request-response)

**Analog:** `web/src/pages/Activity.tsx` (verified closest — grouped read-over-a-table, plain-language rows, per-row actions, provenance-style Pill).

**Import + DTO pattern** (Activity.tsx:12-37) — copy this import block and the
server-DTO interface shape; the new page mirrors `MemoryRow` on whatever the new
`GET /api/memory` route returns:
```typescript
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Pill } from '@/components/Pill';
import { ConfirmModal } from '@/components/ConfirmModal';
import { apiGet, apiPost } from '@/lib/api';
import { term } from '@/lib/vocabulary';
import { pushToast } from '@/lib/toasts';
// Mirror the curated row the GET endpoint returns. No secrets, derived fields only.
interface MemoryRow { id: number; summary: string; category: string | null;
  provenance: 'told' | 'work' | 'email'; confirmed: 0 | 1; created_at: number; }
```
Note: PATCH/DELETE are not in the shared `@/lib/api` named exports shown here
(only `apiGet`/`apiPost` are used by Activity). Confirm `apiPatch`/`apiDelete`
exist in `web/src/lib/api.ts` during planning; if not, use `apiPost` to a
`/confirm` + `/delete` shape or extend the api helper.

**Provenance-as-hero tag = the Pill + tone function** (Activity.tsx:42-57, 375).
Copy `toneForTag` and rename for provenance/needs-review. The "needs review"
marker on `confirmed === 0` rows uses the amber `'medium'` tone exactly as
Activity's "Needs you" does:
```typescript
type PillTone = 'done' | 'neutral' | 'medium' | 'failed' | 'cancelled';
// "needs review" (confirmed === 0) -> 'medium' (amber), mirroring "Needs you".
<Pill tone={toneForTag(row.tag)}>{row.tag}</Pill>
```

**Grouped render (group by CATEGORY, not day)** — adapt the `useMemo` grouping
(Activity.tsx:172-184) and the section render (Activity.tsx:261-285). D-07
(empty categories hidden) is satisfied by only pushing a group when it has rows
— the same loop already does this. Drop the day-key helpers; group on
`row.category`, skip `null`-category rows (or a low-key misc affordance — D-07
discretion).

**Load pattern** (Activity.tsx:136-167) — `useCallback` + cancel-token `load()`
hitting `apiGet<{ rows: MemoryRow[] }>('/api/memory')`. Reuse verbatim.

**PageState loading/empty/error** (Activity.tsx:251-259) — same three-state block.
Empty copy follows the spec assurance tone ("Stored on this machine…").

**Row action + ConfirmModal for Delete** (Activity.tsx:330-361, 433-443) — the
`busy`/`failure` state machine, destructive `ConfirmModal`, `apiPost`, and the
honest success/failure `pushToast`. The Memory row reuses this for Delete and
Confirm; Edit opens an inline edit (no existing modal analog — small new form,
keep it in-file).

**Header + assurance line + Add affordance** (Activity.tsx:188-201) — `PageHeader`
with `title={term('page.memory')}` (new vocab key), an `actions` slot for the
"Stored on this machine. Edit or delete anything." line + an "Add" button
(mirrors the "Summarize Today" button styling at `:194-200`). Copy is Claude's
discretion (CONTEXT specifics).

---

### `web/src/lib/routes.ts` + `web/src/App.tsx` (nav + router, config/route)

**Analog:** the Audit D-13 demotion already encoded in this file.

**New operator route — add to `ROUTES`** (routes.ts:34-37 is the `intelligence`
section block; add beside it):
```typescript
{ path: '/memory', label: 'Memory', vocabKey: 'nav.memory', section: 'intelligence', icon: Brain },
```
Import a lucide icon at routes.ts:1-6 (Brain is already imported; pick a distinct
one if Memories keeps Brain).

**Labs relocation of `/memories` (D-02) — copy the Audit precedent verbatim**
(routes.ts:38-42 comment block): REMOVE the `/memories` `RouteDef` from the
visible `ROUTES` array (currently line 34), but KEEP its `<Route>` in App.tsx for
deep-link + command-palette reach. There is no `labs` section today (Open Q3);
default to the simpler Audit-style demotion unless planning adds a section.

**App.tsx router edits** (App.tsx:57, 60-61, 69):
- Add `<Route path="/memory"><Memory /></Route>` and import `Memory` (App.tsx:10
  import style).
- KEEP `<Route path="/memories"><Memories /></Route>` (App.tsx:57) — relocated,
  not deleted.
- REMOVE/REPOINT the legacy redirect `<Route path="/memory"><Redirect to="/memories" /></Route>`
  (App.tsx:69) — this phase TAKES `/memory` for the operator surface (Open Q2).
- **CRITICAL (Pitfall 2):** edit `web/src/App.tsx` — `git ls-files` confirms
  `App.tsx` is tracked and `app.tsx` is NOT. `main.tsx` imports `./App`. Editing
  the lowercase stray no-ops on the case-insensitive macOS FS.

**vocabulary.ts:** add the `nav.memory` (+ `page.memory`) `TermKey` and term,
matching the existing `nav.*`/`page.*` entries that routes resolve through
`term()`.

---

### `src/dashboard.ts` (NEW mutation routes — controller, CRUD)

**Analog:** approve route (`:3587`), task DELETE (`:1603`), task PATCH (`:1612`).

**House style is fully inherited — do NOT re-implement auth/CSRF/kill-switch.**
RESEARCH verified: `requireToken` query-token gate (`:432`),
`DASHBOARD_MUTATIONS_ENABLED` 503 kill-switch on non-GET (`:449`), and Origin
allowlist CSRF (`:495`) are app-level middleware. New routes get them for free.

**id-validate + status-guard + `.changes`-aware pattern** (approve `:3587-3608`):
```typescript
app.post('/api/approvals/:id/approve', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
  // ... status-guard: if not in expected state, return { ok:false } WITHOUT acting
  const changed = approve(id, replay.message); // a db.ts fn; check .changes === 1 inside
  if (!changed) return c.json({ ok: false, error: 'already decided' });
  return c.json({ ok: true });
});
```
Mirror this for the four new routes (mount under `/api/memory/...` beside the
read routes at `:2300-2324`):
- `POST /api/memory` (Add, D-09) — `{ summary, category }`; validate `category`
  against the 3-value enum; call a `db.ts` Add helper (NOT a raw INSERT here).
- `PATCH /api/memory/:id` (Edit) — `{ summary?, category? }`; the `AFTER UPDATE OF`
  FTS trigger (db.ts:772) keeps search in sync, do not rebuild manually.
- `DELETE /api/memory/:id` (Delete + D-08) — **tombstone FIRST, then delete row**
  (Pitfall 6, fail-safe ordering). See the RESEARCH Code Example at lines 301-308.
- `POST /api/memory/:id/confirm` (D-04) — flip `confirmed=1`; status-guard so a
  double-click is a no-op (`.changes`).

**Body-parse pattern** (task PATCH `:1612-1618`):
`const body = await c.req.json().catch(() => ({})) as { ... };` then per-field
validation returning `c.json({ ok:false, error }, 400)`.

**House rule (V5/security): all SQL lives in `db.ts`** — routes call functions,
never inline SQL. Bind via `?` placeholders.

---

### `src/db.ts` (schema dual-write + readers/mutators — model, CRUD)

**Analog:** self — multiple verified patterns in this file.

**Dual-write ADD COLUMN — `createSchema`/`runMigrations` half** (db.ts:728-794,
the PRAGMA-guarded idempotent block). Copy this shape for `category` + `confirmed`:
```typescript
const memColsPost = database.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>;
if (!memColsPost.some((c) => c.name === 'pinned')) {                      // :791 — copy this guard
  database.exec(`ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
}
// New: category TEXT (nullable); confirmed INTEGER NOT NULL DEFAULT 0.
// Existing-row backfill: see Open Q1 — grandfather existing rows confirmed=1.
// Plus a CREATE TABLE IF NOT EXISTS memory_tombstones here (dual-written).
```
Column names/types MUST be byte-identical to the migration file (Pitfall 1).

**Behavior-read gate (D-04) — copy the `superseded_by IS NULL` clause shape**
(getMemoriesWithEmbeddings db.ts:1136-1137 already carries it). Add `AND confirmed = 1`
to the three behavior-feeding readers:
- `getMemoriesWithEmbeddings` (:1131) — already has `AND superseded_by IS NULL`;
  append `AND confirmed = 1`.
- `searchMemories` (:1020) — the vector branch IN-query (:1041) already has
  `AND superseded_by IS NULL`; append `AND confirmed = 1` (and to the FTS branch).
- `getRecentHighImportanceMemories` (:1150) — **NOTE: this reader does NOT
  currently carry `superseded_by IS NULL`** (:1158, :1165). Add `AND confirmed = 1`
  here; consider adding the superseded clause too while you are in it.

**Operator-surface reader (MEM-01) — model on `getDashboardMemoriesList`**
(db.ts:2346-2369) but it must do the OPPOSITE of the gate: return BOTH confirmed
and unconfirmed, grouped/selectable by `category`, scoped to `chat_id`. Keep the
two readers distinctly named (e.g. `getMemoriesForOperatorSurface` vs the gated
behavior readers). Do NOT add the `confirmed=1` clause here.

**Add mutator — variant of `saveStructuredMemoryAtomic`** (db.ts:1118-1128). The
Add route inserts through a variant that stamps `source='you-told-me'`,
`confirmed=1`, high salience/importance, operator `agent_id`, operator `category`,
best-effort embedding. Reuse the txn + `saveMemoryEmbedding` shape; do not write a
raw INSERT in dashboard.ts.

**Tombstone helpers** (NEW in db.ts): `writeTombstoneForMemory(id)` (hash +
optional embedding + summary), `isTombstoned(chatId, hash, embedding?)`,
`deleteMemory(id)`. Hash = `sha256(normalize(summary))`; reuse the normalization
spirit of `extractKeywords` (db.ts:~1003) per RESEARCH.

---

### `migrations/v1.2.5/<name>.ts` + `version.json` (migration, batch)

**Analog:** `migrations/v1.2.4/enrich-audit-log.ts` (read in full — copy structure
exactly).

**Migration file shape** (enrich-audit-log.ts:1-46):
```typescript
import Database from 'better-sqlite3';
import path from 'path';
export const description = 'Add category + confirmed columns and memory_tombstones (Phase 6)';
export async function run(): Promise<void> {
  const dbPath = path.join(process.cwd(), 'store', 'claudeclaw.db'); // never hardcode abs path
  const db = new Database(dbPath);
  try {
    const have = new Set((db.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>).map((c) => c.name));
    const add = (col: string, type: string) => { if (!have.has(col)) db.exec(`ALTER TABLE memories ADD COLUMN ${col} ${type}`); };
    add('category', 'TEXT');                       // byte-identical to db.ts
    add('confirmed', 'INTEGER NOT NULL DEFAULT 0'); // byte-identical to db.ts
    db.exec(`CREATE TABLE IF NOT EXISTS memory_tombstones (...)`); // mirror createSchema
    // Existing-row confirmed backfill decision (Open Q1): grandfather to 1.
  } finally { db.close(); }
}
```
The header comment in v1.2.4 (lines 14-23) documents the dual-write + Pitfall-1
discipline — keep an equivalent comment.

**`version.json`** (current content has 4 entries up to `v1.2.4`): add
`"v1.2.5": ["<migration-filename-without-ext>"]`.

---

### `src/memory-ingest.ts` (ingest engine — service, event-driven)

**Analog:** self — the dedupe loop and save call are the verified hook points.

**Tombstone check (D-08) — slot in at the existing dedupe loop** (:219-232,
verified). Insert BEFORE `saveStructuredMemoryAtomic` (:234), after embedding
(:214), co-located with the 0.85 cosine dedupe:
```typescript
// existing: embedding generated at :214, dedupe loop at :219-232
const hash = sha256(normalizeSummary(result.summary)); // hash floor, always on
if (isTombstoned(chatId, hash, embedding /* optional, GOOGLE_API_KEY-gated */)) {
  logger.debug({ summary: result.summary.slice(0, 60) }, 'Skipping tombstoned memory');
  return false; // mirrors the dedupe `return false` at :229
}
```

**Category classification (D-06) — extend the existing extractor, no new LLM path.**
`EXTRACTION_PROMPT` (:111) + `extractViaClaude` (:39, verified Haiku-via-OAuth, no
key). Add `"category": "your-business" | "your-clients" | "how-you-work" | null` to
the returned JSON contract; validate/clamp like the existing `importance` handling
(:205-208); `null`/unknown → store NULL (D-07). Pass `category` through the
`saveStructuredMemoryAtomic` call (:234-244).

**Confirmed default:** ingest-written memories are machine-inferred →
`confirmed=0`. This flows through the `saveStructuredMemoryAtomic` variant.

---

### `src/memory-consolidate.ts` (consolidation engine — service, batch)

**Analog:** self — `runConsolidation` (:59), `saveConsolidationAtomic` (:142).

**Second tombstone consult (D-08):** before `saveConsolidationAtomic` (:142),
tombstone-check the SYNTHESIZED summary/insight so a deleted fact cannot re-enter
as a consolidation. Same `isTombstoned` helper as ingest.

---

### `src/memory.ts` + `src/memory-projection.ts` (behavior read paths — service)

**Analog:** self. The gate is applied ONCE at the `db.ts` reader layer (see db.ts
above), so these files need NO per-call-site filter IF the readers they call are
gated. Verify each still routes through the gated readers:
- `src/memory.ts buildMemoryContext` (:63) → `searchMemories`,
  `getRecentHighImportanceMemories`, `getMemoriesWithEmbeddings` (all gated above).
- `src/memory-projection.ts renderMemoryProjection` (:29) → calls
  `getRecentHighImportanceMemories` (verified :42). Gating that reader covers this
  path automatically (Pitfall 3 — do NOT forget this second path).

---

### `scripts/backfill-memory-categories.ts` (NEW data migration — utility, batch)

**Analog:** the ingest classify path + 429 backoff model in `memory-ingest.ts`.
Standalone `tsx`-runnable script: `SELECT` rows `WHERE category IS NULL`, classify
each `summary` via `extractViaClaude` (same helper), `UPDATE` the row. Idempotent
(only touches NULL). Separate from the schema migration; both are needed.

---

## Shared Patterns

### Auth / CSRF / Kill-switch (all new mutation routes)
**Source:** `src/dashboard.ts` — `requireToken` (:432), kill-switch (:449), CSRF
Origin allowlist (:495). **Apply to:** every new route in dashboard.ts.
**Action:** NOTHING per-route — it is inherited app-level middleware. Re-implementing
it risks a gap. Confirmed by RESEARCH (Don't Hand-Roll table).

### SQL lives in db.ts, parameterized
**Source:** house convention (RESEARCH Security V5; FTS quoting db.ts:1054-1059).
**Apply to:** every new route + reader. Routes call `db.ts` functions; all SQL binds
via `?`; never interpolate `summary`/`category`.

### Dual-write migration discipline (Pitfall 1)
**Source:** `migrations/v1.2.4/enrich-audit-log.ts` header (:14-23) + db.ts:728-794.
**Apply to:** the `category`/`confirmed`/`memory_tombstones` schema. Byte-identical
DDL in BOTH `db.ts createSchema` and `migrations/v1.2.5/*.ts`; register in
`version.json`; PRAGMA-guard both. Drift crash-loops the live service on restart.

### Provenance derivation = pure server-side helper (D-03)
**Source:** RESEARCH "Provenance Derivation" mapping (verified every `source`/`agent_id`
writer). **Apply to:** the operator-surface read DTO + tests. A
`deriveProvenance(memory): 'told' | 'work' | 'email'` helper in `src/`:
- `'told'`: `source IN ('you-told-me', 'checkpoint')`.
- `'work'`: `source = 'conversation'` (the default — the unconfirmed majority).
- `'email'`: `source = 'email'` AND emit ONLY if `SELECT 1 FROM memories WHERE
  source='email' LIMIT 1` returns a row (D-05 honest coverage; matches Audit 05 D-13).
Do NOT compute provenance in the Preact layer — keep it in `src/` so API + tests agree.

### Operator surface ≠ developer surface (D-01/D-02)
**Source:** `routes.ts:38-42` (Audit D-13 demotion); `web/src/pages/Activity.tsx`
header/card language. **Apply to:** the new `/memory` page is card/plain-language
(Activity-style); the relocated `/memories` (BrainGraph, salience/decay) stays the
dense developer view, route-only in App.tsx, pulled from visible nav.

### Test homes (Wave 0)
**Source:** RESEARCH Test Map. **Apply to:** new cases land in existing files plus one
new file:
- `src/memory-provenance.test.ts` (NEW) — derivation + D-05 email honesty.
- `src/memory-ingest.test.ts` / `src/memory-consolidate.test.ts` — tombstone suppression.
- `src/memory.test.ts` / `src/memory-projection.test.ts` — confirmed gate, BOTH paths.
- `src/migrations.test.ts` / `src/migrate-runner.test.ts` — dual-write columns + table.
- `src/dashboard.contract.test.ts` — Edit/Delete/Add/Confirm route contracts.

---

## No Analog Found

None. Every file maps to an in-repo analog. The two genuinely new mechanisms
(tombstone table + confirmed gate) reuse existing patterns: the tombstone reuses
the dedupe-loop hook and embeddings/cosine; the gate reuses the `superseded_by IS NULL`
reader-clause pattern.

| Pseudo-gap | Why it is still covered |
|------------|-------------------------|
| `memory_tombstones` table | New table, but DDL + reader follow the `superseded_by`/dedupe patterns; helpers modeled on existing db.ts mutators. |
| Inline Edit form on the operator page | No existing inline-edit modal analog; small in-file form. Delete/Confirm reuse Activity's ConfirmModal + toast flow. |

---

## Metadata

**Analog search scope:** `web/src/pages/`, `web/src/lib/`, `src/` (db, dashboard,
memory-*, embeddings), `migrations/`. All reads against the worktree path in
`<critical_cwd>`.
**Files scanned (read):** Activity.tsx, routes.ts, App.tsx,
migrations/v1.2.4/enrich-audit-log.ts, version.json, dashboard.ts (3 ranges),
db.ts (5 ranges), memory-ingest.ts (2 ranges); grep-verified memory-consolidate.ts,
memory-projection.ts, git-tracked status of App.tsx vs app.tsx.
**Pattern extraction date:** 2026-06-26

### Planner watch-items surfaced during mapping (verified facts)
1. `getRecentHighImportanceMemories` (db.ts:1150) does NOT currently carry
   `superseded_by IS NULL` — unlike the other two readers. Add `confirmed=1` here
   and consider the superseded clause.
2. `web/src/app.tsx` is UNTRACKED (`git ls-files` shows only `App.tsx`). Edit
   `App.tsx`. Flag the stray to the operator (out of scope to delete).
3. App.tsx:69 redirect `/memory` → `/memories` must be removed/repointed (Open Q2).
4. Confirm `apiPatch`/`apiDelete` exist in `web/src/lib/api.ts`; Activity only uses
   `apiGet`/`apiPost`.
5. Existing-row `confirmed` backfill (Open Q1): grandfather existing rows to
   `confirmed=1` so the migration does not strip the operator's whole memory.
