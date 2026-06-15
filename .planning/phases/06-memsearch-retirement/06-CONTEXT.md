# Phase 6: memsearch Retirement - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Disable the agentic-os **memsearch** second semantic index so only ClaudeClaw's
embeddings run, while keeping memory recall working in **both** modes — the
Slack bot and a terminal Claude Code session in the agentic-os workspace.

This phase delivers **MEM-05**: no second semantic index process or nightly job
fires; recall in both modes returns relevant results from ClaudeClaw embeddings
only; a terminal session that previously relied on memsearch gets equivalent
recall from the SQLite-backed path; no default-fleet regression; tests pass.

**In scope:** retiring the memsearch *semantic index* — the nightly index cron,
the AGENTS.md Tier-1 recall wiring that points at memsearch, and the terminal's
semantic-recall replacement.

**Out of scope (own phases / not this one):**
- The memory *content* crons (`daily-memory-distill`, `weekly-memory-curator`,
  `weekly-memory-gaps`) — these promote/curate markdown content and are not the
  semantic index. Leave running unless one is proven to hard-depend on
  `memsearch index`.
- The single-scheduler bridge (Phase 7) — this phase only *disables* one cron,
  it does not migrate cron ownership.
- Deleting agentic-os dead code paths (deferred to v2, CLN-01/02).
</domain>

<decisions>
## Implementation Decisions

### Terminal Tier-1 Recall (replacement for memsearch semantic search)
- **D-01:** Add a **`recall-cli.ts`** in ClaudeClaw `src/` that mirrors the
  existing `src/capture-cli.ts` Stop-hook pattern. It queries ClaudeClaw's
  SQLite embeddings (the `recallMemoryContext` / `searchMemories` +
  `embedText` path in `src/memory.ts`) and prints recall results for a query.
  This gives the terminal **true semantic parity** with the bot against the
  single source-of-record store. Recall stays scoped per the workspace agent
  (reuse the `strictAgentId` / workspace-memory-key scoping established in
  Phases 4–5).
- **D-02:** Rewrite **AGENTS.md "Memory Retrieval" Tier 1** so it invokes the
  new recall-CLI instead of `/memory-recall` / `memsearch search ... |
  reranker.py`. Tier 0 (context/MEMORY.md + daily log + the Phase-5
  `context/memory/*.md` projection) is unchanged. The memsearch CLI and the
  `reranker.py` path are removed from the Tier-1 instructions.

### Retirement Depth
- **D-03:** **Disable + de-reference**, not full removal. Concretely:
  - Flip `cron/jobs/nightly-memsearch-index.md` frontmatter to `active: 'false'`
    (or equivalent) so the nightly re-index no longer fires.
  - Strip the memsearch wiring from AGENTS.md (per D-02).
  - Leave the `memsearch` CLI binary, `scripts/setup-memsearch.*`,
    `scripts/stop-memsearch-watchers.ps1`, and the `Bash(memsearch *)` /
    setup-script permissions in `.claude/settings.json` **dormant** (not
    deleted). Chosen for reversibility while Phases 4/5 live-verification is
    still pending. Full deletion is a later cleanup, not this phase.

### `.memsearch/memory/` Data Fate
- **D-04:** **Freeze as archive.** Stop writing to `.memsearch/memory/*.md`;
  leave existing files in place for history. No migration into SQLite (content
  overlaps with the Phase-5 `context/memory/` projection, so a fold-in would
  duplicate). No deletion.

### Recall-Equivalence Proof
- **D-05:** **Both** an automated test and a live round-trip:
  - **Automated:** a test asserting the single-index / single-store invariant
    (no second semantic index in the recall path) and that recall returns
    results through ClaudeClaw embeddings only. Folds into the existing suite —
    keeps it green (success criterion 4).
  - **Live round-trip (human-verify):** with the memsearch cron disabled, prove
    one query is recalled correctly in **both** the bot and a terminal session
    via the new recall-CLI (success criterion 2 + 3).
- **D-06 (execution gate — CLEARED 2026-06-15):** The sequencing gate was
  "plan now, do not execute until Phase 4 (04-02 live MEM-02 proof) and Phase 5
  (05-02 terminal/bot round-trip) are verified live." Both are now verified and
  closed (04-02-SUMMARY, 05-02-SUMMARY, user-confirmed both directions on
  2026-06-15), so the ClaudeClaw-only recall path is proven and the fallback can
  be removed. Execution is unblocked. The planner should still structure the
  phase so the reversible disable + the live recall proof are the **final**
  steps, after the recall-CLI exists and AGENTS.md is rewritten — never disable
  the index before its replacement is in place.

