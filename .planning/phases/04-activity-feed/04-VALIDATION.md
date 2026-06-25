---
phase: 4
slug: activity-feed
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-24
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `04-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest v2.x |
| **Config file** | `vitest.config.ts` + inline `"vitest"` block in `package.json` |
| **Quick run command** | `npx vitest run src/activity.test.ts src/undo-executor.test.ts src/activity-render.test.ts -x` |
| **Full suite command** | `npm test` (`vitest run`) |
| **Estimated runtime** | ~30 seconds (full); ~5s quick |
| **DB test helper** | `_initTestDatabase()` — fresh in-memory SQLite per `beforeEach` |
| **Contract pattern** | `{module}.contract.test.ts`; extend `src/dashboard.contract.test.ts` |
| **Setup file** | `src/test-env-setup.ts` (sets `DASHBOARD_TOKEN='test-contract-token'`) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/activity.test.ts src/undo-executor.test.ts src/activity-render.test.ts -x`
- **After every plan wave:** Run `npx vitest run src/dashboard.contract.test.ts` plus the unit files
- **Before `/gsd-verify-work`:** `npm test` green AND `npm run build` (vite + tsc) clean
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Requirement / Criterion | Behavior | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-------------------------|----------|------------|-----------------|-----------|-------------------|-------------|--------|
| TRUST-01 / SC1 | Feed reverse-chronological, plain-language, attributed by `agent_id` | — | N/A | unit | `npx vitest run src/activity.test.ts -t "reverse-chron"` | ❌ W0 | ⬜ pending |
| TRUST-01 / SC2 (D-06) | Tag derivation: pending→Needs you, approved→You approved, allow→Ran on its own, denied/expired→honest | — | N/A | unit | `npx vitest run src/activity.test.ts -t "tag derivation"` | ❌ W0 | ⬜ pending |
| D-04 / D-05 | Mapped tool→phrase; unmapped→honest generic, never fabricated, never hidden | — | N/A | unit | `npx vitest run src/activity-render.test.ts` | ❌ W0 | ⬜ pending |
| D-06 dedupe | Queued action appears once (approval_queue wins; audit `allow` only) | — | N/A | unit | `npx vitest run src/activity.test.ts -t "no double"` | ❌ W0 | ⬜ pending |
| TRUST-02 / SC3 (D-07/D-08) | Allowlisted inverse runs for floor family; non-allowlisted returns honest "no undo" | T-04-undo-allowlist | Allowlist-only dispatch, honest rejection | unit | `npx vitest run src/undo-executor.test.ts` | ❌ W0 | ⬜ pending |
| TRUST-02 / D-09 | Tier 4 row never undoable (no undo path, ever) | T-04-tier4 | Hard refuse `tier>=4` before dispatch | unit | `npx vitest run src/undo-executor.test.ts -t "tier 4"` | ❌ W0 | ⬜ pending |
| API read contract | `GET /api/activity` token-gated shape | T-04-auth | Token gate inherited from `app` mount | contract | `npx vitest run src/dashboard.contract.test.ts -t "activity"` | ⚠ extend | ⬜ pending |
| API undo contract | `POST /api/activity/:id/undo` mutation-gated, 400 on bad id, undo-not-twice | T-04-undo-doublefire | Status-guarded transition, `changes===1` | contract | `npx vitest run src/dashboard.contract.test.ts -t "undo"` | ⚠ extend | ⬜ pending |
| Summarize contract | `POST /api/activity/summarize` returns text or honest failure; respects `LLM_SPAWN_ENABLED` | T-04-llm-dos | Kill-switch + operator-invoked only + scrubbed env | contract | `npx vitest run src/dashboard.contract.test.ts -t "summarize"` | ⚠ extend | ⬜ pending |
| SC (visual) | Activity looks unlike Audit (no monospace table); Undo present only when undoable; per-teammate chips | — | N/A | manual | `checkpoint:human-verify` | manual-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/activity.test.ts` — feed build, tag derivation (D-06), dedupe, attribution (TRUST-01)
- [ ] `src/activity-render.test.ts` — tool→phrase map + honest generic (D-04/D-05)
- [ ] `src/undo-executor.test.ts` — allowlist inverse, honest rejection, Tier 4 never (TRUST-02/D-09)
- [ ] `src/dashboard.contract.test.ts` — ADD `/api/activity*` blocks (token gate, mutation gate, undo-not-twice, summarize)
- [ ] `approval-queue.test.ts` — cover new `getApprovalById`/`listApprovals(statuses)` read helper
- [ ] Framework install: none — vitest already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Activity surface visually distinct from Audit (no dense monospace) | D-01 / SC | Visual/subjective design contract per spec 08 | Open `/activity` and `/audit`; confirm they look unlike each other |
| Undo button present only on undoable rows, absent on Tier 4 / unmapped | D-09 | Requires rendered UI | Inspect feed rows; confirm Tier 4 + autonomous rows show no Undo |
| One-click entry from Home reaches `/activity` | D-03 | Requires rendered Home | Click the Home Activity affordance; lands on the feed |
| Real end-to-end undo of the floor family (label or draft) | TRUST-02 / D-08 | Needs a connected MCP server | Perform an allowlisted action, undo it from the feed, confirm the real inverse occurred |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
