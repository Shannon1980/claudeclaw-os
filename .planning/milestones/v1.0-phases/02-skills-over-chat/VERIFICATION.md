---
phase: 2
slug: skills-over-chat
status: passed
verified: 2026-06-15
method: inline (subagents unavailable during session cap; evidence is live transcripts + unit tests)
---

# Phase 2 — Verification

**Goal:** The agentic-os methodology skills are discoverable and invocable by the workspace agent, and a real brand/marketing skill runs end to end over chat including delivering any file output.

**Result: PASSED (3/3 requirements).**

| Req | Criterion | Verdict | Evidence |
|-----|-----------|---------|----------|
| SK-01 | Agent lists/invokes workspace methodology skills over chat | PASS | `sk01-sk02-sk03-transcripts.md` — `aos` enumerated mkt-/str-/viz-/tool- skills from the agentic-os workspace |
| SK-02 | A brand skill returns an on-brand result end to end | PASS | `mkt-copywriting` loaded brand_context (voice/positioning/icp) and produced on-brand SignMeUp taglines + scorecard; judged vs `voice-profile.md` |
| SK-03 | A file-producing skill delivers a chat attachment via the markers | PASS | `viz-excalidraw-diagram` rendered a login-flow PNG (558s) delivered as a Slack attachment, not a raw `[SEND_PHOTO:]` string |

## Code delivered (merged)

- **#16** — delegation branch in `src/message-core.ts` now runs `extractFileMarkers` + a guarded `sendPhoto`/`sendFile` loop, fixing file delivery for all delegated agents fleet-wide. Unit tests: space-in-path bracketed parsing (`format.test.ts`) + delegation marker routing (`message-core.test.ts`).
- **#17** — `DELEGATION_TIMEOUT_MS` (default 15 min) replaces the hardcoded 5-min delegation timeout in `src/orchestrator.ts`, so heavy file-producing skills finish.

## SK-03 dual-proof

The 558s render is itself the proof both fixes are load-bearing: it exceeded the old 5-min limit (needed #17) and the PNG arrived as an attachment rather than leaking as text (needed #16).

## Compatibility

- COMPAT-02 (no default-fleet regression): the delegation change is additive; the non-delegated path is untouched; default fleet behaves as before.
- COMPAT-03 (suite green): full vitest at the documented baseline (519 pass; 4 pre-existing failures — 3 environmental `schedule-cli`, 1 known `dashboard` chatId bug `task_aa93cb02` — none from this phase).

## Decisions / deferrals

- D-1b Slack channel for `aos`: user chose to skip; delegation route alone proven sufficient.
- Filed `task_4d545e7e`: error classifier should distinguish claude.ai session-limit from credential errors (a misleading message surfaced during verification).

**Verified by:** inline goal-backward analysis against live transcripts + merged code + unit tests.
