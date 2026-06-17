# Phase 7: Single Scheduler - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 7-single-scheduler
**Areas discussed:** Old-engine disable depth, Status/log parity, Job-runner agent identity, Sync lifecycle edge cases

---

## Old-engine disable depth

| Option | Description | Selected |
|--------|-------------|----------|
| Add CRON_IN_PROCESS gate now | Gate initCronScheduler() in command-centre/src/instrumentation.ts behind an env var so CC can boot without scheduling. Defense-in-depth before Phase 9. | ✓ |
| Doc-only, defer to Phase 9 | Rely on SCHEDULER-HANDOFF.md + keep CC server stopped; Phase 9 (CKPT-02) owns the CC code change. | |
| Both | Add the env gate now AND keep CC stopped. | |

**User's choice:** Add CRON_IN_PROCESS gate now (→ D-01).
**Notes:** PID daemon stays stopped regardless (D-02). The gate is the new code; keeping CC stopped is still implied.

---

## Status / log parity

| Option | Description | Selected |
|--------|-------------|----------|
| DB row + Slack only | last_run/last_status/last_result on dashboard + notify on_finish/on_failure; stop writing cron/status & cron/logs. Matches handoff. | ✓ |
| Also keep cron/status + logs files | Write legacy json/log files too, for backward-compat / Command Centre. | |
| DB+Slack now, file shim if needed | Ship DB+Slack; add a status/log file shim later only if Phase 9 needs it. | |

**User's choice:** DB row + Slack only (→ D-03).
**Notes:** Engine bookkeeping only — jobs whose prompts write their own output files keep doing so.

---

## Job-runner agent identity

| Option | Description | Selected |
|--------|-------------|----------|
| main fires, runs as aos via delegation | Single claimer (main) = no double-fire by construction; reuses the offline-agent mission-task pattern. (Recommended) | |
| Give aos its own scheduler loop | Stand up an aos standalone service with its own initScheduler. Second live claimer to coordinate. | ✓ |
| You decide | Let planning pick. | |

**User's choice:** Give aos its own scheduler loop (→ D-04). Chose against the recommendation.
**Notes:** Triggered a follow-up on the consequences (new launchd service + double-fire). See follow-ups below.

### Follow-up: aos service in scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, create the aos service | com.claudeclaw.aos launchd plist (symlinked WorkingDirectory, /tmp logs), aos runs standalone with its own initScheduler. | ✓ |
| No service — in-process loop only | Run an aos tick inside an existing process; re-opens how aos gets a process. | |
| Reconsider — main fires as aos | Fall back to single-claimer via delegation. | |

**User's choice:** Yes, create the aos service (→ D-05).

### Follow-up: no-double-fire guarantee

| Option | Description | Selected |
|--------|-------------|----------|
| Atomic claim + agent scoping | aos-cron scoped to agent_id='aos'; atomic UPDATE...WHERE status='active' backstop; main's offline-agent fallback skips aos when isAgentRunning('aos'). | ✓ |
| Atomic claim only | Rely solely on the atomic claim regardless of which process gets there first. | |
| You decide | Let planning/research settle it. | |

**User's choice:** Atomic claim + agent scoping (→ D-06).

---

## Sync lifecycle edge cases

| Option | Description | Selected |
|--------|-------------|----------|
| Sync all; deactivate orphans | Sync every job (inactive as dormant rows); deleted/renamed .md → row marked inactive, history preserved. | ✓ |
| Active only; hard-delete orphans | Only sync active jobs; remove rows for gone files. | |
| Sync all; never auto-remove | Sync everything; leave orphans for manual cleanup. | |

**User's choice:** Sync all; deactivate orphans (→ D-07).
**Notes:** cron/jobs/*.md stay the source of truth; DB rows are a derived projection, never written back. Metadata re-synced on startup, prompt body re-read at fire time.

## Claude's Discretion

- days→cron mapping table and the time/days parser (D-08).
- Exact new scheduled_tasks column names/set and the sync function shape (D-09).
- How the aos loop honors messageQueue single-flight.
- The CC gate env-var name/semantics (CRON_IN_PROCESS=0 suggested).
- How timeout/retry frontmatter map onto TASK_TIMEOUT_MS + run handling.

## Deferred Ideas

- Command Centre reading ClaudeClaw's SQLite + disabling CC engines — Phase 9 (CKPT-01/02).
- Deleting agentic-os dead cron code — v2 (CLN-01/02).
- Generalizing aos-cron sync to other workspace agents / multi-client crons — v2 (MC-01).
