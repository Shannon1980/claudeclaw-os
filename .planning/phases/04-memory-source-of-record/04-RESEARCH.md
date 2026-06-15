# Phase 4: Memory Source of Record - Research

**Researched:** 2026-06-15
**Domain:** ClaudeClaw SQLite memory pipeline (ingest, embeddings, recall) + multi-agent attribution/scoping
**Confidence:** HIGH (all findings traced directly in source; no external library guesswork)

## Summary

Phase 4 has TWO requirements that, after tracing the code, are in very different states.

**MEM-01 (single source of record) is already true and provable.** The DB path is `path.join(STORE_DIR, 'claudeclaw.db')` where `STORE_DIR = path.resolve(PROJECT_ROOT, 'store')` and `PROJECT_ROOT = path.resolve(__dirname, '..')` (`src/config.ts:143-144`, `src/db.ts:427`). This resolves from the compiled file location, NOT from `process.cwd()`, so the Phase 3 cwd fix (which changed the delegated SDK subprocess cwd to agentic-os) cannot create a second store. Verified empirically: there is no `store/` dir and no `claudeclaw.db` anywhere under `/Users/shannongueringer/App Repo/agentic-os`. There is exactly one DB at `claudeclaw/store/claudeclaw.db`. Memory ingest, embeddings, and recall all run in the BOT process against `db` (the single connection in `src/db.ts`). [VERIFIED: codebase]

**MEM-02 (a bot exchange is written and recallable later) is PARTIALLY working, with one real correctness gap — but NOT the gap the brief hypothesized.** The brief asked whether the delegation path skips ingestion. It does not: the delegation branch (`src/message-core.ts:226`) calls `saveConversationTurn(chatIdStr, delegation.prompt, response, undefined, delegation.agentId)`, and `saveConversationTurn` (`src/memory.ts:247-267`) unconditionally fires `ingestConversationTurn(...)` internally (line 264). So a `@aos:` turn IS ingested into the `memories` table, attributed to `aos`. The ingestion runs in the bot process (not the scrubbed SDK subprocess), so it has `GOOGLE_API_KEY` for embeddings and uses OAuth (not the API key) for the Claude-Haiku extractor. The real gap is on the RECALL side: both the main path and the delegation path call `buildMemoryContext(chatId, msg, agentId)` WITHOUT `strictAgentId`, which means recall is NOT scoped to the agent — it surfaces memories from ANY agent sharing the `chat_id`. This is the documented cross-agent-leakage shape and is the success-criterion ("no cross-agent leakage") most at risk. [VERIFIED: codebase]

**Primary recommendation:** Treat Phase 4 as a verification + hardening phase, not a build phase. (1) Prove MEM-01 with a test asserting the resolved DB path is absolute/PROJECT_ROOT-based and that no second DB is created when an agent runs with a foreign cwd. (2) Prove the MEM-02 write half with an integration test against a temp/in-memory DB that runs the delegation save and asserts a row lands in `memories` with `agent_id='aos'`. (3) Close the recall-scoping gap by passing `strictAgentId` (or equivalent) so an `aos` turn is recalled under `aos`, not bled across agents — guarded by a test that writes an `aos` memory and a `main` memory in the same chat and asserts each agent recalls only its own. (4) The minimal MEM-02 proof (write in session A, recall in session B) is a live two-session chat transcript; everything else is automatable. No schema change is required unless the team decides to add a covering index for the agent-scoped recall query (optional, not needed for correctness).

## User Constraints

No CONTEXT.md exists for this phase (`/gsd-discuss-phase` was not run). The constraints below are derived from PROJECT.md, REQUIREMENTS.md, and the phase objective, and should be treated as binding scope.

