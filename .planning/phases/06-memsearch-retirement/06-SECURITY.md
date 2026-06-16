# SECURITY — Phase 06: memsearch-retirement

**Audit date:** 2026-06-16
**ASVS Level:** default
**Disposition:** SECURED — 11/11 threats resolved (9 mitigated/closed, 2 accepted, 2 closed-by-removal)
**Register source:** authored at plan time (register_authored_at_plan_time: true); each mitigation verified against implemented code.

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-06-01 | Information Disclosure (PRIMARY) | mitigate | CLOSED | `src/memory.ts:260` `chatId = workspaceMemoryKey(agentId)` -> `ws:aos`; `src/memory.ts:272` `searchMemories(chatId, query, topK, queryEmbedding, agentId)` passes strict `agentId` as arg 4. Invariant test `src/recall-cli.test.ts:48-53` asserts arg0===`ws:aos`, arg4===`aos`. `db.ts:939-941` adds `AND memories.agent_id = ?` clause when agentId present. |
| T-06-02 | Spoofing | mitigate | CLOSED | `src/recall-cli.ts:32` `const RECALL_AGENT_ID = 'aos'` hardcoded; `runRecallCli` (line 86) passes it; `parseArgs` (47-66) only reads `--top-k`, never an agent id. Source-guard test `src/recall-cli.test.ts:83` asserts `RECALL_AGENT_ID` present. |
| T-06-03 | Tampering (FTS5 injection) | mitigate | CLOSED | CLI builds no SQL; routes only through `recallForWorkspace`->`searchMemories`. `db.ts:938` `keywords.map((w) => `"${w.replace(/"/g, '')}"*`)` strips double-quotes and wraps as FTS5 phrase; all SQL is parameterized (`db.prepare(...).all(...ftsParams)`). |
| T-06-04 | Denial of Service | mitigate | CLOSED | `src/recall-cli.ts:35` `MAX_QUERY_CHARS = 4000`, applied at line 64 `.slice(0, MAX_QUERY_CHARS)`; `src/recall-cli.ts:38-39` `DEFAULT_TOP_K = 10`, `MAX_TOP_K = 100`, bounded at line 55 `Math.min(Math.floor(raw), MAX_TOP_K)`. |
| T-06-05 | Information Disclosure (encrypted tables) | accept | CLOSED (accepted) | Recall path reads only the plaintext `memories` table and returns `m.summary` (`memory.ts:272-273`, `db.ts:920/945/971`). No `wa_*`/`slack_messages`/`decrypt` reference anywhere in `recall-cli.ts` or `recallForWorkspace`. The only `wa_messages`/`slack` reference in memory.ts (line 328) is in an unrelated retention-pruning log block, not the recall path. Accepted-risk entry logged below. |
| T-06-06 | Tampering (wrong/missing artifact) | mitigate | CLOSED | `agentic-os/AGENTS.md:217` references `$HOME/.claudeclaw-app/dist/recall-cli.js` (symlink path, no spaced raw path). Grep confirms no `App Repo/claudeclaw` raw path in the recall command. dist artifact verified built and reachable at the symlink in 06-03 live proof. |
| T-06-07 | Information Disclosure (capture Stop-hook attribution) | mitigate | CLOSED BY REMOVAL | MEM-04 rescope (commit 7f62a81) deleted `src/capture-cli.ts`/`dist/capture-cli.js`. Confirmed: `git ls-files` returns no capture-cli; `dist/capture-cli.js` absent; `agentic-os/.claude/settings.json` Stop array (lines 66-78) contains only `run-ccnotify.js` and `session-sync-stop.js`, no capture-cli entry. The attack surface no longer exists. |
| T-06-08 | Repudiation (uncommitted capture wiring) | mitigate | CLOSED BY REMOVAL | Same rescope; there is no capture wiring to commit. Stop hook carries no capture-cli entry; the terminal->bot path is now shared workspace files (context/MEMORY.md), no new ClaudeClaw code path reads ciphertext. |
| T-06-09 | Information Disclosure (live recall cross-agent) | mitigate | CLOSED | Same scoping as T-06-01 (invariant test guards args). 06-03 live proof confirmed `recall-cli "Q3 launch date"` from the agentic-os cwd returned only ws:aos facts; bot @aos: returned the same fact. |
| T-06-10 | Tampering (stale dist / symlink drift) | mitigate | CLOSED | `src/recall-cli.ts:29` `PACKAGE_ROOT` derived from `import.meta.url` via `fileURLToPath` (NOT argv/cwd) — attacker-controlled cwd cannot redirect the store anchor. Run-as-main guard (lines 105-112) uses `realpathSync` + `pathToFileURL` to canonicalize argv[1]; argv[1] is used only to decide whether to run, never to build queries or store paths. 06-03 confirmed dist exists and symlink resolves. |
| T-06-SC | Tampering (npm/pip/cargo installs) | accept | CLOSED (accepted) | `tech-stack.added: []` in all three SUMMARYs; no package installs this phase. memsearch left installed-but-dormant (plugin disabled per-workspace, CLI/scripts/perms retained), not added. Accepted-risk entry logged below. |

