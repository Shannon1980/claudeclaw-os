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
> Derived from 04-RESEARCH.md "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x [VERIFIED: codebase/TESTING.md, package.json] |
| **Config file** | `vitest.config.ts` (root) + inline `"vitest"` in package.json; glob `src/**/*.test.ts` |
| **Quick run command** | `npx vitest run src/undo-executor.test.ts src/activity.test.ts -x` |
| **Full suite command** | `npm test` (`vitest run`) then `npm run build` (web + tsc) |
| **Estimated runtime** | ~30 seconds (quick), full suite + build longer |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/undo-executor.test.ts src/activity.test.ts -x`
- **After every plan wave:** Run `npm test` (full vitest) + `npx tsc --noEmit`
- **Before `/gsd-verify-work`:** `npm test` green AND `npm run build` succeeds
- **Max feedback latency:** ~30 seconds (quick), full suite at wave merge

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| TRUST-01 | Feed join doesn't double-count a queued action (audit `queued` + queue `pending`) | unit | `npx vitest run src/activity.test.ts -t "no double-count"` | ❌ W0 | ⬜ pending |
| TRUST-01 | Tag derivation: each (src,outcome) → correct tag incl. honest skipped/expired | unit | `npx vitest run src/activity.test.ts -t "deriveTag"` | ❌ W0 | ⬜ pending |
| TRUST-01 | `describeAction`: mapped tools → phrase; unmapped → honest "Ran <tool>"/"Used X", never empty/fabricated | unit | `npx vitest run src/activity.test.ts -t "describeAction"` | ❌ W0 | ⬜ pending |
| TRUST-01 | `GET /api/activity` shape + token gate + per-teammate/agent filter | contract | `npx vitest run src/dashboard.contract.test.ts -t "activity"` | ❌ W0 (extend) | ⬜ pending |
| TRUST-02 | Undo of a `Write` draft deletes the file (does NOT re-write it) | unit | `npx vitest run src/undo-executor.test.ts -t "draft delete"` | ❌ W0 | ⬜ pending |
| TRUST-02 | Tier 4 → undo refused before allowlist (D-09) | unit | `npx vitest run src/undo-executor.test.ts -t "tier 4"` | ❌ W0 | ⬜ pending |
| TRUST-02 | Non-allowlisted / MCP-not-connected → honest message, no no-op theater | unit | `npx vitest run src/undo-executor.test.ts -t "honest"` | ❌ W0 | ⬜ pending |
| TRUST-02 | `POST /api/activity/:id/undo` shape + mutations kill-switch + `undoable` flag | contract | `npx vitest run src/dashboard.contract.test.ts -t "undo"` | ❌ W0 (extend) | ⬜ pending |
| D-10 | Summarize endpoint returns a digest; LLM helper is mocked (no real call) | contract/unit | `npx vitest run src/dashboard.contract.test.ts -t "summarize"` | ❌ W0 (mock) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/undo-executor.test.ts` — covers TRUST-02 (draft delete, tier-4 refusal, honest rejection, no-MCP path). Use `os.tmpdir()` + `mkdtempSync` fixtures per TESTING.md.
- [ ] `src/activity.test.ts` — covers TRUST-01 (no double-count, deriveTag, describeAction). Use `_initTestDatabase()` for the join query.
- [ ] Extend `src/dashboard.contract.test.ts` — `/api/activity`, `/api/activity/:id/undo`, `/api/activity/summarize` shapes + token/kill-switch (mock `extractViaClaude` / `generateContent`).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real draft-undo against a live created draft | TRUST-02 | Automated suite mocks file I/O | Create a draft via the gate, then Undo from the feed; confirm the draft file is gone |
| A real label-undo (if a Gmail MCP is connected) | TRUST-02 | No MCP server configured in this environment (research A1) | Only if/when a Gmail MCP is wired; otherwise ships as honest "no undo" |
| Activity surface looks deliberately unlike `/audit` | TRUST-01 | Visual judgment | Open `/activity` and `/audit`; confirm distinct styling per spec 08 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
