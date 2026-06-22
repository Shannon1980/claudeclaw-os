# Phase 6: memsearch Retirement - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-15
**Phase:** 6-memsearch-retirement
**Areas discussed:** Terminal Tier-1 recall, Retirement depth, .memsearch data fate, Recall-equivalence proof

---

## Terminal Tier-1 Recall

| Option | Description | Selected |
|--------|-------------|----------|
| recall-CLI over SQLite | Add recall-cli.ts (mirrors capture-cli.ts) querying ClaudeClaw SQLite embeddings; AGENTS.md Tier 1 invokes it. True semantic parity, single index. | ✓ |
| Projection Tier-0 only | Terminal reads context/memory/*.md projection, no semantic search itself; deeper recall only via bot. | |
| Lexical fallback | Terminal Tier 1 becomes grep/ripgrep over projected markdown. | |

**User's choice:** recall-CLI over SQLite
**Notes:** Gives terminal true semantic parity with the bot against the single source-of-record store; reuses the Phase 4/5 per-agent scoping.

---

## Retirement Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Disable + de-reference | Cron active:false, rewrite AGENTS.md Tier 1, leave CLI/scripts/.memsearch dormant. Reversible. | ✓ |
| Full removal | Delete cron job, plugin refs, setup scripts, settings perms, .memsearch dir. | |

**User's choice:** Disable + de-reference
**Notes:** Reversibility chosen because Phase 4/5 live verification is still pending; full deletion deferred to v2 cleanup.

---

## .memsearch Data Fate

| Option | Description | Selected |
|--------|-------------|----------|
| Freeze as archive | Stop writing, leave files for history. No migration. | ✓ |
| Fold into ClaudeClaw | One-time import of .memsearch/memory content into SQLite, then freeze. | |
| Delete | Remove the .memsearch dir entirely after verification. | |

**User's choice:** Freeze as archive
**Notes:** Content overlaps with the new Phase-5 context/memory/ projection, so a fold-in would duplicate.

---

## Recall-Equivalence Proof

| Option | Description | Selected |
|--------|-------------|----------|
| Both test + live round-trip | Automated single-index/single-store assertion + live terminal+bot recall round-trip with memsearch off. | ✓ |
| Live round-trip only | Human-verify a query recalled in both modes with memsearch disabled. | |
| Automated test only | Assert single-index path and recall returns results; skip manual round-trip. | |

**User's choice:** Both test + live round-trip
**Notes:** Covers success criteria 2 (recall works) and 4 (suite green). Live proof + reversible disable are gated behind Phase 4/5 verification.

---

## Claude's Discretion

- Exact name/flags/output of the recall-CLI (following capture-cli.ts precedent).
- AGENTS.md phrasing of the new Tier-1 instruction.
- Whether the recall-CLI is exposed via the existing `~/.claudeclaw-app/dist/` symlink.

## Deferred Ideas

- Full memsearch removal (delete cron/plugin/scripts/perms/.memsearch dir) — v2 CLN-01/02 cleanup.
- Folding `.memsearch/memory/` history into SQLite — rejected as duplicate of the projection.

## Sequencing Note (cross-phase)

Pre-discussion decision (AskUserQuestion): **Plan Phase 6 now, gate execution.**
Phase 6 execution must not start until Phase 4 (04-02 live MEM-02 proof) and
Phase 5 (05-02 terminal/bot round-trip) are verified live — memsearch is the
current fallback and must not be disabled before the ClaudeClaw-only recall path
is proven. Captured as D-06 in CONTEXT.md.
