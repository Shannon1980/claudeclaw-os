# Phase 1: Afternoon Win — Point Agent at Workspace - Research

**Researched:** 2026-06-14
**Domain:** ClaudeClaw agent-runtime config / Claude Agent SDK `cwd` + `settingSources` / agentic-os workspace integration
**Confidence:** HIGH

## Summary

The "afternoon win" is mostly already built. ClaudeClaw's `agent.yaml` already supports a `project_dir` key, `loadAgentConfig` already parses it, and `resolveAgentRuntime` already resolves it to the SDK `cwd` — with an existing passing test (`projdir` case in `src/agent-config.test.ts`). The SDK is invoked with `settingSources: ['project','user']`, and the installed SDK (v0.2.50) documents that `'project'` loads `.claude/settings.json` AND `CLAUDE.md` from `cwd`. So pointing an agent at `/Users/shannongueringer/App Repo/agentic-os` will auto-load that repo's `CLAUDE.md` (which `@AGENTS.md`-imports the 27 KB `AGENTS.md`) and its 23 `.claude/skills/`. WS-01 and WS-02 are therefore close to "configure, don't build."

The real work in this phase is **de-risking the side effects**, not wiring the cwd. Three concrete, verified gotchas: (1) `settingSources:['project']` also loads agentic-os's `.claude/settings.json` **hooks**, which fire under headless SDK runs (SessionStart, UserPromptSubmit, Stop, PostToolUse, PreToolUse — including git auto-commit and Command-Centre board sync). (2) Under `permissionMode: 'bypassPermissions'`, **deny rules in the loaded project settings still win** (official docs: "Deny always wins") — agentic-os denies `Bash(curl *)`, `Bash(rm *)`, and `Read(.env)`, which will silently block some skills. (3) ClaudeClaw's `getScrubbedSdkEnv` strips every `*_API_KEY`/`*_TOKEN` from the SDK subprocess env, so skills expecting `FIRECRAWL_API_KEY`/`GEMINI_API_KEY` in `process.env` won't see them (they read the workspace `.env` via Bash instead — which the deny rule then blocks). Most of these land squarely in Phase 2/3 (SK-04 graceful degradation), but the planner must scope WS-03 narrowly: prove an on-brand text skill (e.g. `mkt-copywriting`, which is pure text + `brand_context` reads, no external API, no Downloads) end-to-end over chat, and explicitly defer API/file-output skills.

There is **no system-prompt conflict to fear yet**, but the planner should understand the actual mechanism (below) because it directly shapes WS-02 and pre-stages Phase 8. ClaudeClaw does **not** pass the agent's `CLAUDE.md` to the SDK `systemPrompt` option. It prepends it as a `[Agent role — follow these instructions]` block onto the **first** user message of a session, while the SDK separately loads the **cwd's** `CLAUDE.md` as project context. So with a repointed agent both stack additively: the ClaudeClaw agent's role text + agentic-os's `CLAUDE.md`/`AGENTS.md`. That is fine for this phase; the duplication/identity question is a Phase 8 (IDENT/SOUL) concern.

**Primary recommendation:** Create a NEW dedicated workspace agent (e.g. `workspace` or `aios`) in `~/.claudeclaw/agents/<id>/` with a minimal `agent.yaml` (`project_dir: "/Users/shannongueringer/App Repo/agentic-os"`, its own Slack channel, an MCP allowlist that includes any workspace MCPs), rather than repointing an existing named fleet agent. Verify WS-03 with `mkt-copywriting` over the agent's Slack channel. Document the setup in `docs/` for WS-04. Do not touch `getScrubbedSdkEnv`, the deny list, or hook behavior in this phase — surface them as known constraints for Phase 2/3.

## User Constraints (from CONTEXT.md)

No CONTEXT.md exists for this phase (verified: no `*-CONTEXT.md` in the phase dir). This phase has not been through `/gsd-discuss-phase`, so there are no locked decisions. The planner has full discretion within the requirements (WS-01..WS-04) and the project-level decisions in `PROJECT.md`. Relevant standing project decisions that constrain this phase:

