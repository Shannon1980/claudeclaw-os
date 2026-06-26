# Phase 6: Memory Surface - Pattern Map

**Mapped:** 2026-06-26
**Files analyzed:** 13 (new + modified)
**Analogs found:** 12 / 13 (1 net-new mechanism with no direct analog)

> All paths are worktree-relative to
> `/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/ecstatic-matsumoto-735a37`.
> Line numbers are from that worktree; re-confirm before editing if the engine/dashboard changed.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `web/src/pages/Memory.tsx` (NEW) | component (page) | request-response (grouped read + row mutations) | `web/src/pages/Activity.tsx` | exact (operator surface) |
| `web/src/lib/routes.ts` (MOD) | config (nav source of truth) | — | self (Audit D-13 demotion at `:38-42`) | exact |
| `web/src/App.tsx` (MOD) | route (router) | — | self (`:57-72` route block) | exact |
| `web/src/lib/vocabulary.ts` (MOD) | config (term map) | — | self (existing `term()` keys) | role-match |
| `src/dashboard.ts` POST/PATCH/DELETE/confirm `/api/memory*` (MOD) | route (API mutation) | CRUD | `src/dashboard.ts` task DELETE/PATCH `:1603`/`:1612`, approve `:3587` | exact |
| `src/db.ts` operator-surface reader + mutators (MOD) | model (DB access) | CRUD | `src/db.ts` `getMemoriesWithEmbeddings:1131`, `saveStructuredMemory:951` | exact |
| `src/db.ts` `confirmed` gate on behavior readers (MOD) | model (DB access) | request-response | `src/db.ts` `superseded_by IS NULL` clause (`:1041`,`:1068`,`:1136`) | exact |
| `src/db.ts` `createSchema`/`runMigrations` dual-write (MOD) | migration | — | `src/db.ts` addColumn pattern `:737-794` | exact |
| `migrations/v1.2.5/<name>.ts` (NEW) | migration | — | `migrations/v1.2.4/enrich-audit-log.ts` | exact |
| `migrations/version.json` (MOD) | config | — | self | exact |
| `src/memory-provenance.ts` `deriveProvenance` (NEW) | utility | transform | (pure fn — no analog; spec'd in RESEARCH) | partial |
| `src/memory-ingest.ts` tombstone check + category (MOD) | service | event-driven (ingest) | self `:205-244` dedupe loop | exact |
| `src/memory-consolidate.ts` tombstone check (MOD) | service | batch | self (save path before `saveConsolidationAtomic`) | role-match |
| `src/db.ts` `memory_tombstones` table + helpers (NEW) | model + new mechanism | CRUD | (table CRUD pattern exists; suppression logic is net-new) | partial |
| `scripts/backfill-memory-categories.ts` (NEW) | utility (data migration) | batch | (ingest 429 backoff model to copy) | partial |

## Pattern Assignments

### `web/src/pages/Memory.tsx` (component/page, request-response)

**Analog:** `web/src/pages/Activity.tsx` (verified closest operator-page analog; same PageHeader/Tab + PageState + Pill + grouped-`useMemo` + per-row mutation + ConfirmModal shape).

**Imports pattern** (`Activity.tsx:12-22`):
```typescript
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Pill } from '@/components/Pill';
import { ConfirmModal } from '@/components/ConfirmModal';
import { apiGet, apiPost } from '@/lib/api';
import { term } from '@/lib/vocabulary';
import { pushToast } from '@/lib/toasts';
// Memory adds: import { Modal } from '@/components/Modal'; (Add-fact form)
```

**Tag-tone helper** (`Activity.tsx:42-57`) — copy this shape; provenance is the hero, so map the three provenance tags + the "needs review" marker to `Pill` tones per UI-SPEC §Color:
```typescript
// Memory's version: provenance -> Pill tone
// 'You told me'           -> 'accent'  (accent-soft tint; bounded exception, UI-SPEC)
// 'Learned from your work'-> 'neutral'
// 'Learned from email'    -> 'neutral' (rendered only if email source exists, D-05)
// 'Needs review' marker   -> 'medium'  (amber, unconfirmed; mirrors Activity 'Needs you')
```

**Load + cancel-guard pattern** (`Activity.tsx:136-167`): `useCallback` load with `{ cancelled }` signal, `apiGet<{ ... }>('/api/memory...')`, set rows, `.catch` sets verbatim `err.message`, `.finally` clears loading. Reuse verbatim; swap endpoint.

**Grouping pattern** (`Activity.tsx:172-184`): Activity groups by day via `useMemo`; Memory groups by **category** — same reduce-into-ordered-groups shape. Empty categories: only push a group if `rows.length > 0` (D-07).

**PageState gating** (`Activity.tsx:251-259`): error/loading/empty exactly via `<PageState ... />`. Empty copy from UI-SPEC: heading `Nothing here yet`.

**Row-card + mutation pattern** (`Activity.tsx:315-446` `ActivityRowCard`): per-row `busy`/`failure` local state, `apiPost` mutation, success/honest-failure `pushToast`, `ConfirmModal` for the one destructive action. Memory row actions:
- Confirmed fact: `Edit` (Modal) · `Delete` (`ConfirmModal destructive`).
- Unconfirmed fact: `Confirm` (apiPost, no modal, toast) · `Edit` · `Delete`.
- **Affordance rule** (`Activity.tsx:393` Undo): a button that cannot act is ABSENT, never disabled-dead. `Confirm` renders only on `confirmed = 0` rows.

**Card anatomy** (`Activity.tsx:364`): `bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-3`; fact text `text-[12.5px] leading-snug`, provenance `Pill` right-aligned on the top row (`:371-376`). Match verbatim (UI-SPEC §Spacing/Typography).

---

### `web/src/lib/routes.ts` (config) + `web/src/App.tsx` (route)

**Analog:** the Audit D-13 demotion already encoded here.

**Add operator route** (`routes.ts:27-46` ROUTES array): add `{ path: '/memory', label: 'Memory', vocabKey: <new key>, section: 'intelligence', icon: <lucide icon> }`. Note current `/memories` RouteDef at `routes.ts:34` (`label: 'Memories'`, `Brain` icon) — this is the **developer** view that D-02 demotes.

**Labs/demotion pattern** (`routes.ts:38-42` Audit comment): pull the `/memories` RouteDef OUT of the visible `intelligence` list (comment it like Audit), keep its `<Route>` in `App.tsx` for deep-link + command palette. No new "Labs" section exists — follow the lower-risk Audit-style demotion (RESEARCH Open Q3).

**App.tsx route block** (`App.tsx:57-72`): routes registered as `<Route path="/memories"><Memories /></Route>` (`:57`). Add `<Route path="/memory"><Memory /></Route>`. **Critical:** `App.tsx:69` currently has `<Route path="/memory"><Redirect to="/memories" /></Route>` — this phase TAKES `/memory`, so **remove that redirect line** (RESEARCH Open Q2, Pitfall — also edit `App.tsx`, NOT the untracked `app.tsx`).

**Vocabulary** (`web/src/lib/vocabulary.ts`): add the new `vocabKey` term (e.g. `page.memory` / `nav.memory`) so `term(r.vocabKey)` resolves the operator label (`routes.ts:56-58`).

---

### `src/dashboard.ts` — net-new mutation routes (route, CRUD)

**Analog:** task DELETE/PATCH (`dashboard.ts:1603`, `:1612`) + approve (`:3587`). Existing memory routes are read-only (`:2300`, `:2311`, `:2317`).

**Read-route scope pattern** (`dashboard.ts:2317-2323`): `chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || ''`, paginate via parsed `limit`/`offset`, return `c.json(result)`. The new operator GET reader uses this same `ALLOWED_CHAT_ID` default (RESEARCH A1).

**Mutation route house style** (`dashboard.ts:1603-1607` DELETE, `:1612-1634` PATCH):
```typescript
// id validation + verbatim-error JSON; all SQL delegated to db.ts.
app.delete('/api/memory/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
  const tomb = writeTombstoneForMemory(id);  // tombstone FIRST (Pitfall 6, fail-safe)
  if (!tomb) return c.json({ ok: false, error: 'not found' }, 404);
  const changed = deleteMemory(id);           // then delete the row
  return c.json({ ok: changed });
});
```
**Inherited middleware — do NOT re-implement** (RESEARCH §Don't Hand-Roll): query-token gate (`requireToken:432`), `DASHBOARD_MUTATIONS_ENABLED` kill switch on non-GET (`:449`), CSRF Origin allowlist (`:495`). All four new routes (`POST`/`PATCH`/`DELETE`/`POST :id/confirm`) are covered automatically.

Routes to add (RESEARCH §Net-New Mutation API): `POST /api/memory` (Add, D-09), `PATCH /api/memory/:id` (Edit), `DELETE /api/memory/:id` (Delete + tombstone, D-08), `POST /api/memory/:id/confirm` (D-04). Validate `category` against the 3-value enum; status-guard `confirm` for double-click no-op.

---

### `src/db.ts` — readers, mutators, confirmed-gate (model, CRUD + request-response)

**Add-fact write** — model on `saveStructuredMemory` (`db.ts:951-978`): parameterized INSERT, `now` for `created_at`/`accessed_at`, returns `lastInsertRowid`. The Add route writes through a variant: `source='you-told-me'`, `confirmed=1`, high importance (~0.9, Claude's discretion), `category` from operator. Embedding best-effort via `saveStructuredMemoryAtomic` (`:1118-1129`) which wraps save + `saveMemoryEmbedding` in a txn.

**Behavior-read gate** (D-04) — mirror the existing `superseded_by IS NULL` clause. It appears in THREE readers; append `AND confirmed = 1` to each:
- `getMemoriesWithEmbeddings` (`db.ts:1136-1137`) — `WHERE chat_id = ? AND ... AND superseded_by IS NULL` → add `AND confirmed = 1`.
- `searchMemories` (`db.ts:1041`, `:1068`) — both the IN-clause and FTS JOIN carry `superseded_by IS NULL`; add `confirmed = 1` to both.
- `getRecentHighImportanceMemories` (`db.ts:1150-1168`) — add `AND confirmed = 1` to both branches.

**Operator-surface reader** (MEM-01) — a SEPARATE, clearly-named reader (e.g. `getMemoriesForOperatorSurface`) that does NOT filter `confirmed` (shows unconfirmed with the marker) and returns rows grouped/groupable by `category`. Model the row shape on `getDashboardMemoriesList` (`:2346`) but distinct so the two never drift (RESEARCH §Confirmed Gate).

**FTS sync** — do not hand-roll: the `memories_fts` `AFTER UPDATE OF summary, raw_text, entities, topics` trigger (`db.ts:772`) keeps search in sync on Edit automatically.

---

### `src/db.ts` createSchema/runMigrations + `migrations/v1.2.5/<name>.ts` (migration)

**Dual-write analog:** `migrations/v1.2.4/enrich-audit-log.ts` (full file) + the `addColumn` block in `db.ts:737-794`.

**db.ts side** (`db.ts:783-794` pattern): PRAGMA-guarded idempotent ADD COLUMN:
```typescript
if (!memColsPost.some((c) => c.name === 'confirmed')) {
  database.exec(`ALTER TABLE memories ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0`);
}
if (!memColsPost.some((c) => c.name === 'category')) {
  database.exec(`ALTER TABLE memories ADD COLUMN category TEXT`);
}
// CREATE TABLE IF NOT EXISTS memory_tombstones (...) here too.
```

**Migration file side** (`enrich-audit-log.ts:7-45`): open own `better-sqlite3` handle via `path.join(process.cwd(), 'store', 'claudeclaw.db')`, build a `have` Set from `PRAGMA table_info(memories)`, `add(col, type)` only if missing, `db.close()` in `finally`. **Column names/types MUST be byte-identical to db.ts** (Pitfall 1 — drift crash-loops the live service).

**version.json** (full file, 8 lines): add `"v1.2.5": ["<migration-name>"]` to the `migrations` object.

**Existing-row `confirmed` backfill decision** (RESEARCH Open Q1): recommend defaulting existing rows to `confirmed=1` (grandfather) so the gate doesn't strip the whole memory the moment the migration runs; only NEW inferred facts land `confirmed=0`. Confirm in planning.

---

### `src/memory-provenance.ts` `deriveProvenance` (utility, transform) — NO direct analog

Net-new pure server-side function (RESEARCH §Provenance Derivation). Pin the mapping from real `source` + `agent_id`:
| Tag | Condition |
|-----|-----------|
| `You told me` | `source IN ('you-told-me', 'checkpoint')` (Add route stamps `'you-told-me'`; existing `'checkpoint'` is operator-authored) |
| `Learned from your work` | `source = 'conversation'` (the default for all code-ingested rows; these land unconfirmed) |
| `Learned from email` | `source = 'email'` — emit ONLY if `SELECT 1 FROM memories WHERE source='email' LIMIT 1` returns a row (D-05) |
Keep the derivation in `src/` (shared by the API DTO + tests), never in the Preact layer. Pitfall 4: "You told me" is forward-stamped, not back-derived.

---

### `src/memory-ingest.ts` tombstone + category (service, event-driven)

**Analog (self):** the dedupe loop at `memory-ingest.ts:205-244`.

**Tombstone hook** — slot in beside the existing cosine dedupe (`:219-232`), BEFORE `saveStructuredMemoryAtomic` (`:234`), after `embedText` (`:214`):
```typescript
const hash = sha256(normalizeSummary(result.summary)); // hash floor, always on
if (isTombstoned(chatId, hash, embedding /* optional */)) {
  logger.debug({ summary: result.summary.slice(0, 60) }, 'Skipping tombstoned memory');
  return false;
}
// then existing 0.85 cosine dedupe loop (:220-232), then save.
```

**Category hook** — extend `EXTRACTION_PROMPT` (`:111`) so the existing `extractViaClaude` call (`:39`) also returns `"category": "your-business" | "your-clients" | "how-you-work" | null`; validate/clamp like `importance` (`:208`); null/unknown → store NULL (D-07). One Haiku-via-OAuth call, no new key.

---

### `src/memory-consolidate.ts` tombstone (service, batch)

Second tombstone consult (D-08): before `saveConsolidationAtomic` in `runConsolidation`, hash-and-cosine-check the synthesized `summary`/`insight` so a deleted fact cannot re-enter as a "consolidation." Same `isTombstoned` helper as ingest.

---

### `scripts/backfill-memory-categories.ts` (utility, batch) — partial analog

Standalone `tsx` script: select rows `WHERE category IS NULL`, classify each `summary` via the same `extractViaClaude` classify prompt, UPDATE. Idempotent (only touches NULL). Copy the ingest 429-backoff model. Data migration, separate from the schema migration; both required.

## Shared Patterns

### Mutation auth / CSRF / kill-switch (cross-cutting, all new API routes)
**Source:** `src/dashboard.ts` `requireToken:432`, kill-switch `:449`, CSRF Origin allowlist `:495`.
**Apply to:** every new `/api/memory*` route. App-level middleware covers all non-GET automatically — do NOT add per-route auth (RESEARCH §Don't Hand-Roll, Security §V2/V4).

### Parameterized SQL (all new db.ts functions)
**Source:** `src/db.ts:962-965` (`?` placeholders), FTS quote-strip `:1059`.
**Apply to:** every new reader/mutator. Never interpolate `summary`/`category` into SQL (Security §V5, SQLi mitigation).

### Pill provenance tag (all fact rows)
**Source:** `web/src/components/Pill.tsx:23-29` — tones `accent` (`--color-accent-soft`), `medium` (amber), `neutral`.
**Apply to:** every fact row. Provenance pill is the primary visual anchor (UI-SPEC §Visual Hierarchy); `Needs review` uses `medium`.

### ConfirmModal for the one destructive action (Delete)
**Source:** `web/src/components/ConfirmModal.tsx:23-67` (`destructive` prop → `--color-status-failed` button).
**Apply to:** Delete only. Copy from UI-SPEC §Copywriting: title `Delete this fact?`, body states the tombstone guarantee, success toast `Deleted. It will not come back.` Edit/Add/Confirm are non-destructive (Modal or inline, no confirm modal).

### Honest-failure toasts (all mutations)
**Source:** `web/src/pages/Activity.tsx:343-358` — `pushToast` with verbatim server reason, never a generic line.
**Apply to:** Edit/Delete/Confirm failures; surface `res.error`/`err.message` verbatim per UI-SPEC.

### PageState for loading/error/empty
**Source:** `Activity.tsx:251-259`.
**Apply to:** the new page — never hand-roll states.

## No Analog Found

| File / Mechanism | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `memory_tombstones` suppression logic (`isTombstoned`, hash+cosine) | new mechanism | CRUD | No existing suppression/tombstone table; the genuinely new mechanism this phase adds (D-08). Table CRUD shape is conventional, but the hash-floor + 0.88-cosine suppression check has no codebase precedent — implement per RESEARCH §Tombstone (sha256 over normalized summary as primary key; optional embedding secondary at the named 0.88 threshold). |
| `deriveProvenance` (`src/memory-provenance.ts`) | utility | transform | Net-new pure function; mapping spec'd in RESEARCH §Provenance, not copied from an existing analog. |

## Metadata

**Analog search scope:** `web/src/pages/`, `web/src/components/`, `web/src/lib/`, `src/` (db, dashboard, memory-ingest, memory-consolidate, memory, memory-projection, embeddings), `migrations/`.
**Files scanned (read):** Activity.tsx, routes.ts, App.tsx, dashboard.ts (3 ranges), db.ts (4 ranges), memory-ingest.ts, enrich-audit-log.ts, version.json, Pill.tsx, ConfirmModal.tsx.
**Pattern extraction date:** 2026-06-26
