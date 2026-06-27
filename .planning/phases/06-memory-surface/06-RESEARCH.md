# Phase 6: Memory Surface - Research

**Researched:** 2026-06-26
**Domain:** Operator trust surface over the existing SQLite `memories` table (Preact dashboard + Hono API + better-sqlite3); provenance derivation, confirmation gating, tombstone suppression, LLM categorization
**Confidence:** HIGH (codebase claims verified by direct read; no new external packages)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Build a **NEW operator-facing Memory page/route**. Do **not** reframe the existing `web/src/pages/Memories.tsx` in place. Mirrors Activity-vs-Audit precedent (04 D-01, 05 D-01): operator and developer surfaces look unlike each other.
- **D-02:** **Relocate the existing developer view** (`Memories.tsx`, `BrainGraph`/`BrainGraph3D`, salience/importance sort, decay) to a **hidden Labs area** — keep it working, move it off the operator's main nav. Do not delete the brain graph.
- **D-03:** **Map the raw `source` signal to three operator-facing tags** — "You told me" / "Learned from your work" / "Learned from email". Provenance must be *derived*, not read straight from the column (today's values are coarse).
- **D-04:** **Inferred facts require operator confirmation before they influence behavior.** A machine-inferred fact lands in an **unconfirmed** state, shows a **"needs review"** marker, and does **NOT** inform permission defaults or assistant behavior until the operator confirms. Operator-authored facts are confirmed by definition. Adds (a) a confirmed/unconfirmed state and (b) a read-side rule excluding unconfirmed facts from behavior-influencing reads.
- **D-05 (Claude's discretion):** Show "Learned from email" tag **only if** an email source actually exists in the data; otherwise omit it (honest-coverage pattern).
- **D-06:** **Stored `category` column + LLM backfill.** Add a nullable `category` column via a versioned migration; classify via Claude on ingest plus a one-time backfill; the surface reads the column. Categories: **your business / your clients / how you like to work**.
- **D-07:** **Empty categories are hidden.** Facts that don't classify stay in data but are not forced into a visible "Other" group (low-key miscellaneous affordance is Claude's discretion; default hide).
- **D-08:** **Tombstone / suppression table.** A delete writes a tombstone (text hash and/or embedding); ingestion and consolidation paths check the tombstone set and skip re-deriving a matching fact. Real enforcement, not a soft-delete.
- **D-09:** Add inserts a **high-salience, operator-authored, confirmed** fact (source = "you told me"), category chosen/confirmed by the operator. Carries the prominent local-storage assurance.

### Claude's Discretion

- Exact provenance label copy, "needs review"/"new" marker styling, salience/importance values for operator-authored facts, whether a low-key miscellaneous group is shown (D-07).
- Tombstone matching strategy (hash vs embedding vs both), provided it provably blocks re-derivation.
- Which `chat_id` / agent scope the operator surface reads (single-operator product — default to the operator's primary agent/chat; confirm against how prior operator surfaces scoped reads).

### Deferred Ideas (OUT OF SCOPE)

- **Email → memory ingestion pipeline** — out of scope; D-05 only honors email provenance if data already exists.
- **Redesigning / extending the Labs analytics view** — relocated as-is (D-02); any rework is later.
- **Retuning consolidation/decay algorithms** — this phase gates them, does not retune them.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEM-01 | A user can view what the assistant knows about them, grouped by category | New `category` column (D-06) + new GET route returning category-grouped, confirmed+unconfirmed rows scoped to the operator's `chat_id`. UI mirrors Activity.tsx grouped-read pattern. See Architecture Patterns + Standard Stack. |
| MEM-02 | Each remembered fact shows its provenance and can be edited or deleted in place | Derived provenance mapping (D-03, table below) + net-new PATCH/DELETE/POST/confirm routes in `src/dashboard.ts`. Delete writes a tombstone (D-08). See Provenance Derivation + Net-New Mutation API. |
</phase_requirements>

## Summary

This phase is almost entirely a **view-and-control layer over data the engine already produces**, plus **one genuinely new enforcement mechanism (the tombstone)** and **one cross-cutting behavioral gate (confirmed/unconfirmed)**. There are no new external packages: the stack is the same Preact 10 + wouter-preact + Hono + better-sqlite3 already shipped across Phases 1-5. The work is schema additions (three columns + one table, via the project's strict dual-write migration convention), derivation logic in the ingest/consolidate paths, net-new mutation API routes matching the existing token-gated + kill-switched style, and a new operator page modeled on `Activity.tsx`.

The two highest-risk findings: (1) **provenance cannot be read from the `source` column** — in actual code, every ingested memory is written with `source='conversation'` and `agent_id` defaulting to `'main'`; the only other real value is `'checkpoint'`, written by the CLAUDE.md checkpoint command via a raw SQLite INSERT, never through code. There is **no operator-authored write path today**, so "You told me" provenance must be *created* by D-09's Add route, not derived from history. (2) **D-04's "exclude unconfirmed" rule touches TWO behavior-feeding read paths, not one**: `buildMemoryContext` (prompt injection, `src/memory.ts`) AND `renderMemoryProjection` (markdown projection for terminal Claude, `src/memory-projection.ts`). Both call the same underlying `db.ts` readers, so the cleanest fix is a `confirmed` filter at the `db.ts` query layer (mirroring the existing `superseded_by IS NULL` pattern) rather than at each call site.

**Primary recommendation:** Add `category`, `confirmed`, and a `memory_tombstones` table via one dual-write migration. Derive provenance read-side from `source` + `agent_id`. Gate behavior reads by adding `AND confirmed = 1` to the existing `db.ts` memory readers (same pattern as `superseded_by IS NULL`). Use a hybrid tombstone (normalized-text SHA-256 as the always-on primary key + optional embedding-cosine secondary when `GOOGLE_API_KEY` is present), checked at the exact point the ingest dedupe check already runs. Build the operator page as a new `/memory` route in `web/src/lib/routes.ts` + `App.tsx`; demote the existing `/memories` to Labs exactly as Audit was demoted (05 D-13 precedent, already encoded in `routes.ts`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| View facts grouped by category (MEM-01) | API / Backend (new GET route + `db.ts` reader) | Browser (Preact page renders the grouped list) | Grouping reads the stored `category` column; display is dumb. |
| Per-fact provenance tag (MEM-02, D-03) | API / Backend (derive tag from `source`+`agent_id` in the read DTO) | Browser (renders the tag pill) | Derivation is a pure function of stored columns; belongs server-side so all readers agree. |
| Edit / Delete / Add / Confirm a fact | API / Backend (net-new mutation routes) | Browser (row actions, modal) | Mutations go through the token-gated + kill-switched Hono routes; never client-direct. |
| Tombstone suppression (D-08) | API/DB + ingest/consolidate engine | — | Enforcement must live where facts are written (ingest dedupe point + consolidation save), not in the UI. |
| Confirmed/unconfirmed behavior gate (D-04) | DB read layer (`db.ts` memory readers) | API (mutation to flip `confirmed`) | The gate must cover BOTH `buildMemoryContext` and `renderMemoryProjection`; fix once at the shared `db.ts` reader. |
| Category classification on ingest (D-06) | API/Backend engine (`memory-ingest.ts`) | — | Reuses the existing Claude-Haiku-via-OAuth extractor path; one extra field or one extra call. |
| Labs relocation (D-02) | Browser (routing/nav only) | — | Pure front-end move: change `routes.ts` section + add a Labs route; no backend change. |

## Standard Stack

No new packages. Everything below is already a project dependency and verified present in `package.json` / source.

### Core
| Library | Version (in repo) | Purpose | Why Standard |
|---------|-------------------|---------|--------------|
| `better-sqlite3` | as pinned (Hive Mind V2 schema) | The `memories` store + new columns/table | Single source of record; all memory reads/writes go through `src/db.ts` [VERIFIED: src/db.ts] |
| `hono` | as pinned | The dashboard HTTP layer (`src/dashboard.ts`) | All API routes, token gate, mutation kill-switch, CSRF origin check already implemented here [VERIFIED: src/dashboard.ts] |
| `preact` + `wouter-preact` | 10.x / wouter-preact | Operator dashboard SPA + routing | `App.tsx` uses `<Route>`/`<Switch>`/`<Redirect>`; `routes.ts` is the single nav source of truth [VERIFIED: web/src/App.tsx, web/src/lib/routes.ts] |
| `@anthropic-ai/claude-agent-sdk` | as pinned | Claude Haiku extraction via OAuth (`extractViaClaude`) | Already the PRIMARY memory-extraction path; reuse for category classification [VERIFIED: src/memory-ingest.ts:39] |
| `@google/genai` | as pinned | `gemini-embedding-001` embeddings + in-JS cosine | Existing embedding + dedupe path; reuse for optional tombstone secondary match [VERIFIED: src/embeddings.ts] |
| `vitest` | ^2.0.0 | Test framework | `npm test` = `vitest run`; includes `src/**/*.test.ts` [VERIFIED: package.json] |

### Supporting (existing internal modules to reuse)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/db.ts` `saveStructuredMemory` / `saveStructuredMemoryAtomic` | Memory write entry points (`:951`, `:1118`) | Add route inserts a confirmed operator fact through (a variant of) this; do not write raw INSERTs in dashboard.ts |
| `src/db.ts` `getDashboardMemoriesList`, `getDashboardPinnedMemories` | Existing read shapes (`:2346`, `:2231`) | Model the new grouped-by-category reader on these |
| `src/memory-ingest.ts` `ingestConversationTurn` | Where new memories are extracted + dedupe-checked (`:161`) | Tombstone check + category classification hook here, at the existing dedupe point (`:219`) |
| `src/memory-consolidate.ts` `runConsolidation` | Where consolidation may synthesize facts (`:62`) | Second tombstone consult point (before `saveConsolidationAtomic`) |
| `src/memory.ts` `buildMemoryContext` | Prompt-injection read path (`:63`) | Behavior-feeding read #1 — must exclude unconfirmed |
| `src/memory-projection.ts` `renderMemoryProjection` | Markdown projection for terminal Claude | Behavior-feeding read #2 — must exclude unconfirmed (calls `getRecentHighImportanceMemories`) |
| `src/embeddings.ts` `embedText` / `cosineSimilarity` | Embedding generation + similarity | Optional tombstone secondary match; same code the dedupe uses |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hybrid hash+embedding tombstone | Pure embedding (sqlite-vec) | Adds a native dep + ABI risk (the project already has an Electron/better-sqlite3 ABI scar, MED-4); in-JS cosine over ~hundreds of rows is fine. Reject. |
| `confirmed` filter at `db.ts` reader layer | Filter at each call site | Two call sites today (`buildMemoryContext`, `renderMemoryProjection`); a third could be added later and silently leak unconfirmed facts. Centralize at the reader. |
| New Claude call for category | Extend the existing extraction prompt to also return `category` | One call instead of two on ingest. Recommended (see Code Examples). |

**Installation:** None. No `npm install` required for this phase.

## Package Legitimacy Audit

> Not applicable. This phase installs **zero** external packages. All libraries used are pre-existing project dependencies verified present in `package.json` and exercised in shipped code (Phases 1-5). slopcheck not run because no install occurs.

## Provenance Derivation (D-03) — the EXACT mapping

**The known gap, resolved.** Inspected every place `source` and `agent_id` are written:

- `src/memory-ingest.ts:234-244` — `ingestConversationTurn` calls `saveStructuredMemoryAtomic(..., 'conversation', agentId)`. `agentId` defaults to `'main'` (`:165`). **Every code-ingested memory is `source='conversation'`.**
- `src/db.ts:958` / `:1118` — `saveStructuredMemory` / `saveStructuredMemoryAtomic` default `source='conversation'`, `agentId='main'`.
- `'checkpoint'` source — written ONLY by the CLAUDE.md `checkpoint` command, a raw `INSERT INTO memories (... source ...) VALUES (..., 'checkpoint', ...)` from a Python one-liner. **Never written through application code** (`grep` of `src/` finds no code writer; the only hits are the extraction prompt's mention and tests).
- There is **no `'you told me'` / operator-authored source value anywhere today.** D-09's Add route is what introduces it.
- `entities` / `topics` are LLM-extracted free text; they do NOT reliably carry an email signal.

**Therefore provenance is derived from `source` + `agent_id`, and "You told me" is created going forward, not back-derived.** Concrete mapping the planner should encode as a pure server-side function:

| Operator tag | Condition (derive from stored columns) | Notes |
|--------------|----------------------------------------|-------|
| **You told me** | `source IN ('you-told-me', 'checkpoint')` OR `confirmed = 1` AND it was operator-authored (new Add route stamps `source='you-told-me'`) | New Add facts (D-09) stamp an explicit operator source. Existing `'checkpoint'` facts are operator-authored by nature (the operator ran `checkpoint`) — map them here. |
| **Learned from your work** | `source = 'conversation'` (the default, machine-inferred from a turn) | This is the overwhelming majority of existing rows. These are the facts that land **unconfirmed** under D-04. |
| **Learned from email** | a row whose `source` is an email-ingest value (e.g. `source = 'email'`) — which **does not exist in the data today** | **Honest coverage (D-05):** emit this tag/group ONLY if `SELECT 1 FROM memories WHERE source = 'email' LIMIT 1` returns a row. Otherwise omit. No email pipeline this phase. |

**Planner note:** pick ONE canonical operator-source literal (recommend `'you-told-me'`) and use it consistently in the Add route, the derivation function, and the confirmed-by-definition rule. Keep the derivation in `src/` (e.g. a `deriveProvenance(memory): 'told'|'work'|'email'` helper) so the API DTO and any tests share it — do not compute it in the Preact layer.

## Confirmed / Unconfirmed Gate (D-04) — every read path that must filter

`grep` confirms **permissions do NOT read memory directly** (`src/permissions-config.ts`, `src/gate.ts` contain no memory reads). Memory influences behavior in exactly two places, both via `db.ts` readers:

| Read path | File | Underlying `db.ts` reader | Action |
|-----------|------|---------------------------|--------|
| Prompt injection ("[Memory context]") | `src/memory.ts` `buildMemoryContext:63` | `searchMemories:1020`, `getRecentHighImportanceMemories:1150`, `getMemoriesWithEmbeddings:1131` | Must exclude unconfirmed |
| Markdown projection for terminal Claude | `src/memory-projection.ts` `renderMemoryProjection` | `getRecentHighImportanceMemories:1150` | Must exclude unconfirmed |

**Recommended schema + filter shape:**
- Add `confirmed INTEGER NOT NULL DEFAULT 0` to `memories`. New behavior: any memory written by the **ingest path** (machine-inferred) defaults to `confirmed = 0`. The **Add route** (D-09) and **checkpoint** facts write `confirmed = 1`. A backfill decision is required for *existing* rows — see Open Questions Q1.
- Apply the gate the SAME way the codebase already gates superseded rows: append `AND confirmed = 1` to the behavior-feeding readers (`searchMemories`, `getRecentHighImportanceMemories`, `getMemoriesWithEmbeddings`). These already carry `AND superseded_by IS NULL`, so the pattern and the test surface exist.
- The **operator Memory surface read** (MEM-01) must do the OPPOSITE — it shows BOTH confirmed and unconfirmed (unconfirmed get the "needs review" marker). So the new GET route uses a separate reader that does NOT filter `confirmed`. Keep the two readers distinct and clearly named (e.g. `getMemoriesForBehavior` vs `getMemoriesForOperatorSurface`).

**Provable test (success criterion underpinning D-04):** insert an unconfirmed fact, assert `buildMemoryContext` output does not contain it and `renderMemoryProjection` output does not contain it; confirm it, assert it now appears. `src/memory.test.ts` and `src/memory-projection.test.ts` already exist as homes for these.

## Tombstone / Suppression (D-08) — provable no-re-derivation

**Existing facts that make this cheap:**
- Ingest already does a dedupe pass at `src/memory-ingest.ts:219-232`: it embeds the candidate, loads `getMemoriesWithEmbeddings(chatId)`, and skips if `cosineSimilarity > 0.85`. **This is the exact hook point** — the tombstone check slots in right beside it (or just before it).
- Embeddings are `gemini-embedding-001` via `@google/genai`, compared with an in-JS `cosineSimilarity` (`src/embeddings.ts`). **No sqlite-vec; cosine is computed in JS.** Embeddings require `GOOGLE_API_KEY` and are *non-fatal* if absent (the code already tolerates `embedding.length === 0`).

**Recommended hybrid strategy (matches Claude's discretion + provability requirement):**

1. **Primary, always-on: normalized-text hash.** On delete, compute `sha256(normalize(summary))` where `normalize` = lowercase, collapse whitespace, strip punctuation (reuse the spirit of `extractKeywords` normalization at `db.ts:1003`). Store the hash in `memory_tombstones`. On ingest/consolidate, compute the same hash of the candidate `summary` and skip if it matches. This works with NO API key and is deterministic — it is the floor that guarantees the literal same fact never returns.
2. **Secondary, when embeddings available: cosine similarity.** Also store the deleted fact's embedding (if one exists) in the tombstone row. On ingest, if the candidate embedding cosine-matches any tombstone embedding `> 0.88` (slightly stricter than the 0.85 dedupe threshold so a paraphrase that would dedupe also gets suppressed, but a genuinely different fact is not over-suppressed), skip. Rationale for 0.88: the dedupe threshold 0.85 is the project's empirically-chosen "this is the same memory" line; a tombstone should be at least as strict, and nudging it up slightly reduces false suppression of adjacent-but-distinct facts.

**Exact hook points (two, per D-08):**
- `src/memory-ingest.ts` `ingestConversationTurn` — consult tombstones **before** `saveStructuredMemoryAtomic` (`:234`), ideally co-located with the existing dedupe loop (`:219`).
- `src/memory-consolidate.ts` `runConsolidation` — consult tombstones **before** `saveConsolidationAtomic`. Consolidation synthesizes a new `summary`/`insight`; tombstone-check that synthesized text so a deleted fact cannot re-enter as a "consolidation."

**Schema:** new `memory_tombstones` table: `id`, `chat_id`, `text_hash TEXT NOT NULL`, `embedding TEXT`, `summary TEXT` (for operator-visible audit/debug), `created_at`. Index on `(chat_id, text_hash)`.

**Provable test (success criterion 3):** delete a fact → tombstone row written; feed the SAME raw turn (or a near-paraphrase) back through `ingestConversationTurn` → assert no new memory row is created and a "suppressed by tombstone" log/return path fires. Add to `src/memory-ingest.test.ts`.

## Category Column + LLM Backfill (D-06)

**Migration convention (verified, MUST follow — drift crash-loops the live service):**
- **Dual-write.** Every additive column appears in BOTH places:
  1. `src/db.ts` `createSchema`/`runMigrations` as a PRAGMA-guarded idempotent `ALTER TABLE memories ADD COLUMN ...` (pattern at `db.ts:743`, `:760`, `:783`, `:791` — check `PRAGMA table_info(memories)` then add if missing).
  2. A versioned migration file `migrations/v1.2.5/<name>.ts` exporting `description` + `async run()`, opening its own better-sqlite3 handle via `path.join(process.cwd(), 'store', 'claudeclaw.db')`, doing the SAME PRAGMA-guarded ADD COLUMNs with **byte-identical column names/types** (pattern: `migrations/v1.2.4/enrich-audit-log.ts`).
  3. Register the new version in `migrations/version.json`.
- Runner is `npm run migrate` (`tsx scripts/migrate.ts`), interactive; the non-interactive core is `runMigrations({ assumeYes })` in `src/migrate-runner.ts`. The live store is NOT auto-migrated on deploy — the operator runs `npm run migrate` before restart (per 03/05 precedent in STATE.md).
- **Columns this phase adds to `memories`:** `category TEXT` (nullable), `confirmed INTEGER NOT NULL DEFAULT 0`. Plus the new `memory_tombstones` table (also dual-written: a `CREATE TABLE IF NOT EXISTS` in `createSchema` + the migration). The migration's existing-row UPDATE backfills `confirmed=1` for all rows present at migration time (Open Q1 RESOLVED) so the D-04 gate does not strip the operator's existing memory.

**On-ingest classification (recommended call shape):**
- **Reuse the existing extractor**, do not add a new LLM path. `src/memory-ingest.ts` already calls `extractViaClaude(prompt)` → `claude-haiku-4-5-20251001` via OAuth (no API key, no quota wall). **Extend `EXTRACTION_PROMPT` (`:111`) to also return a `category` field** constrained to an enum: `"your-business" | "your-clients" | "how-you-work" | null`. One call, not two. Validate/clamp like the existing `importance` handling; `null`/unknown → leave `category` NULL (D-07: stays in data, hidden from the surface).
- If you prefer a separate call (cleaner prompt boundaries), the same `extractViaClaude` helper takes any prompt and returns JSON; a tiny classify-only prompt works. Costs one extra Haiku call per ingested memory. Recommendation: fold into the existing prompt.

**One-time backfill of existing rows:**
- A standalone script (e.g. `scripts/backfill-memory-categories.ts`, runnable via `tsx`) that selects rows with `category IS NULL`, classifies each `summary` via the same `extractViaClaude` classify prompt, and updates the row. Batch + rate-aware (the ingest path already has a 429 backoff model to copy). This is a data migration, distinct from the schema migration — both are needed. Idempotent (only touches `category IS NULL`), so safe to re-run.

## Net-New Mutation API Routes

Memory routes today are **read-only** (`src/dashboard.ts:2300` `/api/memories`, `:2311` `/api/memories/pinned`, `:2317` `/api/memories/list`). All shipped mutations follow one house style; match it exactly:

- **Auth:** every route inherits the app-level **query-token gate** (`?token=` checked against `DASHBOARD_TOKEN`, `requireToken` at `:432`) — do not add bespoke auth.
- **Kill switch:** every non-GET inherits the `DASHBOARD_MUTATIONS_ENABLED` 503 kill-switch middleware (`:449`) — automatic, no per-route code.
- **CSRF:** non-GET requests pass the `Origin` allowlist middleware (`:495`) — automatic.
- **Style:** parse + validate id (`Number.isInteger`), return `c.json({ ok: false, error })` with appropriate status; status-guard state transitions and check `.changes === 1` for replay-once safety (pattern: `:3587` approve, `:3603`; routine/task DELETE/PATCH at `:1603`, `:1612`, `:1872`).

**Routes to add (recommend mounting under `/api/memory/...` to sit cleanly beside the existing read routes, or extend `/api/memories`):**

| Method + Path | Body | Behavior |
|---------------|------|----------|
| `POST /api/memory` (Add — D-09) | `{ summary, category }` | Insert via a `saveStructuredMemory` variant: `source='you-told-me'`, `confirmed=1`, high salience/importance (Claude's discretion on exact values; recommend `importance≈0.9`, `salience` high), `agent_id` = operator's agent, `category` from operator. Generate embedding best-effort. |
| `PATCH /api/memory/:id` (Edit — MEM-02) | `{ summary?, category? }` | Update fields; the existing FTS5 `AFTER UPDATE OF` trigger (`db.ts:772`) keeps search in sync. If summary changes, optionally re-embed. |
| `DELETE /api/memory/:id` (Delete — MEM-02 + D-08) | — | (1) write a `memory_tombstones` row (hash + embedding + summary of the deleted fact), THEN (2) delete the memory row. Order matters: tombstone first so a crash between steps fails safe (suppressed but not yet hidden, never re-derived). |
| `POST /api/memory/:id/confirm` (D-04) | — | Set `confirmed = 1`. After this, the fact begins influencing behavior (next `buildMemoryContext`/projection read picks it up). Status-guard so a double-click is a no-op. |

Validate `category` against the three-value enum on Add/Edit. All four are mutations → covered by the kill switch automatically.

## Operator UI — new page + Labs relocation

**New `/memory` operator page (D-01):**
- Model on `web/src/pages/Activity.tsx` (verified the closest analog): `PageHeader`/`Tab`, `PageState` (loading/empty/error), `Pill` for the provenance tag, grouped rendering (Activity groups by day; Memory groups by **category** — same `useMemo` grouping shape), per-row actions, `apiGet`/`apiPost` from `@/lib/api`, `term()` from `@/lib/vocabulary`, `pushToast` from `@/lib/toasts`, `ConfirmModal` for delete.
- Provenance tag is the hero (spec): render it as a `Pill` per row; choose tones echoing Activity's `toneForTag`. "needs review" marker on `confirmed = 0` rows (D-04) — a distinct amber pill, mirroring Activity's "Needs you" = `medium` tone.
- Header: "What I know about you" + assurance line "Stored on this machine. Edit or delete anything." + Add affordance (D-09, success criterion 4). Copy is Claude's discretion.
- Empty categories hidden (D-07): only render a category section if it has ≥1 row.

**Nav registration (verified pattern — `web/src/lib/routes.ts` is the single source of truth for sidebar + command palette + router):**
- Add a `RouteDef` for the new operator page: `{ path: '/memory', label: 'Memory', vocabKey: <new key>, section: 'intelligence', icon: <lucide icon> }`. Add the matching `<Route path="/memory"><Memory /></Route>` in `web/src/App.tsx` (the **tracked** file — see Pitfall: `app.tsx` is an untracked case-collision artifact).
- Add the `vocabKey` term in `web/src/lib/vocabulary.ts` (the `term()` system; routes resolve operator labels through it).

**Labs relocation of the developer view (D-02) — follow the Audit D-13 precedent exactly:**
- `routes.ts` already demonstrates the move: Audit was pulled OUT of the `intelligence` section's sidebar list while its `<Route>` stayed in `App.tsx` for deep-link/command-palette access (see the D-13 comment block at `routes.ts:38-42`).
- Apply the same to the existing `/memories` (`Memories.tsx` + `BrainGraph`/`BrainGraph3D`): remove its `RouteDef` from the visible `intelligence` nav list (or move it to a `labs`/hidden grouping), keep the `<Route path="/memories">` in `App.tsx` so it still works. Keep the `/memory` → `/memories` legacy redirect logic consistent (note `App.tsx:69` currently redirects `/memory` → `/memories`; this phase TAKES `/memory` for the operator surface, so that redirect must be removed/repointed — verify during planning).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Embedding similarity | A new vector index / sqlite-vec | Existing `embedText` + in-JS `cosineSimilarity` | Native dep + ABI risk (MED-4 scar); dataset is small |
| LLM classification call | A new Gemini/API key path | `extractViaClaude` (Haiku via OAuth) | No key, no quota wall, already the primary extractor |
| Auth / CSRF / kill switch on new routes | Per-route token/origin checks | App-level middleware already covers all non-GET | Re-implementing risks a gap; centralized middleware is the contract |
| FTS sync after edit | Manual FTS rebuild | The `memories_fts` `AFTER UPDATE OF`/`AFTER DELETE` triggers (`db.ts:712`,`:772`) | Triggers already keep search in sync on summary/raw_text/entities/topics changes |
| Raw INSERT/UPDATE in dashboard.ts | SQL in the route handler | `db.ts` functions (`saveStructuredMemory`, new readers/mutators) | House convention: all SQL lives in `db.ts`; routes call functions |

**Key insight:** This phase's risk is in *plumbing the gate through every read path* and *following the migration dual-write byte-for-byte*, not in any new algorithm. The engine, embeddings, classifier, auth, and triggers all already exist.

## Runtime State Inventory

> This is a schema-extension + new-surface phase, not a rename. Included because D-04/D-06/D-08 add persistent state and a backfill.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `memories` table in `store/claudeclaw.db` — existing rows have no `category` and (post-migration) default `confirmed=0`. | **Data migration** (backfill `category` via LLM) + **decision** on existing-row `confirmed` (Open Q1). Schema migration is separate. |
| Live service config | None — no external service stores memory state. The `'checkpoint'` source is written by the CLAUDE.md command into the same SQLite DB (already in scope). | None beyond the DB. |
| OS-registered state | None. | None — verified: memory lives only in SQLite. |
| Secrets/env vars | `GOOGLE_API_KEY` (embeddings, optional), `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` (Haiku extraction), `DASHBOARD_TOKEN` (auth), `DASHBOARD_MUTATIONS_ENABLED` (kill switch). All exist; no new secrets. | None — reuse existing. Note tombstone embedding match degrades gracefully if `GOOGLE_API_KEY` absent (hash floor still works). |
| Build artifacts | The untracked `web/src/app.tsx` is a case-collision duplicate of the tracked `web/src/App.tsx`; `main.tsx` imports `./App`. Editing the wrong one silently no-ops on a case-insensitive macOS FS. | **Edit `App.tsx` (tracked).** Flag the stray `app.tsx` to the operator; consider deleting it (out of scope but a real footgun). |

## Common Pitfalls

### Pitfall 1: Migration dual-write drift crash-loops the live service
**What goes wrong:** Column names/types differ between `db.ts createSchema` and the `migrations/v1.2.5/*.ts` file.
**Why:** The service runs `checkPendingMigrations` on restart; a mismatch between what `createSchema` builds (test/in-memory) and what the migration applied (live store) is treated as drift.
**How to avoid:** Copy the column DDL byte-for-byte between the two; PRAGMA-guard both. Register in `version.json`. (Documented in `migrations/v1.2.4/enrich-audit-log.ts` comments.)
**Warning signs:** Service exits on boot after `npm run migrate`; `migrations.test.ts` / `migrate-runner.test.ts` fail.

### Pitfall 2: Editing `app.tsx` instead of `App.tsx`
**What goes wrong:** Route/nav change appears to do nothing.
**Why:** macOS case-insensitive FS; `main.tsx` imports `./App` → tracked `App.tsx`; the untracked lowercase `app.tsx` is dead.
**How to avoid:** Only touch `web/src/App.tsx` (confirm via `git ls-files`).

### Pitfall 3: Gating only `buildMemoryContext` and forgetting `renderMemoryProjection`
**What goes wrong:** Unconfirmed facts still leak into the terminal-Claude markdown projection, violating D-04.
**Why:** Two independent behavior-feeding read paths share `db.ts` readers.
**How to avoid:** Apply the `confirmed = 1` filter at the `db.ts` reader layer, not per-call-site.

### Pitfall 4: Deriving "You told me" from history
**What goes wrong:** No existing row has an operator-authored source, so back-derivation tags everything "Learned from your work."
**Why:** `source='conversation'` for all code-ingested memories; `'checkpoint'` is the only operator-adjacent value.
**How to avoid:** Treat "You told me" as a forward property stamped by the Add route (`source='you-told-me'`, `confirmed=1`) and map existing `'checkpoint'` rows to it.

### Pitfall 5: Tombstone false-suppression / under-suppression threshold
**What goes wrong:** Threshold too low suppresses legitimately-new facts; too high lets paraphrases slip back.
**How to avoid:** Hash floor catches exact repeats deterministically; set embedding secondary at 0.88 (≥ the 0.85 dedupe line). Make the threshold a named constant for tuning.

### Pitfall 6: Delete order (tombstone vs row)
**What goes wrong:** Crash after deleting the row but before writing the tombstone leaves the fact deletable-but-rederivable.
**How to avoid:** Write the tombstone FIRST, then delete the row (fail-safe ordering).

## Code Examples

### Behavior-read gate (mirrors existing `superseded_by IS NULL`)
```typescript
// Source: pattern from src/db.ts:1136 getMemoriesWithEmbeddings (VERIFIED)
// Add `AND confirmed = 1` alongside the existing superseded filter:
//   ... WHERE chat_id = ? AND embedding IS NOT NULL
//       AND superseded_by IS NULL AND confirmed = 1
// Do this in searchMemories, getRecentHighImportanceMemories, getMemoriesWithEmbeddings.
// Operator-surface reader does NOT add this clause (shows unconfirmed w/ marker).
```

### Tombstone check at the existing dedupe point
```typescript
// Source: src/memory-ingest.ts:219-232 (VERIFIED) — existing dedupe loop.
// Before saveStructuredMemoryAtomic(:234), after embedding (:214):
const hash = sha256(normalizeSummary(result.summary)); // hash floor, always on
if (isTombstoned(chatId, hash, embedding /* optional */)) {
  logger.debug({ summary: result.summary.slice(0, 60) }, 'Skipping tombstoned memory');
  return false;
}
// then the existing 0.85 cosine dedupe loop, then save.
```

### Category via the existing extractor (extend the prompt)
```typescript
// Source: src/memory-ingest.ts:111 EXTRACTION_PROMPT + :39 extractViaClaude (VERIFIED)
// Add to the returned JSON contract:
//   "category": "your-business" | "your-clients" | "how-you-work" | null
// Validate against the enum; null/unknown -> store NULL (D-07 hidden).
// One Haiku-via-OAuth call; no new key, reuses extractViaClaude.
```

### Mutation route (matches approve/deny house style)
```typescript
// Source: src/dashboard.ts:3587 approve, :1603 delete task (VERIFIED)
app.delete('/api/memory/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
  const tomb = writeTombstoneForMemory(id);          // tombstone FIRST (Pitfall 6)
  if (!tomb) return c.json({ ok: false, error: 'not found' });
  const changed = deleteMemory(id);                  // then delete the row
  return c.json({ ok: changed });
});
// Auth (token gate), kill switch (DASHBOARD_MUTATIONS_ENABLED), CSRF inherited from middleware.
```

## State of the Art

| Old Approach | Current Approach | When | Impact |
|--------------|------------------|------|--------|
| `source` as the provenance signal (spec's data note implies `source` carries "you told me"/inferred) | `source` is coarse (`'conversation'` for all code ingests); provenance must be derived + forward-stamped | This phase | Confirms D-03's "derive, don't read" requirement |
| Memory always influences behavior once written | Confirmed/unconfirmed gate at the read layer | This phase (D-04) | New cross-cutting filter on two read paths |
| Delete = hard delete (re-derivable) | Delete = tombstone-then-delete | This phase (D-08) | New table + two ingest/consolidate hooks |

**Deprecated/outdated:** The spec's "Data/engine" note (09-memory.md:46) says `source` provides "you told me"/inferred-from-work — **this is aspirational, not the current data**. Research overrides it: those values do not exist in code-written rows today.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The operator surface should scope reads by `chat_id = ALLOWED_CHAT_ID` (the operator's primary chat), matching the existing `/api/memories/list` default (`dashboard.ts:2318`). | Read scope (D-09 note) | If the operator uses multiple chat_ids, some facts are hidden. Single-operator product makes this low-risk; confirm in planning. [ASSUMED from config + existing route default] |
| A2 | Embedding tombstone threshold 0.88 (vs 0.85 dedupe) is a reasonable starting point. | Tombstone (D-08) | Empirical; may need tuning. Named constant mitigates. [ASSUMED] |
| A3 | Existing `'checkpoint'`-source rows should map to "You told me" (operator-authored by nature). | Provenance (D-03) | If checkpoints are considered machine summaries, they'd mis-tag. Low volume. [ASSUMED] |
| A4 | Folding `category` into the existing extraction prompt (one call) does not degrade extraction quality vs a separate classify call. | Category (D-06) | Could slightly affect importance/skip decisions. Verify with a test sample in planning. [ASSUMED] |

## Open Questions (RESOLVED)

1. **Existing-row `confirmed` backfill.** New ingests default `confirmed=0`. What about the rows already in the DB?
   - What we know: there are existing `'conversation'` (machine-inferred) and `'checkpoint'` (operator) rows.
   - What's unclear: whether to retroactively mark existing inferred facts unconfirmed (forces the operator to review a backlog) or grandfather them as confirmed.
   - Recommendation: grandfather existing rows as `confirmed=1` (default the migration's existing-row value to 1, new inserts to 0) so the gate doesn't silently strip the operator's whole memory the moment the migration runs. Surface only NEW inferred facts as "needs review." Confirm with operator in planning.
   - **RESOLVED:** grandfather existing rows as `confirmed=1` in the v1.2.5 migration UPDATE (the `ALTER TABLE ... ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0` adds the column at 0; the migration then runs an `UPDATE memories SET confirmed = 1` over the rows present at migration time, so every pre-existing fact is grandfathered while new ingests still default to 0).

2. **`/memory` route collision.** `App.tsx:69` currently redirects `/memory` → `/memories`. This phase wants `/memory` for the new operator surface.
   - Recommendation: remove that redirect and give `/memory` to the operator page; keep `/memories` as the (now Labs) developer route. Verify no other links hardcode `/memory`.
   - **RESOLVED:** remove the `/memory` → `/memories` redirect at `App.tsx:69`; `/memory` belongs to the new operator page and `/memories` stays as the (demoted) developer route. Verify no other links hardcode `/memory`.

3. **Where Labs lives.** D-02 says "hidden Labs area" but there is no Labs section in `routes.ts` today (Audit was demoted into Settings>Security, not a Labs area).
   - Recommendation: either add a `labs` section or follow the Audit precedent (route stays in `App.tsx`, pulled from visible nav, reachable via command palette/deep link). Decide in planning; the simpler Audit-style demotion is lower-risk.
   - **RESOLVED:** Audit-style demotion — pull the developer Memories `RouteDef` from the visible nav, keep its `<Route>` in `App.tsx` (reachable via deep link / command palette). No new `labs` section added.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `GOOGLE_API_KEY` | Embeddings (dedupe + optional tombstone secondary) | Conditional (per `.env`) | — | Tombstone hash floor + FTS/LIKE search work without it (code already tolerates absent embeddings) |
| Claude OAuth token | Haiku extraction + category classification | Yes (primary path, no key) | claude-haiku-4-5 | Gemini fallback if configured |
| `npm run migrate` (tsx) | Applying the schema migration | Yes | — | — |
| vitest | Validation | Yes | ^2.0.0 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** `GOOGLE_API_KEY` (embeddings optional; hash-based tombstone + keyword search degrade gracefully).

## Validation Architecture

> nyquist_validation is enabled (config.json workflow.nyquist_validation = true).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.0.0 |
| Config | `package.json` `vitest` block (`environment: node`, `include: src/**/*.test.ts`) |
| Quick run command | `npx vitest run src/memory.test.ts src/memory-ingest.test.ts` |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req / Criterion | Behavior | Test Type | Automated Command | File Exists? |
|-----------------|----------|-----------|-------------------|-------------|
| MEM-01 / crit 1 | Reader returns rows grouped by `category`, empty categories absent | unit | `npx vitest run src/db.test.ts` | ✅ src/db.test.ts |
| MEM-02 / crit 2 | `deriveProvenance` maps source+agent_id to the 3 tags; email tag only if email row exists | unit | `npx vitest run src/memory.test.ts` (or new `src/memory-provenance.test.ts`) | ✅ / ❌ Wave 0 (new file) |
| MEM-02 | Edit updates row + FTS; Delete writes tombstone then removes row | unit/integration | `npx vitest run src/dashboard.contract.test.ts` | ✅ src/dashboard.contract.test.ts |
| Crit 3 (no re-derivation) | Delete → tombstone; re-feed same/near-paraphrase turn → no new row | unit | `npx vitest run src/memory-ingest.test.ts` | ✅ src/memory-ingest.test.ts |
| Crit 3 (consolidation path) | Tombstoned synthesized fact not re-saved by consolidation | unit | `npx vitest run src/memory-consolidate.test.ts` | ✅ src/memory-consolidate.test.ts |
| D-04 | Unconfirmed fact absent from `buildMemoryContext` output; present after confirm | unit | `npx vitest run src/memory.test.ts` | ✅ src/memory.test.ts |
| D-04 | Unconfirmed fact absent from `renderMemoryProjection` output | unit | `npx vitest run src/memory-projection.test.ts` | ✅ src/memory-projection.test.ts |
| Crit 4 | Add inserts confirmed, operator-source, high-salience fact with category | unit | `npx vitest run src/db.test.ts` | ✅ src/db.test.ts |
| Migration | Dual-write columns + tombstone table apply idempotently; no drift | unit | `npx vitest run src/migrations.test.ts src/migrate-runner.test.ts` | ✅ both exist |

### Sampling Rate
- **Per task commit:** the relevant `npx vitest run src/<module>.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/memory-provenance.test.ts` (or provenance cases added to `src/memory.test.ts`) — covers MEM-02 derivation + D-05 honest email coverage
- [ ] Tombstone helper unit coverage — covers crit 3 (add to `src/memory-ingest.test.ts` + `src/memory-consolidate.test.ts`)
- [ ] `confirmed`-gate cases in `src/memory.test.ts` and `src/memory-projection.test.ts` — covers D-04 (both behavior read paths)
- [ ] Migration cases in `src/migrations.test.ts` for the new columns + tombstone table

*(Framework + test files all exist; gaps are new test cases within existing files plus optionally one new provenance test file.)*

## Security Domain

> security_enforcement = true, ASVS level 1, block_on high.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuse app-level `requireToken` query-token gate (`dashboard.ts:432`); no new auth |
| V3 Session Management | no | No sessions introduced |
| V4 Access Control | yes | Single-operator; token + CSRF origin allowlist (`:495`) gate all mutations; kill switch (`:449`) |
| V5 Input Validation | yes | Validate `id` (`Number.isInteger`), `category` against the 3-value enum, clamp `summary` length; bind ALL SQL via `?` placeholders (house rule, never concatenate — see `db.ts` FTS comment at `:1054`) |
| V6 Cryptography | no | Memories table is plaintext (only messaging tables are AES-GCM); SHA-256 for tombstone hashing is non-secret content-addressing, not a security control |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via summary/category in new mutations | Tampering | Parameterized `?` binds in `db.ts` functions; never interpolate |
| CSRF on new POST/PATCH/DELETE | Spoofing/Tampering | Inherited Origin allowlist middleware (`dashboard.ts:495`) |
| Mutation during incident | Tampering | Inherited `DASHBOARD_MUTATIONS_ENABLED` kill switch (`:449`) |
| FTS5 query-operator injection (if summary is ever fed to FTS MATCH) | Tampering | Existing `extractKeywords` + quote-stripping (`db.ts:1054-1059`); reuse, don't re-derive |
| Unconfirmed fact influencing a permission/behavior decision | Elevation of Privilege | D-04 gate at the `db.ts` reader layer (both read paths) |

## Sources

### Primary (HIGH confidence)
- `src/db.ts` — memories schema (`:132`, `:663`), dual-write ALTER pattern (`:728-794`), readers (`:1020`, `:1131`, `:1150`), Memory interface (`:921`), `saveStructuredMemory` (`:951`, `:1118`)
- `src/memory-ingest.ts` — ingest + dedupe + extractor (`:39`, `:111`, `:161`, `:219`, `:234`)
- `src/memory-consolidate.ts` — consolidation save path
- `src/memory.ts` — `buildMemoryContext` (`:63`) behavior read path
- `src/memory-projection.ts` — `renderMemoryProjection` second behavior read path
- `src/embeddings.ts` — `gemini-embedding-001`, in-JS `cosineSimilarity`
- `src/dashboard.ts` — read routes (`:2300`), auth (`:432`), kill switch (`:449`), CSRF (`:495`), mutation style (`:3587`, `:1603`)
- `src/config.ts` — `ALLOWED_CHAT_ID` (`:88`), `AGENT_ID` (`:48`)
- `web/src/lib/routes.ts` — nav single source of truth + Audit D-13 demotion precedent
- `web/src/App.tsx`, `web/src/main.tsx` — router; `App.tsx` is the tracked file
- `web/src/pages/Activity.tsx` — closest operator-page analog
- `migrations/v1.2.4/enrich-audit-log.ts`, `migrations/version.json`, `package.json` — migration + test convention
- `specs/operator-product/09-memory.md`, `07-permissions-settings.md` — design specs
- `.planning/phases/04-*`, `05-*` CONTEXT — operator-vs-technical + honest-coverage precedent

### Secondary / Tertiary
- None — all findings verified against the worktree codebase; no web research needed (no new external dependencies).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified present in package.json + exercised in code
- Provenance derivation (D-03): HIGH — verified every source/agent_id writer by grep + read
- Confirmed gate (D-04): HIGH — both read paths located and verified; permissions confirmed NOT to read memory directly
- Tombstone (D-08): HIGH on hook points (existing dedupe loop), MEDIUM on threshold (empirical, named-constant mitigated)
- Migration convention (D-06): HIGH — verified against v1.2.4 example + runner
- Category classification: MEDIUM — call shape verified; folding into prompt is an assumption (A4)

**Research date:** 2026-06-26
**Valid until:** 2026-07-26 (stable internal codebase; re-verify if memory engine or dashboard auth changes)
