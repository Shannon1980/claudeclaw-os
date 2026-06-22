# Phase 1: Desktop Shell & Onboarding - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Source:** Operator-product specs (specs/operator-product/) — design contract is settled

<domain>
## Phase Boundary

Deliver the zero-terminal desktop front door for ClaudeClaw. A non-technical operator installs a
desktop app by double-clicking an installer, the app boots the existing Node service internally and
opens the dashboard as its window, and first-run handles the Claude Code CLI install + `claude login`
and connects the operator's Claude account — all without a terminal. The app persists across reboots.

In scope: the Electron shell wrapping the existing service, the first-run onboarding flow (welcome →
auto setup → sign in → pick chat → connect tools → done), auth (D1), login-item registration.

Out of scope this phase: OAuth connect-buttons for every integration, billing/licensing (Phase 8),
the operator UI reframe of secondary screens, managed cloud-box hosting.
</domain>

<decisions>
## Implementation Decisions

### Distribution & shell (LOCKED — from 01-foundations.md)
- Local-first desktop app. Execution stays on the user's machine; cloud control plane is thin.
- **Electron, not Tauri** — the dashboard is already Preact/Vite and the backend is heavy Node
  (better-sqlite3 native, subprocess spawning, Agent SDK). Electron runs the Node service in its main
  process and loads the dashboard in the renderer with near-zero porting.
- Shell responsibilities: launch with no terminal; bootstrap the existing Node service internally;
  open the dashboard as the app window; first-run install + login; register as a login item.

### The dependency landmine (LOCKED)
- The product spawns the real `claude` CLI. The desktop app must OWN this dependency: bundle or
  auto-install the Claude Code CLI, and drive `claude login` (browser OAuth) through an Electron
  window. This is the highest-risk piece — first-run must surface failure-and-retry states per step,
  not just spinners.

### Auth — D1 (LOCKED)
- Support BOTH subscription OAuth ("Sign in with Claude") and API keys; default onboarding to
  subscription OAuth, with the API-key path one link away (recommended for heavy automation).
- The app must OWN auth precedence: resolution order is
  `explicit key > ANTHROPIC_API_KEY > ANTHROPIC_AUTH_TOKEN > OAuth profile`, and a stale
  `ANTHROPIC_API_KEY` silently overrides an OAuth login (known crash-loop trap). Surface the active
  auth source in Settings > Account.

### Onboarding order (from 02-onboarding.md)
- Six steps: welcome → setting things up (auto: engine + Claude Code install) → sign in to Claude →
  where to talk to it (Slack recommended / Telegram) → connect tools (optional, skippable) → done.
- Setup runs before sign-in so the first real action is one OAuth click and install failures surface
  early. Tools step is skippable; never a 12-app wall.

### launchd / login-item (project constraint)
- Register as a login item so the service persists across reboots (replaces hand-managed launchd
  plists). If any launchd plist is still generated, keep `StandardOutPath`/`StandardErrorPath`
  free of spaces (use `/tmp/` or `~/Library/Logs/`) — launchd exits 78 on spaces in log paths.
  `WorkingDirectory` tolerates spaces.

### Claude's Discretion
- Electron project layout, build/packaging tooling (electron-builder vs forge), code-signing/notarization specifics.
- Exact mechanism for bundling vs auto-installing the Claude Code CLI; where the OAuth window is hosted.
- Service-bootstrap lifecycle (spawn vs in-process), health checks, crash recovery.
- IPC between renderer (dashboard) and main (service), and how the existing Hono server is reached.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Operator-product design contract
- `specs/operator-product/01-foundations.md` — distribution decision, Electron rationale, the dependency landmine, auth (D1) + precedence, model tiers, the launchd note. The authoritative source for the shell.
- `specs/operator-product/02-onboarding.md` — the 6-step first-run flow, order rationale, what the mockup hides (OAuth flows are the real engineering), data/engine mapping, D1 resolution.
- `specs/operator-product/README.md` — build sequence (this phase gates everything), vocabulary, distribution decision.

### Existing engine to wrap (read for integration points)
- `scripts/setup.ts` — the current setup wizard logic to wrap in native first-run UI.
- `src/dashboard.ts` + `web/` — the Hono server + Preact dashboard the Electron window loads.
- `src/agent.ts` / `src/agent-config.ts` — how the service spawns the `claude` CLI (auth surface).
- `launchd/` — current persistence mechanism the login-item registration replaces.
- `.planning/codebase/` — STACK, ARCHITECTURE, STRUCTURE, INTEGRATIONS, CONCERNS maps.
</canonical_refs>

<specifics>
## Specific Ideas

- The first-run flow is mocked in the design conversation; treat the 6-step sequence as the target UX.
- "Setting things up" must own the Claude Code install/login handshake invisibly, with visible retry on failure.
- Sign-in copy: "uses your existing Claude subscription, no API keys, no extra per-message cost"; API-key path behind an "Use an API key instead" link.
</specifics>

<deferred>
## Deferred Ideas

- OAuth connect-buttons for Slack/Google beyond the initial transport pick (later phase).
- Billing/licensing gating — Phase 8.
- Windows/Linux installers — Mac-first; design so the shell is portable but ship Mac first.
- Managed cloud-box hosting tier — Future Requirements.
</deferred>

---

*Phase: 01-desktop-shell-onboarding*
*Context gathered: 2026-06-22 from operator-product specs (design contract settled)*