- ClaudeClaw is the host; agentic-os is the consumed workspace — point an agent's `project_dir` at it; the SDK `settingSources:['project','user']` auto-loads its context + skills. (PROJECT.md Key Decisions)
- Both modes (terminal Claude Code session in the workspace AND the chat bot) must keep working after every phase. (COMPAT-01/02, PROJECT.md Constraints)
- The existing test suite must pass after this phase's changes. (COMPAT-03)
- Schema changes go through versioned migrations — not relevant here (no DB change in Phase 1).
- Fleet lives in `CLAUDECLAW_CONFIG/agents/<id>/` (default `~/.claudeclaw/agents/`): Bertha, forge, samantha, sentinel, skylar. The repo `agents/` (comms, content, ops, research, _template) are templates. (PROJECT.md)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WS-01 | A ClaudeClaw agent configurable with `project_dir` → agentic-os repo, runs Claude Code with that dir as the SDK cwd | Already implemented + tested. `agent.yaml` `project_dir` → `loadAgentConfig` (agent-config.ts:166) → `resolveAgentRuntime` cwd (agent-config.ts:208-226) → `runAgent({ cwd })` (agent.ts:226,248). Existing test `projdir` in agent-config.test.ts:54-57. Plan = configure an agent.yaml + verify cwd is honored end to end. |
| WS-02 | Pointed at the workspace, agent auto-loads its CLAUDE.md/AGENTS.md via SDK `settingSources` | SDK v0.2.50 doc (sdk.d.ts:820-826): "Must include 'project' to load CLAUDE.md files." `settingSources:['project','user']` is hard-set in agent.ts:254. agentic-os `CLAUDE.md` `@AGENTS.md`-imports the 27 KB `AGENTS.md`. Verify: agent demonstrably follows an agentic-os-only rule (e.g. silent-startup ritual, skill registry awareness). |
| WS-03 | Loads `brand_context/` when a skill requests it, producing on-brand output over chat | Skills declare a "Context Needs" table that lazy-loads `brand_context/voice-profile.md`, `positioning.md`, `icp.md`, `samples.md` (verified in `mkt-copywriting/SKILL.md`). Verify: invoke `mkt-copywriting` over Slack/Telegram; confirm output matches `voice-profile.md` (no em dashes, no AI clichés). Use a text-only skill to avoid the API-key/deny-list/Downloads pitfalls below. |
| WS-04 | Documented, reproducible repoint at any workspace without reading source | Write a short guide in `docs/` (existing dir; e.g. `docs/workspace-agent-setup.md`): the `agent.yaml` keys (`project_dir`, `slack_channel`, optional `mcp_servers`/`model`), where it lives (`~/.claudeclaw/agents/<id>/`), and the known headless caveats (hooks fire, deny-list applies, secrets are scrubbed). |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Resolve `project_dir` → SDK cwd | ClaudeClaw config layer (`agent-config.ts`) | — | Already the owner; `resolveAgentRuntime` is the single resolution point. |
| Load workspace CLAUDE.md/AGENTS.md/skills | Claude Agent SDK subprocess (via `settingSources:['project']`) | agentic-os workspace files | The SDK reads `cwd/.claude` + `cwd/CLAUDE.md`; ClaudeClaw only sets cwd. |
| Inject ClaudeClaw agent "role" prompt | ClaudeClaw message layer (`message-core.ts`) | — | Prepended as `[Agent role]` text to message 1, NOT via SDK systemPrompt. |
| Lazy-load `brand_context/` | Skill logic running inside the SDK subprocess | agentic-os `brand_context/*.md` | Skills' "Context Needs" tables drive this at runtime; no ClaudeClaw code involved. |
| Route a chat to the workspace agent | ClaudeClaw transport (`slack-bot.ts` channel map / `@agentId:`) | `message-core.ts` | `slack_channel` in agent.yaml routes a channel to the agent; runtime is cached. |
| Deliver on-brand output to chat | ClaudeClaw transport (Slack/Telegram) | `message-core.ts` result handling | The SDK `result` text is split + posted; no change needed for text output. |

## Standard Stack

