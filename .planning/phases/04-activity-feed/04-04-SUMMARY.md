---
phase: 04-activity-feed
plan: 04
subsystem: api
tags: [llm, haiku, oauth, summarize, kill-switch, hono, preact, vitest, human-verify]

# Dependency graph
requires:
  - phase: 04-activity-feed (plan 01)
    provides: "buildActivityFeed read model, ActivityRow shape (params-free phrase), isUndoableFamily"
  - phase: 04-activity-feed (plan 02)
    provides: "GET /api/activity endpoint, Activity.tsx feed surface + PageHeader actions slot"
  - phase: 04-activity-feed (plan 03)
    provides: "POST /api/activity/:id/undo, conditional Undo affordance"
  - phase: memory subsystem
    provides: "extractViaClaude (Haiku-via-subscription one-shot, scrubbed env, bounded timeout) reused directly"
provides:
  - "src/activity-summary.ts: summarizeDay(rows) -> plain-text params-free prompt + extractViaClaude call + honest degrade"
  - "POST /api/activity/summarize: mutation-gated, LLM_SPAWN_ENABLED-aware (short-circuits with honest degrade and NO LLM call when off), today-only rows"
  - "Summarize Today header action in Activity.tsx (operator-invoked, inline result panel, honest failure copy)"
affects: [end-of-phase-human-verify]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reuse the shared Haiku subscription one-shot (extractViaClaude) for any on-demand LLM affordance: scrubbed env, bounded timeout, no new credential, no Gemini/quota path"
    - "Kill-switch-first route: check LLM_SPAWN_ENABLED before building the prompt, short-circuit with the honest degrade and make NO LLM call when off (DoS chokepoint)"
    - "Params-free LLM prompt: only the row's deterministic phrase + agent_id + time enter the prompt, never raw captured params/env/secrets (ASVS V8)"
    - "Honest degrade over throw: summarizeDay catches internally and returns the degrade string; the route always returns 200 { text }"

key-files:
  created:
    - src/activity-summary.ts
    - src/activity-summary.test.ts
  modified:
    - src/dashboard.ts
    - src/dashboard.contract.test.ts
    - web/src/pages/Activity.tsx

key-decisions:
  - "Reused extractViaClaude (Haiku via subscription, scrubbed env) directly; did NOT introduce a new LLM path or the Gemini/separate-credential path (D-10, RESEARCH A4)"
  - "LLM_SPAWN_ENABLED checked FIRST in the route: when off, return the honest degrade with disabled:true and make no LLM call (T-04-llm-dos chokepoint)"
  - "Mutation gate inherited by mounting POST on app (DASHBOARD_MUTATIONS_ENABLED 503), no bespoke gating"
  - "Digest scoped to today's rows (local midnight forward) so the summary is honestly 'today'; empty feed short-circuits to the degrade with no LLM call"
  - "Prompt carries only the params-free phrase + agent_id + time; no raw tool_input, env, or secrets (ASVS V8, T-04-summarize-infodisc)"

patterns-established:
  - "On-demand LLM affordance = shared Haiku one-shot + kill-switch-first + params-free prompt + honest degrade. The one acceptable LLM affordance on the trust surface."

metrics:
  duration: "~4 min (autonomous code tasks; checkpoint pending operator)"
  completed: 2026-06-24
  tasks_completed: 2
  tasks_total: 3
  files_created: 2
  files_modified: 3
---

# Phase 04 Plan 04: Summarize Today Daily Digest + End-of-Phase Verification Gate Summary

Operator-invoked daily digest (D-10) reusing the existing Haiku subscription path with a kill-switch-first, params-free, honest-degrade route, plus the Summarize Today header action; the end-of-phase live human-verify gate is reached and awaiting operator sign-off.

## What Shipped (autonomous code tasks)

