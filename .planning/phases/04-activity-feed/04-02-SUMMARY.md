---
phase: 04-activity-feed
plan: 02
subsystem: activity-feed-vertical-slice
tags: [activity, dashboard-route, preact-surface, nav-collision, trust-01, mvp]
requires:
  - buildActivityFeed read model (04-01)
  - token gate + mutation kill-switch on the dashboard app (Phase 3)
  - shared web primitives (PageHeader/Tab, Pill, PageState, AgentAvatar, teammateColor, formatRelativeTime)
provides:
  - GET /api/activity (token-gated curated feed endpoint, TRUST-01)
  - web/src/pages/Activity.tsx (operator Activity surface, card/list, D-01/D-06/D-11)
  - resolved nav/route/vocab collision (one Activity item -> /activity; /audit -> nav.audit)
  - Home one-click entry point to /activity (D-03)
affects:
  - src/dashboard.ts, src/dashboard.contract.test.ts
  - web/src/pages/Activity.tsx, web/src/App.tsx, web/src/lib/routes.ts, web/src/lib/vocabulary.ts, web/src/pages/Home.tsx, web/src/pages/Audit.tsx
tech-stack:
  added: []
  patterns:
    - GET route inherits the token gate by mounting on the existing app (no bespoke auth)
    - thin endpoint over the plan-01 read model (no feed re-derivation in the route)
    - sticky teammate-chip set + read-side filter passed straight to the GET (D-11)
    - local-timezone day grouping over an already reverse-chron row set
key-files:
  created:
    - web/src/pages/Activity.tsx
  modified:
    - src/dashboard.ts
    - src/dashboard.contract.test.ts
    - web/src/App.tsx
    - web/src/lib/routes.ts
    - web/src/lib/vocabulary.ts
    - web/src/pages/Home.tsx
    - web/src/pages/Audit.tsx
decisions:
  - "GET /api/activity is a thin wrapper over buildActivityFeed; the route only parses filter + a bounded limit and returns { rows }, never re-deriving the feed"
  - "limit is clamped to [1,500] with a 100 default so a hostile query param cannot ask for an unbounded read"
  - "Audit.tsx title repointed from page.activity to a new page.audit term so the technical view reads 'Audit' after the collision split (correctness fix)"
  - "undoable stays in the Activity.tsx row type as an API-shape field; no Undo affordance renders this slice"
metrics:
  duration: ~6min
  completed: 2026-06-24
---

# Phase 4 Plan 2: Activity Feed Vertical Slice Summary

Shipped the first end-to-end Activity slice: a token-gated `GET /api/activity` over the plan-01 read model, a new `Activity.tsx` surface that renders the reverse-chron, day-grouped, teammate-attributed, D-06-tagged feed in card/list language deliberately unlike Audit, read-side D-11 filter chips, the resolved nav/route/vocab collision (one Activity item to the new surface, the old technical view relabeled Audit), and a quiet one-click Home entry point. UI to API to DB read is now proven on screen. Undo and Summarize affordances are intentionally absent (later plans).

## What Was Built

**Task 1 — `GET /api/activity` + contract tests (src/dashboard.ts, src/dashboard.contract.test.ts):** Mounted `app.get('/api/activity')` beside `/api/approvals` + `/api/audit`. It reads the optional `filter` (all | autonomous | needsyou | <agent_id>, D-11) and a `limit` query param (parsed, clamped to [1,500], default 100), calls `buildActivityFeed({ filter, limit })`, and returns `c.json({ rows })`. Being a GET mounted on the existing `app`, it inherits the query-token gate (T-04-auth) with no bespoke auth; `buildActivityFeed` already projects only curated param-level fields (T-04-infodisc-resp). Added an `activity API contract` describe block: tokenless request -> 401, token -> 200 + `rows` array, a seeded queued-pending + autonomous-`allow` pair returns the expected tagged shape ("Needs you" + "Ran on its own") with no secret fields, and `filter=needsyou` returns only "Needs you" rows.

**Task 2 — `web/src/pages/Activity.tsx`:** New operator surface. Fetches `/api/activity` (and `/api/agents` best-effort for teammate display names) via the shared `apiGet` helper. Renders `PageState` loading/error/empty ("Nothing yet today"). `PageHeader` title `term('page.activity')`, subtitle "What your team did", filter chips (All / Ran on its own / Needs you / one per teammate with a leading `teammateColor` dot) in the tabs slot. Filtering is read-side (active filter passed to the GET). The feed is grouped by local-timezone day with a quiet section label (TODAY / YESTERDAY / "MON, JUN 23"). Each row echoes ApprovalItem's card anatomy: 6px `teammateColor` dot, plain-language phrase (12.5px/400, line-clamp-2), meta line (`AgentAvatar` 16px + "Teammate · 9:12am", 11px muted), and the right-aligned `Pill` tag with the D-06 tone (You approved=done, Ran on its own=neutral, Needs you=medium, Denied=failed, Expired=cancelled). A per-row View toggle shows exactly the captured `{tool, tier, tag}`; for audit ("Ran on its own") rows it states only tool and tier were captured (D-05 honesty). No Undo/Summarize/Review rendered. Tokens-only color, weights 400/500, no monospace, no em dashes.