### Claude's Discretion
- Exact name/flags of the recall-CLI (e.g., `recall-cli.js "<query>" [--top-k]`),
  output format, and how AGENTS.md phrases the new Tier-1 instruction — left to
  planning, following the `capture-cli.ts` precedent.
- Whether the recall-CLI is exposed to the terminal via the existing
  `~/.claudeclaw-app/dist/` symlink (same mechanism `capture-cli.js` already
  uses in agentic-os `settings.json` Stop hook).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirement & roadmap
- `.planning/REQUIREMENTS.md` — MEM-05 (the phase requirement) + the memory
  source-of-record decision rows.
- `.planning/ROADMAP.md` §"Phase 6: memsearch Retirement" — goal + 4 success
  criteria.
- `.planning/PROJECT.md` — Key Decisions (SQLite = source of record; markdown =
  projection; retire memsearch).

### ClaudeClaw recall path (the surviving index)
- `src/memory.ts` — `recallMemoryContext`, `searchMemories`, `strictAgentId`
  scoping (lines ~51–223). The recall-CLI calls into this.
- `src/capture-cli.ts` — the Stop-hook CLI pattern the new `recall-cli.ts`
  mirrors.
- `src/memory-projection.ts` — Phase-5 `context/memory/*.md` projection that is
  the terminal's Tier-0 source.
- `src/embeddings.ts` — `embedText`, `cosineSimilarity` (the single embedding
  index).

### agentic-os (the memsearch footprint to retire)
- `/Users/shannongueringer/App Repo/agentic-os/AGENTS.md` §"Memory Retrieval"
  (lines ~210–230) — Tier-1 recall instructions to rewrite.
- `/Users/shannongueringer/App Repo/agentic-os/cron/jobs/nightly-memsearch-index.md`
  — the nightly re-index job to disable.
- `/Users/shannongueringer/App Repo/agentic-os/.claude/settings.json` — memsearch
  permissions + the existing `capture-cli.js` Stop hook (line ~76) showing the
  symlink invocation pattern.
- `/Users/shannongueringer/App Repo/agentic-os/.memsearch/memory/` — index source
  files to freeze.
- `/Users/shannongueringer/App Repo/agentic-os/scripts/setup-memsearch.sh`,
  `scripts/stop-memsearch-watchers.ps1` — left dormant.

### Migration policy
- `migrations/<version>/` + the `add-migration` skill — any schema change must be
  a versioned migration (no inline schema edits). Not expected for this phase
  (no new columns anticipated), but the rule stands.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/capture-cli.ts`: direct template for the new `recall-cli.ts` (arg
  parsing, DB open, single-shot CLI shape, dist symlink invocation).
- `src/memory.ts` `recallMemoryContext({ strictAgentId })`: the recall entry
  point — the CLI is a thin wrapper that formats its output for a terminal.
- The Phase-5 `capture-cli.js` Stop hook already wired into agentic-os
  `settings.json` proves the symlink + `~/.claudeclaw-app/dist/` invocation
  path the recall-CLI will reuse.

### Established Patterns
- Per-agent recall scoping via `strictAgentId` (Phase 4, `04-01-PLAN.md`) — the
  recall-CLI must scope to the workspace agent, no cross-agent leakage.
- Markdown projection as Tier-0 (Phase 5) — recall-CLI is Tier-1 on top of it.

### Integration Points
- AGENTS.md Tier-1 instruction → invokes recall-CLI (terminal side).
- agentic-os cron disable → ClaudeClaw scheduler unaffected (Phase 7 owns the
  scheduler bridge).
</code_context>

<specifics>
## Specific Ideas

- memsearch CLI is currently installed at v0.4.7 and backed by Zilliz
  Cloud / Milvus Lite — disabling the cron stops the nightly index; the dormant
  CLI does not run on its own.
- The retirement's reversible steps (cron disable + AGENTS.md rewrite) and the
  live proof should be the **last, gated** actions, behind Phase 4/5 live
  verification (D-06).
</specifics>

<deferred>
## Deferred Ideas

- **Full memsearch removal** (delete cron job, plugin, setup scripts, settings
  perms, `.memsearch/` dir) — out of scope here by D-03; candidate for the v2
  CLN-01/02 cleanup once the ClaudeClaw-only path has soaked.
- **Folding `.memsearch/memory/` history into SQLite** — rejected for this phase
  (D-04, duplicate of the projection); could revisit if archival search is ever
  wanted.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.
</deferred>

---

*Phase: 6-memsearch-retirement*
*Context gathered: 2026-06-15*
