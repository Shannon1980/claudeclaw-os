---
phase: 04-memory-source-of-record
plan: 01
status: complete
requirements: [MEM-01, MEM-02]
---

# Plan 04-01 Summary — Memory source-of-record scoping fix

## What was done

Closed the one correctness gap in Phase 4: delegated (workspace-agent) recall now scopes to the agent, so `aos` only surfaces its own memories.

- **Task 1 (Wave 0 tests):** Added 5 regression guards against the existing strict-scoping plumbing. `src/memory.test.ts`: `buildMemoryContext` forwards `strictAgentId` to `searchMemories` (5th arg) and `getRecentHighImportanceMemories` (3rd arg), and leaves them undefined when unset (COMPAT-02). `src/db.test.ts` (real in-memory DB): `getRecentHighImportanceMemories` and `searchMemories` scope by `agent_id` (an `aos` memory and a `main` memory in the same `chat_id` do not leak across), and a MEM-01 path assertion (`STORE_DIR` is absolute, under `PROJECT_ROOT`, never contains `agentic-os`). All pass against current code (the plumbing already existed).
- **Task 2 (the fix):** Changed the single delegated recall call in `src/orchestrator.ts` (~line 196) from `buildMemoryContext(chatId, prompt, agentId)` to `buildMemoryContext(chatId, prompt, agentId, { strictAgentId: agentId })`. Added an `orchestrator.test.ts` test asserting the 4th arg is `{ strictAgentId: 'aos' }`. The main/non-delegated path (`message-core.ts`) was deliberately not touched (COMPAT-02).
- **Task 3 (regression gate):** Full suite run. Deterministic core (memory, db, orchestrator) all green.

## Key files / changes

- `src/orchestrator.ts` — delegated recall scoped with `{ strictAgentId: agentId }` (the only production change).
- `src/memory.test.ts`, `src/db.test.ts`, `src/orchestrator.test.ts` — 6 new regression tests.
- No schema change (agent_id already on `memories`/`conversation_log`; the strict plumbing pre-existed).

## Verification

- `npx vitest run src/orchestrator.test.ts src/memory.test.ts src/db.test.ts` → 68/68 green.
- `npm run build` clean.
- MEM-01: single-store path assertion green (store resolves from PROJECT_ROOT, never under agentic-os).
- MEM-02 (scoping half): cross-agent leakage guards green; delegated caller passes strictAgentId (test green).
- COMPAT-02: `message-core.ts` unchanged; the "no strictAgentId → undefined scope" test guards the default-fleet path.

## Baseline note (main checkout)

Executed in the main checkout (not a worktree this time), so the test baseline differs from prior phases' worktree baseline. Full suite: ~540 pass with 1-3 failures that vary by run, all unrelated to this change:
- `dashboard.contract` "rejects missing chatId with 400" — the known pre-existing bug; its fix is currently stashed (`task_aa93cb02`), so the test still fails here.
- `file-send.integration` "sends a real PDF via Telegram" — requires live Telegram network/token; environmental/flaky.
- `chat-task-tracker` "returns null when classifier fails" — a ~1.25s timeout flake, unrelated to memory.
None touch memory recall, orchestrator scoping, or `message-core.ts`. No regression from the scoping change.

## Pending (Wave 2)

Live two-session MEM-02 proof: after deploy + restart, write a standing preference via `@aos:` in session A, recall it in session B after `/newchat`. Requires the bot deployed with this fix.

## Self-Check: PASSED

Delegated recall is per-agent scoped (no cross-agent leakage), main path untouched, single-store proven, no schema change.
