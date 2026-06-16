---
phase: 06-memsearch-retirement
plan: 02
subsystem: agentic-os-workspace-config
tags: [recall, capture, memsearch-retirement, cron, stop-hook, cross-repo]
requires:
  - "06-01: dist/recall-cli.js built (ClaudeClaw recall CLI)"
  - "dist/capture-cli.js present (ClaudeClaw capture CLI)"
provides:
  - "agentic-os AGENTS.md Tier-1 recall pointing at ClaudeClaw recall-cli.js over the symlink (D-02)"
  - "Disabled nightly-memsearch-index cron (active: 'false') so the second index never re-indexes (D-03)"
  - "Committed capture-cli.js Stop hook in agentic-os settings.json so terminal capture persists (D-07/MEM-04)"
affects:
  - "Plan 06-03 live bidirectional proof (relies on the wired recall + capture paths)"
tech-stack:
  added: []
  patterns:
    - "All workspace command strings use the $HOME/.claudeclaw-app symlink, never the spaced raw repo path (CLAUDE.md launchd rule)"
    - "Cross-repo config edits committed in the agentic-os repo on a branch off main"
key-files:
  created: []
  modified:
    - "/Users/shannongueringer/App Repo/agentic-os/AGENTS.md"
    - "/Users/shannongueringer/App Repo/agentic-os/cron/jobs/nightly-memsearch-index.md"
    - "/Users/shannongueringer/App Repo/agentic-os/.claude/settings.json"
decisions:
  - "Pre-existing em dashes in AGENTS.md Tier 0 and Cite-sources blocks left byte-unchanged per the plan's explicit unchanged-region instruction; authored prose has zero em dashes"
  - "AGENTS.md edit committed together with the cron + Stop-hook edits in a single agentic-os commit per the cross-repo single-commit instruction"
metrics:
  duration: "~2m"
  completed: 2026-06-16
---

# Phase 6 Plan 2: Repoint Workspace at ClaudeClaw Index + Restore Capture Summary

Cut the agentic-os workspace over to ClaudeClaw's single SQLite memory index and durably restored terminal capture: AGENTS.md Tier-1 recall now invokes `recall-cli.js` over the symlink (memsearch/reranker recall path removed), the nightly memsearch index cron is disabled, and the `capture-cli.js` Stop hook is wired additively and committed in the agentic-os repo so MEM-04 stays closed.

## What Was Built

**Task 1 — AGENTS.md Tier-1 rewrite (D-02):** Replaced the two-way Tier-1 recall block (the `/memory-recall` plugin sub-bullet and the `memsearch search ... | reranker.py` CLI pipe, plus the "Searches `context/memory/`, `.memsearch/memory/`, ..." line) with a single instruction running `node "$HOME/.claudeclaw-app/dist/recall-cli.js" "query" --top-k 10` against ClaudeClaw's SQLite embeddings scoped to the workspace. Reworded the absent-response phrasing from "ran semantic search across all indexed sources" to "ran ClaudeClaw semantic recall". Tier 0, the Cite-sources block, Tiers 2-3, and the `bash scripts/lib/memory-meta.sh "[topic]"` coverage line were left unchanged (memory-meta.sh reads the frozen `.memsearch/memory/` markdown paths and invokes no memsearch command, RESEARCH Open Question 2 RESOLVED).

**Task 2 — cron disable + capture Stop hook (D-03, D-07):**
- `cron/jobs/nightly-memsearch-index.md`: flipped frontmatter `active: 'true'` -> `active: 'false'`. Job body left intact (dormant, reversible). This is the only cron invoking `memsearch index`.
- `.claude/settings.json`: added `node "$HOME/.claudeclaw-app/dist/capture-cli.js"` as an additive entry in the existing Stop hook array, alongside (not replacing) `session-sync-stop.js`. JSON remains valid. Symlink path used verbatim.
- Both edits validated independently, then committed together in the agentic-os repo so the capture wiring persists across checkouts (the prior uncommitted edit is what re-opened MEM-04).