## Rescope verification (critical context)

The MEM-04 rescope (commit 7f62a81) removed the Stop-hook SQLite capture. Verified consequences:
- `src/capture-cli.ts` absent from working tree and git index; `dist/capture-cli.js` absent.
- `agentic-os/.claude/settings.json` Stop array has no capture-cli entry (lines 66-78).
- T-06-07 and T-06-08 describe a component that no longer exists -> CLOSED BY REMOVAL (not open).

Three 06-03 execution deviations, security posture verified:
1. Run-as-main guard now `realpathSync` + `pathToFileURL` (`recall-cli.ts:105-112`). argv[1] is used only as a run/no-run decision; never flows into queries or store paths. No path-trust issue introduced.
2. `process.chdir(PACKAGE_ROOT)` before dynamic import of db/memory (`recall-cli.ts:80-82`). `PACKAGE_ROOT` is derived from `import.meta.url` (line 29), not argv/cwd, so an attacker-controlled cwd cannot redirect which .env/store is loaded. Directly reinforces T-06-10.
3. `agentic-os/.claude/settings.json:2-4` `enabledPlugins."memsearch@memsearch-plugins": false` disables the second-index plugin for the workspace (documented MEM-05 hardening, deviation 3 of 06-03). Disable-not-remove, reversible; global install untouched. Not a regression.

## Accepted Risks Log

- **T-06-05 — Encrypted messaging tables not read by recall.** Accepted. The recall surface (recall-cli -> recallForWorkspace -> searchMemories) reads only the plaintext `memories` table and returns `summary` strings. It never queries `wa_*` or `slack_messages` and performs no decryption. No new code path in this phase reads ciphertext. MEM-06 encryption-at-rest path is preserved.
- **T-06-SC — Supply chain / package installs.** Accepted. This phase installs no npm/pip/cargo packages (`tech-stack.added: []` across all plans). memsearch remains installed-but-dormant (nightly cron `active: 'false'`, workspace plugin disabled, CLI/scripts/permissions retained for reversibility), so no new registry surface was introduced.

## Unregistered Flags

None. 06-01 introduced no `## Threat Flags`; 06-02 `## Threat Flags` explicitly states "None"; 06-03 deviations (run-as-main fix, chdir anchor, plugin disable) all map to existing threats (T-06-10, T-06-10, and MEM-05/T-06-SC respectively) and are documented above. No new unmapped attack surface.

## Implementation files

Read-only during audit; none modified. Verified files:
- `/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/musing-kare-323c91/src/recall-cli.ts`
- `/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/musing-kare-323c91/src/recall-cli.test.ts`
- `/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/musing-kare-323c91/src/memory.ts`
- `/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/musing-kare-323c91/src/db.ts`
- `/Users/shannongueringer/App Repo/claudeclaw/.claude/worktrees/musing-kare-323c91/src/agent-config.ts`
- `/Users/shannongueringer/App Repo/agentic-os/AGENTS.md`
- `/Users/shannongueringer/App Repo/agentic-os/.claude/settings.json`
- `/Users/shannongueringer/App Repo/agentic-os/cron/jobs/nightly-memsearch-index.md`