**Task 3 — nav/route/vocab collision + wiring + Home entry (routes.ts, vocabulary.ts, App.tsx, Home.tsx, Audit.tsx):** Added a new `/activity` route row carrying `nav.activity` (icon `Activity`), and re-pointed the existing `/audit` row to a new `nav.audit` vocab key, both kept in the intelligence section. Added `nav.audit` + `page.audit` terms; `nav.activity`/`page.activity` now describe the new surface. Wired `<Route path="/activity"><Activity /></Route>` in App.tsx with the import. Repointed Audit.tsx's `PageHeader` title from `page.activity` to `page.audit` so the technical view reads "Audit". Added a quiet one-click "What your team did" link beneath the NeedsYouCard in Home.tsx (muted text + chevron, accent on hover, `navigate('/activity')`) — understated, not a second loud card (D-03). The sidebar now resolves exactly one "Activity" item to the new surface.

## Verification

- `npx vitest run src/dashboard.contract.test.ts -t "activity"` — 4 passed (token gate, 200 rows array, tagged/no-secret shape, needsyou filter).
- `npx vitest run src/dashboard.contract.test.ts` full file — 95 passed, 2 pre-existing failures unrelated to this plan (see Deviations / Deferred).
- `npm run build` (vite + tsc) — clean after each of Tasks 2 and 3.
- `grep -c "vocabKey: 'nav.activity'" web/src/lib/routes.ts` — exactly 1 (only the /activity row); `/audit` carries `nav.audit`.
- Activity.tsx grep gates: fetches `/api/activity` (2 refs), 0 `font-mono`/`<table`, shared primitives present, 0 rendered Summarize/Undo/Review affordances, 0 em dashes, 0 raw hex literals.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Repointed Audit.tsx page title after the vocab split**
- **Found during:** Task 3
- **Issue:** `Audit.tsx` rendered its `PageHeader` title via `term('page.activity')`. Once the collision was resolved (page.activity now describes the new Activity surface), the technical Audit view would have shown the title "Activity", mislabeling it.
- **Fix:** Added a `page.audit` term and repointed Audit.tsx's title to it so the technical view honestly reads "Audit".
- **Files modified:** web/src/lib/vocabulary.ts, web/src/pages/Audit.tsx
- **Commit:** 575b2e6

**2. [Rule 2 - Hardening] Clamped the GET /api/activity limit**
- **Found during:** Task 1
- **Issue:** A raw `limit` query param flows into the read model. An unvalidated or hostile value could request an unbounded read.
- **Fix:** Parse `limit`, require a positive integer, clamp to a 500 ceiling, default 100. Mirrors the param-validation idiom used by the neighbouring routes.
- **Files modified:** src/dashboard.ts
- **Commit:** 4fba515

### Out of scope (deferred, not fixed)

- Two pre-existing contract-test failures ("auth gate > serves SPA shell at / / at /warroom without a token") fail on the unmodified HEAD too (verified by running the originals). They depend on `DASHBOARD_LEGACY`, which the contract harness does not set. Unrelated to the activity feed; logged in `deferred-items.md`. No 04-02 change touched these tests or the SPA-shell routes.

## Threat Surface

No new threat surface beyond the plan's `<threat_model>`. The endpoint inherits the existing token gate (T-04-auth) and returns only the curated plan-01 row projection (T-04-infodisc-resp); the contract test asserts both the 401 and the no-secret-field invariants. No new packages added (T-04-SC: slopcheck N/A).

## Notes for Downstream Plans

- Plan 03 (undo-executor + `POST /api/activity/:id/undo`) wires the Undo affordance into `Activity.tsx`; the row already carries the `undoable` flag and the View toggle, so Undo renders conditionally on `row.undoable` per the UI-SPEC interaction table.
- Plan 04 (Summarize) lands the "Summarize Today" button in the PageHeader `actions` slot (currently the subtitle node) and `POST /api/activity/summarize`.
- Manual visual verification (Activity unlike Audit, single sidebar Activity item, Home link reaches the feed) is deferred to the end-of-phase human-verify per config (`human_verify_mode: end-of-phase`).

## Self-Check: PASSED

- `web/src/pages/Activity.tsx` present on disk.
- Task commits 4fba515 (Task 1), 9d8534e (Task 2), 575b2e6 (Task 3) present in git history.
