# Roadmap: ClaudeClaw

## Milestones

- ✅ **v1.0 Agentic OS Consolidation** — Phases 1-7 (shipped 2026-06-19) — see [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- 🚧 **v2.0 Operator Product** — packaging, trust, and distribution: reframe ClaudeClaw into a local-first desktop product for business operators (see `specs/operator-product/`)

## Phases

<details>
<summary>✅ v1.0 Agentic OS Consolidation (Phases 1-7) — SHIPPED 2026-06-19</summary>

- [x] Phase 1: Afternoon Win — Point Agent at Workspace (completed 2026-06-14)
- [x] Phase 2: Skills Over Chat (completed 2026-06-15)
- [x] Phase 3: Skill Hardening (completed 2026-06-15)
- [x] Phase 4: Memory Source of Record (completed 2026-06-15)
- [x] Phase 5: Memory Projection & Capture (completed 2026-06-15)
- [x] Phase 6: memsearch Retirement (completed 2026-06-16)
- [x] Phase 7: Single Scheduler (completed 2026-06-19)

Full phase details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

### 🚧 v2.0 Operator Product

- [x] **Phase 1: Desktop Shell & Onboarding** - Zero-terminal install: Electron shell boots the service and drives Claude login/auth (completed 2026-06-23)
- [ ] **Phase 2: Routines** - Plain-language scheduled multi-step workflows the operator builds by describing
- [ ] **Phase 3: Permissions & Autonomy** - The four-tier autonomy model that gates every external action
- [ ] **Phase 4: Activity Feed** - Operator-facing transparency: what the team did, autonomous vs approved, with undo
- [ ] **Phase 5: Audit Log** - Admin-facing immutable, append-only, exportable record of every event
- [ ] **Phase 6: Memory Surface** - "What your assistant knows": editable, provenance-tagged knowledge base
- [ ] **Phase 7: Power Surfaces** - War room decision tool + live team pulse, reframed off the daily path
- [ ] **Phase 8: Billing & Licensing** - Flat per-seat subscription gated by a license key; spend-and-outcomes view

## Phase Details

### Phase 1: Desktop Shell & Onboarding
**Goal**: A non-technical operator can install ClaudeClaw by double-clicking an installer and reach a working dashboard with their Claude account connected, never touching a terminal.
**Depends on**: Nothing (gating prerequisite — the spec sequences this first: "until a non-developer can install and run it with no terminal, there is no product")
**Mode**: mvp
**Requirements**: PKG-01, PKG-02, PKG-03, PKG-04, PKG-05
**Success Criteria** (what must be TRUE):
  1. A user installs the app by double-clicking an installer and never opens a terminal
  2. Launching the app boots the existing Node service internally and opens the dashboard as the app window
  3. First run installs/sets up the Claude Code CLI and completes `claude login` inside the app (browser OAuth driven through an Electron window, no terminal)
  4. The user can sign in with their Claude subscription by default, with an API-key path one link away for heavy automation, and the app shows the active auth source (D1)
  5. The app registers as a login item and keeps running across reboots
**Plans**: 4 plans
Plans:
- [x] 01-01-PLAN.md — Auth-precedence/env helpers (tested) + setup-token spike (A1) + smoke checklist
- [x] 01-02-PLAN.md — Writable-state redirect, migration-before-fork, native-ABI rebuild in build
- [x] 01-03-PLAN.md — Native CLI installer + setup-token capture + auth precedence + login item
- [x] 01-04-PLAN.md — Sign/notarize/package the .dmg + clean-machine end-to-end smoke
**UI hint**: yes

### Phase 2: Routines
**Goal**: An operator can stand up multi-step work that runs on its own by describing it in plain language, then review, control, and trust its run history.
**Depends on**: Phase 1
**Mode**: mvp
**Requirements**: RTN-01, RTN-02, RTN-03, RTN-04, RTN-05
**Success Criteria** (what must be TRUE):
  1. A user creates a routine by describing it in plain language and the assistant assembles the ordered steps
  2. A routine runs multi-step work on a plain-language schedule with no cron syntax shown anywhere in the operator UI
  3. A user can review and edit a routine's ordered steps, each assigned to a named teammate
  4. A user can turn a routine on/off and run it now
  5. Run history shows success, degraded, and failed runs honestly, and the user is notified when a routine breaks or degrades
**Plans**: 4 plans
Plans:
- [ ] 02-01-PLAN.md — Wave 0 test scaffolding: failing tests pinning RTN-01..05 (deriveOutcome, claim-once, notify-transition, draft-no-persist)
- [ ] 02-02-PLAN.md — Slice A (data + engine): routine_steps/routine_runs tables + autonomy column (dual-write migration), routine-runner + scheduler branch
- [ ] 02-03-PLAN.md — Slice B (creation): routine-draft NL→steps assembler + /api/routines* CRUD/draft/run-now/history
- [ ] 02-04-PLAN.md — Slice C (UI): Routines page list/detail/builder + autonomy selector + route entry (human-verify)
**UI hint**: yes

### Phase 3: Permissions & Autonomy
**Goal**: An operator can set how much the team may do on its own through a single autonomy dial backed by the four-tier reversibility model, and every external action is checked against it before it runs.
**Depends on**: Phase 1
**Mode**: mvp
**Requirements**: PERM-01, PERM-02, PERM-03, PERM-04
**Success Criteria** (what must be TRUE):
  1. A user can set a global autonomy mode (Cautious / Balanced / Autonomous) and it changes what the team does unprompted
  2. A user can override individual actions between Always and Ask first
  3. Irreversible actions (send money, sign, delete) are visibly locked to Ask-first and cannot be set to Always in any mode (D4)
  4. A gated action is fully prepared and queued as a "Needs you" item for one-tap approval
**Plans**: TBD
**UI hint**: yes

### Phase 4: Activity Feed
**Goal**: An operator can glance at what the team did, see which actions ran autonomously vs were approved, and undo anything reversible — the transparency that makes autonomy safe to trust.
**Depends on**: Phase 3 (Permissions is the front half of the trust chain; Activity is the operator view of its outcomes)
**Mode**: mvp
**Requirements**: TRUST-01, TRUST-02
**Success Criteria** (what must be TRUE):
  1. A user sees a reverse-chronological activity feed of what the team did, in plain language, attributed by teammate
  2. Each item is tagged autonomous ("Ran on its own") vs approved ("You approved"), with held items tagged "Needs you"
  3. A user can undo a reversible action directly from the feed; irreversible actions show no undo (D9)
**Plans**: TBD
**UI hint**: yes

### Phase 5: Audit Log
**Goal**: An admin can open a complete, read-only, append-only technical record of every event and export it, closing the Permissions → action → Activity → Audit trace.
**Depends on**: Phase 4 (Audit is the technical back half of the same trust chain Activity surfaces; both read the same event stream)
**Mode**: mvp
**Requirements**: AUD-01, AUD-02
**Success Criteria** (what must be TRUE):
  1. An admin can view a complete, append-only audit log of every event with technical detail (tool, target, permission decision, result, duration, cost, session, model)
  2. The log is read-only — no delete, no silent dropping; uncaptured categories are stated rather than implied
  3. An admin can export the audit log as CSV/JSON
  4. Log retention is bounded by a configurable window and the window is stated (D10)
**Plans**: TBD
**UI hint**: yes

### Phase 6: Memory Surface
**Goal**: An operator can see, correct, and control what the assistant knows about them and their business, with every fact showing where it came from.
**Depends on**: Phase 3 (Memory feeds Permissions: preference-level facts inform autonomy defaults, so the permission model must exist for memory to feed it)
**Mode**: mvp
**Requirements**: MEM-01, MEM-02
**Success Criteria** (what must be TRUE):
  1. A user can view what the assistant knows about them, grouped by category (your business / your clients / how you like to work)
  2. Each fact shows its provenance ("You told me" / "Learned from your work" / "Learned from email")
  3. A user can edit or delete any fact in place, and a deleted fact is not silently re-derived
  4. A user can add a fact, and a prominent assurance states it is stored on this machine
**Plans**: TBD
**UI hint**: yes

### Phase 7: Power Surfaces
**Goal**: An operator can convene the team on a hard decision and get a converged recommendation, and see at a glance what the whole team is doing and where effort is going — both kept off the daily path.
**Depends on**: Phase 3 (war-room decisions write back as actions through the permission gate; pulse reconciles spend with the autonomy/work pipeline)
**Mode**: mvp
**Requirements**: PWR-01, PWR-02
**Success Criteria** (what must be TRUE):
  1. A user can convene multiple teammates on a hard decision and every session forces a synthesis card with decision buttons ("Go with this" / "Hold firm" / "Dig deeper")
  2. A war-room decision writes back as an action into the normal work pipeline and appears on Home and Activity
  3. A user can see live team status — who is active, how hard each teammate is working — and where today's effort went by project
**Plans**: TBD
**UI hint**: yes

### Phase 8: Billing & Licensing
**Goal**: An operator runs the product on a flat per-seat subscription gated by a license key, and sees spend and outcomes rather than token telemetry.
**Depends on**: Phase 1 (auth/account established in onboarding); informed by Phase 7 (pulse spend reconciles with billing)
**Mode**: mvp
**Requirements**: BILL-01, BILL-02
**Success Criteria** (what must be TRUE):
  1. A user runs the product on a flat per-seat subscription, gated by a valid license key
  2. The product blocks or degrades when the license is missing or invalid
  3. A user sees spend and outcomes ("142 tasks done, 6 routines running, $— this month"), not raw token telemetry, on a single billing screen
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Desktop Shell & Onboarding | 4/4 | Complete    | 2026-06-23 |
| 2. Routines | 4/4 | Executed (live checks pending) | 2026-06-23 |
| 3. Permissions & Autonomy | 0/? | Not started | - |
| 4. Activity Feed | 0/? | Not started | - |
| 5. Audit Log | 0/? | Not started | - |
| 6. Memory Surface | 0/? | Not started | - |
| 7. Power Surfaces | 0/? | Not started | - |
| 8. Billing & Licensing | 0/? | Not started | - |

## Backlog

### Deferred from v1.0 — Agentic OS Consolidation

Deferred 2026-06-22 when the project pivoted to the operator-product direction. These were planned
but never executed under v1.0. Revisit in a future milestone if the consolidation is resumed.

- **Per-Agent Soul** — Every agent gets its own SOUL.md (voice) separate from its role CLAUDE.md; workspace agent's soul aligns with agentic-os SOUL.md (was Phase 8)
- **Command Centre Repoint** — Command Centre reads ClaudeClaw SQLite through the decryption path; its own cron/memory engines disabled (was Phase 9)
- **Compatibility Verification** — Both modes proven working end-to-end, no default-fleet regression, full test suite green (was Phase 10)
