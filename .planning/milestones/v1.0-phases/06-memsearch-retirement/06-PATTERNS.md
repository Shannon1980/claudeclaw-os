# Phase 6: memsearch-retirement - Pattern Map

**Mapped:** 2026-06-15
**Files analyzed:** 6 (3 ClaudeClaw code, 3 agentic-os config/docs)
**Analogs found:** 3 / 3 code files (config/doc edits need no code analog)

> RESEARCH.md already names the analogs and sketches the code. This map adds the
> verified, line-numbered excerpts the planner copies into PLAN action steps, so
> the planner does not re-derive them. All paths absolute.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/recall-cli.ts` (NEW) | CLI entrypoint | request-response (query in, results out) | `src/capture-cli.ts` (structure/safety) + `src/schedule-cli.ts` (arg parsing) | role-match (composite) |
| `src/memory.ts` `recallForWorkspace` wrapper (NEW export, MODIFY file) | service/utility | transform (embed + search) | `buildMemoryContext` lines 79-93 in same file | exact (same file, lifted path) |
| `src/recall-cli.test.ts` (NEW) | test | n/a | `src/memory-projection.test.ts` + `src/capture-cli.test.ts` | exact (mock seam pattern) |
| agentic-os `AGENTS.md` "Memory Retrieval" Tier 1 (MODIFY) | docs | n/a | no code analog (prose edit) | n/a |
| agentic-os `cron/jobs/nightly-memsearch-index.md` frontmatter (MODIFY) | config | n/a | no code analog (frontmatter flag) | n/a |
| agentic-os `.claude/settings.json` Stop hook (MODIFY, MEM-04) | config | n/a | existing Stop-array entry pattern | config-match |

## Pattern Assignments

### `src/recall-cli.ts` (CLI entrypoint, request-response)

**Analogs:** `/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/sharp-easley-ba9c43/src/capture-cli.ts` (structure, safety, run-as-main) and `/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/sharp-easley-ba9c43/src/schedule-cli.ts` (arg parsing). The CLI takes a query **arg**, NOT stdin (Research Pitfall 2).

**Shebang + imports pattern** — copy the import discipline from `capture-cli.ts` lines 30-32 (`.js` extensions, named imports from `db.js` / `memory.js` / `agent-config.js`):
```typescript
#!/usr/bin/env node
import { initDatabase } from './db.js';
import { recallForWorkspace } from './memory.js'; // the new wrapper, see below
```
Do NOT import `searchMemories`/`embedText` directly into the CLI — route through the `memory.ts` wrapper so the bot and CLI share one path (single-index goal).

**Arg parsing pattern** — adapt `schedule-cli.ts` lines 30-38 (flag-index scan + filter the flag and its value out of argv), NOT capture-cli's stdin reader:
```typescript
// from schedule-cli.ts:30-38 — find a flag anywhere, strip flag+value from argv
const agentFlagIdx = process.argv.indexOf('--agent');     // recall uses --top-k the same way
const cleanedArgv = agentFlagIdx !== -1
  ? process.argv.filter((_, i) => i !== agentFlagIdx && i !== agentFlagIdx + 1)
  : [...process.argv];