**Task 1 — summarizeDay digest module + mutation-gated route + contract tests (commit d06e4fa)**
- `src/activity-summary.ts`: `summarizeDay(rows): Promise<string>` assembles a plain-text prompt from the feed rows (only the params-free `phrase`, `agent_id`, and time per line, never raw params/env/secrets), asks for a 3 to 4 sentence plain-language paragraph with no em dashes, and calls `extractViaClaude(prompt, 20_000)` (the shared Haiku-via-subscription one-shot, scrubbed env, bounded timeout). On any failure, timeout, empty output, or empty feed it returns the honest degrade `"Couldn't summarize right now. The feed below is complete."` and never throws.
- `src/activity-summary.test.ts`: happy path returns the model text; rejection and empty output both degrade honestly; the prompt contains no em dash and no secret/env field; an empty feed short-circuits to the degrade with no LLM call.
- `src/dashboard.ts`: `app.post('/api/activity/summarize')` mounted on the shared app. It checks `LLM_SPAWN_ENABLED` FIRST: when off it returns `{ ok: true, text: <degrade>, disabled: true }` and makes NO LLM call. Otherwise it builds today's rows (local midnight forward) and calls `summarizeDay`. It inherits the token gate + `DASHBOARD_MUTATIONS_ENABLED` 503 by mounting on `app` (no bespoke gating).
- `src/dashboard.contract.test.ts`: summarize block proving mutation-gated 503, the `LLM_SPAWN_ENABLED`-off short-circuit (degrade + NO LLM call, asserted via a spy), and text-or-honest-failure shape.

**Task 2 — Summarize Today header action in Activity.tsx (commit d992a8e)**
- Filled-accent `Summarize Today` button in the `PageHeader` actions slot (mirrors `ApprovalItem`'s Approve styling), with a `Summarizing…` busy state.
- Operator-invoked via a `useCallback` in the click handler; never auto-runs on mount, never per row.
- The digest renders as a quiet inline panel near the header (tokens-only, weight 400). On failure or a disabled kill-switch it shows the honest degrade, never a generic error.

## Verification

- `npx vitest run src/activity-summary.test.ts` — 5/5 green (digest, honest degrade x2, no-secret/no-em-dash prompt, empty-feed short-circuit).
- `npx vitest run src/dashboard.contract.test.ts -t "summarize"` — green (mutation-gated, kill-switch short-circuit, text-or-honest-failure).
- `npx vitest run src/dashboard.contract.test.ts` — full file 105/105 green.
- `npm run build` (vite + tsc) — clean.
- Acceptance greps: `extractViaClaude` present in the module; `gemini|GOOGLE_API_KEY|generateContent` = 0; `process.env|OAUTH|API_KEY|tool_input` = 0; em dashes = 0 in both `src/activity-summary.ts` and `web/src/pages/Activity.tsx`; `LLM_SPAWN_ENABLED` covers the summarize route and short-circuits before any LLM call; `Something went wrong` = 0 in Activity.tsx; the route is mounted with no bespoke mutation gate.

## Deviations from Plan

None for the code tasks. Plan executed as written.

## Deferred / Out-of-Scope Issues

- `src/chat-task-tracker.test.ts > returns null (not throw) when the classifier fails` fails in the full `npm test` run. This is the pre-existing, LLM-environment-dependent failure already logged in `deferred-items.md` at 04-03 (verified failing identically before any 04-03 change). It touches none of this plan's files (activity-summary, dashboard, Activity.tsx) and is out of scope per the executor scope boundary. All of this plan's tests are green and the build is clean.

## Threat Surface

The summarize route is the only new surface and is fully covered by the plan's threat register:
- T-04-llm-dos: `LLM_SPAWN_ENABLED` kill-switch short-circuits with NO LLM call; operator-invoked only; bounded 20s timeout; inherits the mutations kill-switch. Mitigated.
- T-04-summarize-infodisc: prompt carries only the params-free phrase/teammate/time; grep gate confirms no env/secret/tool_input in the module. Mitigated.
- T-04-summarize-auth: inherits `DASHBOARD_MUTATIONS_ENABLED` + token gate by mounting on `app`; contract test asserts 503 when mutations off. Mitigated.
- T-04-summarize-fabrication: on failure/disabled the route and UI render the honest degrade, never a fabricated summary or generic error. Mitigated.
- T-04-SC: no new npm packages. Mitigated (N/A).

No new threat surface beyond the plan's register.

## Self-Check: PASSED

- Created files exist: `src/activity-summary.ts`, `src/activity-summary.test.ts`, `04-04-SUMMARY.md`.
- Commits exist: d06e4fa (Task 1), d992a8e (Task 2).

## Status: AWAITING HUMAN-VERIFY CHECKPOINT (Task 3)

Task 3 is the blocking end-of-phase `checkpoint:human-verify` gate. No code is written in this task. The executor has paused and returned the structured checkpoint state to the orchestrator. The operator must exercise the running app (feed unlike Audit, legible tags, Undo present only when undoable and never on Tier 4 / autonomous, a real floor-family undo end to end, the Home one-click entry, and the Summarize Today digest) and type "approved" or report issues for gap closure. This gate is NOT self-approved.
