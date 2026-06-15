---
phase: 05-memory-projection-capture
plan: 01
subsystem: memory
tags: [memory, projection, capture, unified-pool, cross-mode-bridge]
requires:
  - "Phase 4 strictAgentId recall scoping (in baseline)"
provides:
  - "workspaceMemoryKey(agentId) / isWorkspaceAgent(agentId) helpers"
  - "renderMemoryProjection(agentId, date) -> {date}.claudeclaw.md (MEM-03, MEM-06)"
  - "captureFromStop(input) + capture-cli Stop-hook entrypoint (MEM-04, MEM-06)"
  - "dist/capture-cli.js (Plan 02 Stop-hook target)"
affects:
  - src/agent-config.ts
  - src/orchestrator.ts
  - src/message-core.ts
tech-stack:
  added: []
  patterns:
    - "Unified workspace memory pool keyed on ws:<agentId>"
    - "In-process db.ts read access path for MEM-06 (no raw sqlite, no decrypt)"
    - "Exported pure handler (captureFromStop) behind a thin stdin CLI shell"
key-files:
  created:
    - src/memory-projection.ts
    - src/memory-projection.test.ts
    - src/capture-cli.ts
    - src/capture-cli.test.ts
  modified:
    - src/agent-config.ts
    - src/orchestrator.ts
    - src/message-core.ts
    - src/agent-config.test.ts
    - src/orchestrator.test.ts
decisions:
  - "workspaceMemoryKey returns ws:<agentId> (ws:aos); all four consumers agree on one pool"
  - "isWorkspaceAgent reuses resolveAgentRuntime's projectDir + fs.existsSync predicate"
  - "No schema change: dedup reuses source + session_id"
  - "src/hooks.ts intentionally unwired; success criterion 4 satisfied by the Plan 02 Stop hook"
metrics:
  duration: ~25m
  completed: 2026-06-15
  tasks: 3
  files_created: 4
  files_modified: 5
---

# Phase 5 Plan 01: Workspace Memory Bridge (in-repo half) Summary

Built the in-repo half of the cross-mode memory bridge: a single `workspaceMemoryKey('aos') = 'ws:aos'` pool key that delegation save/recall, the SQLite-to-markdown projection writer, and the Stop-hook capture CLI all key on, so a terminal Claude Code session and the bot's `@aos:` turns read and write ONE shared memory pool.

## Workspace key value and derivation

`workspaceMemoryKey(agentId)` returns the literal `ws:${agentId}`, so the workspace agent `aos` resolves to **`ws:aos`**. It is deterministic from the agent id with no DB lookup. `isWorkspaceAgent(agentId)` is true only when `loadAgentConfig(agentId).projectDir` is set AND `fs.existsSync(projectDir)` is true, reusing the exact predicate `resolveAgentRuntime` uses to pick the SDK cwd. It returns false (never throws) for unknown or broken agents.

Four consumers agree on `ws:aos`:
1. orchestrator delegated recall (`buildMemoryContext` chatId for workspace agents)
2. message-core delegated save (`saveConversationTurn` chatId for workspace agents)
3. `renderMemoryProjection` (read key)
4. `captureFromStop` (write key + dedup key)

## Files changed

Created:
- `src/memory-projection.ts` (renderMemoryProjection: read fns -> {date}.claudeclaw.md)
- `src/memory-projection.test.ts` (render, no-clobber, skip-no-workspace, MEM-06 source guard)
- `src/capture-cli.ts` (captureFromStop + thin stdin CLI shell, dist target)
- `src/capture-cli.test.ts` (attribution, dedup, feedback-loop, empty/cap, foreign-cwd)

Modified:
- `src/agent-config.ts` (added workspaceMemoryKey + isWorkspaceAgent)
- `src/orchestrator.ts` (delegated recall routes workspace agents onto ws:<agentId>; strictAgentId kept)
- `src/message-core.ts` (delegated save routes workspace agents onto ws:<agentId>; inline fire-and-forget projection trigger)
- `src/agent-config.test.ts` (helper tests)
- `src/orchestrator.test.ts` (workspace vs non-workspace recall branch tests + mock additions)

## COMPAT-02

Only the delegated save/recall chatId changed, and only for workspace agents (gated on `isWorkspaceAgent`). The main (non-delegated) `saveConversationTurn` in message-core is untouched, and non-workspace delegated agents keep the caller chatId unchanged. Verified by the orchestrator non-workspace test asserting recall still passes the caller chatId.

## MEM-06 access-path proof

`src/memory-projection.ts` imports only `getRecentHighImportanceMemories` from `db.ts`, `resolveAgentRuntime` / `workspaceMemoryKey` from `agent-config.ts`, and `fs` / `path`. It never opens the sqlite file from a new connection, never invokes the field-level crypto helpers, and never reads the encrypted messaging tables. The memories table is plaintext (only `wa_*` / `slack_messages` are AES-GCM encrypted), so the in-process read is the full MEM-06-safe access path. A source-guard test reads the module's own source and asserts the absence of the decrypt-helper identifier, the sqlite driver name, `wa_`, and `slack_messages`. `capture-cli.ts` likewise writes only through `saveConversationTurn` and reads dedup state only through `getRecentConversation`.

## No-schema-change confirmation

No migration was created and no column was added. Capture dedup reuses the existing `conversation_log.session_id` and content match plus the existing 0.85 cosine dedup in ingest; `source` is reused as-is. No `migrations/<version>/` directory was touched.

## Criterion-4 reinterpretation (hooks.ts intentionally unwired)

`src/hooks.ts` is ClaudeClaw's in-process registry that fires inside the bot Node process; it cannot observe a terminal Claude Code session, so wiring it would NOT satisfy MEM-04. Roadmap success criterion 4 ("hooks not dead code / actually fire") is reinterpreted as: the agentic-os Claude Code **Stop** hook firing `dist/capture-cli.js` (wired in Plan 02) is what makes the bridge fire. `src/hooks.ts` is left unwired and flagged for a later dedicated cleanup phase. The projection trigger is an inline fire-and-forget call in message-core after the delegated turn save, not a hooks.ts registration.

## Deviations from Plan

None affecting behavior. One minor implementation note: the MEM-06 source-guard docstring in `memory-projection.ts` is phrased to avoid literally containing the forbidden identifiers (decrypt-helper name, sqlite driver, encrypted-table names), since the guard test reads the module's own source; the docstring still describes the rule plainly. Em dashes were kept out of all created files per CLAUDE.md.

## Test results

- `npx vitest run src/agent-config.test.ts src/orchestrator.test.ts`: 29 passed
- `npx vitest run src/memory-projection.test.ts`: 5 passed
- `npx vitest run src/capture-cli.test.ts`: 7 passed
- Full suite (`npx vitest run`): 562 passed, 2 failed (38 files). Both failures are the documented baseline:
  - `dashboard.contract.test.ts` "rejects missing chatId with 400" (stashed fix, unrelated)
  - `chat-task-tracker.test.ts` classifier no-API-key path (unrelated)
  No new failures introduced. `file-send.integration` live-Telegram passed/was inert this run.
- `npm run build`: clean; `dist/capture-cli.js` produced (4772 bytes).

## Commits

- 5ae899f feat(05-01): workspace memory key + delegation save/recall wiring
- a930411 feat(05-01): memory projection writer (MEM-03, MEM-06) + inline trigger
- f3690d3 feat(05-01): capture-cli Stop-hook entrypoint (MEM-04, MEM-06)

## Self-Check: PASSED
