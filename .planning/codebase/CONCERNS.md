# Codebase Concerns

**Analysis Date:** 2026-06-14

---

## Memory System

### consolidations Table Has No agent_id Column

**What it is:** `src/db.ts` lines 112–121 define the `consolidations` table with only `id`, `chat_id`, `source_ids`, `summary`, `insight`, `created_at`, `embedding`, and `embedding_model`. There is no `agent_id` column and no migration that adds one.

**Impact:** `buildMemoryContext` in `src/memory.ts` line 118 explicitly guards around this: `if (includeConsolidations && !strictAgentId)` — consolidation insights are skipped entirely for any caller that passes `strictAgentId`. In a multi-agent install (main + research + comms + content + ops), the consolidation layer is therefore **permanently disabled for per-agent strict-isolation callers** (war-room agents). Adding `agent_id` to this table is a prerequisite for cross-agent memory isolation to work fully.

**Fix approach:** Add `agent_id TEXT NOT NULL DEFAULT 'main'` to the `consolidations` table via `addColumnIfMissing`. Update `saveConsolidation`, `getRecentConsolidations`, `searchConsolidations`, and `getConsolidationsWithEmbeddings` to accept and filter by `agentId`. Thread the agent ID through `runConsolidation` in `src/memory-consolidate.ts` and the consolidation callers in `src/index.ts`.

---

### getUnconsolidatedMemories Does Not Scope by agent_id

**What it is:** `src/db.ts` line 1128–1135 — `getUnconsolidatedMemories(chatId, limit)` fetches memories from all agents sharing a `chat_id`. In a multi-agent install, the main process's `runConsolidation` call (`src/index.ts` lines 176–184) consolidates memories belonging to research, comms, ops, etc., alongside main's, producing cross-agent consolidations.

**Impact:** Consolidation insights may contain facts from another agent's conversations. Low risk today (single-user install), but this is a correctness bug for the planned integration work that adds external markdown projection.

**Fix approach:** Add `agentId?: string` parameter to `getUnconsolidatedMemories`, filter with `AND agent_id = ?` when provided. Pass the running agent's ID from `runConsolidation`.

---

### Embeddings Stored as JSON Text in SQLite — Invisible to External Processes

**What it is:** Embedding vectors are serialized as JSON arrays and stored in `memories.embedding TEXT` and `consolidations.embedding TEXT` (see `src/db.ts` lines 105, 826, 982, 1152). All similarity math (`cosineSimilarity` in `src/embeddings.ts`) runs in the Node.js process.

**Impact for integration work:** Any external process (e.g., an agentic-os markdown projection exporter, or a future Python search backend) that reads the SQLite file must re-implement the JSON parse + cosine math, OR accept that it gets zero vector search. There is no SQLite vector extension (sqlite-vss or similar) wired in. Swapping to a proper vector store (pgvector, Chroma) requires changing every caller of `getMemoriesWithEmbeddings` and `getConsolidationsWithEmbeddings`, which are called from `src/memory.ts` (Layer 1, Layer 3) and `src/memory-ingest.ts` (duplicate detection).

**Fix approach:** If a markdown projection is added, it should rely only on the `summary`, `entities`, `topics`, and `importance` columns — not embeddings. Embeddings are an internal search optimization, not portable data.

---

### Memory Extraction Uses `as any` SDK Cast

**What it is:** `src/memory-ingest.ts` line 71 passes the SDK options object with `} as any`. This bypasses TypeScript checking on the `query()` call used by `extractViaClaude`, meaning invalid option combinations will fail at runtime rather than compile time.

**Fix approach:** Define a typed options interface matching the SDK's expected shape, or import the SDK's own types if exported.

---

### Consolidation Uses Gemini-Only Path (No Claude Fallback)

**What it is:** `src/memory-consolidate.ts` line 89 calls `generateContent(prompt)` directly — there is no Claude fallback like `src/memory-ingest.ts` has. If Gemini is unavailable or hits quota, consolidation silently fails.

**Impact:** Consolidations stop accumulating, degrading memory quality over time without any user-visible signal.

**Fix approach:** Mirror the fallback pattern from `ingestConversationTurn`: try Claude Haiku first, fall back to Gemini. Log a warning when falling back.

---

### consolidatingChats Guard Is Process-Local Only

**What it is:** `src/memory-consolidate.ts` line 52 — `consolidatingChats` is a module-level `Set<string>`. It prevents overlapping consolidation runs within a single Node.js process, but provides no cross-process locking.

