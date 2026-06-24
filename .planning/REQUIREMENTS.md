# Requirements: v2.0 Operator Product

**Milestone:** v2.0 — Operator Product
**Defined:** 2026-06-22
**Source:** `specs/operator-product/` (README.md is the PRD; per-surface specs 01-10)
**Locked decisions:** D1 (auth: both subscription OAuth + API key, subscription-default), D4 (autonomy: four action tiers, irreversible tier locked)

## Already Delivered (pre-GSD tracking — context only)

Shipped to `main` before this milestone existed; not re-scoped here:
- Onboarding first-run flow
- Home daily-loop (web + backend)
- Projects (scoped daily loop)
- Team roster (operator-facing agent management)

## v2.0 Requirements

### Packaging & Distribution (PKG)
- [x] **PKG-01**: A non-technical user can install ClaudeClaw as a desktop app by double-clicking an installer, with no terminal
- [x] **PKG-02**: The desktop app boots the existing Node service internally and opens the dashboard as its window
- [x] **PKG-03**: First run installs/sets up the Claude Code CLI and completes `claude login` without the user using a terminal
- [x] **PKG-04**: The app registers as a login item and keeps running across reboots
- [x] **PKG-05**: A user can authenticate with their Claude subscription (OAuth) by default, with an API-key path available for heavy automation (D1)

### Routines (RTN)
- [x] **RTN-01**: A user can create a routine by describing it in plain language; the assistant assembles the steps
- [x] **RTN-02**: A routine runs multi-step work on a plain-language schedule with no cron syntax shown in the operator UI
- [x] **RTN-03**: A user can review and edit a routine's ordered steps, each assigned to a named teammate
- [x] **RTN-04**: A user can turn a routine on/off and run it now
- [x] **RTN-05**: Routine run history shows success, degraded, and failed runs honestly, and the user is notified when a routine breaks or degrades

### Permissions & Autonomy (PERM)
- [x] **PERM-01**: A user can set a global autonomy mode (Cautious / Balanced / Autonomous)
- [x] **PERM-02**: A user can override what the team may do per action (Always / Ask first)
- [x] **PERM-03**: Irreversible actions (send money, sign, delete) are locked to Ask-first and cannot be set to Always in any mode (D4)
- [x] **PERM-04**: A gated action is prepared and queued as a "Needs you" item for one-tap approval

### Activity & Audit (TRUST)
- [x] **TRUST-01**: A user can see an activity feed of what the team did, each item tagged autonomous vs approved
- [x] **TRUST-02**: A user can undo a reversible action from the activity feed (D9)
- [ ] **AUD-01**: An admin can view a complete, read-only, append-only audit log of every event with technical detail
- [ ] **AUD-02**: An admin can export the audit log (CSV/JSON); log retention is bounded and configurable (D10)

### Memory (MEM)
- [ ] **MEM-01**: A user can view what the assistant knows about them, grouped by category
- [ ] **MEM-02**: Each remembered fact shows its provenance and can be edited or deleted in place

### Power Surfaces (PWR)
- [ ] **PWR-01**: A user can convene multiple teammates on a hard decision and get a converged recommendation with decision buttons (war room)
- [ ] **PWR-02**: A user can see live team status and where the team's effort is going (team pulse)

### Billing & Licensing (BILL)
- [ ] **BILL-01**: A user runs the product on a flat per-seat subscription, gated by a license key
- [ ] **BILL-02**: A user sees spend and outcomes (not token telemetry) in billing

## Future Requirements (deferred)

- Managed cloud-box hosting tier (premium "done-for-you" deployment)
- OAuth connect-buttons for every integration beyond the initial set
- Formal enterprise security audit surface (SSO-gated access, tamper-evidence) — build when going upmarket

## Out of Scope

- Hosted SaaS execution — kills the local-first differentiator and adds liability/compute cost
- Metered/usage-based pricing — incompatible with local-first compute the vendor doesn't pay for
- Developer-facing toys as primary surfaces (3D brain graph, raw token telemetry, memory-decay viz) — Labs only

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| PKG-01 | Phase 1 | Complete |
| PKG-02 | Phase 1 | Complete |
| PKG-03 | Phase 1 | Complete |
| PKG-04 | Phase 1 | Complete |
| PKG-05 | Phase 1 | Complete |
| RTN-01 | Phase 2 | Complete |
| RTN-02 | Phase 2 | Complete |
| RTN-03 | Phase 2 | Complete |
| RTN-04 | Phase 2 | Complete |
| RTN-05 | Phase 2 | Complete |
| PERM-01 | Phase 3 | Complete |
| PERM-02 | Phase 3 | Complete |
| PERM-03 | Phase 3 | Complete |
| PERM-04 | Phase 3 | Complete |
| TRUST-01 | Phase 4 | Complete |
| TRUST-02 | Phase 4 | Complete |
| AUD-01 | Phase 5 | Pending |
| AUD-02 | Phase 5 | Pending |
| MEM-01 | Phase 6 | Pending |
| MEM-02 | Phase 6 | Pending |
| PWR-01 | Phase 7 | Pending |
| PWR-02 | Phase 7 | Pending |
| BILL-01 | Phase 8 | Pending |
| BILL-02 | Phase 8 | Pending |
