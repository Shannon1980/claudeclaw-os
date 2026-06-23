---
phase: 3
slug: permissions-autonomy
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-23
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `03-RESEARCH.md` → "Validation Architecture". Task IDs are filled in by the planner.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x (per TESTING.md, STACK.md) |
| **Config file** | `vitest.config.ts` (root) + inline `vitest` block in `package.json` |
| **Quick run command** | `npx vitest run src/gate.test.ts src/approval-queue.test.ts` |
| **Full suite command** | `npm test` (`vitest run`) |
| **Estimated runtime** | ~30–60s (pure-logic core <5s; `runAgent`/MCP mocked, in-memory SQLite) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/gate.test.ts src/approval-queue.test.ts`
- **After every plan wave:** `npm test` + `npm run typecheck`
- **Before `/gsd-verify-work`:** Full suite green + `npm run typecheck` clean. Manual smoke: a Balanced-mode background task triggering a Tier 3 send lands in `approval_queue` (pending) with an `audit_log` row.
- **Max feedback latency:** ~60s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | — | 0 | PERM-01 | — | Mode→tier auto/ask matrix resolves correctly | unit | `npx vitest run src/gate.test.ts -t "resolveOutcome mode matrix"` | ❌ W0 | ⬜ pending |
| TBD | — | 0 | PERM-01 | — | `getMode` defaults to balanced on empty settings (D-11) | unit | `npx vitest run src/permissions-config.test.ts -t "default balanced"` | ❌ W0 | ⬜ pending |
| TBD | — | 0 | PERM-02 | — | Per-action override flips Tier 2/3 always/ask; mode default when none | unit | `npx vitest run src/gate.test.ts -t "override"` | ❌ W0 | ⬜ pending |
| TBD | — | 0 | PERM-03 | T-tier4-bypass | Tier 4 returns 'ask' in EVERY mode AND with an 'always' override (lock holds) | unit | `npx vitest run src/gate.test.ts -t "tier4 locked"` | ❌ W0 | ⬜ pending |
| TBD | — | 0 | PERM-03 | T-misclassify | classifyTier: money/sign/delete + destructive Bash → Tier 4; unknown → Tier 3 (safe) | unit | `npx vitest run src/gate.test.ts -t "classify"` | ❌ W0 | ⬜ pending |
| TBD | — | 0 | PERM-04 | — | Background 'ask' enqueues a pending row and returns behavior:'deny' | unit | `npx vitest run src/gate.test.ts -t "background queue deny"` | ❌ W0 | ⬜ pending |
| TBD | — | 0 | PERM-04 | — | enqueue/list/approve/deny/expire transitions; pending→approved sets decided_at+result | unit | `npx vitest run src/approval-queue.test.ts` | ❌ W0 | ⬜ pending |
| TBD | — | 0 | PERM-04 | T-replay-twice | `/api/approvals` GET lists pending; approve→replay once; deny→denied | contract | `npx vitest run src/dashboard.contract.test.ts -t "approvals"` | ❌ W0 (extend) | ⬜ pending |
| TBD | — | 0 | PERM-01/02 | T-config-audit | `/api/permissions` GET mode+overrides; PUT persists + audits config event | contract | `npx vitest run src/dashboard.contract.test.ts -t "permissions"` | ❌ W0 (extend) | ⬜ pending |
| TBD | — | 0 | D-10 | T-silent-allow | Every gate decision writes an audit_log row (tool/tier/mode/outcome in detail) | unit | `npx vitest run src/gate.test.ts -t "audit recorded"` | ❌ W0 | ⬜ pending |
| TBD | — | 0 | Gate wiring | T-bypass-noop | permissionMode is NOT 'bypassPermissions' when gate active; canUseTool present | unit | `npx vitest run src/agent.test.ts -t "gate wired"` | ❌ W0 (extend) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/gate.test.ts` — `classifyTier` + `resolveOutcome` mode matrix + Tier 4 lock (every mode + override present) + background-queue-deny + audit-recorded. Covers PERM-01/02/03/04 + D-10. Mock `audit()`.
- [ ] `src/approval-queue.test.ts` — enqueue/list/approve/deny/expire transitions; pending→approved sets decided_at+result; replay-once guard. Covers PERM-04. In-memory SQLite via `_initTestDatabase()`.
- [ ] `src/permissions-config.test.ts` — default mode = balanced (D-11); override read/write round-trip. Covers PERM-01/02.
- [ ] Extend `src/dashboard.contract.test.ts` — `/api/permissions` (GET/PUT) + `/api/approvals` (GET/approve/deny) route shapes, auth gate, replay-not-twice assertion.
- [ ] Extend (or add) `src/agent.test.ts` — assert the `query()` options object has `canUseTool` set and `permissionMode !== 'bypassPermissions'` when the gate is enabled.
- [ ] Framework install: none — vitest present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Inline yes/no approval in live chat (Slack) | PERM-02/04 (D-04) | Requires a live transport + an actual Tier 3 tool call mid-turn | In a live chat under Balanced, ask the assistant to send an external email; confirm it asks inline (yes/no) and only sends on yes |
| Background gated action surfaces as "Needs you" on Home | PERM-04 | Requires a running service + a background (routine/scheduled) Tier 3 action | Trigger a scheduled/routine task that does a Tier 3 send; confirm a pending item appears on Home and one-tap Approve replays it |
| Locked Tier 4 cannot be set to Always in the UI | PERM-03 | Visual/interaction assertion | In Settings → Permissions, confirm money/sign/delete rows show a lock, no Always control, even in Autonomous mode |
| Gate fails safe-usable, not closed, on classifier/config error | Gate wiring (L-2) | Requires fault injection on the live path | Force a classifier error; confirm the action degrades to ask/queue (Tier 3), never deny-all (bricks bot) or allow-all |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