**Impact:** If consolidation were ever triggered from multiple agent processes (it isn't today — `src/index.ts` lines 161–188 guards this to the main process), duplicate consolidation records would accumulate. This is not currently a bug, but it is fragile: the process-level guard and the comment in index.ts are the only things keeping it correct. Removing the `if (AGENT_ID === 'main')` guard accidentally would cause silent data corruption.

**Fix approach:** Document the invariant explicitly with an assertion. Alternatively, add a DB-level advisory lock (`INSERT OR IGNORE INTO a deduplicate table`) so the constraint holds even if the code path changes.

---

## Scheduler

### Scheduler Has No Cross-Process DB Lock for Concurrent Agent Startup

**What it is:** `src/scheduler.ts` lines 82–94 use a two-layer guard: in-memory `runningTaskIds` Set plus `markTaskRunning` which does a status-flip in SQLite. The in-memory guard only works within a single process. In a multi-agent install, two agent processes could both call `getDueTasks` at the same tick, both find the same `status='active'` row, and both fire.

**Impact:** Double-execution of scheduled tasks. The `busy_timeout = 5000` pragma in `src/db.ts` line 437 handles write-lock contention but doesn't prevent two processes from reading the same active row before either writes the status flip.

**Fix approach:** Replace the read-then-write pattern with a single `UPDATE ... WHERE status='active' AND id=? RETURNING *` so only one process can claim the row. SQLite serializes writes; this atomically prevents double-claim.

---

### Scheduler Cannot Execute Jobs From External Markdown Files

**What it is:** `src/db.ts` lines 1261–1273 — scheduled tasks are stored in the `scheduled_tasks` table with a `prompt` text column. There is no path to load a task definition from a filesystem file (e.g., an agentic-os cron markdown file). Adding that capability would require either: (a) a pre-import step that reads `.md` files and inserts them into the table, or (b) a `prompt_file` column with a file path that the scheduler resolves at run time.

**Impact for integration work:** Migrating agentic-os cron jobs to the ClaudeClaw scheduler requires a deliberate import/sync step. There is no automatic pickup.

**Fix approach:** Add a `source` column (`inline` | `file`) and `prompt_file TEXT` to `scheduled_tasks`. At execution time, read the file if `source='file'`, fall back to the inline `prompt` if the file is missing. This keeps backward compatibility and enables live-edit of job definitions from the filesystem.

---

## agent-config.ts

### project_dir Is Not Validated for Traversal

**What it is:** `src/agent-config.ts` lines 166–171 — `project_dir` is read from `agent.yaml` and checked with `fs.existsSync`, but there is no validation that the path stays outside the agent's config directory or outside user-controlled paths. A crafted `agent.yaml` with `project_dir: /etc` would cause the SDK subprocess to run with cwd `/etc`.

**Impact:** Low risk in a personal install (you control your own `agent.yaml`), but relevant if the dashboard's agent-creation flow (`src/agent-create.ts`) ever accepts `project_dir` from user input without sanitization.

**Fix approach:** Validate that `project_dir` resolves to an absolute path and does not contain `..` segments after `path.resolve`. Log a warning and fall back to the agent directory if the path fails validation.

---

### resolveAgentDir Falls Back Silently to Repo Path

**What it is:** `src/agent-config.ts` lines 77–83 — `resolveAgentDir` checks `CLAUDECLAW_CONFIG/agents/<id>/agent.yaml` first, then falls back to `PROJECT_ROOT/agents/<id>`. If neither location has a file, the function returns the repo path silently. Callers that subsequently call `loadAgentConfig` get a `throw`, but callers that only need the directory path (avatars, dashboard file editor) receive a non-existent path with no error.

**Fix approach:** Either throw in `resolveAgentDir` when neither location exists, or return `null | string` and force callers to handle the null case.

---

## Encryption Layer

### Encryption Only Covers wa_messages, wa_outbox, slack_messages — Not memories or conversation_log

**What it is:** `src/db.ts` — `encryptField`/`decryptField` are applied only in `saveWaMessage`, `enqueueWaMessage`, `saveSlackMessage`, and their read counterparts (lines 1428, 1436, 1683, 1703, 1720, 1741). The `memories`, `conversation_log`, `consolidations`, and `warroom_transcript` tables store plaintext.

**Impact for external process integration:** Any tool that reads `claudeclaw.db` directly (including an agentic-os markdown exporter) can read the `summary`, `raw_text`, and conversation content without decryption. This is intentional by design for the memory/conversation tables, but it means the encryption coverage is partial: WhatsApp and Slack message bodies are protected, but the distilled semantic memories of those conversations are not.

**Implication for integration:** A markdown projection of memories reading from SQLite can simply read `summary` and `raw_text` directly — no decryption needed. But if the integration ever writes _into_ the encrypted columns, it needs the same `DB_ENCRYPTION_KEY` and the same `iv:authTag:ciphertext` hex format defined in `src/db.ts` lines 32–66.

---

### decryptField Falls Back to Plaintext on Decryption Failure

**What it is:** `src/db.ts` lines 46–66 — `decryptField` catches any decryption error and returns the raw ciphertext unchanged. This is intentional for migrating pre-encryption rows, but it also means **tampered or truncated ciphertext returns silently corrupted data** rather than an error.

**Impact:** If an external process writes malformed data into an encrypted column, the bot will receive and act on the corrupted plaintext without any signal that decryption failed.

**Fix approach:** Log a warning (at debug level) when decryption falls back, including the length and prefix of the value so corrupted rows can be identified in logs.

---

## hooks.ts

### Hooks Are Defined But Never Wired Into the Message Pipeline

**What it is:** `src/hooks.ts` exports `createHookRegistry`, `loadHooksFromDir`, and `runHooks` — a full hook system with preMessage, postMessage, onSessionStart, onSessionEnd, onError hook points. There are zero non-test imports of this module in the entire codebase. `message-core.ts`, `bot.ts`, and `slack-bot.ts` do not import it.

**Impact:** The hooks system is dead code. Any integration that expects to drop a `.js` or `.ts` file into a hooks directory and have it called on each message will find it has no effect.

**Fix approach for integration:** Wire `loadHooksFromDir` into the startup path (e.g., in `src/index.ts`), initialize a `HookRegistry`, and call `runHooks(registry.preMessage, ctx)` before `runAgent` and `runHooks(registry.postMessage, ctx)` after it in `src/message-core.ts`. The infrastructure is fully built; it just needs connection.

---

## General Technical Debt

### db.ts Is 3188 Lines With No Internal Subdivision

**What it is:** `src/db.ts` is a single 3188-line file containing schema definition, migrations, encryption utilities, every CRUD function, and all dashboard query functions. There are no sub-modules.

**Impact for integration:** Any integration adding new tables or queries extends this already large file. Merge conflicts become frequent as features are added in parallel.

**Fix approach:** Extract by domain: `src/db-memory.ts`, `src/db-scheduler.ts`, `src/db-messaging.ts`, `src/db-warroom.ts`, re-exporting from a thin `src/db.ts` index that handles init and migrations only.

---

### dashboard.ts Is 3352 Lines With Inlined HTML Templates

**What it is:** `src/dashboard.ts` contains all HTTP route handlers, business logic, and large inline HTML strings (lines 432, 503, 507, 511, 531, 559). The HTML generation modules (`src/dashboard-html.ts` at 2849 lines, `src/warroom-html.ts` at 2057 lines, `src/warroom-text-html.ts` at 3248 lines) are already extracted but still very large.

**Impact:** Any future dashboard feature requires navigating one of four 2000-3300 line files. The inline `DASHBOARD_TOKEN` interpolation into HTML (lines 432, 503–559) means the token is embedded in initial page loads on the legacy path.

---

### searchConversationHistory Uses LIKE on Unindexed content Column

**What it is:** `src/db.ts` lines 1539–1569 — `searchConversationHistory` builds a `WHERE ... content LIKE ?` query over the `conversation_log` table. The `conversation_log` table has no FTS5 virtual table, unlike `memories` which has `memories_fts`. On a long-running install with 500 rows per agent per chat, this is a full table scan.

**Impact:** Recall queries ("do you remember...") trigger a full scan that can be slow on large installs. The `pruneConversationLog(500)` cap (called in `src/memory.ts` line 280) limits the worst case, but 500 rows × 5 agents = 2500 rows per scan.

**Fix approach:** Add a FTS5 virtual table for `conversation_log` mirroring the pattern used for `memories_fts`, or narrow the time window further.

---

### Multiple process.env Direct Reads Outside config.ts

**What it is:** Several modules bypass `readEnvFile` and read `process.env` directly: `src/daily-client.ts` lines 15, 29; `src/meet-cli.ts` lines 76, 132, 526; `src/dashboard.ts` lines 389, 427, 3243; `src/logger.ts` lines 27, 32. These values are not included in the centralized `readEnvFile` call in `src/config.ts`.

**Impact:** Config values loaded this way are only visible if the calling process has the env vars injected at OS level. They are silently missing in launchd services that don't populate the environment, and they can't be overridden by the `.env` file mechanism.

**Fix approach:** Consolidate all env key reads into `src/config.ts`'s `readEnvFile` call, or at minimum add `DAILY_API_KEY`, `PIKA_DEV_KEY`, and `DASHBOARD_BIND` to the whitelist.

---

### Module-Level `db` Singleton Can Be Used Before initDatabase()

**What it is:** `src/db.ts` line 68 declares `let db: Database.Database` without initialization. All exported functions use this variable. If any exported function is called before `initDatabase()` runs, it will throw `TypeError: Cannot read properties of undefined`.

**Impact:** The order of initialization in `src/index.ts` (line 138) currently prevents this, but any test that imports DB functions without calling `_initTestDatabase()` first will crash. The test setup file (`src/test-env-setup.ts`) does not call the init function.

**Fix approach:** Add a lazy getter: `function getDb() { if (!db) throw new Error('DB not initialized'); return db; }` and use `getDb()` in all exported functions, providing a clear error message rather than an opaque undefined property access.

---

## Test Coverage Gaps

### hooks.ts Has Tests But No Integration Coverage

**What it is:** `src/hooks.test.ts` exists and tests the hook system in isolation. However, because hooks are never wired into `message-core.ts`, there are no integration tests validating that hooks fire on real message processing.

**Risk:** When hooks are wired in (required for integration work), there is no existing test scaffold to catch regressions in hook execution order, timeout behavior, or context propagation.

---

### Memory Consolidation Tests Do Not Cover Multi-Agent Scenarios

**What it is:** `src/memory-consolidate.test.ts` tests the consolidation logic but does not test the case where multiple agents share a `chat_id` with mixed `agent_id` values in the `memories` table. The `getUnconsolidatedMemories` bug (no agent_id filter) is untested.

**Risk:** Fixing the cross-agent consolidation bug could be regressed without detection.

---

### No Tests for markdown Memory Projection / Export Path

**What it is:** The `.memsearch/memory/` directory shows a markdown projection of sessions exists in the worktree, but there is no source file implementing a write path, and no tests for any such projection.

**Risk:** Integration work adding a markdown projection has no test baseline to validate against.

---

### scheduler.test.ts Does Not Test Double-Claim Scenario

**What it is:** `src/scheduler.test.ts` (376 lines) tests task execution flow but does not simulate two concurrent processes both calling `getDueTasks` and racing to claim the same task.

**Risk:** The cross-process double-execution concern is structurally undetected by the test suite.

---

## Security Considerations

### DASHBOARD_TOKEN Appears in URL Query String on Legacy HTML Routes

**What it is:** `src/dashboard.ts` lines 431–559 — several HTML routes interpolate `DASHBOARD_TOKEN` directly into the initial page response (war room picker, war room voice, legacy dashboard path). The token also appears in `URLSearchParams` appended to redirect URLs (line 531).

**Risk:** The token can appear in browser history, server access logs, and any upstream proxy logs. The `Referrer-Policy: no-referrer` header (line 232) mitigates referrer leakage for outbound links, but the URL-in-log-file vector remains.

**Current mitigation:** Dashboard is localhost-only by default (`DASHBOARD_BIND` defaults to `127.0.0.1`, line 3243). The `X-Frame-Options: DENY` header prevents iframe embedding.

**Recommendation:** Migrate remaining legacy routes to session-cookie or Bearer-header auth so the token is never in the URL. The modern SPA routes already use sessionStorage, not URL params.

---

### AGENT_ID_RE Accepts Mixed Case (i Flag) But IDs Are Stored Lowercase

**What it is:** `src/agent-config.ts` line 20 — `AGENT_ID_RE = /^[a-z0-9_-]+$/i` (case-insensitive flag). Agent IDs are stored in SQLite as-is. Two agents named `Research` and `research` would be treated as distinct by the filesystem scan but potentially collide in DB queries that do case-insensitive comparison.

**Fix approach:** Drop the `i` flag and enforce lowercase-only agent IDs at creation time in `src/agent-create.ts`.

---

*Concerns audit: 2026-06-14*