### Locked Decisions (from PROJECT.md / REQUIREMENTS.md)
- SQLite (`store/claudeclaw.db`) is the single source of record for memory. Markdown is a derived projection (Phase 5), not a store. [PROJECT.md Key Decisions]
- Phase 4 does NOT touch agentic-os's own memory (`context/memory/*.md` + memsearch). Markdown projection = Phase 5; memsearch retirement = Phase 6. [objective]
- Any schema change ships as a versioned migration under `migrations/<version>/` via the `add-migration` skill. [objective success criteria + `.claude/skills/add-migration/SKILL.md`]
- Memory must be scoped correctly to the workspace agent (`aos`) with no cross-agent leakage. [objective success criteria]
- The pipeline (ingest, embeddings, recall) runs against `store/claudeclaw.db` with no second store. [objective success criteria]
- Both modes keep working after the phase (COMPAT-01/02/03 are cross-cutting). [REQUIREMENTS.md]
- No em dashes, terse output in any user-facing text (CLAUDE.md personality rules apply to the `aos` agent's chat output, not to code). [CLAUDE.md]

### Claude's Discretion
- Whether to close the recall-scoping gap by threading `strictAgentId` through `processUserMessage`/delegation, or by changing the default of `buildMemoryContext` for the delegated path. Recommend the explicit-flag approach (lower blast radius).
- Whether to add an optional covering index for the agent-scoped recall query (perf only; not correctness).
- Test granularity (how many unit vs integration cases) beyond the minimum proofs listed.

### Deferred Ideas (OUT OF SCOPE)
- Markdown projection into agentic-os `context/memory/*.md` — Phase 5 (MEM-03, MEM-06).
- Terminal Stop-hook capture into ClaudeClaw memory — Phase 5 (MEM-04).
- Retiring memsearch / second semantic index — Phase 6 (MEM-05).
- Command Centre reading the DB — Phase 9 (CKPT-*).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEM-01 | ClaudeClaw SQLite is the single source of record across both modes | DB path is PROJECT_ROOT-based (`config.ts:143-144`, `db.ts:427`), cwd-independent; empirically only one DB exists; no second store under agentic-os. Provable by a path-assertion test + filesystem check. |
| MEM-02 | A bot exchange is written to ClaudeClaw memory and retrievable in a later session | Write half works: delegation branch calls `saveConversationTurn` (`message-core.ts:226`) → `ingestConversationTurn` (`memory.ts:264`) → `saveStructuredMemoryAtomic` with `agentId='aos'` (`memory-ingest.ts:234-244`, `db.ts:830-857`). Recall half works cross-session via `buildMemoryContext` (`memory.ts:62`) but is NOT agent-scoped (gap). Embeddings + FTS5 + importance make a memory recallable. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Persisting a bot exchange to memory | Backend (bot process, `memory.ts`/`db.ts`) | — | Runs in the always-on Node bot process, not the SDK subprocess; SQLite is the single store |
| Extracting a structured memory from a turn | Backend (`memory-ingest.ts`) | LLM (Claude Haiku via OAuth, Gemini fallback) | Extraction is an LLM call but orchestrated and persisted by the bot process |
| Computing embeddings | Backend (`embeddings.ts`) | Gemini API (`GOOGLE_API_KEY`) | Needs the key; key lives in the bot process env, not scrubbed |
| Recall / building memory context | Backend (`memory.ts buildMemoryContext`) | — | Reads the single store; must be agent-scoped |
| Agent attribution / scoping | Backend (`db.ts` `agent_id` columns + WHERE clauses) | — | Multi-agent isolation is enforced in SQL, not in the SDK |
| Schema evolution | Backend (`migrations/`, `src/migrations.ts`) | — | Versioned migrations gate process startup |

## Standard Stack

This is a brownfield phase; the "stack" is the existing ClaudeClaw memory subsystem. No new external packages are introduced.

### Core (existing, in use)
| Module | Purpose | Notes |
|--------|---------|-------|
| `src/memory.ts` | `buildMemoryContext` (recall), `saveConversationTurn` (write entry point), decay/nudge | `saveConversationTurn` fires `ingestConversationTurn` fire-and-forget |
| `src/memory-ingest.ts` | `ingestConversationTurn` (LLM extraction → structured memory) | Primary extractor: Claude Haiku via OAuth (`extractViaClaude`); fallback: Gemini |
| `src/db.ts` | schema, `searchMemories`, `getRecentHighImportanceMemories`, `saveStructuredMemoryAtomic`, `logConversationTurn`, `searchConversationHistory` | Single `db` connection; `agent_id` on `memories` + `conversation_log` |
| `src/embeddings.ts` | `embedText` (Gemini embeddings), `cosineSimilarity` | Requires `GOOGLE_API_KEY`; throws if absent |
| `src/config.ts` | `PROJECT_ROOT`, `STORE_DIR`, `GOOGLE_API_KEY` | DB path derives from `PROJECT_ROOT`, cwd-independent |
| `src/migrations.ts` + `migrations/` | versioned migration guard + registry | `checkPendingMigrations` exits process if pending |

### Supporting (test + tooling)
| Tool | Version | Purpose |
|------|---------|---------|
| vitest | ^2.0.0 | test runner (`npm test` = `vitest run`) |
| `@vitest/coverage-v8` | ^2.0.0 | coverage |
| better-sqlite3 | (existing) | the DB driver behind `new Database(...)` |
| `add-migration` skill | `.claude/skills/add-migration/SKILL.md` | the ONLY sanctioned way to author a migration |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Threading `strictAgentId` through callers | Changing `buildMemoryContext` default to scope by `agentId` | Lower-effort but higher blast radius — changes legacy Telegram behavior for the default fleet (risks COMPAT-02). Prefer the explicit flag on the delegated/main paths that need it. |

**Installation:** None. No new dependencies.

**Version verification:** N/A — no new packages. The only registry-adjacent check is that `vitest` ^2.0.0 and `better-sqlite3` are already in `package.json` devDeps/deps and in use across 36 existing test files.

## Package Legitimacy Audit

Not applicable. This phase installs no external packages. All work is against existing in-repo modules and the already-installed test toolchain. (If the plan later decides to add a package, run the Package Legitimacy Gate before doing so.)

## Architecture Patterns

### System Architecture Diagram

```
                                BOT PROCESS (cwd = claudeclaw, NOT scrubbed)
                                ───────────────────────────────────────────
  Slack/Telegram msg ─▶ processUserMessage (message-core.ts)
                              │
                              ├─ parseDelegation? ──▶ YES (@aos: ...)
                              │        │
                              │        ▼
                              │   delegateToAgent (orchestrator.ts)
                              │        │  buildMemoryContext(chatId, prompt, 'aos')   ◀── RECALL (gap: no strictAgentId)
                              │        │  runAgent(... cwd = agentic-os, env SCRUBBED of GOOGLE_API_KEY)
                              │        │        └─▶ SDK subprocess (Claude Code in agentic-os)
                              │        ▼
                              │   saveConversationTurn(chatId, prompt, response, _, 'aos')  ◀── WRITE
                              │        │
                              │        ├─ logConversationTurn x2  ──▶ conversation_log (agent_id='aos')
                              │        └─ ingestConversationTurn(... 'aos')  [fire-and-forget]
                              │                 │  extractViaClaude (Haiku, OAuth)  | fallback Gemini
                              │                 │  embedText (Gemini, GOOGLE_API_KEY present here)
                              │                 │  dedup vs getMemoriesWithEmbeddings
                              │                 └─▶ saveStructuredMemoryAtomic ──▶ memories (agent_id='aos', embedding, FTS5)
                              │
                              └─ NO ──▶ main path: buildMemoryContext(chatId, msg, agentId)  ◀── RECALL (same no-scope gap)
                                       runAgent ... ; saveConversationTurn(chatId, msg, resp, sid, agentId)
                                              (identical write+ingest path)

  ALL writes/reads target the SINGLE connection `db` ──▶ store/claudeclaw.db
                                                          (resolved from PROJECT_ROOT, cwd-independent)

  LATER SESSION (new sessionId, same chatId + agent_id='aos')
     buildMemoryContext('aos' turn query) ─▶ searchMemories (embedding ▶ FTS5 ▶ LIKE)
                                          ─▶ getRecentHighImportanceMemories (importance>=0.5)
                                          ─▶ surfaces prior memory as [Memory context]
```

### Recommended Project Structure
No new structure. Changes (if any) land in:
```
src/
├── memory.ts              # possibly: thread strictAgentId for delegated/main recall
├── message-core.ts        # possibly: pass strictAgentId on delegation + main recall calls
├── orchestrator.ts        # possibly: pass strictAgentId into buildMemoryContext
├── memory.test.ts         # new cases: agent-scoped recall, no cross-agent leak
├── orchestrator.test.ts   # new case: delegated turn ingests under 'aos'
└── db.test.ts             # new case: single-store path assertion
migrations/<version>/      # ONLY if a schema/index change is chosen
```

### Pattern 1: Write-then-ingest entry point
**What:** `saveConversationTurn` is the single funnel for both logging (`conversation_log`) and async memory extraction (`ingestConversationTurn`). Both the main and delegation paths use it.
**When to use:** Any time a completed user/assistant exchange should become memory.
**Example:**
```typescript
// Source: src/memory.ts:247-267 [VERIFIED: codebase]
export function saveConversationTurn(chatId, userMessage, claudeResponse, sessionId?, agentId = 'main'): void {
  try {
    logConversationTurn(chatId, 'user', userMessage, sessionId, agentId);
    logConversationTurn(chatId, 'assistant', claudeResponse, sessionId, agentId);
  } catch (err) { logger.error({ err }, 'Failed to log conversation turn'); }
  // fire-and-forget LLM extraction — never blocks the reply
  void ingestConversationTurn(chatId, userMessage, claudeResponse, agentId).catch((err) => {
    logger.error({ err }, 'Memory ingestion fire-and-forget failed');
  });
}
```

### Pattern 2: Agent-scoped recall (the fix shape)
**What:** Recall functions already accept an optional `agentId`/`strictAgentId` that adds `AND memories.agent_id = ?` to the query. The plumbing exists; the delegated/main callers just don't pass it.
**When to use:** When per-agent isolation is required (it is, per success criteria).
**Example:**
```typescript
// Source: src/memory.ts:62-93 and src/db.ts:899-979 [VERIFIED: codebase]
// buildMemoryContext already supports strictAgentId:
const { contextText } = await buildMemoryContext(chatId, prompt, 'aos', { strictAgentId: 'aos' });
// db.searchMemories adds: const ftsAgentClause = agentId ? ' AND memories.agent_id = ?' : '';
// db.getRecentHighImportanceMemories: WHERE chat_id = ? AND agent_id = ? AND importance >= 0.5
```

### Pattern 3: In-memory test DB
**What:** Tests stub `db.js` with `vi.mock` (see `memory.test.ts`, `memory-ingest.test.ts`), OR exercise the real schema via the test-DB path that opens `:memory:` and sets a random encryption key.
**Example:**
```typescript
// Source: src/db.ts:763-765 [VERIFIED: codebase] — test path uses an in-memory DB + random key
encryptionKey = crypto.randomBytes(32);
db = new Database(':memory:');
// Source: src/memory-ingest.test.ts:29-36 [VERIFIED: codebase] — or mock the db boundary
vi.mock('./db.js', () => ({ saveStructuredMemoryAtomic: vi.fn(() => 1), getMemoriesWithEmbeddings: vi.fn(() => []) }));
```

### Anti-Patterns to Avoid
- **Re-implementing ingestion on the delegation branch.** It already runs via `saveConversationTurn`. Adding a second `ingestConversationTurn` call would double-write memories. The brief's hypothesized gap does not exist.
- **Editing a migration file in place or hand-writing migration registry JSON.** Use the `add-migration` skill. Never touch `migrations/.applied.json` or run `npm run migrate` for the user (per skill notes).
- **Scoping recall by changing the global default of `buildMemoryContext`.** That alters legacy Telegram/default-fleet behavior and risks COMPAT-02. Pass the flag from the callers that need it.
- **Assuming memory tables are encrypted.** They are not (see Pitfall 2). Do not add decryption to the recall path expecting ciphertext.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-agent memory isolation | A new filter layer | Existing `agentId`/`strictAgentId` params on `searchMemories`, `getRecentHighImportanceMemories`, `getMemoriesWithEmbeddings`, `buildMemoryContext` | The SQL clauses already exist and are tested for the war-room path |
| Memory extraction from a turn | A custom heuristic | `ingestConversationTurn` (Haiku via OAuth, Gemini fallback, dedup, importance threshold) | Already handles quota backoff, dedup at 0.85 cosine, importance>=0.5 filter |
| Embeddings | Any new embedding client | `embedText` (Gemini) | Single client, single model, already wired |
| Cross-session recall | A new retrieval system | `buildMemoryContext` 3-layer retrieval (embedding ▶ FTS5 ▶ LIKE + recent-high-importance) | Recall is keyed on `chat_id` (+agent_id), independent of `session_id`, so it already spans sessions |
| Schema change | Raw `ALTER TABLE` in app code | `add-migration` skill → `migrations/<version>/*.ts` | The migration guard (`checkPendingMigrations`) exits the process if a pending migration is unapplied |

**Key insight:** The recall and write machinery for MEM-02 already exists and is exercised by the war-room path with strict per-agent scoping. Phase 4 is wiring + verification, not new subsystem construction.

## Runtime State Inventory

This is not a rename/migration phase, but it touches stored memory state and an external runtime (Gemini), so the relevant categories are answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `memories` and `conversation_log` rows already carry `agent_id` (added via ALTER migrations at `db.ts:632` and `db.ts:515`, default `'main'`). Pre-existing `aos` rows may already exist from Phase 1-3 live testing. Existing rows with `agent_id='main'` from before will NOT be recalled under `aos` once scoping is tightened — this is correct behavior, not a regression. | None required for correctness. If the team wants prior `aos` test exchanges recallable, no backfill needed (they were already attributed to `aos` at write time by the Phase 3 delegation code). Code edit only (recall scoping), not a data migration. |
| Live service config | None. No external service stores the `aos` string in UI/DB config relevant to memory. (n8n/Datadog/etc. are not part of the memory pipeline.) | None — verified: memory pipeline is fully in-repo + Gemini API. |
| OS-registered state | None. launchd runs the bot; no OS registration embeds memory keys. | None — verified. |
| Secrets / env vars | `GOOGLE_API_KEY` (Gemini, for `embedText`) and `DB_ENCRYPTION_KEY` (for messaging tables only) live in `.env`, read in the BOT process. The SDK subprocess env IS scrubbed (`getScrubbedSdkEnv`), but ingestion runs in the bot process, so the key is present for embeddings. `CLAUDE_CODE_OAUTH_TOKEN` powers the Haiku extractor. | None — confirmed the key is available where ingestion runs. No rename. |
| Build artifacts | None specific to memory. Standard `npm run build` (tsc) compiles `src/` to `dist/`; tests run via tsx/vitest on `src/`. | None. |

**The canonical risk for this phase:** after recall scoping is tightened, confirm the default fleet (main/comms/content/ops/research) still recalls its own memories unchanged (COMPAT-02). The strict-scope flag must be applied to the `aos`/delegated path without flipping global defaults.

## Common Pitfalls

### Pitfall 1: Assuming the delegation path skips ingestion
**What goes wrong:** Planning a fix to "add ingestion to the delegation branch," which would create duplicate memories.
**Why it happens:** The brief hypothesized this. The reality: `saveConversationTurn` (called on both paths) always fires `ingestConversationTurn`. Verified `message-core.ts:226` → `memory.ts:264`.
**How to avoid:** Write the WRITE-half test first (assert exactly one `memories` row with `agent_id='aos'` after a delegated save). It will pass on current code, confirming the write half.
**Warning signs:** Two near-identical memory rows for one exchange.

### Pitfall 2: Believing memory tables are field-level encrypted
**What goes wrong:** Adding a decryption step to recall, or assuming a projection (Phase 5) needs decryption for memory rows.
**Why it happens:** PROJECT.md and the brief mention "field-level AES-GCM encryption." That encryption (`encryptField`/`decryptField`) is applied ONLY to messaging tables: `wa_outbox`, `wa_messages`, `slack_messages` (`db.ts:1428,1436,1683,1703,1720,1741`). The `memories`, `conversation_log`, and `consolidations` tables store plaintext.
**How to avoid:** Do not add crypto to the memory recall/ingest path. (MEM-06's "respect field-level encryption" is a Phase 5 projection concern about the messaging tables, not memory tables — flag this distinction to whoever plans Phase 5.)
**Warning signs:** `decryptField` appearing in a memory-table read.

### Pitfall 3: Cross-agent recall leakage (the real gap)
**What goes wrong:** An `aos` turn recalls memories created by `main` (and vice versa) because callers pass `agentId` for ATTRIBUTION but not `strictAgentId` for RECALL scope.
**Why it happens:** `buildMemoryContext(chatId, msg, agentId)` with no opts leaves `strictAgentId` undefined, so `searchMemories`/`getRecentHighImportanceMemories` are called with `agentId=undefined` and return any agent's rows for that `chat_id` (`memory.ts:93,103`).
**How to avoid:** Pass `{ strictAgentId: agentId }` (or equivalent) on the delegated path (and decide whether the main path should also be strict). Guard with a test: write one `aos` memory and one `main` memory in the same `chat_id`; assert `aos` recall returns only the `aos` memory.
**Warning signs:** `main`'s memories surfacing in an `aos` `[Memory context]` block.

### Pitfall 4: Embeddings silently disabled
**What goes wrong:** Recall quietly degrades to keyword-only (FTS5/LIKE) if `GOOGLE_API_KEY` is missing or Gemini 429s; a memory written without an embedding is still recallable by keyword but not by semantic similarity.
**Why it happens:** `embedText` throws without `GOOGLE_API_KEY` (`embeddings.ts:12-13`); `buildMemoryContext` catches and falls back (`memory.ts:81-87`); `ingestConversationTurn` has a 5-minute quota backoff on Gemini 429 (`memory-ingest.ts:19,173,263-273`).
**How to avoid:** For the MEM-02 live proof, ensure `GOOGLE_API_KEY` is set so the recall is semantic (not just keyword). For automated tests, mock `embedText` (as existing tests do) and assert the keyword path also recalls.
**Warning signs:** `/api/health` showing "memory paused"; memories with `embedding IS NULL`.

### Pitfall 5: Importance threshold drops the memory before it's stored
**What goes wrong:** A test exchange is "remembered" in `conversation_log` but never lands in `memories`, so semantic recall returns nothing.
**Why it happens:** `ingestConversationTurn` skips if `userMessage.length <= 15`, starts with `/`, the LLM returns `{skip:true}`, or `importance < 0.5` (`memory-ingest.ts:168,194,205`). Acknowledgments and ephemeral tasks are intentionally dropped.
**How to avoid:** For the MEM-02 live proof, use an exchange the extractor will actually keep — a stated standing preference/decision/fact (the EXTRACTION_PROMPT keeps preferences, decisions, standing rules at importance >= 0.5). Don't use "ok thanks" or a one-off task.
**Warning signs:** `conversation_log` has the row but `memories` does not.

## Code Examples

### Verify the single-store path (MEM-01 proof, automatable)
```typescript
// Source: src/config.ts:143-144, src/db.ts:427 [VERIFIED: codebase]
// PROJECT_ROOT = path.resolve(__dirname, '..'); STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
// const dbPath = path.join(STORE_DIR, 'claudeclaw.db');
import path from 'path';
import { STORE_DIR, PROJECT_ROOT } from './config.js';
// Assert: STORE_DIR is absolute and under PROJECT_ROOT, independent of process.cwd()
expect(path.isAbsolute(STORE_DIR)).toBe(true);
expect(STORE_DIR.startsWith(PROJECT_ROOT)).toBe(true);
expect(STORE_DIR).not.toContain('agentic-os');
```

### Assert a delegated turn lands in memories under 'aos' (MEM-02 write half, automatable)
```typescript
// Pattern mirrors src/orchestrator.test.ts + src/memory.test.ts mocking style [VERIFIED: codebase]
// Mock the extractor to return a keepable memory, run saveConversationTurn('chat', prompt, resp, undefined, 'aos'),
// assert saveStructuredMemoryAtomic was called with agentId === 'aos'.
import { saveConversationTurn } from './memory.js';
saveConversationTurn('chat1', 'I always want marketing copy in lowercase, no exclamation marks', 'Noted.', undefined, 'aos');
// await the fire-and-forget tick, then assert the db mock recorded a memory with agent_id 'aos'
```

### Agent-scoped recall (the fix + its test)
```typescript
// Source: src/memory.ts:62-67 (signature), :93/:103 (scope wiring) [VERIFIED: codebase]
const { contextText } = await buildMemoryContext('chat1', userMsg, 'aos', { strictAgentId: 'aos' });
// Test: insert one memory agent_id='aos', one agent_id='main', same chat_id.
// Assert aos recall returns ONLY the aos summary; main recall returns ONLY the main summary.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Gemini as primary memory extractor | Claude Haiku via OAuth primary, Gemini fallback | Pre-Phase-4 (in current `memory-ingest.ts`) | Extraction no longer dies on Gemini free-tier 429; embeddings still need Gemini |
| Recall touched/boosted memories at retrieval | Retrieval does NOT touch; only `evaluateMemoryRelevance` feedback boosts | Documented in `memory.ts:89-92` | Prevents positive-feedback noise loop; don't reintroduce touch-on-read |
| `sessions` keyed by `chat_id` only | Composite `(chat_id, agent_id)`; `conversation_log`/`memories` gained `agent_id` | Hive Mind V2 migrations (`db.ts:482-515,630-633`) | Attribution exists; recall scoping is the remaining gap |

**Deprecated/outdated:**
- Nothing to remove in Phase 4. memsearch retirement is Phase 6, not here.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The workspace agent id is exactly `aos` (lowercase) | throughout | Low — confirmed: `~/.claudeclaw/agents/aos/agent.yaml` exists with `project_dir` = agentic-os. [VERIFIED: filesystem] |
| A2 | The main path SHOULD also be strict-scoped, or it's acceptable to scope only the delegated path | Pitfall 3 / Discretion | Medium — if the user wants global per-agent isolation, the main path needs the flag too; if legacy shared-chat recall is desired for the default fleet, leave it. Needs a one-line confirmation. Default recommendation: scope the `aos` path; leave default fleet behavior unchanged to protect COMPAT-02. |
| A3 | No schema change is required for MEM-01/MEM-02 | Migrations | Low — `agent_id` already exists on both relevant tables; recall clauses already exist. An index is optional perf only. |

**If A2 is the only open decision, confirm it during planning; it is the single behavioral choice in this phase.**

## Open Questions

1. **Should the MAIN (non-delegated) path also become strict per-agent on recall, or only the `aos`/delegated path?**
   - What we know: The plumbing supports both. War-room already uses `strictAgentId`. Tightening only the delegated path satisfies the `aos`-no-leakage success criterion with minimal risk to the default fleet.
   - What's unclear: Whether the user wants global per-agent recall isolation across the whole fleet.
   - Recommendation: Scope the delegated/`aos` path strictly now (satisfies the success criterion). Leave the legacy main-path default as-is unless the user explicitly wants fleet-wide isolation, to avoid COMPAT-02 regression.

2. **What counts as the canonical MEM-02 live proof?**
   - What we know: Recall is keyed on `chat_id`+`agent_id`, independent of `session_id`, so it already spans sessions. The minimal live proof is: session A — send an `@aos:` exchange containing a standing preference (importance >= 0.5); session B (after `/newchat`, new `session_id`, same chat + `aos`) — ask a related question and confirm the prior fact appears in `[Memory context]`.
   - What's unclear: Nothing blocking; this is a manual transcript step.
   - Recommendation: One scripted two-session transcript as the human-verify artifact; everything else automated.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + tsx | running tests/migrate | ✓ | (existing toolchain) | — |
| vitest | automated tests | ✓ | ^2.0.0 (package.json) | — |
| better-sqlite3 | DB driver | ✓ | (existing dep) | — |
| `GOOGLE_API_KEY` (Gemini) | semantic recall + ingest embeddings | ✓ (in `.env`, bot process) | — | Keyword-only recall (FTS5/LIKE) still works; semantic recall degrades |
| `CLAUDE_CODE_OAUTH_TOKEN` | Haiku memory extractor | ✓ (powers all agents) | — | Gemini fallback extractor |
| Live bot + `aos` agent | MEM-02 two-session live proof | ✓ | — | None for the live proof; automated tests cover the rest |

**Missing dependencies with no fallback:** None. The two-session live proof needs the running bot, which is the normal deployed state.
**Missing dependencies with fallback:** Semantic recall degrades to keyword recall without `GOOGLE_API_KEY`; not blocking.

## Validation Architecture

`workflow.nyquist_validation` is `true`, so this section applies.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.0.0 |
| Config file | inline `vitest` block in `package.json` (no separate config file) |
| Quick run command | `npx vitest run src/memory.test.ts src/orchestrator.test.ts src/db.test.ts` |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEM-01 | DB path is absolute, under PROJECT_ROOT, cwd-independent, never under agentic-os | unit | `npx vitest run src/db.test.ts` | exists (`src/db.test.ts`) — add case |
| MEM-01 | No second DB file is created when an agent runs with a foreign cwd | integration | `npx vitest run src/db.test.ts` (or a small fs assertion) | add case |
| MEM-02 | Delegated `@aos:` save writes exactly one `memories` row attributed `agent_id='aos'` (write half) | integration | `npx vitest run src/orchestrator.test.ts` / `src/memory.test.ts` | exist — add case |
| MEM-02 | A memory written for `aos` is recalled by `buildMemoryContext` for `aos` (recall half, same chat, different session) | integration | `npx vitest run src/memory.test.ts` | exists — add case |
| MEM-02 (scope) | `aos` recall returns ONLY `aos` memories when a `main` memory shares the chat (no cross-agent leak) | integration | `npx vitest run src/memory.test.ts` | exists — add case |
| MEM-02 (live) | Write in session A, recall in session B over real chat | manual | live two-session transcript | n/a (human-verify) |
| COMPAT-02 | Default fleet recall behavior unchanged after scoping change | unit | `npm test` (regression) | existing suite |

### Sampling Rate
- **Per task commit:** `npx vitest run src/memory.test.ts src/orchestrator.test.ts src/db.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green (note baseline: 519 pass with 4 known pre-existing failures — 3 environmental `schedule-cli`, 1 known `dashboard` chatId bug, per Phase 3 summary) before `/gsd-verify-work`; plus the one live two-session transcript for MEM-02.

### Wave 0 Gaps
- [ ] `src/db.test.ts` — add MEM-01 single-store path assertion (no new file; existing file)
- [ ] `src/memory.test.ts` — add recall-scoping + cross-agent-leak cases (existing file)
- [ ] `src/orchestrator.test.ts` or `src/memory.test.ts` — add delegated-save write-half case (existing file)
- [ ] No framework install needed; no new fixtures beyond the existing `vi.mock('./db.js')` / in-memory DB patterns.

*(No missing infrastructure: vitest, in-memory DB path, and db mocking are all established in the existing 36 test files.)*

## Security Domain

`security_enforcement` is `true`, ASVS level 1.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface introduced in this phase |
| V3 Session Management | no | Chat session handling unchanged; `session_id` not modified |
| V4 Access Control | yes | Per-agent memory isolation IS an access-control concern. Control: SQL `WHERE agent_id = ?` scoping on recall (the Phase 4 fix). Enforced server-side in `db.ts`, never client-trusted. |
| V5 Input Validation | yes | FTS5 query building already strips quotes to prevent operator injection (`db.ts:933-938`); keep using parameterized `better-sqlite3` prepared statements (already universal in `db.ts`). No string concatenation of user input into SQL. |
| V6 Cryptography | no (for memory tables) | Memory tables are plaintext by design; messaging-table AES-GCM (`encryptField`) is untouched here. Do not hand-roll crypto. |

### Known Threat Patterns for ClaudeClaw memory
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-agent memory disclosure (one agent recalls another's private memories) | Information Disclosure | `strictAgentId` recall scoping (the core Phase 4 access-control fix) + a regression test |
| FTS5 query operator injection via user message | Tampering | Existing quote-stripping + parameterized statements (`db.ts:933-951`); keep the parameterized pattern |
| Secret leakage into memory rows | Information Disclosure | Existing exfiltration guard scrubs the response before send (`message-core.ts:430-442`); memory stores the same scrubbed/raw response — confirm no protected env value is persisted (low risk, response is already guarded on the main path; note the delegation branch logs the raw response before file-marker stripping — acceptable, but worth a glance) |

## Sources

### Primary (HIGH confidence)
- `src/memory.ts` (buildMemoryContext, saveConversationTurn, strictAgentId opt) — read in full
- `src/memory-ingest.ts` (ingestConversationTurn, extractViaClaude, quota backoff, importance/dedup filters) — read in full
- `src/message-core.ts` (delegation branch :196-259, main path :419-458) — read in full
- `src/orchestrator.ts` (delegateToAgent, buildMemoryContext call :196, runAgent with scrubbed-env subprocess) — read in full
- `src/db.ts` (schema, agent_id ALTERs, searchMemories :899, getRecentHighImportanceMemories :1029, logConversationTurn :1494, saveStructuredMemory :830, encryptField usage, in-memory test path :765) — read targeted ranges
- `src/config.ts` (PROJECT_ROOT :143, STORE_DIR :144, GOOGLE_API_KEY) — read targeted
- `src/migrations.ts` + `migrations/version.json` + `.claude/skills/add-migration/SKILL.md` — read in full
- `package.json` (vitest ^2.0.0, `test`/`migrate` scripts) — read targeted
- `.planning/phases/03-skill-hardening/03-01-SUMMARY.md` (cwd fix context, test baseline 519 pass / 4 known fails) — read in full
- Filesystem: confirmed single DB at `claudeclaw/store/claudeclaw.db`, none under `agentic-os/`; `aos` agent registered at `~/.claudeclaw/agents/aos/agent.yaml`

### Secondary (MEDIUM confidence)
- None — all findings are from direct source reads.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- MEM-01 (single store): HIGH — path resolution traced and empirically confirmed (no second DB exists).
- MEM-02 write half: HIGH — ingestion call chain traced from delegation branch to `saveStructuredMemoryAtomic`.
- MEM-02 recall + scoping gap: HIGH — recall functions and their `agentId` clauses read directly; caller omission of `strictAgentId` confirmed in both `message-core.ts` and `orchestrator.ts`.
- Encryption scope (memory plaintext): HIGH — every `encryptField`/`decryptField` call site enumerated.
- Test architecture: HIGH — 36 existing test files including `memory.test.ts`, `memory-ingest.test.ts`, `orchestrator.test.ts`, `db.test.ts`, `migrations.test.ts`.

**Research date:** 2026-06-15
**Valid until:** 2026-07-15 (stable internal subsystem; re-verify if `memory.ts`/`db.ts`/`orchestrator.ts` change before planning).
