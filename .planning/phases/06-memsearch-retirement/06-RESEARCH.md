# Phase 6: memsearch Retirement - Research

**Researched:** 2026-06-15
**Domain:** Memory recall consolidation (retiring a second semantic index); TypeScript CLI mirroring an existing Stop-hook CLI; ESM/Node + better-sqlite3 + Gemini embeddings; vitest test suite; agentic-os AGENTS.md / cron / settings.json edits
**Confidence:** HIGH

## Summary

This phase removes the *second* semantic index. ClaudeClaw already owns the surviving index: `src/embeddings.ts` (`embedText` via `gemini-embedding-001`, `cosineSimilarity`) + `src/db.ts` (`searchMemories` does vector search over `getMemoriesWithEmbeddings`, falling back to FTS5/LIKE) + `src/memory.ts` (`buildMemoryContext`, the orchestrator's recall entry point). agentic-os's memsearch (v0.4.7, Zilliz/Milvus Lite backend) is a parallel index fed by a nightly cron and queried by AGENTS.md Tier 1. The work is: (1) add `src/recall-cli.ts` — a thin query CLI mirroring `src/capture-cli.ts` that runs ClaudeClaw's embedding recall scoped to `workspaceMemoryKey('aos')`; (2) rewrite AGENTS.md Tier 1 to call it via the existing `~/.claudeclaw-app/dist/` symlink; (3) flip the nightly-memsearch-index cron to `active: 'false'`; (4) freeze `.memsearch/memory/`; (5) prove recall-equivalence with an automated test plus a live round-trip. memsearch CLI, setup scripts, and settings.json perms stay dormant (D-03), `.memsearch/memory/*.md` is frozen as archive (D-04).

Everything needed already exists in the codebase. The recall path is the same one the bot uses, so terminal recall via the CLI gives true parity against the single source-of-record store. No new dependencies, no schema change.

**Primary recommendation:** Add `src/recall-cli.ts` as a positional-arg CLI (`recall-cli.js "<query>" [--top-k N]`, like `schedule-cli.ts`, NOT stdin like `capture-cli.ts`). It calls a small exported recall function over `searchMemories(workspaceMemoryKey('aos'), query, topK, await embedText(query), 'aos')` and prints formatted results to stdout. Sequence the reversible disable + live proof LAST (D-06).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Semantic recall (embeddings + cosine) | ClaudeClaw backend (`src/embeddings.ts` + `src/db.ts searchMemories`) | — | Single surviving index; SQLite is source of record (MEM-01) |
| Terminal Tier-1 recall surface | ClaudeClaw CLI (`src/recall-cli.ts` → `dist/`) | agentic-os AGENTS.md (instruction only) | Terminal invokes the CLI over the symlink; AGENTS.md just documents the command |
| Bot recall surface | ClaudeClaw orchestrator (`buildMemoryContext` w/ `strictAgentId`) | — | Already in place from Phases 4/5; unchanged this phase |
| Memory capture (terminal → store) | agentic-os Stop hook → `dist/capture-cli.js` | ClaudeClaw `saveConversationTurn` | Established Phase 5; the recall-CLI is its read-side twin |
| Nightly re-index (to retire) | agentic-os cron engine (`nightly-memsearch-index.md`) | — | Disabled here by flipping `active:'false'`; ClaudeClaw scheduler unaffected (Phase 7 owns the bridge) |
| `.memsearch/memory/*.md` archive | agentic-os filesystem (frozen) | — | Stop writing, no migration, no deletion (D-04) |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEM-05 | memsearch is retired — no second semantic index runs, and memory recall still works through ClaudeClaw's embeddings | recall-CLI design (D-01) reuses `searchMemories` + `embedText`; cron disable (D-03) stops the only `memsearch index` invocation (confirmed: only `nightly-memsearch-index.md` runs it); AGENTS.md Tier-1 rewrite (D-02) removes the memsearch/reranker recall path; automated single-index invariant test + live round-trip (D-05) prove equivalence |
</phase_requirements>

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Add a `recall-cli.ts` in ClaudeClaw `src/` mirroring `src/capture-cli.ts`. It queries ClaudeClaw's SQLite embeddings (`recallMemoryContext` / `searchMemories` + `embedText` in `src/memory.ts`) and prints recall results for a query. True semantic parity with the bot against the single source-of-record store. Recall scoped per the workspace agent (reuse `strictAgentId` / workspace-memory-key from Phases 4-5).
- **D-02:** Rewrite AGENTS.md "Memory Retrieval" Tier 1 to invoke the new recall-CLI instead of `/memory-recall` / `memsearch search ... | reranker.py`. Tier 0 (context/MEMORY.md + daily log + the Phase-5 `context/memory/*.md` projection) unchanged. memsearch CLI and `reranker.py` removed from Tier-1 instructions.
- **D-03:** Disable + de-reference, NOT full removal. Flip `cron/jobs/nightly-memsearch-index.md` to `active:'false'`; strip memsearch wiring from AGENTS.md; leave the memsearch CLI binary, `scripts/setup-memsearch.*`, `scripts/stop-memsearch-watchers.ps1`, and `Bash(memsearch *)` / setup-script perms in `.claude/settings.json` DORMANT (not deleted). Chosen for reversibility. Full deletion is a later cleanup.
- **D-04:** Freeze `.memsearch/memory/*.md` as archive. Stop writing, leave existing files for history. No migration into SQLite (overlaps Phase-5 projection). No deletion.
- **D-05:** Prove recall-equivalence with BOTH an automated test (single-index / single-store invariant + recall returns results via ClaudeClaw embeddings only) AND a live terminal+bot round-trip with memsearch off.
- **D-06 (execution gate — CLEARED 2026-06-15):** Phases 4 & 5 verified live, so the fallback can be removed. Structure the phase so the reversible disable + live recall proof are the FINAL steps, after the recall-CLI exists and AGENTS.md is rewritten. Never disable the index before its replacement is in place.

### Claude's Discretion
- Exact name/flags of the recall-CLI (e.g., `recall-cli.js "<query>" [--top-k]`), output format, and how AGENTS.md phrases the new Tier-1 instruction — following the `capture-cli.ts` precedent.
- Whether the recall-CLI is exposed to the terminal via the existing `~/.claudeclaw-app/dist/` symlink (same mechanism `capture-cli.js` already uses).

### Deferred Ideas (OUT OF SCOPE)
- Full memsearch removal (delete cron job, plugin, setup scripts, settings perms, `.memsearch/` dir) — deferred to v2 CLN-01/02.
- Folding `.memsearch/memory/` history into SQLite — rejected (D-04, duplicate of projection).
</user_constraints>

## Project Constraints (from CLAUDE.md)

- **No em dashes. Ever.** All created/edited files (recall-cli.ts, tests, AGENTS.md edits, cron frontmatter) must use `--` or commas, never `—`. The existing memory-projection test even asserts `not.toContain('—')`.
- **No AI clichés / no narration** in any prose written into AGENTS.md.
- launchd: never use paths with spaces in `StandardOutPath`/`StandardErrorPath`; the project dir has a space, hence the `~/.claudeclaw-app` symlink. The recall-CLI invocation MUST go through that symlink, not the raw `/Users/shannongueringer/App Repo/claudeclaw` path.
- Schema changes go through versioned `migrations/<version>/` (add-migration skill), never inline. **Not expected this phase** — recall is read-only over the existing `memories` table.

## Standard Stack

### Core (already present — no installs)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | (installed) | Synchronous SQLite access in `db.ts` | The single source-of-record store; `searchMemories` runs here |
| `@google/genai` | (installed) | `embedText` via `gemini-embedding-001` in `embeddings.ts` | The single embedding index ClaudeClaw owns |
| `vitest` | (installed) | Test runner (`npm test` = `vitest run`) | All 38 `src/*.test.ts` files use it; D-05 automated test folds in here |
| `typescript` / `tsx` | (installed) | TS compile to `dist/` (`npm run build` = `vite build && tsc`); `tsx` for dev | recall-cli.ts compiles to `dist/recall-cli.js`, reached via symlink |

**Installation:** None. No new dependency is needed or wanted. (`memsearch` v0.4.7 stays installed but dormant; do not uninstall — D-03.)

**Version verification:** `memsearch --version` → `memsearch, version 0.4.7` [VERIFIED: local PATH]. All ClaudeClaw deps confirmed present in `package.json` [VERIFIED: codebase].

## Package Legitimacy Audit

> Not applicable — this phase installs NO external packages. All code reuses existing in-repo modules and already-installed dependencies. memsearch is being *retired*, not added. No registry interaction occurs.

## Architecture Patterns

### System Architecture Diagram

```
                          BEFORE (two indexes)
  terminal session ──Tier1──> memsearch search ──> Milvus/Zilliz index ──┐
                                                                          ├─ TWO indexes
  bot @aos: turn ───recall──> buildMemoryContext ──> SQLite embeddings ──┘

  nightly 23:30 cron ──> memsearch index <dirs> ──> rebuilds Milvus index


                          AFTER (one index)
  terminal session ──Tier1──> node ~/.claudeclaw-app/dist/recall-cli.js "<q>"
                                        │
                                        ▼
  bot @aos: turn ───recall──> [ searchMemories(ws:aos, q, k, embed(q), 'aos') ]
                                        │           (src/db.ts + src/embeddings.ts)
                                        ▼
                              ONE SQLite embedding index  (source of record)

  nightly cron: active:'false'  (does not fire; memsearch CLI dormant on disk)
  .memsearch/memory/*.md: frozen archive (no writes)
```

Data flow to trace for the primary use case: terminal user asks a recall question → AGENTS.md Tier 1 instructs `node "$HOME/.claudeclaw-app/dist/recall-cli.js" "<query>"` → CLI embeds the query (`embedText`) → `searchMemories('ws:aos', query, topK, embedding, 'aos')` → formatted results to stdout → Claude summarizes. The bot path hits the exact same `searchMemories` call inside `buildMemoryContext`. One index, one store, two surfaces.

### Recommended Code Layout (new + edited)
```
claudeclaw/
├── src/
│   ├── recall-cli.ts          # NEW — positional-arg query CLI (mirrors schedule-cli arg shape, capture-cli structure)
│   ├── recall-cli.test.ts     # NEW — unit test of the pure recall function + single-index invariant
│   ├── memory.ts              # optional: add thin `recallForWorkspace(query, opts)` wrapper export
│   └── db.ts / embeddings.ts  # UNCHANGED — reused
└── dist/recall-cli.js         # build output, reached via ~/.claudeclaw-app symlink

agentic-os/
├── AGENTS.md                  # EDIT — Tier 1 rewrite (lines 216-219, 226, 228)
├── cron/jobs/nightly-memsearch-index.md   # EDIT — active: 'false'
├── .claude/settings.json      # UNCHANGED this phase (perms stay dormant, D-03)
└── .memsearch/memory/         # FROZEN (no writes; no code change needed, it just stops being indexed)
```

### Pattern 1: Positional-arg CLI (NOT stdin)
**What:** `recall-cli.ts` takes the query as `argv[2]` and an optional `--top-k N`, exactly like `schedule-cli.ts` parses `command`/`rest`. This differs from `capture-cli.ts`, which reads JSON on stdin (because a Stop hook pipes JSON). Recall is invoked with a query string, so it is arg-based.
**When to use:** This phase.
**Example:**
```typescript
// Source: pattern composed from src/schedule-cli.ts (arg parsing) + src/capture-cli.ts (run-as-main idiom)
#!/usr/bin/env node
import { initDatabase } from './db.js';
import { recallForWorkspace } from './memory.js'; // thin wrapper, see Pattern 2

async function runRecallCli(): Promise<void> {
  initDatabase();
  const argv = process.argv.slice(2);
  const tkIdx = argv.indexOf('--top-k');
  const topK = tkIdx !== -1 ? Number(argv[tkIdx + 1]) || 10 : 10;
  const query = argv.filter((_, i) => i !== tkIdx && i !== tkIdx + 1).join(' ').trim();
  if (!query) { process.stderr.write('usage: recall-cli "<query>" [--top-k N]\n'); process.exit(2); }

  const results = await recallForWorkspace(query, { agentId: 'aos', topK });
  // formatted, plain text — easy for a terminal Claude to summarize
  if (results.length === 0) { process.stdout.write('No matching memories found.\n'); }
  else { for (const r of results) process.stdout.write(`- ${r}\n`); }
  process.exit(0);
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) { void runRecallCli(); }
```

### Pattern 2: Thin exported recall wrapper in memory.ts
**What:** `buildMemoryContext` (the bot's entry point) is heavy: it builds a full prepended context block, gates Layer 5 history on recall keywords, and pulls team-activity/consolidations. For a terminal recall CLI you want the raw semantic hits. Add a small exported function so the CLI and the bot share the SAME `searchMemories` + `embedText` call.
**When to use:** This phase (recommended — gives a clean unit-test seam and keeps the invariant honest).
**Example:**
```typescript
// Source: composed from src/memory.ts buildMemoryContext (lines 79-100) — the exact embed+search path
// Add to src/memory.ts:
export async function recallForWorkspace(
  query: string,
  opts: { agentId?: string; topK?: number } = {},
): Promise<string[]> {
  const agentId = opts.agentId ?? 'aos';
  const chatId = workspaceMemoryKey(agentId);          // 'ws:aos' — same pool as bot + capture
  let queryEmbedding: number[] | undefined;
  if (GOOGLE_API_KEY) {
    try { queryEmbedding = await embedText(query); } catch { /* falls back to FTS5/LIKE */ }
  }
  const hits = searchMemories(chatId, query, opts.topK ?? 10, queryEmbedding, agentId);
  return hits.map((m) => m.summary);
}
```
This reuses `searchMemories` (vector-first with FTS5/LIKE fallback) and `strictAgentId='aos'` scoping (Phase 4) against `ws:aos` (Phase 5). Note: `recallMemoryContext` named in CONTEXT.md does NOT exist as a symbol; the real entry point is `buildMemoryContext`. The wrapper above is the clean substitute the CONTEXT.md intent points at. Import `workspaceMemoryKey` from `./agent-config.js`, `embedText` from `./embeddings.js`, `searchMemories` from `./db.js`, `GOOGLE_API_KEY` from `./config.js`.

### Anti-Patterns to Avoid
- **Calling `buildMemoryContext` from the CLI directly:** it would inject team-activity/consolidation/Obsidian blocks and keyword-gate history — noise for a terminal recall and a leak risk (consolidations have no agent_id). Use the thin wrapper.
- **Opening a fresh sqlite connection or reading raw files in the CLI:** must go through `db.ts` (`initDatabase` + `searchMemories`) for MEM-01/MEM-06 path integrity (mirror the projection's source-guard discipline).
- **Trusting an agent_id from argv:** attribution is fixed server-side to `'aos'` (same rule as capture-cli T-05-06).
- **Hardcoding the repo path in AGENTS.md:** use `node "$HOME/.claudeclaw-app/dist/recall-cli.js"` (symlink) — the raw path has a space.
- **Disabling the cron before the CLI + AGENTS.md rewrite ship:** violates D-06 sequencing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Query embedding | Custom vectorizer / new embedding call | `embedText` (`src/embeddings.ts`) | Single embedding model (`gemini-embedding-001`); reuse guarantees parity with the bot |
| Vector + keyword search | New cosine/FTS loop in the CLI | `searchMemories` (`src/db.ts`) | Already vector-first with FTS5 + LIKE fallback and `superseded_by` filtering |
| Per-agent scoping | New WHERE clause | `strictAgentId='aos'` arg + `workspaceMemoryKey('aos')` | Phase 4/5 plumbing; prevents cross-agent leakage |
| DB path resolution | `process.cwd()` joins | `initDatabase()` (anchors on PROJECT_ROOT via config.ts) | CLI runs from the agentic-os cwd; must still hit the claudeclaw store (capture-cli proves this) |
| run-as-main detection | argv string hacks | `import.meta.url === new URL(...)` idiom from capture-cli | Lets vitest import the pure function without running the CLI |

**Key insight:** This phase is almost entirely *composition of existing modules*. The only genuinely new code is ~40 lines of CLI glue + an optional ~12-line wrapper. Hand-rolling anything in the recall path would re-create a second code path and defeat the single-index goal.

## Runtime State Inventory

> Rename/refactor/retirement phase — inventory required.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **memsearch's Milvus/Zilliz index** (local Milvus Lite on macOS per AGENTS.md line 524). It holds embeddings of `context/memory/`, `.memsearch/memory/`, `context/transcripts/`, `context/learnings.md`, `brand_context/`. | None required (D-03 = dormant, not deleted). It simply stops being refreshed once the cron is off. Do NOT migrate it (D-04). |
| Live service config | **`nightly-memsearch-index.md` cron** (`active:'true'`, time `23:30`, daily) — the ONLY job that runs `memsearch index`. Lives in the agentic-os cron engine (file-based frontmatter), NOT in ClaudeClaw's scheduler. | Flip `active:'false'` (D-03). Phase 7 owns scheduler ownership; this phase only flips this one flag. |
| OS-registered state | memsearch `watch` watchers (real-time index on macOS/Linux). `MEMSEARCH_NO_WATCH=1` on Windows; `scripts/stop-memsearch-watchers.ps1` clears stale ones. | None this phase — watchers only run if memsearch is actively used; with the cron off and AGENTS.md no longer invoking it, nothing starts them. Script stays dormant (D-03). Verify no launchd/cron-engine process currently runs `memsearch watch` before the live proof. |
| Secrets/env vars | `ZILLIZ_URI`, `ZILLIZ_TOKEN` (AGENTS.md line 524). Referenced by memsearch only. | None — leave in `.env`; harmless when the cron is off. No code in ClaudeClaw reads them. |
| Build artifacts | New: `dist/recall-cli.js` must be built (`npm run build`) and reachable via `~/.claudeclaw-app` symlink (already live → `/Users/shannongueringer/App Repo/claudeclaw`, verified). | Run `npm run build` after writing recall-cli.ts; confirm `dist/recall-cli.js` exists (like `dist/capture-cli.js` does today). |

**Other agentic-os crons — scope-boundary check (CONTEXT item 5):** `daily-memory-distill.md`, `weekly-memory-curator.md`, `weekly-memory-gaps.md`, `monthly-learnings-health.md`, `weekly-activity-digest.md`, `skill-update-check.md`, `youtube-newsletter.md`. **Grep result:** the ONLY file invoking a `memsearch` *command* (`index`/`search`/`stats`/`--version`) is `nightly-memsearch-index.md` [VERIFIED: grep]. `daily-memory-distill.md` line 22 and `weekly-memory-gaps.md` line 28 reference the **`.memsearch/memory/` directory as a file path** (reading auto-captured markdown), not the index command. So:
- They do NOT hard-depend on `memsearch index`. They keep working — they read the frozen `.memsearch/memory/*.md` files as plain markdown. **OUT OF SCOPE, leave running** (matches CONTEXT scope boundary).
- Minor note for the planner: since `.memsearch/memory/` is frozen (D-04, no new files written by the retired Stop-hook capture path), those two crons will see no *new* `.memsearch/memory/` entries going forward — but the Phase-5 `context/memory/*.md` projection covers that ground, and the crons already read `context/memory/` too. No action; flag as a benign behavioral note.

**Migration:** None. Recall is read-only over the existing plaintext `memories` table. `migrations/version.json` shows an empty `migrations:{}` map; do not touch it.

## Common Pitfalls

### Pitfall 1: Disabling the cron before the replacement exists
**What goes wrong:** Terminal recall breaks for a window — memsearch off but no recall-CLI yet.
**Why it happens:** Doing the "easy" cron flip first.
**How to avoid:** D-06 ordering — recall-CLI built + AGENTS.md rewritten + (ideally) live-verified, THEN flip `active:'false'`. Make the disable the last reversible step.
**Warning signs:** A plan that puts the cron edit in an early wave.

### Pitfall 2: stdin vs arg CLI confusion
**What goes wrong:** Copying capture-cli's stdin reader makes recall hang waiting for stdin that never comes (terminal calls it with a query arg).
**Why it happens:** "Mirror capture-cli.ts" read too literally.
**How to avoid:** Mirror capture-cli's *structure and safety discipline* (initDatabase, run-as-main idiom, server-side agent_id, try/catch), but parse the query from `argv` like `schedule-cli.ts`.
**Warning signs:** CLI blocks with no output in the live test.

### Pitfall 3: Embedding unavailable in CI / no GOOGLE_API_KEY
**What goes wrong:** A test or live run with no key throws on `embedText`.
**Why it happens:** Embedding is required for vector search.
**How to avoid:** Mirror `buildMemoryContext` — wrap `embedText` in try/catch and let `searchMemories` fall back to FTS5/LIKE (it already does when `queryEmbedding` is empty). The automated test should mock `embedText` (vitest `vi.mock`) rather than hit the network, like `memory-projection.test.ts` mocks `db.js`.
**Warning signs:** Test flakes or network calls in `vitest run`.

### Pitfall 4: Cross-agent / cross-pool leakage
**What goes wrong:** Recall returns `main`'s memories or another chat's.
**Why it happens:** Forgetting `strictAgentId='aos'` or using the wrong chatId.
**How to avoid:** Always `searchMemories(workspaceMemoryKey('aos'), q, k, emb, 'aos')`. Phase 4 db.test.ts already proves agent_id scoping prevents leakage; the recall-CLI test should assert the same args are passed.

### Pitfall 5: Symlink / dist drift
**What goes wrong:** AGENTS.md points at a path that has no built artifact.
**Why it happens:** Forgetting `npm run build`, or pointing at the spaced raw path.
**How to avoid:** Build first, confirm `dist/recall-cli.js` exists, reference `$HOME/.claudeclaw-app/dist/recall-cli.js`. The symlink is already live (verified).

### Pitfall 6: Phase-5 Stop-hook wiring discrepancy (important for the live proof)
**What goes wrong:** The 05-02 SUMMARY says the agentic-os Stop hook runs `dist/capture-cli.js` and SessionStart loads the projection. The CURRENT on-disk `/Users/shannongueringer/App Repo/agentic-os/.claude/settings.json` does NOT reference `capture-cli.js` anywhere — its Stop array runs only `session-sync-stop.js`, and SessionStart runs `load-memory-snapshot.js` (which reads SOUL/USER/MEMORY/daily-log, not the `.claudeclaw.md` projection). [VERIFIED: grep + file read]
**Why it happens:** Either the live wiring was reverted/stashed, or the summary described an intended state not landed in this checkout.
**How to avoid:** The planner must NOT assume the capture/projection hooks are wired when designing the live round-trip (D-05). Either (a) treat re-wiring the Stop hook to `capture-cli.js` as a prerequisite of the live proof, or (b) scope the live proof to the recall direction only and capture via the bot. Flag this to the user during planning — it directly affects whether the "terminal work is captured then recalled" half of D-05 can run.
**Warning signs:** Live proof expecting terminal turns to land in `ws:aos` with no Stop hook actually firing capture-cli.

## Code Examples

### Exact AGENTS.md Tier-1 edit (D-02) — quoted before/after
Current text (`AGENTS.md` lines 216-219) [VERIFIED: file read]:
```markdown
2. **Tier 1** — If Tier 0 has nothing, run semantic search. Two ways depending on what's installed:
   - **memsearch plugin installed** (Claude Code): invoke `/memory-recall "query"` or ask naturally — the plugin auto-invokes the skill.
   - **CLI only**: run `memsearch search "query" --top-k 10 --json-output | python3 scripts/lib/reranker.py "query"` — results come back re-ranked by source authority and recency. Summarise the top 5.
   Searches `context/memory/`, `.memsearch/memory/`, `context/transcripts/`, `context/learnings.md`, and `brand_context/`.
```
Recommended replacement (no em dashes, per CLAUDE.md):
```markdown
2. **Tier 1** - If Tier 0 has nothing, run ClaudeClaw semantic recall against the single memory store:
   `node "$HOME/.claudeclaw-app/dist/recall-cli.js" "query" --top-k 10`
   This queries ClaudeClaw's SQLite embeddings (the source of record shared with the bot), scoped to this workspace. Summarise the top results and cite them per the rules below.
```
Also note line 228 references `bash scripts/lib/memory-meta.sh "[topic]"` for coverage and line 226 ("ran semantic search across all indexed sources") — the planner should reword line 226's phrasing to "ran ClaudeClaw semantic recall" for consistency, and decide whether memory-meta.sh (a memsearch-coverage helper) stays as a Tier-0/3 aid or is dropped from the recall flow. Tier 0 (line 215) and Tiers 2-3 (line 230) are unchanged.

### Exact cron edit (D-03)
In `cron/jobs/nightly-memsearch-index.md` frontmatter, change:
```yaml
active: 'true'
```
to:
```yaml
active: 'false'
```
Leave the body intact (dormant, reversible). [VERIFIED: file read — only this one job invokes `memsearch index`]

### Automated test skeleton (D-05) — vitest, mocked like the projection test
```typescript
// Source: pattern from src/memory-projection.test.ts + src/capture-cli.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchCalls: unknown[][] = [];
vi.mock('./db.js', () => ({
  initDatabase: vi.fn(),
  searchMemories: vi.fn((...args: unknown[]) => { searchCalls.push(args); return [{ summary: 'Q3 launch is Oct 14' }]; }),
}));
vi.mock('./embeddings.js', () => ({ embedText: vi.fn(async () => [0.1, 0.2, 0.3]) }));
vi.mock('./agent-config.js', () => ({ workspaceMemoryKey: (id: string) => `ws:${id}` }));

import { recallForWorkspace } from './memory.js';

beforeEach(() => { searchCalls.length = 0; vi.clearAllMocks(); });

describe('recallForWorkspace (single-index invariant)', () => {
  it('recalls through ClaudeClaw embeddings + searchMemories only, scoped to ws:aos/aos', async () => {
    const out = await recallForWorkspace('when is the launch', { agentId: 'aos', topK: 10 });
    expect(out).toContain('Q3 launch is Oct 14');
    // single store + single index: searchMemories called once, with the workspace pool + strict agent
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0][0]).toBe('ws:aos');       // chatId = workspace pool
    expect(searchCalls[0][4]).toBe('aos');          // strict agent scope (no cross-agent leak)
    expect(Array.isArray(searchCalls[0][3])).toBe(true); // embedding present (ClaudeClaw's index)
  });
});

// Source-guard variant (proves no second index in the recall path):
it('the recall module references no memsearch / second-index path', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'recall-cli.ts'), 'utf8');
  expect(src).not.toMatch(/memsearch/i);
  expect(src).not.toContain('reranker');
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Two semantic indexes (memsearch Milvus + ClaudeClaw SQLite embeddings) | One SQLite embedding index, two surfaces (bot + recall-CLI) | This phase (MEM-05) | No duplicate index process or nightly job |
| Terminal Tier-1 = `memsearch search ... \| reranker.py` or `/memory-recall` plugin | Terminal Tier-1 = `recall-cli.js "<q>"` over the symlink | This phase (D-02) | Terminal and bot share one store; true parity |
| `.memsearch/memory/` written + indexed | `.memsearch/memory/` frozen archive; Phase-5 `context/memory/*.md` projection is the live Tier-0 source | Phase 5 + this phase (D-04) | No new writes; history preserved |

**Deprecated/outdated (kept dormant, not deleted — D-03):**
- memsearch CLI v0.4.7, `scripts/setup-memsearch.*`, `scripts/stop-memsearch-watchers.ps1`, `Bash(memsearch *)` + setup-script perms in settings.json, `reranker.py`, `memory-meta.sh` (memsearch-coverage helper). Candidates for v2 CLN-01/02 cleanup.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `recallMemoryContext` named in CONTEXT.md/D-01 does not exist as a symbol; the real recall entry point is `buildMemoryContext`, and a thin `recallForWorkspace` wrapper is the intended substitute. | Pattern 2 | LOW — verified by grep that no `recallMemoryContext` export exists; the wrapper achieves D-01's stated intent (reuse searchMemories+embedText scoped to ws:aos). |
| A2 | memsearch uses local Milvus Lite on this macOS host (per AGENTS.md line 524). | Runtime State Inventory | LOW — disabling the cron stops refresh regardless of backend; this only affects how the dormant index is described, not the work. |
| A3 | The Phase-5 capture-cli Stop hook + projection SessionStart hook are NOT currently wired in the live agentic-os settings.json (despite 05-02 SUMMARY). | Pitfall 6 | MEDIUM — affects the D-05 live round-trip design. Verified by grep/read of the current file; user should confirm intended wiring before the live proof. |
| A4 | No other agentic-os cron hard-depends on `memsearch index`; the two `.memsearch/memory/` references are file-path reads, not index commands. | Runtime State Inventory | LOW — verified by grep across all cron job files. |

**A3 is the one to surface to the user** — it determines whether the "terminal work captured then recalled" half of D-05 is runnable as-is or needs the Stop hook re-wired first.

## Open Questions

1. **Is the capture/projection hook wiring currently live in agentic-os?**
   - What we know: 05-02 SUMMARY claims the Stop hook runs `capture-cli.js` and SessionStart loads the projection; the current on-disk settings.json does NOT (only `session-sync-stop.js` / `load-memory-snapshot.js`).
   - What's unclear: whether it was reverted, stashed, or never landed in this checkout.
   - Recommendation: Planner asks the user / inspects the deployed config. If unwired, either re-wire the Stop hook as a prerequisite task, or scope the live D-05 round-trip to: bot writes a fact (@aos:) → terminal recalls it via recall-CLI (recall direction only), which is the core MEM-05 claim anyway.

2. **Does `scripts/lib/memory-meta.sh` (coverage helper, AGENTS.md line 228) depend on memsearch?**
   - What we know: it is invoked for "exact coverage" in partial/absent recall responses.
   - What's unclear: whether it shells out to `memsearch stats`/`index`.
   - Recommendation: Planner reads `scripts/lib/memory-meta.sh`; if it calls memsearch, drop it from the rewritten Tier-1/coverage instructions (it would otherwise hit a dormant index). If it only stats files, it can stay.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js / `npm run build` | building `dist/recall-cli.js` | ✓ | (project toolchain) | — |
| `~/.claudeclaw-app` symlink | terminal invocation of recall-CLI | ✓ | → `/Users/shannongueringer/App Repo/claudeclaw` | — |
| `GOOGLE_API_KEY` | `embedText` for vector recall | assumed ✓ (bot uses it) | gemini-embedding-001 | FTS5/LIKE keyword fallback in `searchMemories` |
| `memsearch` CLI | being retired (must NOT be uninstalled) | ✓ (dormant) | 0.4.7 | n/a — left in place by D-03 |
| agentic-os repo | AGENTS.md + cron edits | ✓ | at `/Users/shannongueringer/App Repo/agentic-os` | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** `GOOGLE_API_KEY` absence degrades vector recall to keyword recall (still returns results; parity with bot's own fallback behavior).

## Validation Architecture

> Nyquist validation enabled (`workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (installed) |
| Config file | uses `vite` config; runner via `npm test` = `vitest run` |
| Quick run command | `npx vitest run src/recall-cli.test.ts` |
| Full suite command | `npx vitest run` (or `npm test`) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEM-05 | Recall returns relevant results via ClaudeClaw embeddings only (one index) | unit | `npx vitest run src/recall-cli.test.ts` (asserts `searchMemories` called once with `ws:aos`/`aos`/embedding) | ❌ Wave 0 |
| MEM-05 | No second semantic index in the recall path (source-guard) | unit | same file — assert recall module source has no `memsearch`/`reranker` reference | ❌ Wave 0 |
| MEM-05 | Per-agent scoping (no cross-agent leakage) | unit | reuse Phase-4 `db.test.ts` agent_id scoping (already green) + assert CLI passes `strictAgentId='aos'` | partial (Phase 4 exists) |
| MEM-05 | Terminal recall-CLI parity (live) | manual / human-verify | `node "$HOME/.claudeclaw-app/dist/recall-cli.js" "<known fact>"` returns the fact in a terminal AND the bot recalls the same fact for `@aos:` | manual |
| MEM-05 | Nightly index does not fire | manual / human-verify | confirm `nightly-memsearch-index.md` `active:'false'`; no `memsearch index` in process list after 23:30 | manual |
| COMPAT-03 | Existing suite stays green | regression | `npx vitest run` (expect baseline: 2 known unrelated failures — dashboard.contract chatId, chat-task-tracker no-key) | exists |

### Sampling Rate
- **Per task commit:** `npx vitest run src/recall-cli.test.ts`
- **Per wave merge:** `npx vitest run` (full suite; tolerate the 2 documented baseline failures only)
- **Phase gate:** Full suite green (modulo known baseline) before `/gsd-verify-work`; live round-trip human-verified LAST.

### Wave 0 Gaps
- [ ] `src/recall-cli.test.ts` — covers MEM-05 single-index invariant + source-guard (mock `db.js` + `embeddings.js` like `memory-projection.test.ts`)
- [ ] (optional) extend `src/memory.test.ts` if `recallForWorkspace` lives in memory.ts — assert it forwards `strictAgentId` and `ws:aos`
- [ ] No framework install needed (vitest present)

## Security Domain

> `security_enforcement: true`, ASVS level 1.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface added |
| V3 Session Management | no | — |
| V4 Access Control | yes | Per-agent recall scope: `strictAgentId='aos'` + `ws:aos` pool prevents reading other agents'/chats' memories (reuse Phase 4 control) |
| V5 Input Validation | yes | Query arg is untrusted: do not interpolate into SQL (searchMemories already parameterizes + sanitizes FTS5 quotes, db.ts lines 933-938); fix `agent_id='aos'` server-side, never from argv; cap query length |
| V6 Cryptography | no | recall reads plaintext `memories.summary`; no crypto, no encrypted-table reads (MEM-06 path preserved — mirror projection's source-guard) |

### Known Threat Patterns for {TS CLI over SQLite + Gemini}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| FTS5 query injection via crafted query string | Tampering | `searchMemories` strips `"` and wraps as FTS5 phrase (db.ts:938); keep using it, never build raw SQL |
| Cross-agent memory disclosure | Information Disclosure | `strictAgentId='aos'` + `workspaceMemoryKey('aos')` scope (V4) |
| Spoofed agent attribution via argv | Spoofing | Hardcode `agentId='aos'` in the CLI; ignore any argv-supplied agent (capture-cli precedent T-05-06) |
| Reading encrypted messaging tables | Information Disclosure | Recall only `memories` (plaintext); never touch `wa_*`/`slack_messages` (MEM-06 source-guard test) |
| Unbounded query / resource use | DoS | Length-cap the query (mirror capture-cli's 4000-char cap); `--top-k` bounded default 10 |

## Sources

### Primary (HIGH confidence)
- Codebase [VERIFIED]: `src/capture-cli.ts`, `src/memory.ts` (buildMemoryContext lines 62-238), `src/embeddings.ts`, `src/db.ts` (searchMemories 899-958, getRecentHighImportanceMemories 1029-1048), `src/agent-config.ts` (workspaceMemoryKey 203-205, isWorkspaceAgent, resolveAgentRuntime), `src/memory-projection.ts`, `src/schedule-cli.ts` (arg-parse pattern), `src/memory-projection.test.ts` + `src/capture-cli.test.ts` (vitest mock patterns), `package.json`, `tsconfig.json`, `migrations/version.json`
- agentic-os [VERIFIED]: `AGENTS.md` (Memory Retrieval 211-230, Zilliz note 524), `cron/jobs/nightly-memsearch-index.md`, `cron/jobs/daily-memory-distill.md` (line 22), `cron/jobs/weekly-memory-gaps.md` (line 28), `.claude/settings.json`, `.claude/hooks/session-sync-stop.js`, `.claude/hooks/load-memory-snapshot.js`
- Planning docs [VERIFIED]: `06-CONTEXT.md`, `REQUIREMENTS.md` (MEM-05), `STATE.md`, `05-01-SUMMARY.md`, `05-02-SUMMARY.md`, `04-01-SUMMARY.md`, `.planning/config.json`
- Tooling [VERIFIED: local PATH]: `memsearch --version` -> 0.4.7; `~/.claudeclaw-app` symlink live; `dist/capture-cli.js` + `dist/memory-projection.js` present

### Secondary (MEDIUM confidence)
- 05-02-SUMMARY claims of live hook wiring — contradicted by current settings.json (see Pitfall 6 / A3)

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all modules read directly; no new deps; memsearch version verified on PATH
- Architecture: HIGH — recall path traced through actual source; CLI pattern proven by capture-cli + schedule-cli
- Pitfalls: HIGH — each grounded in a verified file fact (especially the Stop-hook wiring discrepancy)
- Live-proof design: MEDIUM — depends on resolving the A3 hook-wiring question with the user

**Research date:** 2026-06-15
**Valid until:** 2026-07-15 (stable; in-repo, slow-moving). Re-verify the agentic-os settings.json wiring before the live proof if time passes.