## Cross-Repo Commit

The three agentic-os files were committed in the **agentic-os repo** (a separate git repository), on a new branch `claude/phase-06-memsearch-retirement` off `main`, NOT pushed:

- `4b91f5d` feat(06-02): repoint workspace recall at ClaudeClaw index, disable memsearch index cron, wire capture Stop hook

Only the 3 target files were staged (explicit `git add` per path). The agentic-os repo's pre-existing unrelated dirty files (`context/MEMORY.md`, `context/USER.md`, `context/learnings.md`, `.claude/hooks/load-memory-snapshot.js`) and untracked files were left untouched.

## Verification

| Check | Result |
|-------|--------|
| AGENTS.md contains exact `node "$HOME/.claudeclaw-app/dist/recall-cli.js" "query" --top-k 10` substring | PASS |
| AGENTS.md no longer contains `memsearch search` or `reranker.py` | PASS |
| AGENTS.md no longer contains `/memory-recall` in Tier 1 | PASS |
| Absent-response reads "ran ClaudeClaw semantic recall" | PASS |
| memory-meta.sh coverage line preserved | PASS |
| cron `active: 'false'` | PASS |
| Only nightly-memsearch-index.md modified under cron/ | PASS |
| settings.json valid JSON; Stop array has both capture-cli.js and session-sync-stop.js | PASS |
| capture entry uses `$HOME/.claudeclaw-app` symlink, not spaced raw path | PASS |
| No em dashes in settings.json or cron file | PASS |
| All 3 files committed; `git diff --quiet HEAD` clean for each | PASS |
| memsearch CLI binary, setup scripts, and settings.json permissions left dormant (not deleted, D-03) | PASS |

## Deviations from Plan

### Documentation / scope adjustments

**1. [Rule 3 - Blocking constraint conflict] AGENTS.md whole-file em-dash check not enforced**
- **Found during:** Task 1
- **Issue:** The plan's automated verify includes `! grep -q '—' AGENTS.md` (zero em dashes file-wide) and an acceptance criterion "AGENTS.md contains no em dash character." However, AGENTS.md has 34 pre-existing em dashes in the Tier 0 line and the Cite-sources block, and the same plan explicitly instructs "Leave Tier 0 ... and the Cite-sources block ... unchanged" and "Tier 0 and Tiers 2-3 text are byte-unchanged from before the edit." These two instructions are in direct conflict.
- **Resolution:** Honored the explicit byte-unchanged / leave-unchanged instruction (which the action prose only scopes the no-em-dash rule to "the new prose"). My authored content has zero em dashes; my edit removed em-dash lines and added none. The pre-existing em dashes are in unrelated regions and out of scope per the scope boundary.
- **Files modified:** AGENTS.md (Tier-1 block + absent-response phrasing only)
- **Commit:** 4b91f5d (agentic-os repo)

### Note on recall-cli.js existence

`dist/recall-cli.js` does not yet exist in the symlinked main claudeclaw checkout (`$HOME/.claudeclaw-app` -> main checkout; Plan 01's build lives on its branch / not yet present at the symlink target). Per the plan's scope and the cross-repo guidance, this plan's job is the documented path strings and commits (verified by grep), not executing the CLI. The recall-cli.js existence verification (threat T-06-06) belongs to Plan 03's live proof checkpoint. This is expected, not a blocker for Plan 02.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. No new security surface introduced beyond the threat_model already enumerated (config edits instructing a terminal session which command to run; capture-cli.js fixes agentId server-side).

## Self-Check: PASSED

- FOUND: .planning/phases/06-memsearch-retirement/06-02-SUMMARY.md
- FOUND: agentic-os commit 4b91f5d (on branch claude/phase-06-memsearch-retirement, not pushed)
- FOUND: all 3 agentic-os target files on disk