No new packages. This is a brownfield config + documentation phase using the existing stack.

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | 0.2.50 installed (`^0.2.34` in package.json) | Spawns `claude` CLI subprocess; honors `cwd`, `settingSources`, `permissionMode`, `mcpServers` | Already the engine; no alternative in scope. [VERIFIED: node_modules/@anthropic-ai/claude-agent-sdk/package.json] |
| `js-yaml` | (installed) | Parses `agent.yaml` | Already used by `loadAgentConfig`. [VERIFIED: agent-config.ts:3] |
| `vitest` | ^2.0.0 | Test runner (`npm test` → `vitest run`) | Existing suite; COMPAT-03 requires it green. [VERIFIED: package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New dedicated workspace agent | Repoint an existing named fleet agent (e.g. skylar) | See Open Question 1 — surfaced, not decided. New agent is lower-risk (no regression to a live agent's behavior, no Slack-channel reshuffle), at the cost of one more agent dir + token/channel. |

**Installation:** None.

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. (Confirmed: WS-01..WS-04 are satisfied by existing code + config + docs.)

## Architecture Patterns

### System Architecture Diagram (chat turn for a workspace-pointed agent)

```
Slack/Telegram message
        │
        ▼
[slack-bot.ts] channel map ──► targetAgent? ──► getRoutedRuntime(agentId)
        │                                              │
        │                                              ▼
        │                                  [agent-config.ts] resolveAgentRuntime(id)
        │                                   ├─ loadAgentConfig: reads agent.yaml
        │                                   │    project_dir, model, mcp_servers, slack_channel
        │                                   ├─ cwd = project_dir (if exists) else agent's own dir
        │                                   ├─ systemPrompt = agent's CLAUDE.md (read from disk)
        │                                   └─ mcpAllowlist = agent.yaml mcp_servers
        │                                              │
        ▼                                              ▼
[message-core.ts] runChatTurn(runtime)
   ├─ parts[0] = "[Agent role]\n<agent CLAUDE.md>"  (only when NO sessionId)
   ├─ parts += memory context, recent tasks, nudge
   ├─ parts += user message
   └─ fullMessage ─────────────────────────────────────┐
                                                        ▼
                              [agent.ts] runAgent(message, cwd=project_dir, mcpAllowlist)
                                 ├─ getScrubbedSdkEnv()  ── DROPS *_API_KEY / *_TOKEN
                                 ├─ loadMcpServers(allowlist, cwd)
                                 │     merges ~/.claude/settings.json + cwd/.claude/settings.json
                                 └─ query({ cwd, settingSources:['project','user'],
                                            permissionMode:'bypassPermissions', mcpServers, ... })
                                                        │
                                                        ▼
                              Claude Agent SDK spawns `claude` in cwd = agentic-os
                                 ├─ loads agentic-os/CLAUDE.md (→ @AGENTS.md)        [WS-02]
                                 ├─ loads agentic-os/.claude/settings.json
                                 │     ├─ HOOKS fire (SessionStart, UserPromptSubmit,
                                 │     │   Stop, PostToolUse git-auto-commit, PreToolUse guards)
                                 │     └─ DENY rules apply even under bypass (curl, rm, Read(.env))
                                 ├─ discovers agentic-os/.claude/skills/ (23 skills)
                                 └─ a skill lazy-loads brand_context/*.md on trigger  [WS-03]
                                                        │
                                                        ▼
                              result text ──► split ──► posted to Slack/Telegram (on-brand)
```

### Pattern 1: Dedicated workspace agent via external config dir
**What:** Create `~/.claudeclaw/agents/<id>/agent.yaml` with `project_dir` pointing at the workspace.
**When to use:** Whenever you want an agent to operate "inside" another project's context + skills.
**Example (minimal agent.yaml):**
```yaml
# Source: schema verified from src/agent-config.ts loadAgentConfig() + ~/.claudeclaw/agents/skylar/agent.yaml
name: Workspace
description: Runs inside the agentic-os workspace; brand/marketing skills.
project_dir: "/Users/shannongueringer/App Repo/agentic-os"
slack_channel: C0XXXXXXX        # optional — routes a Slack channel to this agent
telegram_bot_token_env: WORKSPACE_BOT_TOKEN   # only needed to run as a standalone --agent process
# model: opus                   # optional; alias or full id, resolved via resolveAgentModel
# mcp_servers: [echo_ai, cms_coverage]   # optional allowlist; see MCP pitfall below
```
Note: an `agent.yaml` requires only `name`. `project_dir` is read at agent-config.ts:166 and warns (non-fatal) if the path does not exist (agent-config.ts:167-171). cwd falls back to the agent's own dir if `project_dir` is missing/nonexistent (agent-config.ts:212-215).

### Pattern 2: cwd-driven context loading (no SDK systemPrompt override)
**What:** ClaudeClaw never sets the SDK `systemPrompt` option. The agent's own `CLAUDE.md` is injected as a `[Agent role]` text block on the first message; the cwd's `CLAUDE.md` is loaded by the SDK via `settingSources:['project']`.
**Why it matters:** For a workspace agent, the agentic-os `CLAUDE.md`/`AGENTS.md` arrives through the SDK (WS-02), and the ClaudeClaw agent's role text arrives through the message. They stack additively. Keep the workspace agent's own `CLAUDE.md` minimal (or absent) to avoid duplicating/contradicting agentic-os guidance — this pre-stages Phase 8 (SOUL).
**Evidence:** message-core.ts:242,249 (role text on `!sessionId`); agent.ts:254 (`settingSources`); agent.ts never passes `systemPrompt` to `query()` (verified — no `systemPrompt` key in the options object at agent.ts:242-278). [VERIFIED: codebase grep]

### Anti-Patterns to Avoid
- **Copying agentic-os files into the ClaudeClaw repo.** The whole point is to run *against* the workspace in place via cwd. Don't vendor `CLAUDE.md`/skills.
- **Setting the SDK `systemPrompt` option to "fix" identity in this phase.** It's not how the codebase works today and would diverge terminal vs chat behavior. Leave it for Phase 8.
- **Choosing a skill that needs an external API key or writes to Downloads to prove WS-03.** It will hit the env-scrub / deny-list / headless pitfalls below and produce a false negative. Use a text-only skill.
- **Editing `getScrubbedSdkEnv` or the deny list in Phase 1.** Those are Phase 2/3 (SK-04) concerns; touching them here widens blast radius and risks COMPAT regressions.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| cwd resolution from config | A new resolver | `resolveAgentRuntime` (agent-config.ts:208) | Already resolves `project_dir` → cwd with fallback + loads CLAUDE.md + MCP allowlist; has a test. |
| Loading workspace CLAUDE.md/skills | Manual file reads/injection | SDK `settingSources:['project','user']` | The SDK already does this from cwd; manual loading would duplicate and drift. |
| MCP merge from settings | A bespoke loader | `loadMcpServers(allowlist, cwd)` (agent.ts:32) | Already merges user + project settings and applies the agent.yaml allowlist. |
| Slack channel → agent routing | New routing code | `getSlackChannelMap()` + existing handler (slack-bot.ts:530+) | `slack_channel` in agent.yaml is already wired with runtime caching. |

**Key insight:** Phase 1 is a configuration + verification + documentation phase. Almost every "implementation" task is really "confirm the existing path works for the agentic-os cwd, and document it."

## Runtime State Inventory

This phase adds a new agent config; it does not rename or migrate stored state. Inventory for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB rows keyed on the new agent until it handles a chat. ClaudeClaw memory is keyed by chat/agent id; a new agent simply starts empty. | None |
| Live service config | A new `slack_channel` in agent.yaml requires the Slack app to be in that channel and the channel ID to be correct; the routing map is built at startup (`getSlackChannelMap`) and cached. **Restart the bot** (or the agent process) after adding/editing the agent so the channel map and runtime cache pick it up. The Slack runtime cache (`runtimeCache` in slack-bot.ts:538) holds a resolved `AgentRuntime` per agent for the process lifetime — editing `agent.yaml` while running will NOT take effect until restart. | Restart bot/agent process after config change |
| OS-registered state | If the agent is run as its own launchd service, a plist is needed (`launchd/com.claudeclaw.*.plist`). **CLAUDE.md launchd rule:** never put space-containing paths in `StandardOutPath`/`StandardErrorPath`. The agentic-os path *contains a space* ("App Repo") — see path-with-spaces pitfall. For the afternoon win you can run delegation-only (no token, reached via `@agentId:`/routed channel) and skip launchd entirely. | Only if running as a standalone launchd service |
| Secrets/env vars | A standalone `--agent` run needs a Telegram token env (`telegram_bot_token_env`) — index.ts enforces it at startup for non-main standalone agents. Delegation-only / Slack-channel-routed agents need NO token (agent-config.ts:120-128). agentic-os skills want `FIRECRAWL_API_KEY`/`GEMINI_API_KEY`/etc. — scrubbed from SDK env (see pitfall). | Add token only if running standalone; otherwise none |
| Build artifacts | `npm run build` (tsc) — the bot runs from `dist/` in production (per CLAUDE.md scheduling/mission CLIs reference `dist/`). Config-only changes (new agent.yaml) need no rebuild; doc changes none. Any TS change (unlikely this phase) needs `npm run build` + restart. | Rebuild only if source changes |

**Verified explicitly:** No collection names, no encrypted columns, no scheduler rows, and no Task Scheduler entries are affected by adding a workspace agent in Phase 1.

## Common Pitfalls

### Pitfall 1: agentic-os hooks fire under headless SDK execution
**What goes wrong:** `settingSources:['project']` loads `cwd/.claude/settings.json`, which for agentic-os defines hooks on SessionStart, UserPromptSubmit, Stop, Notification, PostToolUse, PreToolUse. Several do real work: `skill-auto-commit.js` (git commit on Write/Edit of SKILL files), `session-sync*.js` (write a board task to the Command Centre), `load-memory-snapshot.js`/`session-sync.js` (SessionStart). They run on every bot turn against the workspace.
**Why it happens:** Official SDK docs: setting `settingSources` to include `'project'` loads `.claude/settings.json` **including its hooks**. [CITED: code.claude.com/docs/en/agent-sdk/hooks]
**How to avoid (Phase 1):** Most agentic-os hooks are fire-and-forget and tolerate missing/garbage stdin (verified: each parses stdin in a try/catch and returns silently on failure). For the afternoon win they are mostly harmless noise. The notable ones to watch: `skill-auto-commit.js` will `git commit` inside the agentic-os repo if a skill edits a SKILL file (fine, but creates commits); SessionStart `gsd-check-update.js` does a background network update check. Do NOT attempt to disable hooks in Phase 1 — just be aware they run, and verify the test skill (text-only) doesn't trigger a destructive one. Disabling/scoping hooks is a Phase 2/3 (SK-04) decision.
**Warning signs:** Unexpected git commits in agentic-os; Command-Centre board entries appearing from bot turns; SDK `stderr` noise about hook scripts.

### Pitfall 2: deny rules apply even under bypassPermissions
**What goes wrong:** agentic-os `.claude/settings.json` `permissions.deny` includes `Bash(curl *)`, `Bash(wget *)`, `Bash(rm *)`, `Bash(ssh *)`, and `Read(.env)`, `Read(**/*.key)`, etc. Even though ClaudeClaw runs `permissionMode:'bypassPermissions'` + `allowDangerouslySkipPermissions`, the loaded **deny** rules still block those tools.
**Why it happens:** Official docs: "Anything in disallowed_tools (or a deny rule in loaded settings) is blocked — even under bypassPermissions. Deny always wins." [CITED: code.claude.com/docs/en/agent-sdk/permissions]
**How to avoid:** For WS-03, pick a skill that needs none of the denied tools. `mkt-copywriting` is pure reasoning + `brand_context` Read + `Write` to `projects/` — none denied. Skills like `tool-firecrawl-scraper` (needs `curl`/network + `Read(.env)` for `FIRECRAWL_API_KEY`) will silently fail; that is a Phase 2/3 (SK-04) problem to resolve, not Phase 1.
**Warning signs:** A skill reports it "can't reach" a service or "can't find the API key" even though the key is in agentic-os `.env`.

### Pitfall 3: SDK env scrub strips the API keys agentic-os skills expect
**What goes wrong:** `getScrubbedSdkEnv` (security.ts:192) drops every env var matching `/_API_KEY$/`, `/_TOKEN$/`, `/_SECRET$/`, `/^SECRET_/` (plus an explicit secret list incl. `GOOGLE_API_KEY`), keeping only `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`. So `FIRECRAWL_API_KEY`, `GEMINI_API_KEY`, `HEYGEN_API_KEY`, etc. are NOT in the subprocess `process.env`. agentic-os skills read these from the workspace `.env` via Bash anyway — but that read is then blocked by Pitfall 2's `Read(.env)` deny.
**Why it happens:** Deliberate exfiltration defense (security.ts:120-136). Correct behavior; just incompatible with API-using skills run headless.
**How to avoid (Phase 1):** Same as Pitfall 2 — verify WS-03 with a no-API, no-`.env` skill. Note this constraint loudly in the WS-04 doc and hand the resolution to Phase 3 (SK-04). [VERIFIED: security.ts:148-219]
**Warning signs:** Skill says key missing despite `.env` having it.

### Pitfall 4: path-with-spaces ("App Repo")
**What goes wrong:** The workspace path `/Users/shannongueringer/App Repo/agentic-os` contains a space. CLAUDE.md documents that launchd silently exits 78 when `StandardOutPath`/`StandardErrorPath` contain spaces.
**Why it happens:** launchd config-path bug (project-specific, documented in CLAUDE.md).
**How to avoid:** `project_dir`/cwd itself handles spaces fine (it is passed as a single JS string to the SDK `cwd` option and to Node `path` calls — no shell splitting). The risk is ONLY if you create a launchd plist for a standalone workspace agent: use a symlink (e.g. `~/.claudeclaw-aios` → the workspace) for `WorkingDirectory`, and keep log paths under `/tmp/claudeclaw-<agent>.log`. For the afternoon win, prefer a delegation-only / Slack-channel-routed agent (no plist needed). Also confirm any hand-written Bash in the doc quotes the path. [VERIFIED: CLAUDE.md launchd rules; agent.ts cwd passing]
**Warning signs:** launchd `last exit code = 78`, empty logs; or unquoted-path errors in shell snippets.

### Pitfall 5: runtime + channel-map caching requires a restart
**What goes wrong:** Editing `agent.yaml` while the bot is running has no effect — `getSlackChannelMap()` is built once at Slack startup and `resolveAgentRuntime` results are cached in `runtimeCache` for the process lifetime (slack-bot.ts:538-545).
**How to avoid:** Restart the bot/agent process after creating or editing the workspace agent. Document this in WS-04. [VERIFIED: slack-bot.ts:530-571]
**Warning signs:** "Agent not found" / messages still handled by main after adding a `slack_channel`.

### Pitfall 6: MCP servers come from settings.json, not agent.yaml
**What goes wrong:** agentic-os `.claude/settings.json` has NO `mcpServers` key (verified). If you repoint an agent that relies on MCPs (e.g. skylar's `echo_ai`/`cms_coverage`), `loadMcpServers(allowlist, cwd=agentic-os)` will find those servers only if they are defined in `~/.claude/settings.json` (user scope), because the workspace project scope defines none. The `mcp_servers` allowlist in agent.yaml only *filters* what's merged from the two settings files — it does not *define* servers.
**How to avoid:** For the afternoon win, prefer a new agent that needs no MCP (text/brand skills don't). If a workspace MCP is needed later, ensure it's in `~/.claude/settings.json`. [VERIFIED: agent.ts:32-76; agentic-os settings.json has no mcpServers]
**Warning signs:** An expected MCP tool is unavailable when running in the workspace cwd.

## Code Examples

### Resolve a routed agent's runtime (existing path, no change needed)
```typescript
// Source: src/agent-config.ts:208-226 (verified)
export function resolveAgentRuntime(agentId: string): AgentRuntime {
  const config = loadAgentConfig(agentId);
  const cwd =
    config.projectDir && fs.existsSync(config.projectDir)
      ? config.projectDir                 // ← project_dir wins (WS-01)
      : resolveAgentDir(agentId);
  let systemPrompt: string | undefined;
  const claudeMdPath = resolveAgentClaudeMd(agentId);
  if (claudeMdPath) systemPrompt = fs.readFileSync(claudeMdPath, 'utf-8');
  return { agentId, cwd, model: resolveAgentModel(config.model), systemPrompt, mcpAllowlist: config.mcpServers };
}
```

### How the SDK is invoked (existing path; WS-02 mechanism)
```typescript
// Source: src/agent.ts:242-278 (verified) — note: NO `systemPrompt` option is passed
for await (const event of query({
  prompt: singleTurn(message),
  options: {
    cwd: effectiveCwd,                       // = agentic-os when project_dir set
    resume: sessionId,
    settingSources: ['project', 'user'],     // 'project' loads cwd/CLAUDE.md + .claude/settings.json (WS-02)
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,   // deny rules still win (Pitfall 2)
    env: sdkEnv,                             // scrubbed of *_API_KEY/*_TOKEN (Pitfall 3)
    ...(mcpServerSpecs ? { mcpServers: mcpServerSpecs } : {}),
    ...(model ? { model } : {}),
  },
}))
```

### WS-03 verification target: skill Context Needs (lazy brand_context load)
```markdown
# Source: agentic-os/.claude/skills/mkt-copywriting/SKILL.md "Context Needs" (verified)
| File | Load level | How it shapes this skill |
| brand_context/voice-profile.md | full  | Match tone, vocabulary, rhythm |
| brand_context/positioning.md   | angle | Lead, proof hierarchy, CTA framing |
| brand_context/icp.md           | full  | Audience awareness, pains, objections |
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SDK `settingSources` defaulted to loading project settings | v0.2.x: when `settingSources` is omitted/empty, NO filesystem settings load ("SDK isolation mode"); must include `'project'` | SDK 0.2.x | ClaudeClaw already passes `['project','user']` explicitly — correct. [VERIFIED: sdk.d.ts:820-826] |
| n/a | `dontAsk` permission mode added | SDK 0.2.x | Not used here; ClaudeClaw uses `bypassPermissions`. Informational. |

**Deprecated/outdated:** None relevant. SDK installed (0.2.50) is ahead of the `^0.2.34` floor — behavior verified against the installed `.d.ts`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A text-only skill (`mkt-copywriting`) will not trip the deny list / env-scrub / hooks and is a clean WS-03 proof | Pitfalls 1-3, WS-03 | If a hidden dependency exists (e.g. it shells out), WS-03 verification could fail; mitigated by reading the full SKILL.md before relying on it. The "Context Needs" + "save to projects/" shape strongly suggests no external API. |
| A2 | Fire-and-forget agentic-os hooks won't break a headless turn | Pitfall 1 | If a hook blocks on stdin or errors fatally, the SDK turn could stall; mitigated — each inspected hook parses stdin in try/catch and returns silently. Recommend a smoke test that runs one bot turn against the workspace and checks for hook stalls/`stderr`. |
| A3 | Delegation-only / Slack-channel routing needs no Telegram token | Runtime State Inventory | If the chosen verification path is a standalone `--agent` process, a token IS required (index.ts enforces). Confirm the routing model before writing the doc. [Partially VERIFIED via agent-config.ts:120-128] |

## Open Questions

1. **New dedicated workspace agent vs repoint an existing named fleet agent (skylar/etc.)?**
   - What we know: New agent = zero regression risk to a live agent, but needs a new dir + (maybe) a Slack channel/token. Repointing skylar would instantly give the workspace agent skylar's MCPs (echo_ai/cms_coverage) and persona — but changes a live, channel-routed agent's behavior and identity, risking COMPAT-02, and skylar's MCPs are defined in its agent.yaml allowlist that only filters settings.json (Pitfall 6).
   - What's unclear: whether the user wants the workspace agent to *be* an existing character or a fresh one. This intersects Phase 8 (SOUL).
   - Recommendation: **New agent for the afternoon win** (lowest risk, clean verification). Surface the repoint option to the user via `/gsd-discuss-phase`; do not decide unilaterally.

2. **Should the workspace agent have its own (minimal) ClaudeClaw `CLAUDE.md`?**
   - What we know: If present, it is prepended as `[Agent role]` text and stacks on top of agentic-os's CLAUDE.md/AGENTS.md (Pattern 2). A large or opinionated one risks duplicating/contradicting agentic-os guidance.
   - Recommendation: Omit it, or keep it to one line ("You run inside the agentic-os workspace; follow its CLAUDE.md/AGENTS.md."). Full identity reconciliation is Phase 8 (IDENT/SOUL).

3. **How is WS-03 "on-brand" verified objectively over chat?**
   - What we know: `brand_context/voice-profile.md` defines the brand voice; CLAUDE.md (ClaudeClaw) and agentic-os both forbid em dashes / AI clichés.
   - Recommendation: Acceptance check = trigger `mkt-copywriting` over the agent's Slack/Telegram channel with a real prompt; confirm (a) the skill announces it loaded `brand_context/voice-profile.md` (the skill shows a status line), (b) the output respects the voice profile (no em dashes, no clichés, matches sample tone). Capture the transcript as verification evidence.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| agentic-os workspace | WS-01/02/03 (the cwd) | ✓ | git repo at `/Users/shannongueringer/App Repo/agentic-os` | None — required |
| agentic-os `CLAUDE.md` + `AGENTS.md` | WS-02 | ✓ | CLAUDE.md (`@AGENTS.md`), AGENTS.md 27 KB | None |
| agentic-os `.claude/skills/` | WS-03 (skill discovery) | ✓ | 23 skills incl. `mkt-copywriting` | None |
| agentic-os `brand_context/` | WS-03 | ✓ | voice-profile.md, positioning.md, icp.md, samples.md, assets.md | Skills proceed standalone if missing, but then "on-brand" can't be proven |
| `@anthropic-ai/claude-agent-sdk` | all | ✓ | 0.2.50 (node_modules) | None |
| Claude auth (`~/.claude/` OAuth) | running any turn | ✓ (assumed — bot already runs) | — | `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` in .env |
| Slack app in target channel | WS-03 verify over Slack | ✗ (unknown — channel ID TBD) | — | Verify over Telegram, or via `@agentId:` delegation |
| Workspace `*_API_KEY`s in SDK env | (NOT this phase) | ✗ (scrubbed by design) | — | Deferred to Phase 3 (SK-04) |

**Missing dependencies with no fallback:** None for WS-01/02/04.
**Missing dependencies with fallback:** Slack channel for WS-03 — fall back to Telegram or `@agentId:` delegation routing to verify on-brand output.

## Validation Architecture

`workflow.nyquist_validation: true` — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.0.0 |
| Config file | `package.json` (`"vitest"` key) + per-file colocated `*.test.ts` |
| Quick run command | `npx vitest run src/agent-config.test.ts` |
| Full suite command | `npm test` (→ `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WS-01 | `project_dir` resolves to SDK cwd (existing + new path) | unit | `npx vitest run src/agent-config.test.ts -t "project_dir"` | ✅ (extend existing `projdir` case to assert cwd === project_dir and fallback) |
| WS-01 | nonexistent `project_dir` falls back to agent dir (warn, non-fatal) | unit | `npx vitest run src/agent-config.test.ts -t "fallback"` | ❌ Wave 0 (add case) |
| WS-02 | (SDK loads cwd CLAUDE.md) — SDK-owned; not unit-testable in ClaudeClaw | manual/smoke | bot turn: ask the workspace agent a question only answerable from `AGENTS.md`/silent-startup ritual | ❌ manual-only (justified: behavior lives in the SDK subprocess + workspace files) |
| WS-03 | brand_context loads on skill trigger → on-brand output | manual/smoke | trigger `mkt-copywriting` over chat; inspect transcript vs `voice-profile.md` | ❌ manual-only (justified: end-to-end over a live transport) |
| WS-04 | doc exists and is accurate | manual | review `docs/<name>.md` against the agent.yaml schema + pitfalls | ❌ manual (doc) |
| COMPAT-03 | existing suite still green | full | `npm test` | ✅ |

### Sampling Rate
- **Per task commit:** `npx vitest run src/agent-config.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test` green + manual WS-02/WS-03 smoke transcripts captured before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] Extend `src/agent-config.test.ts`: assert `resolveAgentRuntime(projdir).cwd === project_dir` AND a separate case where `project_dir` is nonexistent → cwd falls back to the agent's own dir (covers WS-01 both branches).
- [ ] (Optional) A small smoke harness/checklist doc for the manual WS-02/WS-03 turns so verification is reproducible.
- Framework install: none — vitest already present.

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high` — section included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface; SDK auth via existing `~/.claude/` OAuth. |
| V3 Session Management | no | Reuses existing per-chat session resume; no change. |
| V4 Access Control | yes | New agent runs with `bypassPermissions` against a workspace cwd. The workspace deny list (curl/rm/ssh/Read .env) is an *additional* guardrail that still applies (Pitfall 2). No broadening of access in this phase. |
| V5 Input Validation | partial | `agent.yaml` is read with `js-yaml` `load` and validated (name required; project_dir existence checked). No untrusted external input added. |
| V6 Cryptography | no | No new crypto; memory encryption untouched. |
| V7 Secrets | yes | `getScrubbedSdkEnv` already strips secrets from the SDK subprocess (Pitfall 3). DO NOT relax it in this phase to make skills work — that would re-expose every key to a workspace skill (and to prompt injection from workspace content). Resolve API-key needs in Phase 3 via a scoped, per-skill mechanism, not a blanket env unscrub. [VERIFIED: security.ts] |

### Known Threat Patterns for this phase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Workspace `CLAUDE.md`/`AGENTS.md`/skill content carries prompt-injection that the agent now auto-loads | Tampering / EoP | Trusted local repo (user-owned); deny list + env scrub limit blast radius. Note: the bot already runs `bypassPermissions` on a personal machine by design (CLAUDE.md). No new external untrusted input is introduced. |
| Pointing cwd at a repo whose hooks run arbitrary scripts under the bot | EoP | Hooks come from the user's own agentic-os repo; they are fire-and-forget. Do not point a workspace agent at an untrusted/third-party repo. Document this constraint in WS-04. |
| Secret exfiltration via a workspace skill calling `env`/`cat .env` | Information Disclosure | Already mitigated: SDK env is scrubbed (security.ts) and `Read(.env)` is denied by agentic-os settings. Keep both. |

## Sources

### Primary (HIGH confidence)
- ClaudeClaw source (read directly this session): `src/agent-config.ts`, `src/agent.ts`, `src/config.ts`, `src/index.ts`, `src/security.ts`, `src/message-core.ts`, `src/slack-bot.ts`, `src/agent-config.test.ts`
- Installed SDK types: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (v0.2.50) — `settingSources` semantics (lines 820-826), `systemPrompt`/`permissionMode` options
- agentic-os workspace (read directly): `CLAUDE.md`, `AGENTS.md` (head), `.claude/settings.json` (full), `.claude/hooks/*` (heads), `.claude/skills/` listing + `mkt-copywriting/SKILL.md`, `brand_context/` listing, `.env` key names
- `.claudeclaw/agents/skylar/agent.yaml` (real fleet schema)
- `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`, `.planning/STATE.md`, `.planning/codebase/INTEGRATIONS.md`

### Secondary (MEDIUM confidence)
- Claude Code / Agent SDK docs (WebSearch, cross-checked against installed `.d.ts`): permissions ("deny always wins" under bypass), hooks loading via `settingSources:['project']`
  - https://code.claude.com/docs/en/agent-sdk/permissions
  - https://code.claude.com/docs/en/agent-sdk/hooks
  - https://platform.claude.com/docs/en/agent-sdk/claude-code-features

### Tertiary (LOW confidence)
- None — all load-bearing claims verified against source or installed types.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all components verified in the repo.
- Architecture / mechanism (cwd, settingSources, role-prompt injection): HIGH — read directly from source + installed SDK types.
- Pitfalls (hooks fire, deny wins, env scrub, spaces, caching, MCP): HIGH — each verified against source files and/or official docs cross-checked with installed `.d.ts`.
- WS-03 skill choice (A1) and hook-safety (A2): MEDIUM — recommend a smoke test to confirm; logged in Assumptions.

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (stable; re-verify if the SDK is bumped past 0.2.x or agentic-os hooks/settings change)

Sources:
- [Configure permissions - Claude Code Docs](https://code.claude.com/docs/en/agent-sdk/permissions)
- [Intercept and control agent behavior with hooks - Claude Code Docs](https://code.claude.com/docs/en/agent-sdk/hooks)
- [Use Claude Code features in the SDK - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/claude-code-features)
