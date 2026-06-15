# Phase 5: Memory Projection & Capture - Research

**Researched:** 2026-06-15
**Domain:** Cross-mode memory bridge — ClaudeClaw SQLite ↔ agentic-os daily markdown (projection out + terminal capture in), plus disambiguating two unrelated "hook" systems
**Confidence:** HIGH (all findings traced directly in ClaudeClaw + agentic-os source/filesystem; no external library guesswork)

## Summary

This phase builds a bidirectional bridge between the two modes. **Projection out (MEM-03):** render recent ClaudeClaw SQLite memories into the agentic-os daily `context/memory/{YYYY-MM-DD}.md` so a terminal Claude Code session sees what the bot produced. **Capture in (MEM-04):** when a terminal session ends, an agentic-os **Stop hook** ships that session's work into ClaudeClaw SQLite so the bot sees it. **MEM-06** is satisfied for free: the memory tables are plaintext (only messaging tables are AES-GCM encrypted — verified by enumerating every `encryptField`/`decryptField` call site), so "use ClaudeClaw's access path" just means *call the existing in-process `db.ts`/`memory.ts` read functions instead of opening the sqlite file and reading raw columns from another process.*

The single most important disambiguation for the planner: **there are TWO different hook systems and they are unrelated.** (1) `src/hooks.ts` is ClaudeClaw's own built-but-unwired in-process registry (`preMessage`/`postMessage`/`onSessionStart`/`onSessionEnd`/`onError`) that fires inside the Node bot process — it has a test (`src/hooks.test.ts`) but zero production callers (verified by grep). (2) The agentic-os `.claude/hooks/` are **Claude Code CLI hooks** (`Stop`, `UserPromptSubmit`, `SessionStart`) that fire in a terminal session, configured in `agentic-os/.claude/settings.json`, receiving JSON on stdin. The capture-in mechanism (MEM-04) MUST be system (2) — a `Stop` hook. The projection-out trigger (MEM-03) is best done **inline** from the bot's existing turn-save funnel, NOT by wiring system (1).

