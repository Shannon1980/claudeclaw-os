# 02 Onboarding (first run)

**Purpose:** get a non-developer from a fresh install to a working assistant with zero terminal, in
under five minutes and ~3 real decisions.

**When used:** once, on first launch of the desktop app. The operator is the design partner; build
this for yourself first to surface every friction point while you are the only one inconvenienced.

## Flow (6 steps)

A native wizard inside the Electron shell. Progress indicator across the top, single content area,
Back / Continue footer.

1. **Welcome.** Sets that it runs locally and the data stays put. Three plain value lines: runs in the
   background, reach it from Slack or your phone, your files and accounts never leave this machine. No
   action but Continue.

2. **Setting things up (automatic).** Runs silently: install the engine, set up Claude Code, start the
   background service. Checklist rows flip from spinner to check. **This is where the dependency
   landmine is handled invisibly** (see [foundations](01-foundations.md#the-dependency-landmine)). The
   user does nothing. Must have a visible failure-and-retry state per row, not just spinners; an
   unattended install that fails silently is the worst day-one outcome.

3. **Sign in to Claude.** One button: "Sign in with Claude." Opens the `claude login` browser OAuth
   once. Copy states it uses the existing Claude subscription, no API keys, no extra per-message cost.
   Show a clear signed-in confirmation. An "Use an API key instead" link sits below for the API-key
   path (D1). See the resolution below for which to recommend.

4. **Where do you want to talk to it?** Two cards: Slack (recommended) and Telegram. Picks the primary
   transport. The other can be added later. Behind each, the existing transport setup runs, but the
   token-paste / manifest steps must be replaced by OAuth-style connect flows for the product (see
   below).

5. **Connect your tools (optional, skippable).** Grid of connect cards: Gmail, Calendar, Drive. Clearly
   deferrable. Do not let this become a 12-app checklist; that reintroduces the wall. Skip is a
   first-class action.

6. **Done.** Confirms the assistant is running in the background and keeps working when the window is
   closed. Primary button opens the dashboard (Home, day-one state).

## Order rationale

- **Setup before sign-in** so the user's first real action is a single OAuth click, and any install
  failure surfaces before they have invested effort.
- **Subscription-default, both supported (see D1 resolution).** The happy path is subscription OAuth.
  The API-key path is one link away, not buried, because it is the more robust choice for the product's
  automated workloads.
- **Tools last and skippable** so the operator reaches a working assistant in three decisions
  (sign in, pick chat, done).

## What the mockup hides (real engineering)

- OAuth flows behind every connect button (Slack, Google). You, the developer, register the apps so
  the user never sees a manifest or pastes a token. This is the bulk of the work this screen implies.
- "Setting up Claude Code" is one calm line but is a download + version check + login handshake, each
  of which can fail. Build the retry/diagnostic states.

## Data / engine

- Reuses `scripts/setup.ts` logic (dependency checks, transport setup, service install) wrapped in
  native UI.
- Writes config that today lives in `.env` and `~/.claudeclaw/CLAUDE.md` into app-managed storage; the
  operator never edits those files directly.
- Login-item registration replaces the launchd/systemd/scheduled-task install.

## States

- First run only. After completion, the wizard never shows again; re-running individual steps
  (connect another tool, switch transport) happens in Settings.
- Partial completion: if the user quits mid-flow, resume where they left off on next launch.

## Open decisions

- **D1 (resolved):** support **both**, subscription-default. Onboarding leads with "Sign in with
  Claude" (subscription OAuth, no per-message cost). Ship an API-key path one link away and recommend
  it for users running heavy automation. Rationale: the product runs autonomous routines 24/7 and
  multi-agent deliberations, and (a) consumer subscription plans are not designed for sustained
  automated workloads, while (b) OAuth tokens are short-lived and not auto-refreshed when passed via
  env var, so a headless always-on service is more stable on an API key. Detect when subscription
  limits are being hit and prompt a switch to API billing.
- **Auth precedence (engine note, from the Claude API reference):** the resolution order is
  `explicit key > ANTHROPIC_API_KEY > ANTHROPIC_AUTH_TOKEN > OAuth profile`, and a stale
  `ANTHROPIC_API_KEY` silently overrides an OAuth login (this is the known stale-key crash-loop trap).
  Whichever path is active, the app must own this precedence so the two credentials never fight —
  surface the active auth source in Settings > Account.

## Cross-references

- Skipped tools reappear as the activation block on [Home](03-home.md) and in
  [Settings > Connected tools](07-permissions-settings.md).
- Transport choice feeds nothing else structurally; both transports share one command set.
