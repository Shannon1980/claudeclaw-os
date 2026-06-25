# Phase 5: Audit Log - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-24
**Phase:** 5-audit-log
**Areas discussed:** Capture completeness, Retention (D10), Export (CSV/JSON), Surface & placement

---

## Capture completeness — Data model

| Option | Description | Selected |
|--------|-------------|----------|
| Enrich audit_log schema | Add real columns (event_type, target, project_id, outcome, duration_ms, cost_usd, session_id, model); old rows NULL/honestly flagged | ✓ |
| Derive read-side via joins | Keep thin table; join token_usage + parse detail JSON at read time | |
| Hybrid | Add only columns with no source; join token_usage for cost/duration/model/session | |

**User's choice:** Enrich audit_log schema
**Notes:** Cleanest queries and export; pre-capture rows shown as "not captured before vN," not zeroed.

## Capture completeness — Coverage

| Option | Description | Selected |
|--------|-------------|----------|
| All four, real capture | Add capture sites so Actions, Permissions, Auth, Errors all genuinely log | ✓ |
| Permissions+Actions now, rest stated | Capture existing flows; banner the uncaptured Auth/Errors | |
| All four, but Auth/Errors best-effort | Wire all four; label specific gaps inline where capture is partial | |

**User's choice:** All four, real capture
**Notes:** New write sites in scope for Auth (login/token refresh) and Errors (tool failures, recovered timeouts).

## Capture completeness — No-drop integrity

| Option | Description | Selected |
|--------|-------------|----------|
| Record the gap | Counter / "audit-write-failed" marker so the log surfaces possible misses | |
| Surface in UI banner | Same tracking plus a prominent integrity-warning banner when failures > 0 | ✓ |
| Leave as-is | Treat as rare; no tracking (violates no-silent-dropping) | |

**User's choice:** Surface in UI banner
**Notes:** Fixes the silent `catch` in `src/security.ts:111`; operations stay non-blocking.

---

## Retention (D10) — Window

| Option | Description | Selected |
|--------|-------------|----------|
| 90 days, hard prune | Delete oldest past 90 days (stated, configurable policy) | |
| 90 days full, then archive | Keep 90 days live; roll older rows into on-disk archive, nothing deleted | ✓ |
| 180 days, hard prune | Longer default, same hard-prune behavior | |

**User's choice:** 90 days full, then archive
**Notes:** Nothing lost — archive over delete.

## Retention (D10) — Config UI

| Option | Description | Selected |
|--------|-------------|----------|
| Settings + header line | Configurable in Settings>Security and stated inline in the Audit page header | ✓ |
| Settings only | Configurable but not restated on the Audit page | |
| Config file only | Set via config value, no dedicated UI this phase | |

**User's choice:** Settings + header line
**Notes:** Promise stated where the data is read.

## Retention (D10) — Archive reachability

| Option | Description | Selected |
|--------|-------------|----------|
| Export-only | Archived events not in live table but includable in export | |
| Queryable on demand | A load-archived toggle / date-range reads archive back into the view | ✓ |
| Sealed archive | Written for safekeeping but neither shown nor exported this phase | |

**User's choice:** Queryable on demand
**Notes:** Archive is not a dead end; live view stays bounded by default.

---

## Export (CSV/JSON)

| Option | Description | Selected |
|--------|-------------|----------|
| Current filter, browser download | Reflects active filters/range, include-archived option, browser download | ✓ |
| Whole log always | Ignores filters; always dumps complete log | |
| Both, admin picks | Export dialog for scope + format + include-archive | |

**User's choice:** Current filter, browser download
**Notes:** WYSIWYG export matching the investigative use; both CSV and JSON (locked by criteria).

---

## Surface & placement

| Option | Description | Selected |
|--------|-------------|----------|
| Under Settings>Security | Move off main nav into a Security/admin Settings section (spec-faithful) | ✓ |
| Keep top-level /audit | Leave route in nav, just formalize page contents | |
| Settings entry, same route | Keep /audit route, remove from nav, link from Settings | |

**User's choice:** Under Settings>Security
**Notes:** Audit is an admin tool opened deliberately, not a daily-glance surface.

---

## Claude's Discretion

- Final column set/types for enriched `audit_log` (validated against token_usage / approval_queue / encoded detail).
- Archive file format and location; prune/archive job on the existing single scheduler (no second cron path).
- Event-type taxonomy mapping (AuditAction → the four UI chips).
- Settings>Security sub-route shape, page layout, empty/loading states, pagination vs infinite scroll.
- Export endpoint shape (streaming vs in-memory), filename convention.
- Whether the demoted `/audit` route is removed or kept as an internal redirect.

## Deferred Ideas

- Enterprise security wrapper (SSO-gated access, compliance export formats, tamper-evidence/hash-chaining).
- Admin vs operator access control beyond the dashboard token ("who is an admin").
- Per-project filter chip for Audit (project_id captured this phase; chip folds in with Projects work).
- Configurable archive destinations (external storage / log shipping) — local on-disk only this phase.
