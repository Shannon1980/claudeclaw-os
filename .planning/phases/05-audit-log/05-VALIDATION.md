---
phase: 5
slug: audit-log
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-25
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `05-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^2.0.0 (already installed) |
| **Config file** | `vitest` block in root `package.json` |
| **Quick run command** | `npx vitest run src/db.test.ts src/gate.test.ts src/dashboard.contract.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds (quick) / full suite varies |
| **Contract harness** | `src/dashboard.contract.test.ts` uses `_initTestDatabase()` + Hono `app.request(path + '?token=' + TOKEN)` — no real port |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/db.test.ts src/gate.test.ts src/dashboard.contract.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite green + `npm run migrate` dry-run applies `v1.2.4` idempotently
- **Max feedback latency:** ~30 seconds (quick command)

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| AUD-01 | New `audit_log` columns exist in BOTH test DB and `v1.2.4` migration (P-4 dual-write) | unit | `npx vitest run src/migrations.test.ts -t "audit"` | ❌ W0 (extend `migrations.test.ts`) |
| AUD-01 | `insertAuditLog` persists + filtered reader returns new fields | unit | `npx vitest run src/db.test.ts -t "audit"` | ❌ W0 (add to `db.test.ts`) |
| AUD-01 | Permission decision records enriched detail (tool/target/result/duration); no secrets in detail/target | unit | `npx vitest run src/gate.test.ts` | ✅ extend (`gate.test.ts:146` "audit recorded", `:184` no-secrets) |
| AUD-01 | New event types emit (`auth` / `routine` / `error`) | unit | `npx vitest run src/routine-runner.test.ts src/message-core.test.ts` | ✅ extend |
| AUD-01 | `/api/audit` returns enriched rows + cost via LEFT JOIN token_usage + honest NULLs | contract | `npx vitest run src/dashboard.contract.test.ts -t "audit"` | ✅ extend |
| AUD-01 | NULL fields surface as "not captured" (never blank); honest type chips | component/manual | UI render check | manual-only (no headless web test infra) |
| AUD-02 | `/api/audit/export` returns FULL filtered set (not page-capped), CSV + JSON, `Content-Disposition` | contract | `npx vitest run src/dashboard.contract.test.ts -t "export"` | ❌ W0 |
| AUD-02 | CSV serializer RFC-4180 + formula-injection safe (comma/quote/newline/leading `=`+`-`@`) | unit | `npx vitest run src/audit-export.test.ts` (or `db.test.ts -t "csv"`) | ❌ W0 |
| AUD-02 | Retention window get/set + default 90; displayed value reads config | unit | `npx vitest run -t "retention"` | ❌ W0 |
| AUD-02 | No `DELETE FROM audit_log` anywhere (append-only invariant) | unit/grep | assert no DELETE on audit_log in `src/`; CRUD test inserts only | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/migrations.test.ts` — assert `v1.2.4` registered in `version.json` + idempotent apply (AUD-01 schema, P-4 dual-write)
- [ ] `src/db.test.ts` — audit insert/read with new fields; cost LEFT JOIN; the "no DELETE on audit_log" invariant
- [ ] `src/audit-export.test.ts` (new) OR extend `db.test.ts` — CSV RFC-4180 + formula-injection cases; JSON envelope shape
- [ ] `src/dashboard.contract.test.ts` — `/api/audit` enriched rows + `/api/audit/export` full-set + `Content-Disposition` headers + `format` validation
- [ ] Retention get/set unit test — default 90, input validation
- [ ] Framework install: **none** — Vitest already present

*Framework is installed; Wave 0 is test-stub authoring only.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| NULL fields render as faint "not captured", never a blank cell | AUD-01 | No headless web test harness in this repo | Open the relocated Audit surface; expand a pre-migration row; confirm uncaptured fields show "not captured" |
| Honest type chips: not-yet-captured types are disabled with a footnote | AUD-01 | Same — UI render | Confirm only event types present in data are enabled; others disabled + footnoted |
| Audit surface is dense/technical and visually unlike Activity | AUD-01 | Visual judgment | Compare `/audit` (mono, dense) vs `/activity` (cards) side by side |
| Export downloads the complete filtered set as a file | AUD-02 | File download is browser-mediated | Apply filters, click Export log → CSV/JSON; confirm row count matches the filtered set, not the page |
| Stated retention line ("Retaining 90 days") is visible | AUD-02 | UI render | Confirm header shows the configured window |

*Flag these for the end-of-phase human-verify checkpoint.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`vitest run`, never `vitest` watch)
- [ ] Feedback latency < ~30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