const [, , command, ...rest] = cleanedArgv;
```
Recall variant: scan for `--top-k`, default 10; the remaining argv joined is the query. Print a `usage:` line to stderr and `process.exit(2)` on empty query (mirror schedule-cli's exit-1 usage guards at lines 53-57, 100).

**initDatabase pattern** — call `initDatabase()` once at the top of the run function, exactly as capture-cli.ts line 93 and schedule-cli.ts line 27. This anchors the DB on PROJECT_ROOT via config.ts (NOT `process.cwd()`), so the CLI hits the claudeclaw store even when spawned from the agentic-os cwd (Research "Don't Hand-Roll": DB path resolution).

**Run-as-main idiom (CRITICAL — lets vitest import the pure fn without running the CLI)** — copy verbatim from `capture-cli.ts` lines 119-126:
```typescript
const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  runRecallCli();
}
```

**Safety discipline to mirror from capture-cli.ts (do NOT skip):**
- Server-side agent id, never from argv. capture-cli.ts line 38: `const CAPTURE_AGENT_ID = 'aos';` -> recall uses a fixed `'aos'` the same way (Research Pitfall 4 / V4 + Spoofing threat).
- Length-cap the untrusted query. capture-cli.ts lines 34-35 + 60-64 cap at `MAX_CAPTURE_CHARS = 4000`; cap the query the same way (DoS threat).
- Bound `--top-k` (default 10), like schedule-cli validates its inputs before use.

**Output format (Claude's Discretion, D-01):** plain text lines, no heavy markdown, no em dashes (CLAUDE.md). Sketch in RESEARCH.md Pattern 1 lines 144-146: `No matching memories found.` when empty, else `- ${summary}` per line.

---

### `src/memory.ts` — new `recallForWorkspace` export (service, transform)

**Analog:** the embed+search block ALREADY in `buildMemoryContext`, same file, lines 79-93 (read and verified). The wrapper lifts exactly that path so CLI and bot are byte-identical on the recall call.

**Exact path to lift** (`memory.ts` lines 79-93):
```typescript
// Embed the query for vector search (async, adds ~200ms but gives semantic results)
let queryEmbedding: number[] | undefined;
if (GOOGLE_API_KEY) {
  try {
    queryEmbedding = await embedText(userMessage);
  } catch {
    // Embedding failure is non-fatal; falls back to keyword search
  }
}
const searched = searchMemories(chatId, userMessage, 5, queryEmbedding, strictAgentId);
```

**Imports already present at top of `memory.ts` (reuse, do not re-add duplicates):**
- `GOOGLE_API_KEY` from `./config.js` (line 1)
- `searchMemories` from `./db.js` (line 19)
- `embedText` from `./embeddings.js` (line 21)
- `workspaceMemoryKey` is NOT yet imported into memory.ts — add `import { workspaceMemoryKey } from './agent-config.js';` (it is the canonical pool helper, verified at `agent-config.ts` line 203: `return \`ws:${agentId}\`;`).

**Wrapper shape** (composing the lifted path; scope to `ws:aos` + strict `'aos'`):
```typescript
export async function recallForWorkspace(
  query: string,
  opts: { agentId?: string; topK?: number } = {},
): Promise<string[]> {
  const agentId = opts.agentId ?? 'aos';
  const chatId = workspaceMemoryKey(agentId);            // 'ws:aos' (agent-config.ts:203)
  let queryEmbedding: number[] | undefined;
  if (GOOGLE_API_KEY) {
    try { queryEmbedding = await embedText(query); } catch { /* FTS5/LIKE fallback */ }
  }
  const hits = searchMemories(chatId, query, opts.topK ?? 10, queryEmbedding, agentId);
  return hits.map((m) => m.summary);
}
```

**`searchMemories` signature (verified `db.ts` lines 899-905) — call positionally:**
```typescript
searchMemories(chatId, query, limit, queryEmbedding?, agentId?)
```
- arg 0 = `chatId` -> `'ws:aos'`
- arg 3 = `queryEmbedding` (vector-first; `db.ts:907-927` does cosine over `getMemoriesWithEmbeddings`, threshold 0.3, filters `superseded_by IS NULL`)
- arg 4 = `agentId` -> `'aos'` (db.ts:939-941 adds `AND memories.agent_id = ?` to the FTS5 clause -> the cross-agent leak guard, Research Pitfall 4 / V4)
- When `queryEmbedding` is empty (no key), searchMemories falls through to FTS5 then LIKE (db.ts:929-958) — this is the no-key fallback Research Pitfall 3 relies on. The wrapper must NOT throw when the key is absent.

**Anti-pattern (Research lines 178-181):** do NOT call `buildMemoryContext` from the CLI. It injects team-activity/consolidation/Obsidian blocks and keyword-gates history (consolidations have no agent_id -> leak risk). The thin wrapper is the correct seam.

---

### `src/recall-cli.test.ts` (unit test)

**Analogs:** `/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/sharp-easley-ba9c43/src/memory-projection.test.ts` (mock seam + source-guard regex) and `/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/sharp-easley-ba9c43/src/capture-cli.test.ts` (capture-side mock pattern, in-memory substitute).

**Mock seam pattern** — copy from `memory-projection.test.ts` lines 13-24 and `capture-cli.test.ts` lines 15-34. Mock `./db.js`, `./embeddings.js`, `./agent-config.js`; import the unit under test AFTER the mocks:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchCalls: unknown[][] = [];
vi.mock('./db.js', () => ({
  initDatabase: vi.fn(),
  searchMemories: vi.fn((...args: unknown[]) => { searchCalls.push(args); return [{ summary: 'Q3 launch is Oct 14' }]; }),
}));
vi.mock('./embeddings.js', () => ({ embedText: vi.fn(async () => [0.1, 0.2, 0.3]) }));
vi.mock('./agent-config.js', () => ({ workspaceMemoryKey: (id: string) => `ws:${id}` }));

