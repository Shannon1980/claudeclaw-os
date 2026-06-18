# 01 Foundations

Cross-cutting decisions every screen depends on. Read this before any screen spec.

## Distribution: local-first desktop app

The product's differentiator is that it runs the real Claude Code engine on a machine with the
user's own files, skills, and login. That is also what makes distribution hard. The chosen model is
the only one that keeps the differentiator while removing the terminal.

- **Execution stays local.** The Node service, SQLite store, and Claude subprocess run on the user's
  Mac. Their data never leaves the machine.
- **Cloud control plane is thin.** Auth/identity, the remote dashboard tunnel (existing Cloudflare
  Tunnel path), billing, and license validation. Nothing executes user work in the cloud.
- **Installer, not a clone.** A signed `.app` (then Windows/Linux) replaces `git clone`, `npm
  install`, `.env` editing, and launchd plists.

### Electron shell

Use Electron, not Tauri. The dashboard is already a Preact/Vite web app and the backend is heavy Node
(better-sqlite3 native module, subprocess spawning, Agent SDK). Electron runs the Node service in its
main process and loads the dashboard in the renderer with near-zero porting. Tauri would force the
Node backend to run as a sidecar for no benefit.

Shell responsibilities:
1. Launch with no terminal (double-click `.app`).
2. Bootstrap the existing Node service internally (no separate install step).
3. Open the dashboard as the app window.
4. First-run flow handles the Claude Code CLI install + `claude login` (see [onboarding](02-onboarding.md)).
5. Register as a login item so it persists across reboots (replaces the hand-managed launchd plist).
6. Native settings screens replace `.env` editing for account/integration config.

### The dependency landmine

The product spawns the real `claude` CLI, which today needs `npm i -g @anthropic-ai/claude-code` then
`claude login`. A non-developer cannot do either. The desktop app must **own this dependency**:
bundle or auto-install the CLI, and drive `claude login` (a browser OAuth flow) through an Electron
window. Solve this or the slickest installer still dead-ends at a terminal. This is the highest-risk
piece of the build; design the first-run flow around it.

### launchd note (carry-over from project CLAUDE.md)

The current launchd setup exits with code 78 when log paths contain spaces. The Electron login-item
registration replaces hand-written plists; if any plist is still generated, keep `StandardOutPath` /
`StandardErrorPath` free of spaces (use `/tmp/` or `~/Library/Logs/`). `WorkingDirectory` tolerates
spaces.

## Auth and model selection (cross-cutting)

Grounded in the current Claude API reference; affects onboarding, billing, and the Team "brain" picker.

**Auth (D1 resolved).** Support both subscription OAuth (`claude login`) and API keys; default
onboarding to subscription. Two engine facts drive this:
- Resolution order is `explicit key > ANTHROPIC_API_KEY > ANTHROPIC_AUTH_TOKEN > OAuth profile`. A
  stale `ANTHROPIC_API_KEY` silently wins over an OAuth login — the known crash-loop trap. The app
  must own precedence and show the active source in Settings > Account.
- OAuth tokens are short-lived and not auto-refreshed when passed via env var. Fine interactively;
  fragile for an always-on headless service. Recommend API keys for users running heavy automation,
  and detect/prompt when subscription limits are hit.

**Model tiers (the "brain" picker, [Team](05-team.md)).** Map teammate/routine work to the cheapest
model that fits, reserve the expensive tier for genuine deliberation:
- **Routine teammate work and routines** (drafting, triage, summaries, scheduled jobs): Sonnet 4.6
  (balanced) or Haiku 4.5 (fastest/cheapest). This is most of the volume.
- **Deliberation and hard reasoning** ([War room](10-war-room-and-pulse.md), complex analysis):
  Opus 4.8 (default), the most capable Opus-tier model.
- Relative cost per million tokens at time of writing: Haiku 4.5 $1/$5, Sonnet 4.6 $3/$15, Opus 4.8
  $5/$25. War room convening N Opus teammates is the most expensive action in the product (D12).

## Vocabulary

Single source of truth in [README](README.md#vocabulary-internal-to-operator-facing). Enforce it in a
shared i18n/string map so the operator product and a possible builder/advanced mode can swap labels
without forking screens. No screen ships the word "agent," "cron," "MCP," "delegation," or "salience"
in operator-facing copy.

## Design system

Inherit the existing Preact dashboard system. Rules that matter for product polish:

- **Flat, clean, sentence case.** No gradients/shadows. Headings and labels only in medium weight.
- **One vocabulary, one color language for teammates.** Fixed per-teammate accent colors used
  everywhere they appear (Research purple, Comms teal, Content coral, Ops amber, Assistant gray).
  This is what makes attribution legible across Home, Team, Routines, Activity, Pulse.
- **Progressive disclosure.** Operator depth on the surface, builder depth in drawers/advanced
  toggles. Applied on Team (settings drawer), Permissions (per-action overrides), Routines (raw cron).
- **Status pills, on/off toggles, honest history.** Reused on Team, Routines, Projects, Activity.
- **Dark mode mandatory.** Use CSS variables, never hardcoded colors.

## Autonomy / permission model (cross-cutting)

The most important cross-cutting system. Full UI in [07](07-permissions-settings.md); the model
itself is referenced by Home, Routines, Activity, Audit, and Memory.

- **Global autonomy mode**: Cautious / Balanced (default) / Autonomous.
- **Per-action overrides**: each capability is `Always` or `Ask first`.
- **Four action tiers by reversibility (D4, resolved).** Tier 1 read & prepare (always silent), Tier 2
  low-stakes external, Tier 3 consequential external, Tier 4 irreversible (locked). Modes shift the
  line between tiers 1/2/3; Tier 4 is fixed. Full table and mode definitions in
  [07-permissions-settings.md](07-permissions-settings.md#action-tiers-d4-resolved).
- **Permission tier tracks undo-ability.** Reversible actions may default to `Always`; irreversible
  ones default to `Ask first` or locked. Anything that cannot be undone must not be silently
  automated.
- **Every action checks the rule, logs the decision, and either proceeds, queues for approval, or is
  blocked.** Queued actions surface as "Needs you" on Home and as held entries in Activity.

This gate sits at the Agent SDK tool-call layer: before any tool that performs an external/irreversible
action runs, it consults the permission model.

## Trust chain (cross-cutting)

Permissions (rules) -> action -> Activity (operator view) -> Audit (technical truth), with Memory
feeding the rules. Each surface references the same event IDs so an operator or admin can trace any
outcome end to end. Do not build these as four unrelated pages.
