---
phase: 06-memsearch-retirement
plan: 01
subsystem: memory
tags: [recall, cli, sqlite, single-index, memsearch-retirement]
requires:
  - src/memory.ts buildMemoryContext embed+search block (lifted)
  - src/db.ts searchMemories (chatId, query, limit, embedding, agentId)
  - src/agent-config.ts workspaceMemoryKey
  - src/embeddings.ts embedText
provides:
  - recallForWorkspace (memory.ts) thin wrapper over the single SQLite index
  - recall-cli.ts terminal recall CLI routed through recallForWorkspace
  - dist/recall-cli.js built artifact reachable via ~/.claudeclaw-app symlink
affects:
  - Plan 02 (AGENTS.md Tier-1 recall instruction now has a real command to point at)
  - Plan 02/03 (index can be disabled without losing terminal recall)
tech-stack:
  added: []
  patterns:
    - run-as-main ESM idiom (import.meta.url === file://argv[1]) for testable CLIs
    - server-side agent attribution constant (never read agent id from argv)
    - source-guard test via fs.readFileSync regex (no second-index, no em dash)
key-files:
  created:
    - src/recall-cli.ts
    - src/recall-cli.test.ts
  modified:
    - src/memory.ts
decisions:
  - "recallForWorkspace does NOT call buildMemoryContext: that injects team-activity, consolidation, and Obsidian layers, and consolidations have no agent_id, which would be a cross-agent leak. Recall reads only the agent-scoped memories table via searchMemories."
  - "recall-cli takes a positional query, NOT stdin: copying capture-cli's stdin reader would make recall hang waiting for input that never arrives."
  - "dist/recall-cli.js is gitignored (same as dist/capture-cli.js); it is a built artifact, not a tracked source file. The live ~/.claudeclaw-app symlink resolves to the main repo, which builds it on merge."
metrics:
  duration: ~10 min
  completed: 2026-06-16
  tasks: 2
  files: 3
---

# Phase 06 Plan 01: Recall-CLI Replacement Summary

Terminal semantic recall over ClaudeClaw's single SQLite embedding index: a `recallForWorkspace` wrapper that reuses the bot's exact embedText + searchMemories path (scoped ws:aos / strict aos), plus a positional-arg `recall-cli.ts` that routes through it with server-side agent attribution. This is MEM-05's surviving recall surface, shipped before any index is disabled (D-06 sequencing).

## What Was Built

**Task 1 (TDD):** Added `recallForWorkspace(query, { agentId?, topK? })` to `src/memory.ts`. It computes `chatId = workspaceMemoryKey(agentId ?? 'aos')`, embeds the query with `embedText` guarded by `if (GOOGLE_API_KEY)` in a try/catch (embedding failure is non-fatal, falls back to FTS5/LIKE), then calls `searchMemories(chatId, query, topK ?? 10, queryEmbedding, agentId)` and returns the mapped `summary` strings. The Wave 0 invariant test (`src/recall-cli.test.ts`) asserts the single-index contract: searchMemories called exactly once, arg 0 === 'ws:aos', arg 4 === 'aos', arg 3 is an array embedding, plus the defaults path (agentId=aos, topK=10).

**Task 2:** Created `src/recall-cli.ts`, a positional-arg query CLI (NOT stdin). It imports only `initDatabase` and `recallForWorkspace` (no direct searchMemories/embedText, so no second path). It defines `RECALL_AGENT_ID='aos'` and `MAX_QUERY_CHARS=4000` server-side, parses `--top-k` (default 10, bounded to 100) by scanning argv and filtering the flag out, trims and truncates the query, prints `usage: recall-cli "<query>" [--top-k N]` to stderr and exits 2 on empty query, calls `initDatabase()` first, then prints one `- ${summary}` line per hit (or `No matching memories found.`). Wrapped in the `import.meta.url` run-as-main guard so vitest can import without executing. Extended the test with a source-guard (no memsearch/reranker/em-dash, contains RECALL_AGENT_ID). Built to `dist/recall-cli.js`.

## Verification Results

- `npx vitest run src/recall-cli.test.ts` — 4/4 passing (single-index invariant + defaults + two source guards)
- Related suites unaffected: `memory-projection.test.ts` + `capture-cli.test.ts` — 16/16 total green
- `npm run build` clean; `dist/recall-cli.js` present; `grep -q 'No matching memories found' dist/recall-cli.js` — BUILT_OK
- `grep -v '^#' src/recall-cli.ts | grep -ci 'memsearch\|reranker'` == 0
- `node dist/recall-cli.js` with no args → exit 2, usage to stderr (confirmed)
- No em dash in any added source line

## Threat Model Coverage

- **T-06-01 (Information Disclosure, PRIMARY):** mitigated — chatId fixed to `workspaceMemoryKey('aos')`='ws:aos' and strict `agentId='aos'` passed as searchMemories arg 4; the Wave 0 test asserts both.
- **T-06-02 (Spoofing):** mitigated — `RECALL_AGENT_ID='aos'` hardcoded; argv never supplies an agent id (source-guard asserts the constant is present).
- **T-06-03 (Tampering / FTS5 injection):** mitigated — CLI builds no raw SQL; routes only through searchMemories, which strips quotes and wraps as an FTS5 phrase.
- **T-06-04 (DoS):** mitigated — query capped at 4000 chars, `--top-k` bounded (default 10, ceiling 100).
- **T-06-05 (encrypted tables):** accepted/preserved — recall reads only plaintext `memories.summary` via searchMemories; no code touches wa_*/slack_messages.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] recall-cli doc comment tripped the source-guard test**
- **Found during:** Task 2
- **Issue:** The original doc comment said "no memsearch, no reranker", which the source-guard regex `not.toMatch(/memsearch/i)` correctly rejected.
- **Fix:** Reworded the comment to "no second semantic index in this path" (keeps meaning, no banned token).
- **Files modified:** src/recall-cli.ts
- **Commit:** 6dcad07

### Notes

- `dist/recall-cli.js` is listed in the plan's `files_modified` but `dist/` is gitignored in this repo (same as `dist/capture-cli.js`). The artifact is built locally and verified present; it is not a tracked git file. The live `~/.claudeclaw-app` symlink resolves to the main repo, which produces the artifact on build/merge. This matches the existing capture-cli precedent and is not a deviation in behavior.
- A real-query smoke test (`node dist/recall-cli.js "launch date" --top-k 3`) confirmed the CLI does NOT hang on stdin and correctly reaches `initDatabase()`; it then errored on a missing `DB_ENCRYPTION_KEY` because this worktree has no `.env`. That is an environment condition (the live runtime has the key), out of scope per deviation scope boundary, not a code defect.

## TDD Gate Compliance

- RED gate present: `9c92616 test(06-01): add failing recallForWorkspace ...` (all 3 tests failed before implementation)
- GREEN gate present: `c61a02f feat(06-01): add recallForWorkspace wrapper ...`
- No REFACTOR commit needed (implementation was minimal and clean).

## Self-Check: PASSED
- src/recall-cli.ts — FOUND
- src/recall-cli.test.ts — FOUND
- src/memory.ts recallForWorkspace — FOUND
- Commits 9c92616, c61a02f, 6dcad07 — all FOUND in git log