**Primary recommendation:** (A) Projection: add a `renderMemoryProjection(agentId)` function in a new `src/memory-projection.ts` that reads via existing `getRecentHighImportanceMemories`/`getRecentMemories` (the MEM-06-safe access path), resolves the agentic-os path via `resolveAgentRuntime('aos').cwd`, and writes a **delimited ClaudeClaw-owned block into a separate file** `context/memory/{date}.claudeclaw.md` (NOT into the agent's own `{date}.md`, to avoid clobbering its session blocks). Call it inline after the delegated `saveConversationTurn` in `message-core.ts`, and from a SessionStart-equivalent path. (B) Capture: add a small `src/capture-cli.ts` (mirroring `schedule-cli.ts`/`mission-cli.ts`) that reads session text from stdin/transcript and calls `saveConversationTurn(chatId, userText, assistantText, sessionId, 'aos')`; wire it as a second command in the agentic-os `Stop` hook array (alongside the existing `session-sync-stop.js`), passing the Stop hook's stdin `last_assistant_message`/`transcript_path`. (C) Leave `src/hooks.ts` unwired — wiring it is the wrong tool here and out of scope; recommend a one-line note that it is dead code for a later cleanup phase. (D) Dedup: tag captured memories with a distinct `source` value (`'terminal'`) and key dedup on the Claude Code `session_id` so re-running the Stop hook for the same session does not double-ingest.

## User Constraints

No CONTEXT.md exists for this phase (`/gsd-discuss-phase` was not run — `has_context: false`). Constraints below are derived from PROJECT.md, REQUIREMENTS.md, the phase objective, and CLAUDE.md, and should be treated as binding scope.

### Locked Decisions (from PROJECT.md / REQUIREMENTS.md / objective)
- SQLite (`store/claudeclaw.db`) is the single source of record. Markdown is a DERIVED projection rendered FROM SQLite — never the source, never round-tripped back as truth. [PROJECT.md Key Decisions]
- The projection reads memory through ClaudeClaw's own access/decryption path — never raw ciphertext reads of encrypted columns. (MEM-06) [objective]
- The projection must COEXIST with the agent's own `context/memory/{date}.md` session blocks without clobbering them. [objective]
- Capture-in is via a Claude Code **Stop hook** in the agentic-os workspace. (MEM-04) [objective]
- The hook wiring must actually fire (not dead code) and the suite must pass. (Success criterion 4) [objective]
- Any schema change ships as a versioned migration under `migrations/<version>/` via the `add-migration` skill — never hand-edit migration registry JSON or run `npm run migrate` for the user. [Phase 4 research + `.claude/skills/add-migration/SKILL.md`]
- Both modes keep working after the phase (COMPAT-01/02/03 cross-cutting); the default fleet (main/comms/content/ops/research) is unaffected. [REQUIREMENTS.md]
- No em dashes; terse, plain output in any user-facing/chat text (CLAUDE.md personality rules apply to the agent's chat output and to any text the projection injects into the workspace, not to code/comments). [CLAUDE.md]

### Claude's Discretion
- File-vs-section strategy for the projection (recommend a SEPARATE file `{date}.claudeclaw.md` over an in-file delimited section — lower clobber risk; see Pitfall 1).
- Projection trigger: inline-after-turn vs scheduled vs on-SessionStart (recommend inline-after-delegated-turn as the primary trigger, plus making the projection file readable at terminal SessionStart; see Open Question 1).
- Whether capture reads the Claude Code transcript JSONL or just the `last_assistant_message` from Stop-hook stdin (recommend `last_assistant_message` + the user's last prompt for v1; transcript parsing is richer but heavier — see Pitfall 4).
- Whether to add a `source='terminal'` tag and/or a `session_id` dedup column, or reuse existing fields (recommend reuse existing `source` TEXT column + `conversation_log.session_id` for dedup; only add a migration if a new column is genuinely needed — see Open Question 3).
- Test granularity beyond the minimum proofs listed.

### Deferred Ideas (OUT OF SCOPE)
- Retiring memsearch / second semantic index — Phase 6 (MEM-05).
- Command Centre reading the DB — Phase 9 (CKPT-*).
- Scheduler reading `cron/jobs/*.md` — Phase 7 (SCH-*).
- Wiring `src/hooks.ts` into the bot message lifecycle for general use — NOT required by MEM-03/04/06; flag as later cleanup, do not build here.
- Two-way sync (treating markdown edits as a memory source) — explicitly forbidden by PROJECT.md (markdown is derived, one-directional out).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEM-03 | Recent ClaudeClaw memories rendered into agentic-os daily `context/memory/{date}.md` as a derived projection a terminal session reads on startup | Read path exists: `getRecentHighImportanceMemories(chatId, limit, agentId)` (`db.ts:1029`), `getRecentMemories` (`db.ts:1050`). Workspace path resolvable via `resolveAgentRuntime('aos').cwd` (`agent-config.ts:208` → `project_dir` = `/Users/shannongueringer/App Repo/agentic-os`, confirmed in `~/.claudeclaw/agents/aos/agent.yaml`). Terminal already auto-loads `context/memory/{date}.md` at SessionStart via `agentic-os/.claude/hooks/load-memory-snapshot.js`. |
| MEM-04 | Work in a terminal Claude Code session captured (via Stop hook) into ClaudeClaw memory so the bot sees it | Write path exists: `saveConversationTurn(chatId, user, assistant, sessionId, 'aos')` (`memory.ts:247`) → logs `conversation_log` + fires `ingestConversationTurn` (`memory-ingest.ts:161`). Stop hook precedent: `agentic-os/.claude/hooks/session-sync-stop.js` already reads stdin JSON (`session_id`, `last_assistant_message`) and shells a background process. New `src/capture-cli.ts` mirrors `schedule-cli.ts`/`mission-cli.ts` pattern. |
| MEM-06 | Projection produced through ClaudeClaw's decryption path, never raw ciphertext reads of encrypted columns | Memory tables (`memories`, `conversation_log`, `consolidations`) are PLAINTEXT. `encryptField`/`decryptField` are applied ONLY to `wa_outbox`, `wa_messages`, `slack_messages` (every call site enumerated: `db.ts:1428,1436,1683,1703,1720,1741`). "Access path" = call in-process `db.ts` read functions (as the dashboard does at `dashboard.ts:1940` via `getDashboardMemoriesList`), not open the sqlite file from another process. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Reading memories for projection | Backend (bot process, `db.ts`/`memory.ts` read fns) | — | MEM-06 requires the in-process access path; reading runs where the DB connection + plaintext are |
| Rendering markdown projection text | Backend (new `src/memory-projection.ts`) | — | Pure transform of memory rows → delimited markdown; runs in bot process |
| Writing the projection file | Backend (fs write to resolved aos `project_dir`) | Filesystem (agentic-os workspace) | Path resolved via `resolveAgentRuntime('aos').cwd`; bot owns the write |
| Triggering the projection | Backend (inline in `message-core.ts` after delegated turn-save) | Scheduler (optional periodic refresh) | Inline keeps it current with each `@aos:` turn; no new subsystem |
| Capturing a terminal session | Claude Code Stop hook (agentic-os `.claude/`) → new `src/capture-cli.ts` | Backend (`saveConversationTurn`/ingest) | The terminal session runs under agentic-os Claude Code hooks; the hook shells into ClaudeClaw to write SQLite |
| Reading the projection at terminal startup | Claude Code SessionStart hook (agentic-os `load-memory-snapshot.js`) | — | Terminal-side; already loads `context/memory/{date}.md` — projection file must be in a path it reads |
| Schema evolution (only if needed) | Backend (`migrations/`, `add-migration` skill) | — | Versioned migration gate; avoid unless a new column is required |

## Standard Stack

Brownfield phase. No new external packages. The "stack" is existing ClaudeClaw modules + the agentic-os Claude Code hook system.

### Core (existing ClaudeClaw, in use)
| Module / fn | Purpose | Notes |
|-------------|---------|-------|
| `src/db.ts` `getRecentHighImportanceMemories(chatId, limit, agentId)` | Projection read (importance ≥ 0.5, agent-scoped) | `db.ts:1029`; pass `agentId='aos'` for strict scope |
| `src/db.ts` `getRecentMemories(chatId, limit)` | Projection read (all, recency) | `db.ts:1050`; NOT agent-scoped — prefer the high-importance variant for `aos` |
| `src/db.ts` `getDashboardMemoriesList(...)` | Existing in-process read pattern (the MEM-06 access path precedent) | `dashboard.ts:1940` |
| `src/memory.ts` `saveConversationTurn(chatId, user, assistant, sessionId?, agentId)` | Capture write entry point | `memory.ts:247`; logs conversation_log + fires ingest |
| `src/memory-ingest.ts` `ingestConversationTurn(chatId, user, assistant, agentId)` | LLM extraction → structured memory | `memory-ingest.ts:161`; importance ≥ 0.5 filter, 0.85 cosine dedup, `userMessage.length <= 15` skip |
| `src/db.ts` `logConversationTurn(chatId, role, content, sessionId?, agentId)` | Raw turn log | `db.ts:1494`; `session_id` column is the natural dedup key for capture |
| `src/agent-config.ts` `resolveAgentRuntime('aos').cwd` | Resolve workspace `project_dir` | `agent-config.ts:208`; returns `/Users/shannongueringer/App Repo/agentic-os` |
| `src/config.ts` `PROJECT_ROOT`, `STORE_DIR`, `CLAUDECLAW_CONFIG` | Path anchors | `config.ts:143,144,166` |

### Supporting (test + tooling)
| Tool | Version | Purpose |
|------|---------|---------|
| vitest | ^2.0.0 | test runner (`npm test` = `vitest run`); inline config block in `package.json` |
| better-sqlite3 | ^11.8.1 | DB driver; in-memory `:memory:` test path at `db.ts:765` |
| `add-migration` skill | `.claude/skills/add-migration/SKILL.md` | ONLY sanctioned way to author a migration (only if a schema change is required) |
| Node `child_process` / stdin JSON | (Node builtin) | Stop-hook → CLI plumbing (pattern: `session-sync-stop.js`) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline projection trigger in `message-core.ts` | Wiring `src/hooks.ts` `postMessage` | hooks.ts is generic dead code; wiring it adds a registry/loader surface and a config story for a single inline call. Higher blast radius, no benefit here. Leave for a dedicated cleanup phase. |
| New `src/capture-cli.ts` invoked by Stop hook | A long-running HTTP endpoint on the bot the hook POSTs to | The dashboard server is the bot process; an endpoint exists pattern-wise, but a CLI is process-isolated, works when the bot is down, and matches `schedule-cli`/`mission-cli` precedent. Recommend CLI. |
| Separate `{date}.claudeclaw.md` file | Delimited section inside `{date}.md` | In-file section risks racing the agent's own session-block writes and clobbering. Separate file is collision-free and still auto-loaded if added to the SessionStart hook's target list (see Open Question 2). |
| `last_assistant_message` + last prompt for capture | Full transcript JSONL parse | Transcript is richer (tool calls, multi-turn) but heavier and format-fragile. v1: `last_assistant_message`; defer transcript parse. |

**Installation:** None. No new dependencies.

**Version verification:** N/A — no new packages. `vitest ^2.0.0` and `better-sqlite3 ^11.8.1` are already in `package.json` and used across 36+ existing test files. No npm/PyPI/crates lookup needed.

## Package Legitimacy Audit

Not applicable. This phase installs no external packages. All work is against existing in-repo modules, the agentic-os Claude Code hook system, and the already-installed test toolchain. (If the plan later adds a package, run the Package Legitimacy Gate first.)

## Architecture Patterns

### System Architecture Diagram

```
 PROJECTION OUT (MEM-03) — runs in the BOT process
 ─────────────────────────────────────────────────
  @aos: chat turn ─▶ message-core.ts (delegation branch)
                        │  delegateToAgent(...) ─▶ SDK subprocess (terminal-equivalent run in agentic-os)
                        │  saveConversationTurn(chatId, prompt, resp, _, 'aos')   [writes SQLite]
                        │
                        └─▶ renderMemoryProjection('aos')                          [NEW, inline, fire-and-forget]
                               │  getRecentHighImportanceMemories(chatId,'aos')  ◀── MEM-06 access path (plaintext, in-process)
                               │  resolveAgentRuntime('aos').cwd  = .../agentic-os
                               └─▶ fs.write  .../agentic-os/context/memory/{date}.claudeclaw.md
                                      (ClaudeClaw-owned delimited block; never touches {date}.md)

                                              │ (terminal session, later)
                                              ▼
  Terminal Claude Code (cwd=agentic-os) ─▶ SessionStart hook: load-memory-snapshot.js
       reads context/memory/{date}.md  (+ {date}.claudeclaw.md once added to its target list)
       ─▶ injects as additionalContext  ── terminal now SEES what the bot produced ✔ MEM-03


 CAPTURE IN (MEM-04) — Claude Code Stop hook in the TERMINAL
 ───────────────────────────────────────────────────────────
  Terminal session ends ─▶ Stop hook (agentic-os/.claude/settings.json "Stop" array)
       existing: session-sync-stop.js   (Mission Control task sync — untouched)
       NEW entry: node <claudeclaw>/dist/capture-cli.js   (stdin = Stop hook JSON)
                     │  reads { session_id, last_assistant_message, transcript_path, cwd }
                     │  dedup: skip if conversation_log already has this session_id+content
                     └─▶ saveConversationTurn(chatId='aos-terminal'?, userText, assistantText, session_id, 'aos')
                              ├─ logConversationTurn x2 ─▶ conversation_log (agent_id='aos', source-tagged)
                              └─ ingestConversationTurn(... 'aos')  ─▶ memories (agent_id='aos')
                                      └─ bot's next recall surfaces it ✔ MEM-04

  ALL SQLite reads/writes target the single connection `db` ─▶ store/claudeclaw.db (PROJECT_ROOT-based, cwd-independent)
```

### Recommended Project Structure
```
src/
├── memory-projection.ts        # NEW: renderMemoryProjection(agentId) — read fns → delimited markdown → fs.write
├── memory-projection.test.ts   # NEW: temp-db + temp-workspace-dir tests
├── capture-cli.ts              # NEW: Stop-hook entrypoint; stdin JSON → saveConversationTurn('aos')
├── capture-cli.test.ts         # NEW: stdin parse + dedup + attribution (mock db boundary)
├── message-core.ts             # EDIT: one inline call to renderMemoryProjection('aos') after delegated saveConversationTurn
package.json                    # (optional) add a "capture" script alias; dist/capture-cli.js is the hook target
migrations/<version>/           # ONLY if a new column (e.g. source='terminal' marker) is genuinely required

agentic-os/.claude/settings.json  # EDIT (outside this repo): add capture-cli.js to the "Stop" hooks array
agentic-os/.claude/hooks/         # (optional) thin wrapper hook if settings.json can't reference an absolute claudeclaw path cleanly
```

### Pattern 1: MEM-06-safe read (use the in-process access path)
**What:** Read memories by calling the existing `db.ts` functions in the bot process — exactly like the dashboard does — never by opening the sqlite file from a second process or reading raw columns.
**When to use:** Any time the projection needs memory data.
**Example:**
```typescript
// Source: src/db.ts:1029 + dashboard.ts:1940 precedent [VERIFIED: codebase]
import { getRecentHighImportanceMemories } from './db.js';
// agent-scoped, importance>=0.5, already-decrypted-if-it-were-encrypted (it isn't — memory tables are plaintext)
const memories = getRecentHighImportanceMemories(chatId, 10, 'aos');
```

### Pattern 2: Resolve the workspace path from the agent config
**What:** The projection must write to the agentic-os repo. ClaudeClaw knows that path as the `aos` agent's `project_dir`.
**When to use:** Resolving where to write the projection file.
**Example:**
```typescript
// Source: src/agent-config.ts:208 [VERIFIED: codebase]
import { resolveAgentRuntime } from './agent-config.js';
const workspaceDir = resolveAgentRuntime('aos').cwd; // /Users/shannongueringer/App Repo/agentic-os
const outFile = path.join(workspaceDir, 'context', 'memory', `${dateStr}.claudeclaw.md`);
// guard: if workspaceDir does not contain context/memory, skip silently (agent not pointed at a workspace)
```

### Pattern 3: Capture CLI mirroring the existing CLI entrypoint shape
**What:** A small `#!/usr/bin/env node` CLI that `initDatabase()`s then calls into `db.ts`/`memory.ts`, reading args/stdin. Same shape as `schedule-cli.ts`/`mission-cli.ts`.
**When to use:** The Stop-hook target.
**Example:**
```typescript
// Source: pattern from src/schedule-cli.ts:1-38, src/mission-cli.ts:25, session-sync-stop.js:14-25 [VERIFIED: codebase]
import { initDatabase } from './db.js';
import { saveConversationTurn } from './memory.js';
initDatabase();
let raw = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  const d = JSON.parse(raw);              // Stop hook JSON: { session_id, last_assistant_message, transcript_path, cwd }
  const assistant = d.last_assistant_message || '';
  if (!assistant) process.exit(0);
  // dedup on session_id before writing (see Pitfall 4)
  saveConversationTurn('aos-terminal', '[terminal session]', assistant, d.session_id, 'aos');
});
setTimeout(() => process.exit(0), 4000); // stdin safety net, matching load-memory-snapshot.js:127
```

### Pattern 4: Stop hook registration (agentic-os side)
**What:** The agentic-os `Stop` hook array already runs `run-ccnotify.js` and `session-sync-stop.js`. Add a third command that invokes the ClaudeClaw capture CLI. Each command in the array receives the same Stop JSON on stdin.
**When to use:** Wiring capture so it actually fires.
**Example:**
```jsonc
// Source: agentic-os/.claude/settings.json "Stop" array [VERIFIED: filesystem]
"Stop": [{ "hooks": [
  { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/run-ccnotify.js\" Stop" },
  { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/session-sync-stop.js\"" },
  { "type": "command", "command": "node \"<ABS_PATH>/claudeclaw/dist/capture-cli.js\"" }  // NEW
]}]
```
Note: the claudeclaw repo path contains a space; quote it, and prefer a stable symlink (the project already uses `~/.claudeclaw-app` per CLAUDE.md launchd guidance) or an env var rather than an embedded spaced path.

### Anti-Patterns to Avoid
- **Wiring `src/hooks.ts` to drive the projection.** It is generic, unwired, and the projection is a single inline call. Wiring it adds a loader/registry/config surface for no benefit. Disambiguate clearly: hooks.ts ≠ the Claude Code Stop hook.
- **Writing the projection into the agent's own `{date}.md`.** Races/clobbers the agent's session blocks (the file format is `## Session — HH:MM` blocks the agent appends). Use a separate `{date}.claudeclaw.md`.
- **Opening `store/claudeclaw.db` from the capture CLI as a foreign process while the bot holds it.** The CLI uses the same `initDatabase()`/`db.ts` connection code in its own process — fine — but it MUST go through `db.ts` functions (the access path), and be tolerant of better-sqlite3 busy/locked (WAL mode + retry). Never read raw columns expecting plaintext from a table you didn't verify is plaintext.
- **Treating the markdown as a memory source.** Markdown is one-directional out. Do not re-ingest `{date}.claudeclaw.md` back into SQLite — that would create a feedback loop (the projection re-captured as a memory).
- **Re-ingesting the same terminal session on every Stop fire.** Stop fires after EVERY turn (`session-sync-stop.js:5` comment), not just session end. Dedup on `session_id` + content, or capture only meaningful deltas (see Pitfall 4).
- **Hand-writing a migration or editing `migrations/version.json` directly.** Use the `add-migration` skill, and only if a new column is truly required.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reading memories for the projection | Raw `SELECT` / opening the sqlite file from a new process | `getRecentHighImportanceMemories` / `getRecentMemories` (`db.ts`) | The access path MEM-06 mandates; agent-scoping + importance filter already implemented and tested |
| Writing a captured turn to memory | A bespoke INSERT into `memories` | `saveConversationTurn` → `ingestConversationTurn` (`memory.ts`/`memory-ingest.ts`) | Handles conversation_log + LLM extraction + embedding + 0.85 dedup + importance filter + quota backoff |
| Resolving the agentic-os path | Hard-coding `/Users/.../agentic-os` | `resolveAgentRuntime('aos').cwd` (`agent-config.ts`) | Single source of truth; survives a repoint of the agent's `project_dir` |
| Stop-hook stdin handling | Custom IPC | The `session-sync-stop.js` stdin pattern + a CLI mirroring `schedule-cli.ts` | Both patterns are proven in-repo; Stop JSON shape is already consumed there |
| Embeddings / extraction in the capture path | A second extractor | `ingestConversationTurn` (Haiku via OAuth, Gemini fallback) | One extractor, one model, already wired and quota-aware |
| Schema change | Raw `ALTER TABLE` in app code | `add-migration` skill → `migrations/<version>/*.ts` | `checkPendingMigrations` exits the process on an unapplied migration; the skill is the only sanctioned authoring path |

**Key insight:** Both halves of this bridge are *thin glue over machinery that already exists*. The projection is `read fn → format → fs.write`. The capture is `stdin JSON → saveConversationTurn`. The only genuinely new artifacts are `memory-projection.ts`, `capture-cli.ts`, one inline call in `message-core.ts`, and one line in the agentic-os Stop hook array.

## Runtime State Inventory

Not a rename/migration phase, but it writes to an external workspace filesystem and registers a new Claude Code hook, so the categories are answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `memories`/`conversation_log` rows tagged `agent_id='aos'` (live: 1 `aos` memory, 16 `main`, confirmed via sqlite). Captured terminal turns will add `aos` rows. No existing terminal-captured rows. | Code edit (new write path). If a `source='terminal'` distinction is wanted, that is the only candidate schema/data concern — see Open Question 3. |
| Live service config | The agentic-os `.claude/settings.json` `Stop`/`SessionStart` hook arrays are config that lives in the workspace repo (in git for agentic-os), NOT in ClaudeClaw. Adding the capture command edits a file OUTSIDE this repo. The `load-memory-snapshot.js` target list (which daily files it loads) also lives there. | Edit `agentic-os/.claude/settings.json` (Stop array) and optionally `load-memory-snapshot.js` (add `{date}.claudeclaw.md` to its targets). These are workspace-side changes, tracked separately from ClaudeClaw's repo — call this out in the plan as a cross-repo edit. |
| OS-registered state | None. launchd runs the bot; no OS registration embeds the projection/capture. The Stop hook is a Claude Code config, not OS-level. | None — verified. |
| Secrets / env vars | `GOOGLE_API_KEY` needed for embeddings during capture-time ingest; it lives in ClaudeClaw `.env`, read in whatever process runs `ingestConversationTurn`. The capture CLI runs in a SEPARATE process spawned by the terminal Stop hook — it must load ClaudeClaw's `.env` (the existing `initDatabase()`/config import chain reads it from `PROJECT_ROOT`, cwd-independent). Verify the CLI process has the key, else capture-ingest degrades to keyword-only memory. | Confirm the capture CLI resolves `.env` from `PROJECT_ROOT` (it will, since `config.ts` is cwd-independent), not from the terminal's cwd (agentic-os). |
| Build artifacts | `dist/capture-cli.js` is the Stop-hook target and only exists after `npm run build` (`tsc`). A source-only change won't make the hook work until built. The spaced repo path means the hook should reference a symlink/env, not a literal path. | Plan must include a build step + the symlink/path decision before the hook can fire (success criterion 4: "hooks actually fire"). |

**The canonical risk:** the capture CLI runs in a process spawned by the terminal session in the agentic-os cwd. It must still resolve ClaudeClaw's `store/claudeclaw.db` and `.env` from `PROJECT_ROOT` (cwd-independent — verified in Phase 4 that the DB path derives from `__dirname`, not `process.cwd()`), and must tolerate the bot process holding the DB (WAL + busy retry).

## Common Pitfalls

### Pitfall 1: Clobbering the agent's own daily log
**What goes wrong:** Writing the projection into `context/memory/{date}.md` overwrites or interleaves with the agent's own `## Session — HH:MM` blocks (verified format in `2026-06-12.md`).
**Why it happens:** Both the bot (projection) and the terminal session (its own session-sync) write daily memory files.
**How to avoid:** Write a SEPARATE file `{date}.claudeclaw.md` with a clear ClaudeClaw-owned header. Never edit `{date}.md`. Add the new file to the SessionStart loader's target list so the terminal still reads it.
**Warning signs:** Agent session notes disappearing; merge-conflict-looking daily files.

### Pitfall 2: hooks.ts vs Claude Code hooks confusion
**What goes wrong:** Planner "wires hooks.ts" thinking it satisfies MEM-04, but hooks.ts fires inside the bot process and cannot observe a terminal session at all.
**Why it happens:** Both are called "hooks"; PROJECT.md line 56 even says "`src/hooks.ts` (SessionStart/Stop projection hooks)" which conflates them.
**How to avoid:** MEM-04 capture = agentic-os Claude Code **Stop** hook (the `.claude/settings.json` system). The projection trigger = inline bot call (or optionally `hooks.ts` postMessage, but not recommended). State this split explicitly in the plan.
**Warning signs:** A plan task "register postMessage hook to capture terminal sessions" — impossible; postMessage only sees bot turns.

### Pitfall 3: Importance threshold drops captured terminal work
**What goes wrong:** A terminal session's captured text never lands in `memories` (only `conversation_log`), so the bot's semantic recall returns nothing.
**Why it happens:** `ingestConversationTurn` skips if `userMessage.length <= 15`, starts with `/`, LLM returns `{skip:true}`, or `importance < 0.5` (`memory-ingest.ts:168,194,205`). A synthetic `'[terminal session]'` user message may extract low importance.
**How to avoid:** Feed the extractor a meaningful summary of the session (e.g. the assistant's last substantive message as the "assistant" arg and a descriptive "user" arg), not a stub. Test the keyword-recall path too (FTS5/LIKE works even if importance gates the structured memory).
**Warning signs:** `conversation_log` has the captured row but `memories` does not; bot can't recall terminal work.

### Pitfall 4: Stop hook fires every turn → duplicate captures
**What goes wrong:** Stop fires after EVERY assistant turn (documented in `session-sync-stop.js:5`), not once at session end. Naive capture ingests the same growing session repeatedly → duplicate memories.
**Why it happens:** Misreading "Stop" as "session end."
**How to avoid:** Dedup. `ingestConversationTurn` already drops >0.85-cosine duplicates, which catches near-identical re-captures. Additionally key on `session_id` + a content hash before calling `saveConversationTurn`, or only capture the delta since the last Stop for that `session_id`. v1 minimum: rely on the existing cosine dedup + a `session_id` guard.
**Warning signs:** Many near-identical `aos` memories with the same `session_id` minutes apart.

### Pitfall 5: Capture CLI can't find the DB / .env / key
**What goes wrong:** The Stop hook spawns the CLI in the agentic-os cwd; the CLI looks for `store/claudeclaw.db` or `.env` relative to cwd and finds nothing, or runs without `GOOGLE_API_KEY` so ingest is keyword-only.
**Why it happens:** Wrong assumption that cwd = claudeclaw.
**How to avoid:** `config.ts` resolves `PROJECT_ROOT` from `__dirname` (cwd-independent — verified Phase 4), so `dist/capture-cli.js` finds the DB and `.env` correctly as long as it's the compiled file in `dist/`. Confirm in a test that runs the CLI from a foreign cwd.
**Warning signs:** "store not found" / a second empty db; "memory paused" / `embedding IS NULL` on captured rows.

### Pitfall 6: Feedback loop (projection re-captured as memory)
**What goes wrong:** The projection file is read by the terminal, the terminal's Stop hook captures the session (which contains the projected memories), and those get re-ingested as new memories.
**Why it happens:** Bidirectional bridge with no guard.
**How to avoid:** Cosine dedup (0.85) catches verbatim re-ingestion of projected summaries. Stronger: capture should summarize *new* work, not echo loaded context. Keep markdown strictly one-directional out (PROJECT.md constraint). Test: project a memory, simulate a capture containing it, assert no duplicate `memories` row.
**Warning signs:** Memory count growing with no new information; summaries identical to projected ones.

## Code Examples

### Render the projection (MEM-03 + MEM-06, automatable)
```typescript
// Source: composes db.ts:1029 read + agent-config.ts:208 path + fs write [VERIFIED: codebase]
import fs from 'fs';
import path from 'path';
import { getRecentHighImportanceMemories } from './db.js';
import { resolveAgentRuntime } from './agent-config.js';

export function renderMemoryProjection(chatId: string, agentId = 'aos', date = new Date()): string | null {
  const ws = resolveAgentRuntime(agentId).cwd;            // MEM-06: in-process access path below
  const memDir = path.join(ws, 'context', 'memory');
  if (!fs.existsSync(memDir)) return null;                // agent not pointed at a workspace — skip silently
  const memories = getRecentHighImportanceMemories(chatId, 10, agentId); // plaintext, agent-scoped
  const d = date.toISOString().slice(0, 10);
  const body =
    `# ClaudeClaw memory projection — ${d}\n\n` +
    `Derived from ClaudeClaw SQLite (source of record). Do not edit; regenerated by the bot.\n\n` +
    memories.map((m) => `- ${m.summary}`).join('\n') + '\n';
  const out = path.join(memDir, `${d}.claudeclaw.md`);
  fs.writeFileSync(out, body, 'utf8');                    // separate file — never clobbers {date}.md
  return out;
}
```

### Inline trigger after a delegated turn (MEM-03 trigger)
```typescript
// Source: src/message-core.ts:226 (delegated saveConversationTurn) [VERIFIED: codebase]
saveConversationTurn(chatIdStr, delegation.prompt, response, undefined, delegation.agentId);
// NEW — fire-and-forget, never blocks the reply:
if (delegation.agentId === 'aos') {
  try { renderMemoryProjection(chatIdStr, 'aos'); } catch (err) { logger.warn({ err }, 'projection render failed'); }
}
```

### Capture from a Stop hook (MEM-04, automatable via stdin fixture)
```typescript
// Source: pattern from session-sync-stop.js:14-25 + schedule-cli.ts init [VERIFIED: filesystem/codebase]
// dist/capture-cli.js — wired into agentic-os .claude/settings.json "Stop" array
import { initDatabase, getRecentConversation } from './db.js';
import { saveConversationTurn } from './memory.js';
initDatabase();
let raw = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let d: any; try { d = JSON.parse(raw); } catch { process.exit(0); }
  const assistant = (d.last_assistant_message || '').trim();
  if (!assistant) process.exit(0);
  // dedup guard: skip if this session's last captured content matches
  const recent = getRecentConversation('aos-terminal', 2, 'aos');
  if (recent.some((t) => t.content === assistant)) process.exit(0);
  saveConversationTurn('aos-terminal', `[terminal session ${d.session_id}]`, assistant, d.session_id, 'aos');
});
setTimeout(() => process.exit(0), 4000);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| agentic-os memsearch as the terminal's memory index | ClaudeClaw SQLite as source of record; markdown projected from it | This consolidation (Phase 4 shipped source-of-record; Phase 5 adds projection) | Terminal stays informed via projected daily file; memsearch retired in Phase 6 |
| Terminal session work invisible to the bot | Stop-hook capture into ClaudeClaw memory | Phase 5 (this) | Bot recalls terminal work; one shared memory across modes |
| `src/hooks.ts` as the intended projection mechanism (PROJECT.md framing) | Inline trigger + Claude Code Stop hook; hooks.ts stays unwired | This research | Avoids building a registry surface for one inline call; hooks.ts flagged as later cleanup |

**Deprecated/outdated:**
- PROJECT.md line 56 conflates `src/hooks.ts` with Claude Code SessionStart/Stop hooks. Treat that as imprecise framing, not a directive to wire hooks.ts.
- agentic-os memsearch is NOT touched here (Phase 6).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The workspace agent id is `aos` and its `project_dir` is `/Users/shannongueringer/App Repo/agentic-os` | throughout | Low — [VERIFIED: filesystem] `~/.claudeclaw/agents/aos/agent.yaml` confirms both. |
| A2 | Memory tables are plaintext; only messaging tables are encrypted | MEM-06 | Low — [VERIFIED: codebase] every `encryptField`/`decryptField` call site is on `wa_*`/`slack_messages` only (`db.ts:1428-1741`). |
| A3 | The correct `chat_id` to project/capture under is ambiguous — `aos` memories are keyed by the CALLER's chat_id (whoever sent `@aos:`), not a fixed per-agent id | Open Q1, capture example | MEDIUM — using a synthetic `'aos-terminal'` chat_id for capture isolates terminal work but means it won't share a chat_id with the bot's `@aos:` memories unless the projection iterates all `aos` chat_ids. Needs a decision (see Open Question 1). [ASSUMED] |
| A4 | The Stop hook stdin includes `last_assistant_message`, `session_id`, `transcript_path`, `cwd` | capture | MEDIUM — `last_assistant_message` + `session_id` confirmed in `session-sync-stop.js`; `transcript_path`/`cwd` are standard Claude Code Stop fields but not directly observed in that hook. Verify against Claude Code hook docs at plan time. [ASSUMED] |
| A5 | Adding `{date}.claudeclaw.md` to `load-memory-snapshot.js` targets makes the terminal read the projection at startup | MEM-03 read side | Low — the loader explicitly lists target files (`load-memory-snapshot.js:67-88`); adding one entry is mechanical. [VERIFIED: codebase] |
| A6 | No schema change is strictly required (reuse `source` TEXT col + `session_id`) | Open Q3 | Low-Medium — if a hard `source='terminal'` filter or a projected-flag is wanted, a migration is needed via add-migration. [ASSUMED] |

**A3 and A4 are the two decisions worth confirming before/at planning.** A3 (which chat_id) is the only behavioral design choice; A4 (Stop stdin fields) is a doc-verification step.

## Open Questions

1. **Which `chat_id` does the projection/capture use?**
   - What we know: `aos` memories are written under the caller's `chat_id` (the chat that sent `@aos:`), via `saveConversationTurn(chatIdStr, ...)` (`message-core.ts:226`). Live data: 1 `aos` memory under 1 chat_id. There is no fixed "the aos chat."
   - What's unclear: Should the projection render memories for ALL `aos` chat_ids (the agent's whole memory), or a specific chat? Should captured terminal work go under the same chat_id the bot uses, or an isolated `'aos-terminal'` id?
   - Recommendation: Projection — iterate all `chat_id`s that have `agent_id='aos'` memories (or render the union) so the terminal sees everything the bot knows for that agent. Capture — write under the same chat_id space as the bot's `aos` memories (not an isolated id) so the bot's recall surfaces terminal work; if a single canonical aos chat_id exists in practice, use it. Confirm with the user during planning (one short question).