import { recallForWorkspace } from './memory.js';
```
Note: `memory.ts` imports `GOOGLE_API_KEY` from `./config.js`; if the embedding branch must run in the test, either mock `./config.js` to export a truthy `GOOGLE_API_KEY` or assert against the FTS5 fallback path. Match whatever the existing suite does for memory.ts tests.

**Reset hook** — from `memory-projection.test.ts` lines 34-42 / `capture-cli.test.ts` lines 38-41:
```typescript
beforeEach(() => { searchCalls.length = 0; vi.clearAllMocks(); });
```

**Single-index invariant assertions** (the MEM-05 core — verify the lifted `searchMemories` args):
```typescript
expect(searchCalls).toHaveLength(1);
expect(searchCalls[0][0]).toBe('ws:aos');        // chatId = workspace pool
expect(searchCalls[0][4]).toBe('aos');           // strict agent scope (no cross-agent leak)
expect(Array.isArray(searchCalls[0][3])).toBe(true); // ClaudeClaw embedding present
```

**Source-guard assertion** — copy the `fs.readFileSync(__dirname, ...)` regex pattern from `memory-projection.test.ts` lines 98-104 (which proves no decrypt/sqlite/encrypted-table refs). The recall variant proves no second index:
```typescript
const src = require('fs').readFileSync(require('path').join(__dirname, 'recall-cli.ts'), 'utf8');
expect(src).not.toMatch(/memsearch/i);
expect(src).not.toContain('reranker');
```
Also consider mirroring memory-projection.test.ts:62 `expect(...).not.toContain('—')` to enforce the CLAUDE.md no-em-dash rule on any output strings.

---

### agentic-os `AGENTS.md` "Memory Retrieval" Tier 1 (NON-CODE / docs edit)

**Target:** `/Users/shannongueringer/App Repo/agentic-os/AGENTS.md`, "Memory Retrieval" section. No code analog — prose edit.

**Current state (RESEARCH.md verified, lines ~216-219):** Tier 1 invokes `/memory-recall "query"` (memsearch plugin) or `memsearch search "query" --top-k 10 --json-output | python3 scripts/lib/reranker.py "query"`, "Searches `context/memory/`, `.memsearch/memory/`, ...".

**Target state (D-02, RESEARCH.md lines 263-265):** Tier 1 invokes the new CLI over the symlink:
```
node "$HOME/.claudeclaw-app/dist/recall-cli.js" "query" --top-k 10
```
Use the `$HOME/.claudeclaw-app` symlink, NOT the raw spaced path (CLAUDE.md launchd rule; Research anti-pattern). No em dashes in the new prose. Tier 0 (line ~215) and Tiers 2-3 (line ~230) unchanged.

**Planner follow-ups flagged by research (do not skip):**
- Reword line ~226 ("ran semantic search across all indexed sources") to "ran ClaudeClaw semantic recall" for consistency.
- Decide the fate of `scripts/lib/memory-meta.sh` (line ~228 coverage helper): read it first; if it shells out to `memsearch`, drop it from the rewritten Tier-1/coverage flow (it would hit a dormant index); if it only stats files, it may stay. (RESEARCH.md Open Question 2.)

---

### agentic-os `cron/jobs/nightly-memsearch-index.md` (NON-CODE / config edit)

**Target:** `/Users/shannongueringer/App Repo/agentic-os/cron/jobs/nightly-memsearch-index.md` frontmatter. No code analog — frontmatter flag flip.

**Current -> Target (D-03, RESEARCH.md lines 271-277):**
```yaml
active: 'true'    ->    active: 'false'
```
Leave the body intact (dormant, reversible). Verified: this is the ONLY cron invoking `memsearch index` (RESEARCH.md A4). This is a Phase-7-independent single-flag flip; do NOT migrate cron ownership here.

---

### agentic-os `.claude/settings.json` Stop hook (NON-CODE / config edit, MEM-04 fold-in)

**Target:** `/Users/shannongueringer/App Repo/agentic-os/.claude/settings.json` "Stop" hook array. No code analog — JSON config edit following the existing Stop-array entry shape.

**Current state (RESEARCH.md Pitfall 6 / A3, VERIFIED):** the on-disk Stop array runs ONLY `session-sync-stop.js`. `capture-cli` appears in NO agentic-os revision (CONTEXT.md MEM-04 note). Despite 05-02-SUMMARY claims, it is not wired.

**Target state (D-07):** add `node "$HOME/.claudeclaw-app/dist/capture-cli.js"` as an ADDITIONAL Stop-array entry alongside the existing `session-sync-stop.js`, and COMMIT it in the agentic-os repo. Use the `$HOME/.claudeclaw-app` symlink (same invocation mechanism capture-cli's design specifies; CLAUDE.md launchd rule). This is additive (writes terminal work into `(ws:aos, aos)`), not a replacement for session-sync-stop.js.

**Sequencing:** this is a prerequisite for the *capture* half of the D-05 live round-trip. The recall half works without it. Build `dist/capture-cli.js` (already present per RESEARCH.md) and confirm before relying on it.

## Shared Patterns

### Server-side agent attribution (V4 / Spoofing guard)
**Source:** `src/capture-cli.ts` line 38 (`const CAPTURE_AGENT_ID = 'aos';`) and its use at lines 67, 72, 86.
**Apply to:** `recall-cli.ts` and `recallForWorkspace`. Fix `agentId='aos'` server-side; never read an agent id from argv.
```typescript
const RECALL_AGENT_ID = 'aos'; // never from argv
```

### Workspace pool key (cross-agent leak guard)
**Source:** `src/agent-config.ts` lines 203-205 — `workspaceMemoryKey(agentId)` returns `ws:${agentId}`. Doc comment (lines 200-202) names the four callers (bot, projection, capture, and now recall) that MUST agree on this one pool.
**Apply to:** `recallForWorkspace` (chatId) and the recall-cli test (assert `searchCalls[0][0] === 'ws:aos'`).

### ESM run-as-main idiom (test-importable CLI)
**Source:** `src/capture-cli.ts` lines 119-126.
**Apply to:** `recall-cli.ts`. Wrap the run function so vitest can import the pure recall fn without executing the CLI.
```typescript
const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) { runRecallCli(); }
```

### initDatabase before any DB access (PROJECT_ROOT anchor, not cwd)
**Source:** `src/capture-cli.ts:93`, `src/schedule-cli.ts:27`.
**Apply to:** `recall-cli.ts` (call once at top of run). Guarantees the claudeclaw store is hit when spawned from the agentic-os cwd.

### vitest mock-the-boundary seam + source-guard regex
**Source:** `src/memory-projection.test.ts` lines 13-24 (mock `db.js`/`agent-config.js`, import-after-mock), lines 98-104 (`fs.readFileSync(__dirname,...)` + `not.toMatch`/`not.toContain` source guard), line 62 (`not.toContain('—')`). Also `src/capture-cli.test.ts` lines 15-34 (in-memory substitute for db).
**Apply to:** `recall-cli.test.ts`.

### No em dashes (CLAUDE.md hard rule)
**Source:** CLAUDE.md + enforced by `memory-projection.test.ts:62`.
**Apply to:** all six files (recall-cli.ts output strings, test, AGENTS.md prose, cron frontmatter, settings.json). Use `--` or commas.

### Build + symlink reachability
**Source:** `package.json` `"build": "vite build && tsc"`, `"test": "vitest run"`. The `~/.claudeclaw-app` symlink is live (-> repo root). `dist/capture-cli.js` already exists, proving the path.
**Apply to:** after writing `recall-cli.ts`, run `npm run build`, confirm `dist/recall-cli.js` exists, then point AGENTS.md at `$HOME/.claudeclaw-app/dist/recall-cli.js`. Per-task quick test: `npx vitest run src/recall-cli.test.ts`; per-wave: `npx vitest run` (tolerate the 2 documented baseline failures per RESEARCH.md).

## No Analog Found

None among the code files. All three new/modified ClaudeClaw files have a strong in-repo analog. The three agentic-os edits are config/docs (no code analog by nature) and are fully specified by before/after states in RESEARCH.md "Code Examples" and the assignments above.

## Metadata

**Analog search scope:** `/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/sharp-easley-ba9c43/src/` (CLI entrypoints, memory/db/embeddings/agent-config modules, test files); agentic-os targets verified by RESEARCH.md.
**Files read this pass:** `src/capture-cli.ts`, `src/schedule-cli.ts`, `src/memory-projection.test.ts`, `src/memory.ts` (1-100), `src/db.ts` (899-960), `src/agent-config.ts` (200-209), `src/capture-cli.test.ts` (1-41), `package.json` (scripts).
**Pattern extraction date:** 2026-06-15