2. **Separate projection file vs section, and is the SessionStart loader edit in scope?**
   - What we know: A separate `{date}.claudeclaw.md` avoids clobbering. The terminal only auto-loads files in `load-memory-snapshot.js`'s target list.
   - What's unclear: Whether editing the agentic-os SessionStart loader (a cross-repo change) is in scope for this phase or deferred.
   - Recommendation: Separate file + add it to the loader targets in the same phase (the projection is useless if the terminal doesn't read it). Track as an explicit cross-repo edit.

3. **Any schema change?**
   - What we know: `memories.source` is a TEXT column (`saveStructuredMemoryAtomic(..., 'conversation', agentId)`); `conversation_log.session_id` exists.
   - What's unclear: Whether the team wants to distinguish terminal-captured memories (`source='terminal'`) or mark memories as already-projected.
   - Recommendation: Reuse `source` (pass `'terminal'` through a thin ingest variant if distinction is desired) and dedup via `session_id` + cosine. Only add a migration (via `add-migration` skill) if a queryable projected-flag is required. Default: no migration.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + tsx | tests, CLI, build | ✓ | (existing toolchain) | — |
| vitest | automated tests | ✓ | ^2.0.0 | — |
| better-sqlite3 | DB driver | ✓ | ^11.8.1 | — |
| agentic-os workspace at `project_dir` | projection write target | ✓ | — (`/Users/shannongueringer/App Repo/agentic-os`) | Skip projection if `context/memory/` absent |
| agentic-os `.claude/settings.json` Stop array | capture wiring | ✓ | — (Stop + SessionStart hooks already present) | None — must edit to wire capture |
| `GOOGLE_API_KEY` | embeddings during capture-ingest | ✓ (`.env`, PROJECT_ROOT) | — | Keyword-only memory (FTS5/LIKE) still works |
| `CLAUDE_CODE_OAUTH_TOKEN` | Haiku extractor in ingest | ✓ | — | Gemini fallback |
| `dist/capture-cli.js` (built) | Stop-hook target | ✗ until `npm run build` | — | None — must build before the hook fires |
| Stable claudeclaw path (symlink/env) | Stop hook command (repo path has a space) | partial (`~/.claudeclaw-app` symlink pattern documented in CLAUDE.md) | — | Use the symlink or `$CLAUDECLAW_HOME` env in the hook command |

**Missing dependencies with no fallback:** `dist/capture-cli.js` must be built and the Stop hook must be edited for capture to fire (success criterion 4). The agentic-os `.claude/settings.json` edit is a required cross-repo change.
**Missing dependencies with fallback:** Embeddings degrade to keyword-only without `GOOGLE_API_KEY` (not blocking).

## Validation Architecture

`workflow.nyquist_validation` is `true`, so this section applies.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.0.0 |
| Config file | inline `vitest` block in `package.json` (no separate config file) |
| Quick run command | `npx vitest run src/memory-projection.test.ts src/capture-cli.test.ts` |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEM-03 | `renderMemoryProjection` writes `{date}.claudeclaw.md` into a temp workspace `context/memory/`, never touches `{date}.md` | integration | `npx vitest run src/memory-projection.test.ts` | ❌ Wave 0 |
| MEM-03 | Projection content is derived from memory rows (seed temp db, assert summaries appear) | integration | `npx vitest run src/memory-projection.test.ts` | ❌ Wave 0 |
| MEM-03 | Skips silently when the workspace has no `context/memory/` dir | unit | `npx vitest run src/memory-projection.test.ts` | ❌ Wave 0 |
| MEM-06 | Projection reads only via `db.ts` access fns (assert no raw file read / no `decryptField` on memory tables) | unit | `npx vitest run src/memory-projection.test.ts` | ❌ Wave 0 |
| MEM-04 | Capture parses Stop JSON from stdin and calls `saveConversationTurn(..., 'aos')` with the assistant text | integration | `npx vitest run src/capture-cli.test.ts` | ❌ Wave 0 |
| MEM-04 | Captured turn lands in `memories`/`conversation_log` under `agent_id='aos'` (temp db) | integration | `npx vitest run src/capture-cli.test.ts` | ❌ Wave 0 |
| MEM-04 | Re-running capture for the same `session_id`+content does not duplicate (dedup) | integration | `npx vitest run src/capture-cli.test.ts` | ❌ Wave 0 |
| MEM-04 | CLI run from a foreign cwd still resolves `store/claudeclaw.db` (PROJECT_ROOT-based) | integration | `npx vitest run src/capture-cli.test.ts` | ❌ Wave 0 |
| Feedback loop | Projected memory re-captured does not create a duplicate `memories` row | integration | `npx vitest run src/capture-cli.test.ts` | ❌ Wave 0 |
| Success crit 4 | Stop hook actually fires (capture CLI invoked, row written) | manual | live terminal session in agentic-os, then check `memories` for the captured row | n/a (human-verify) |
| MEM-03 (live) | Terminal SessionStart reads `{date}.claudeclaw.md` and the projected memory is visible | manual | live terminal session, observe injected context | n/a (human-verify) |
| COMPAT-02 | Default fleet + bot behavior unchanged | unit | `npm test` (regression) | existing suite |

### Sampling Rate
- **Per task commit:** `npx vitest run src/memory-projection.test.ts src/capture-cli.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green (baseline ~540 pass with 1-3 known unrelated flakes per Phase 4 summary: `dashboard.contract` chatId, `file-send.integration` live-Telegram, `chat-task-tracker` timeout) before `/gsd-verify-work`; plus two live human-verify steps (capture fires; terminal reads projection).

### Wave 0 Gaps
- [ ] `src/memory-projection.test.ts` — projection render, no-clobber, skip-when-no-workspace, MEM-06 access-path
- [ ] `src/capture-cli.test.ts` — stdin parse, attribution to `aos`, dedup, foreign-cwd DB resolution, feedback-loop guard
- [ ] Test fixtures: a temp workspace dir with `context/memory/`, and the existing in-memory db pattern (`db.ts:765`) / `vi.mock('./db.js')`
- [ ] Build step (`npm run build`) so `dist/capture-cli.js` exists for the live hook test
- [ ] No framework install needed.

## Security Domain

`security_enforcement` is `true`, ASVS level 1.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface introduced |
| V3 Session Management | no | Uses existing `session_id`; no new session handling |
| V4 Access Control | yes | Captured terminal work is attributed `agent_id='aos'`; reads/writes scope by agent. The capture CLI must not write under a foreign agent_id. Server-side attribution, never client-trusted. |
| V5 Input Validation | yes | Stop-hook stdin JSON is untrusted input — `JSON.parse` in try/catch, bound the assistant text length (mirror `session-sync-stop.js:41` 4000-char cap), use parameterized `better-sqlite3` statements (already universal). No string concatenation of hook content into SQL. |
| V6 Cryptography | no (for memory tables) | Memory tables are plaintext by design (verified). Do NOT add crypto; do NOT read messaging tables (which ARE encrypted) in the projection. |

### Known Threat Patterns for this phase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Untrusted Stop-hook stdin (malformed/oversized JSON crashes or floods the CLI) | Denial of Service / Tampering | try/catch `JSON.parse`, length-cap the captured text, stdin timeout safety net (`setTimeout(...4000)` like `load-memory-snapshot.js:127`) |
| Secret leakage into projected markdown (a memory containing a secret written to a workspace file) | Information Disclosure | Memory rows are already the bot's scrubbed responses (exfiltration guard at `message-core.ts:430-442`); confirm the projection writes only `summary`/`topics`, not raw message bodies; never project `wa_*`/`slack_messages` (encrypted) tables |
| Reading the wrong (encrypted) table for the projection | Information Disclosure | Hard rule: projection reads ONLY `memories`/`conversation_log` via `db.ts` fns; assert no `decryptField`/`wa_`/`slack_messages` reference in the projection module |
| Feedback-loop amplification (projection re-captured, growing unbounded) | DoS | Cosine dedup (0.85) + `session_id` guard + one-directional markdown rule |
| Path traversal via resolved workspace path | Tampering | `resolveAgentRuntime` returns a configured `project_dir`; `existsSync` guard the `context/memory/` dir; write a fixed filename, never a hook-supplied path |

## Sources

### Primary (HIGH confidence)
- `src/hooks.ts` (full) — confirmed built-but-unwired; grep shows no production callers, only `src/hooks.test.ts`
- `src/agent-config.ts` (full) — `resolveAgentRuntime`/`loadAgentConfig`/`project_dir` resolution
- `src/db.ts` (targeted: 899-1090 read fns, 1428-1741 encryptField call sites, 1494-1540 logConversationTurn) — read path + encryption boundary
- `src/memory.ts` (247-277 saveConversationTurn) and `src/memory-ingest.ts` (161-250 ingestConversationTurn) — write/ingest path
- `src/message-core.ts` (196-260 delegation branch) — projection trigger point + chat_id derivation
- `src/schedule-cli.ts`, `src/mission-cli.ts` (full) — CLI entrypoint pattern for capture-cli
- `src/dashboard.ts` (1935-1942) — existing in-process memory-read access-path precedent (MEM-06)
- `src/config.ts` (143-166) — PROJECT_ROOT/STORE_DIR/CLAUDECLAW_CONFIG, cwd-independent path anchors
- `.planning/phases/04-memory-source-of-record/04-RESEARCH.md` + `04-01-SUMMARY.md` — encryption boundary, agent scoping, single-store proof, test baseline
- `.planning/phases/03-skill-hardening/03-01-SUMMARY.md` — cwd fix (delegated writes resolve to agentic-os)
- Filesystem (agentic-os): `.claude/settings.json` (Stop/UserPromptSubmit/SessionStart hook arrays), `.claude/hooks/session-sync-stop.js` (Stop stdin shape), `.claude/hooks/load-memory-snapshot.js` (SessionStart daily-log loader + target list), `context/memory/*.md` (daily log format)
- Filesystem: `~/.claudeclaw/agents/aos/agent.yaml` (project_dir); sqlite `memories` agent_id distribution (aos=1, main=16)
- `.claude/skills/add-migration/SKILL.md` — migration authoring gate

### Secondary (MEDIUM confidence)
- None — all findings from direct source/filesystem reads.

### Tertiary (LOW confidence)
- Exact Claude Code Stop-hook stdin field set beyond `session_id`/`last_assistant_message` (A4) — verify `transcript_path`/`cwd` against current Claude Code hook docs at plan time.

## Metadata

**Confidence breakdown:**
- MEM-03 projection (read fns, path resolution, file format): HIGH — all traced in source/filesystem.
- MEM-04 capture (write path, Stop-hook precedent, CLI pattern): HIGH for the ClaudeClaw side; MEDIUM for the exact Stop stdin schema (A4).
- MEM-06 (memory tables plaintext, access path): HIGH — every encrypt/decrypt call site enumerated.
- hooks.ts disambiguation: HIGH — grep-confirmed unwired; both hook systems read in full.
- chat_id design choice (A3): the one genuine open decision — MEDIUM until confirmed.

**Research date:** 2026-06-15
**Valid until:** 2026-07-15 (stable internal subsystems; re-verify if `memory.ts`/`db.ts`/`agent-config.ts`/`message-core.ts` or the agentic-os `.claude/` hooks change before planning).
