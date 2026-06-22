# Phase 2: Skills Over Chat - Research

**Researched:** 2026-06-14
**Domain:** ClaudeClaw file-marker delivery pipeline (`format.ts` / `message-core.ts` / transports) x agentic-os `.claude/skills/` file-producing skills, run headless via the `aos` workspace agent
**Confidence:** HIGH

## Summary

Phase 1 already proved SK-01 and most of SK-02 live. The WS-02/WS-03 transcripts show the `aos` agent (delegation-only, reached via `@aos:`) discovered the workspace skills, loaded `mkt-copywriting`, lazy-loaded `brand_context/`, and produced on-brand SignMeUp copy over Slack. So **SK-01 is demonstrated** (the agent enumerated and invoked a workspace skill) and **SK-02 is demonstrated for a text skill**. The remaining real work in this phase is SK-03: delivering a file an agentic-os skill produces, as a chat attachment.

SK-03 has one crux, and it is an integration gap, not a missing feature. ClaudeClaw's file delivery works by the agent emitting a `[SEND_FILE:/abs/path|caption]` / `[SEND_PHOTO:...]` marker in its response text; `extractFileMarkers` (`src/format.ts:62`) strips the marker and the transport uploads the local path (`message-core.ts:419-456`). **But marker extraction only runs on the MAIN-agent path** (`processUserMessage`), used by Slack channel routing. **The delegation path (`@aos:`) does NOT call `extractFileMarkers`** — `delegateToAgent` returns `result.text` raw (`orchestrator.ts:232-238`) and `message-core.ts:222` posts it through `sendFormatted` with no marker handling. Since the `aos` agent today has no `slack_channel` and is reached only via `@aos:`, **any file marker it emits would be rendered as a literal string in chat and the file never uploaded.** That is the gap to close. Separately, **agentic-os file skills do not emit ClaudeClaw markers at all** — `viz-excalidraw-diagram` says "Show the user the rendered PNG" and prints a path, but never writes a `[SEND_PHOTO:]` marker. So even on the main path, the agent must be instructed to emit the marker.

The right SK-03 proof skill is **`viz-excalidraw-diagram`**: it renders a real PNG locally via Playwright, reads NO `brand_context` and needs NO API key, so it sidesteps the env-scrub and `Read(.env)` deny-list pitfalls from Phase 1. Playwright chromium is already installed globally on this machine and `render_excalidraw.py` makes no network calls. The only network risk is first-run `uv sync` (PyPI download of `playwright`), which is not blocked by the deny list (it blocks `curl`/`wget`/`pip install`, not `uv`); pre-warming the skill's `.venv` once removes even that. Finally, because the workspace path contains a space (`App Repo`), the marker MUST be the **bracketed** form `[SEND_PHOTO:/abs/path.png]` — the tolerant bare form (`SEND_PHOTO:/path...`) truncates at the first space and would deliver a broken path (verified empirically below).

**Primary recommendation:** (1) Decide the delivery route for `aos`: either give it a routed `slack_channel` so file turns go through `processUserMessage` (which already extracts markers), OR add `extractFileMarkers` + file send to the delegation branch in `message-core.ts`. Recommend adding marker handling to the delegation branch (smaller blast radius than reshuffling Slack channels, and fixes delegation file delivery for the whole fleet). (2) Prove SK-03 with `viz-excalidraw-diagram` producing a PNG, with the agent emitting a **bracketed** `[SEND_PHOTO:<abs path>]` marker. (3) Add unit coverage that `extractFileMarkers` handles a path containing a space, and a test asserting the delegation path delivers a file marker. (4) Document the "skills must emit the bracketed marker; bare form breaks on spaces" rule for skill authors.

## User Constraints (from CONTEXT.md)

No CONTEXT.md exists for this phase (verified: no `*-CONTEXT.md` in `.planning/phases/02-skills-over-chat/`). This phase has not been through `/gsd-discuss-phase`, so there are no locked decisions. The planner has full discretion within the requirements (SK-01..SK-03) and the standing project decisions in `PROJECT.md`. Relevant standing constraints that bound this phase:

- ClaudeClaw is the host; agentic-os is the consumed workspace, run in place via cwd. Do not vendor/copy workspace files. (PROJECT.md Key Decisions)
- Both modes (terminal Claude Code session AND chat bot) must keep working after this phase. (COMPAT-01/02)
- The existing test suite must pass after this phase. (COMPAT-03)
- DO NOT relax `getScrubbedSdkEnv` or the agentic-os deny list to make API/file skills work — that is Phase 3 (SK-04) territory and would re-expose every secret to a workspace skill. (Phase 1 research, Security Domain)
- Fleet lives in `CLAUDECLAW_CONFIG/agents/<id>/` (default `~/.claudeclaw/agents/`); the `aos` agent already exists there with `project_dir` → agentic-os and no `slack_channel`. (verified on disk)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SK-01 | Agentic OS methodology skills (mkt-*, str-*, viz-*, meta-*) are discoverable and invocable by the workspace agent | **Already demonstrated** (Phase 1 transcript): the `aos` agent silently scanned `.claude/skills/` per the workspace startup ritual and invoked `mkt-copywriting` end-to-end. 23 skill families exist (enumerated below). Plan = re-confirm discovery objectively (ask the agent to list skills / invoke by trigger phrase) and capture a transcript; optionally a smoke check that the cwd's `.claude/skills/` is non-empty. |
| SK-02 | A representative brand/marketing skill returns a correct on-brand result end-to-end over Slack/Telegram | **Already demonstrated for a text skill** (Phase 1 `mkt-copywriting` transcript: loaded voice/positioning/icp, produced SignMeUp copy in the live brand voice). Minimal additional proof: re-run the same skill OR run one more representative brand skill (e.g. `mkt-ugc-scripts`, also text-only + brand_context) over chat and confirm against `brand_context/voice-profile.md`. Note the Phase 1 correction: the no-em-dash rule is ClaudeClaw house style, NOT the agentic-os voice — judge "on-brand" against the workspace `voice-profile.md`, not ClaudeClaw's CLAUDE.md. |
| SK-03 | A skill that produces a FILE (image/PDF/doc) delivers it as a chat attachment via `[SEND_FILE:]`/`[SEND_PHOTO:]` | **The real new work.** Requires: (a) closing the delegation-path marker-extraction gap OR routing `aos` via a Slack channel; (b) the agent emitting a **bracketed** marker (skills don't emit it themselves); (c) using a headless, no-API skill — `viz-excalidraw-diagram` (PNG via local Playwright). Full trace, gap, and path-with-spaces analysis below. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Discover workspace skills | Claude Agent SDK subprocess (cwd `.claude/skills/`) | agentic-os workspace files | SDK loads skills from cwd; ClaudeClaw only sets cwd. SK-01 lives in the SDK + workspace. |
| Invoke a skill / produce output text | Skill logic inside the SDK subprocess | agentic-os SKILL.md + scripts | The model runs the skill's steps; ClaudeClaw is uninvolved until the result returns. |
| Generate the file on disk | Skill script (e.g. `render_excalidraw.py` via Playwright) | agentic-os `projects/<skill>/...` | Local render; writes a PNG/file under the workspace `projects/` dir. |
| Emit the `[SEND_FILE:]`/`[SEND_PHOTO:]` marker | The agent's response text (model) | (instructed via agent role / skill convention) | **Neither ClaudeClaw nor the agentic-os skill emits it today** — the model must, on cue. This is the SK-03 instruction gap. |
| Extract markers + strip from text | ClaudeClaw `format.ts:extractFileMarkers` via `message-core.ts` | — | Runs on the MAIN path (`processUserMessage:419`). **NOT on the delegation path** — the SK-03 integration gap. |
| Upload the local file to chat | ClaudeClaw transport (`slack-bot.ts:231` uploadV2 / `bot.ts:280` InputFile) | `message-core.ts:441-456` | Existing, identical contract on Slack and Telegram; `fs.existsSync` guard at 443. |

## Standard Stack

No new npm packages. This is a brownfield integration + verification phase using the existing stack, plus the agentic-os skill's own Python/Playwright toolchain (already installed system-wide).

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | 0.2.50 installed (`^0.2.34` floor) | Spawns `claude` in cwd=agentic-os; runs skills | Already the engine. [VERIFIED: Phase 1 research / node_modules] |
| `vitest` | ^2.1.9 (installed) | Test runner; COMPAT-03 gate | Existing suite (17 tests in `format.test.ts` alone, all green). [VERIFIED: `npx vitest run src/format.test.ts`] |
| `grammy` `InputFile` (Telegram) / `@slack/web-api` `files.uploadV2` (Slack) | installed | Upload a local file path as an attachment | Existing, transport-symmetric file send. [VERIFIED: bot.ts:280-283, slack-bot.ts:231-248] |
| `uv` | 0.11.21 (homebrew) | Runs the excalidraw skill's Python venv + Playwright render | Workspace skill toolchain; present on machine. [VERIFIED: `command -v uv`] |
| Playwright chromium | chromium-1208/1217 cached | Headless render of `.excalidraw` → PNG | Already installed at `~/Library/Caches/ms-playwright/`. [VERIFIED: `ls` of cache dir] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `viz-excalidraw-diagram` (PNG) for SK-03 | An anthropic docx/pptx/pdf skill | **Not present in this workspace** (verified: no docx/pdf/pptx/xlsx skill under `.claude/skills/`). Excalidraw is the only headless, no-API file producer available. |
| `viz-excalidraw-diagram` | `viz-nano-banana` (image via Gemini) | Rejected: needs `GEMINI_API_KEY`, which is scrubbed from SDK env (Phase 1 Pitfall 3) and the skill itself says "cannot fall back". That is Phase 3 (SK-04). |
| Add markers to the delegation branch | Give `aos` a `slack_channel` (main path already extracts markers) | Both valid. Channel routing reuses existing extraction but requires a dedicated channel + bot-in-channel + restart, and only fixes the channel-routed agent. Adding extraction to delegation fixes file delivery for ALL delegated agents and needs no Slack config. Recommend the delegation fix; surface the channel option to the user. |

**Installation:** None (npm). Pre-warm the skill venv once (see Environment Availability).

## Package Legitimacy Audit

Not applicable — this phase installs no new npm/PyPI packages into ClaudeClaw. The agentic-os excalidraw skill declares `playwright>=1.40.0` in its own `references/pyproject.toml` (installed via `uv sync` into the skill's `.venv`); chromium binaries are already cached on the machine. No package added to the ClaudeClaw dependency tree, so slopcheck is moot here. (If the planner adds a test helper later, run the gate then.)

## Architecture Patterns

### System Architecture Diagram (SK-03: a file-producing skill turn)

```
Slack/Telegram message ("@aos: draw an excalidraw diagram of X")
        │
        ▼
[slack-bot.ts / bot.ts]  ─── transport callbacks (sendFile, sendPhoto, sendFormatted) ──┐
        │                                                                                │
        ▼                                                                                │
[message-core.ts] processUserMessage                                                     │
   │                                                                                     │
   ├── parseDelegation("@aos: ...") ?                                                    │
   │        │                                                                            │
   │   YES  ▼  (DELEGATION BRANCH, lines 196-233)                                        │
   │   delegateToAgent(aos) → runAgent(cwd=agentic-os) → result.text                     │
   │        │                                                                            │
   │        │   *** result.text may contain "[SEND_PHOTO:/abs/x.png]" ***                │
   │        │                                                                            │
   │        └─► sendFormatted(format(result.text))   ◄── ❌ NO extractFileMarkers HERE   │
   │                  (marker leaks into chat as literal text; file NOT uploaded)        │
   │                                                                                     │
   │   NO   ▼  (MAIN BRANCH)                                                             │
   │   runAgentWithRetry(cwd) → rawResponse                                              │
   │        │                                                                            │
   │        ├─ extractFileMarkers(rawResponse)  (line 419) → { text, files[] }   ✅       │
   │        ├─ for file in files: fs.existsSync? → cb.sendPhoto/sendFile(path) ──────────┘
   │        └─ sendFormatted(text without markers)
   │
   ▼
Inside the SDK subprocess (cwd = /Users/shannongueringer/App Repo/agentic-os):
   viz-excalidraw-diagram skill
      ├─ Step 0: uv sync + playwright install (network on FIRST run only)
      ├─ build .excalidraw JSON
      ├─ Step 5: uv run render_excalidraw.py <file>  → writes PNG (NO network)
      ├─ Step 6: save to projects/viz-excalidraw-diagram/<name>/<date>_<name>.png
      └─ Step "show user": prints path  ◄── ❌ does NOT emit [SEND_PHOTO:] marker today
```

Two breaks to close for SK-03: (A) the agent must emit a bracketed marker (skill doesn't), and (B) the delegation branch must extract it (or route via channel so the main branch does).

### Pattern 1: Marker-based file delivery (the existing contract)
**What:** The agent's final text contains `[SEND_FILE:/abs/path|caption]` or `[SEND_PHOTO:/abs/path|caption]`. `extractFileMarkers` strips it; the transport uploads the local path.
**When to use:** Any time a skill produces a local file the user should receive in chat.
**Example (the marker the agent must emit for SK-03):**
```text
Done. Rendered the architecture diagram.
[SEND_PHOTO:/Users/shannongueringer/App Repo/agentic-os/projects/viz-excalidraw-diagram/auth-flow/2026-06-14_auth-flow.png|Auth flow diagram]
```
**Verified parser behavior** (`format.ts:70-72`, tested empirically this session):
- Bracketed form preserves spaces in the path: `[SEND_PHOTO:/.../App Repo/.../x.png]` → path `"/Users/shannongueringer/App Repo/.../x.png"` ✅
- Bracketed caption via pipe works: `|Auth flow diagram` → caption `"Auth flow diagram"` ✅
- **Bare form truncates at the first space:** `SEND_PHOTO:/Users/shannongueringer/App Repo/x.png` → path `"/Users/shannongueringer/App"` ❌ (regex `[^\s|\]]+` stops at the space). So the bracketed form is mandatory in this workspace.

### Pattern 2: Headless file generation without API keys or network (at run time)
**What:** Choose a skill whose file output is produced by a local renderer, not a cloud API.
**Why it matters:** Phase 1 proved `*_API_KEY` is scrubbed from the SDK env and `Read(.env)` + `curl`/`wget` are denied. A cloud-image/video skill (`viz-nano-banana`, `viz-ugc-heygen`, `tool-*`) fails headless. `viz-excalidraw-diagram` renders a PNG with local Playwright and makes no network call in `render_excalidraw.py` (verified: no `http`/`requests`/`urllib` in the script).
**Evidence:** `render_excalidraw.py` has zero network references; chromium already cached; `uv` present. The only network is first-run `uv sync` (PyPI), which the deny list does not block (`pip install`/`curl`/`wget` are denied; `uv` is not).

### Anti-Patterns to Avoid
- **Proving SK-03 with an API-backed skill** (`viz-nano-banana`/`viz-ugc-heygen`/`tool-firecrawl`). They need scrubbed keys + network — guaranteed false negative. That's Phase 3 (SK-04).
- **Relaxing the env scrub or deny list to make a file skill work.** Re-exposes secrets; explicitly out of scope (Phase 3 owns the scoped fix).
- **Relying on the bare (unbracketed) marker form.** It breaks on the `App Repo` space. Always emit the bracketed form.
- **Assuming the agentic-os skill emits the ClaudeClaw marker.** It does not; the agent must, on instruction.
- **Vendoring the excalidraw skill into ClaudeClaw.** Run it in place via cwd.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parse `[SEND_FILE:]`/`[SEND_PHOTO:]` from agent text | A new parser | `extractFileMarkers` (`format.ts:62`) | Already tolerant of caption pipes, bare forms, URLs; strips markers + collapses blank lines. Reuse it in the delegation branch. |
| Upload a local file to Slack/Telegram | New upload code | `cb.sendFile`/`cb.sendPhoto` (transport callbacks) | Symmetric across Slack (`uploadV2`) and Telegram (`InputFile`); already wired with caption support. |
| Mission-task file parsing (dashboard) | Anything new | `mission-files.ts` (`parseTaskOutputFiles` reuses `extractFileMarkers`) | Established pattern — delegation file extraction should mirror it. |
| Render `.excalidraw` → PNG | A custom renderer | the skill's `render_excalidraw.py` via `uv run` | Local, no API, validated loop built in. |

**Key insight:** Almost everything for SK-03 already exists. The single missing wire is "run `extractFileMarkers` on the delegated agent's result before posting it" (or route via a channel that already does), plus instructing the agent to emit the bracketed marker.

## Runtime State Inventory

Not a rename/refactor phase. This phase adds (a) marker handling on the delegation path and/or a `slack_channel` on `aos`, and (b) verification artifacts. Inventory for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB keys/collections change. Delegation already writes a conversation turn attributed to `aos` (`message-core.ts:218`); unaffected. | None |
| Live service config | If `aos` gets a `slack_channel`: the Slack app must be in that channel; channel map + `runtimeCache` are built once at startup → **restart the bot** after the config change (Phase 1 Pitfall 5). If instead the delegation branch is patched, a `npm run build` + restart is needed (TS change). | Restart bot after config or code change |
| OS-registered state | The excalidraw skill's `.venv` does not yet exist (`references/.venv` absent). First run triggers `uv sync` (PyPI download). Pre-warm it once to avoid a network step inside a headless turn. Chromium is already installed. | Pre-warm `.venv` once (see Environment Availability) |
| Secrets/env vars | None. The chosen SK-03 skill needs no API key (that's the point). DO NOT add keys to the SDK env this phase. | None |
| Build artifacts | If the delegation branch is patched in `src/message-core.ts`, `npm run build` (tsc → `dist/`) + restart, since the bot runs from `dist/`. Config-only (channel) needs no rebuild. | Rebuild only if source changes |

**Verified explicitly:** No scheduler rows, no encrypted columns, no Task Scheduler entries affected.

## Common Pitfalls

### Pitfall 1: Delegation path drops file markers (THE crux)
**What goes wrong:** A skill produces a PNG and the agent emits `[SEND_PHOTO:...]`, but because `aos` is reached via `@aos:` delegation, `message-core.ts` posts `result.text` through `sendFormatted` (line 222) without calling `extractFileMarkers`. The marker shows up as literal text; no file is uploaded.
**Why it happens:** `extractFileMarkers` is only called in the MAIN branch (`message-core.ts:419`), not the delegation branch (196-233). `delegateToAgent` returns raw `result.text` (`orchestrator.ts:232-238`). [VERIFIED: codebase grep — `extractFileMarkers` appears only at format import + line 419; absent from the delegation branch]
**How to avoid:** Either (a) add `extractFileMarkers` + the file-send loop (mirror `message-core.ts:441-456`) to the delegation branch before `sendFormatted`, OR (b) give `aos` a `slack_channel` so file turns go through `processUserMessage`'s main branch. Recommend (a): it fixes delegation file delivery fleet-wide and needs no Slack config.
**Warning signs:** A raw `[SEND_PHOTO:/...]` string appears in the Slack/Telegram message; no attachment.

### Pitfall 2: agentic-os skills never emit the ClaudeClaw marker
**What goes wrong:** Even on the main path, the file is generated and "shown to the user" (the skill reads the PNG itself), but no `[SEND_PHOTO:]` marker is emitted, so nothing uploads.
**Why it happens:** `viz-excalidraw-diagram` Step 6 says "Save to `projects/...`" and "Show the user the rendered PNG" — it Reads the PNG for its own validation loop and prints the path; it has no concept of ClaudeClaw markers. [VERIFIED: SKILL.md Steps 5-7, no marker text]
**How to avoid:** Instruct the agent (via the `aos` agent role / a short workspace convention) to, after a skill saves a file, emit a bracketed `[SEND_FILE:<abs path>]` or `[SEND_PHOTO:<abs path>]`. The agent already knows the absolute path it saved to. Do NOT edit the agentic-os skill to hard-code a ClaudeClaw marker (couples the workspace to one host; breaks terminal use). Prefer a role-prompt instruction on the ClaudeClaw side.
**Warning signs:** Agent replies "saved the diagram to projects/..." with no attachment.

### Pitfall 3: path-with-spaces breaks the BARE marker form
**What goes wrong:** The workspace path is `/Users/shannongueringer/App Repo/agentic-os/...` (space in "App Repo"). If the agent emits the tolerant bare form `SEND_PHOTO:/Users/.../App Repo/x.png`, the parser truncates at the space to `/Users/shannongueringer/App` and the upload fails (file-not-found).
**Why it happens:** `format.ts:72` bare-form regex is `((?:https?:\/\/|\/)[^\s|\]]+)` — `[^\s...]` stops at whitespace. The bracketed form (`format.ts:71`, `[^\]|]+?`) does NOT stop at spaces. [VERIFIED empirically this session — see Pattern 1 evidence]
**How to avoid:** Require the bracketed form in the agent instruction. Add a unit test that `extractFileMarkers('[SEND_PHOTO:/Users/x/App Repo/y.png]')` yields the full path. Optionally harden the bare-form regex, but the simpler fix is "always bracket."
**Warning signs:** "Could not send file: /Users/shannongueringer/App (not found)" in chat.

### Pitfall 4: first-run `uv sync` needs network inside a headless turn
**What goes wrong:** The excalidraw skill's `.venv` does not exist yet; Step 0 runs `uv sync` (downloads `playwright` from PyPI) inside the SDK turn. If network is flaky or the turn times out, the render fails on first use.
**Why it happens:** `.venv` absent (verified). `uv sync` is a network op; it is NOT blocked by the deny list (which blocks `pip install`/`curl`/`wget`, not `uv`).
**How to avoid:** Pre-warm once before the SK-03 demo: `cd "/Users/shannongueringer/App Repo/agentic-os/.claude/skills/viz-excalidraw-diagram/references" && uv sync && uv run playwright install chromium` (chromium already cached, so the second command is a fast no-op). After that, render is fully offline.
**Warning signs:** Skill Step 0 stalls or errors on `uv sync`; long first-render latency.

### Pitfall 5: skill SKILL.md has an inconsistent venv path
**What goes wrong:** `viz-excalidraw-diagram` Step 0 uses `cd .claude/skills/viz-excalidraw-diagram/references` (relative to cwd) but Step 5 uses `cd ~/.claude/skills/viz-excalidraw-diagram/references` (home dir). The skill lives under the WORKSPACE `.claude/skills/`, not `~/.claude/`. If the agent follows the `~/.claude` path it will not find the renderer.
**Why it happens:** SKILL.md path typo/assumption. [VERIFIED: SKILL.md Step 0 vs Step 5]
**How to avoid:** The agent's cwd is the workspace, so the relative `.claude/skills/...` path is correct. Note this in the SK-03 plan so the agent (or a test) uses the workspace-relative path. This is a documentation gap in the workspace skill, not a ClaudeClaw bug — flag, don't fix the skill in this phase unless trivial.
**Warning signs:** "No such file or directory" on `render_excalidraw.py`.

### Pitfall 6: hooks fire on the workspace turn (carried from Phase 1)
**What goes wrong:** `settingSources:['project']` loads agentic-os hooks; a Write/Edit of a SKILL file triggers `skill-auto-commit.js` (git commit). The excalidraw run writes to `projects/`, not a SKILL file, so the auto-commit hook should not fire on it — but the run still produces files under `projects/` that may be auto-committed by other hooks.
**Why it happens:** Documented in Phase 1 (Pitfall 1). [VERIFIED: Phase 1 research]
**How to avoid:** Acceptable for this phase; just be aware. Don't disable hooks here (that's SK-04). Verify the SK-03 demo turn doesn't trigger a destructive hook.
**Warning signs:** Unexpected git commits in agentic-os after a demo turn.

## Code Examples

### The marker-extraction the delegation branch is MISSING (main branch, for reference)
```typescript
// Source: src/message-core.ts:419-456 (verified) — runs only on the MAIN path
const { text: responseText, files: fileMarkers } = extractFileMarkers(rawResponse);
// ...
for (const file of fileMarkers) {
  if (!fs.existsSync(file.filePath)) {
    await cb.sendPlain(`Could not send file: ${file.filePath} (not found)`);
    continue;
  }
  if (file.type === 'photo') await cb.sendPhoto(file.filePath, file.caption);
  else await cb.sendFile(file.filePath, file.caption);
}
```

### The delegation branch as it is today — NO extraction (the gap)
```typescript
// Source: src/message-core.ts:212-223 (verified)
const response = delegationResult.text?.trim() || 'Agent completed with no output.';
const header = `[${delegationResult.agentId} — ${Math.round(delegationResult.durationMs / 1000)}s]`;
// ...
for (const part of splitMessage(cb.format(`${header}\n\n${response}`), cb.maxLen)) {
  await cb.sendFormatted(part);            // ← marker, if any, posted as literal text
}
```
**Fix shape (for the planner):** before the loop, run `const { text, files } = extractFileMarkers(response);` then post `${header}\n\n${text}` and run the same file-send loop as the main branch. Mirrors `mission-files.ts:parseTaskOutputFiles`.

### Bracketed marker the agent must emit (verified parser-safe with spaces)
```text
[SEND_PHOTO:/Users/shannongueringer/App Repo/agentic-os/projects/viz-excalidraw-diagram/x/2026-06-14_x.png|Diagram of X]
```

### Pre-warm the excalidraw renderer once (offline thereafter)
```bash
cd "/Users/shannongueringer/App Repo/agentic-os/.claude/skills/viz-excalidraw-diagram/references" \
  && uv sync \
  && uv run playwright install chromium   # chromium already cached → fast no-op
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| File delivery only proven on the main chat path | Delegation is now a first-class route (`@aos:`) but lacks marker extraction | This consolidation | SK-03 must close the delegation gap or route via channel. |
| Skills "show the user" a file by reading it | Over chat, a file must be emitted as a `[SEND_*]` marker to actually deliver | This phase | The agent (not the skill) emits the marker on instruction. |

**Deprecated/outdated:** The Phase 1 validation's "no em dashes" WS-03 criterion was wrong for the agentic-os voice (its `voice-profile.md` uses em dashes deliberately). Judge on-brand against the workspace voice profile, not ClaudeClaw house style. [VERIFIED: Phase 1 transcript "Criteria note (deviation)"]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `viz-excalidraw-diagram` produces a PNG with no network at render time and no API key | Stack / Pattern 2 | If `render_excalidraw.py` or a reference imports a network call, the headless render fails. Mitigated: grepped the script for `http`/`requests`/`urllib` — none found; chromium is local. First-run `uv sync` is the only network step, pre-warmed away. |
| A2 | Recommending the delegation-branch fix over a `slack_channel` is the right default | Stack alternatives / Pitfall 1 | If the user prefers `aos` to own a dedicated channel (cleaner UX, no code change), the channel route is fine and reuses existing extraction. Surface both via `/gsd-discuss-phase`; do not decide unilaterally. |
| A3 | The agent will reliably emit a bracketed marker when instructed via the agent role | Pitfall 2/3 | LLM compliance is probabilistic. Mitigated by an explicit, short instruction ("after any skill saves a file, emit `[SEND_FILE:<absolute path>]` in brackets") and a live transcript as proof. A deterministic fallback (skill emits a structured "saved at <path>" line that ClaudeClaw converts) is heavier; defer unless flaky. |
| A4 | First-run `uv sync` is not blocked by the agentic-os deny list | Pitfall 4 | Deny list blocks `pip install`/`curl`/`wget`, not `uv`/`npx` (verified in settings.json). If a future settings change adds `Bash(uv *)` to deny, pre-warming becomes mandatory (which we already recommend). |

## Open Questions (RESOLVED)

> Resolved 2026-06-14 at plan time via user decisions, locked into 02-01/02-02-PLAN.md:
> 1. **Both** — fix the delegation branch (fleet-wide code fix, mirrors `mission-files.ts`) AND give `aos` a `slack_channel` (belt-and-suspenders).
> 2. **Agent-role instruction** emits the bracketed marker; deterministic converter deferred to SK-04 (Phase 3).
> 3. **One fresh SK-02 transcript** suffices; Phase 1 already proved `mkt-copywriting`.

1. **Delegation-branch marker fix vs. routed Slack channel for `aos`?**
   - What we know: The delegation branch lacks `extractFileMarkers`; the main (channel-routed) path has it. `aos` currently has no `slack_channel`.
   - Recommendation: Add `extractFileMarkers` + file-send to the delegation branch (fixes file delivery for all delegated agents, no Slack config, mirrors `mission-files.ts`). Offer the channel option to the user. Decide in `/gsd-discuss-phase`.

2. **Who emits the `[SEND_*]` marker — agent role instruction, or a deterministic ClaudeClaw-side converter?**
   - What we know: agentic-os skills don't emit it; the model can on instruction (A3).
   - Recommendation: Start with an agent-role instruction (lightest, keeps the workspace skill host-agnostic). If transcripts show the agent forgetting, add a deterministic fallback in Phase 3 (SK-04) where graceful-degradation/routing is already in scope.

3. **Is one more SK-02 brand skill needed, or does the Phase 1 `mkt-copywriting` transcript suffice?**
   - What we know: SK-02 says "at least one representative brand/marketing skill" — Phase 1 already demonstrated `mkt-copywriting` on-brand over Slack.
   - Recommendation: Treat SK-02 as substantially met; capture one fresh transcript (same or a second brand skill like `mkt-ugc-scripts`) for this phase's evidence so SK-02 has a Phase 2 artifact, then focus effort on SK-03.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `aos` agent (`~/.claudeclaw/agents/aos/agent.yaml`, `project_dir`→agentic-os) | SK-01/02/03 | ✓ | exists, delegation-only (no `slack_channel`) | None — required |
| agentic-os `.claude/skills/` (23 families) | SK-01 | ✓ | incl. `viz-excalidraw-diagram` | None |
| `viz-excalidraw-diagram` skill | SK-03 | ✓ | SKILL.md + `references/render_excalidraw.py` | No other headless no-API file skill exists in workspace |
| `uv` | excalidraw render | ✓ | 0.11.21 (homebrew) | None — needed for the venv |
| Playwright chromium | excalidraw render | ✓ | chromium-1208/1217 cached | None |
| excalidraw skill `.venv` | excalidraw render | ✗ (not yet created) | — | `uv sync` on first run (pre-warm to avoid in-turn network) |
| `extractFileMarkers` (main path) | file delivery | ✓ | `format.ts:62`, 17 tests green | None |
| `extractFileMarkers` on delegation path | SK-03 over `@aos:` | ✗ (the gap) | — | Route `aos` via `slack_channel` (uses main path) |
| Slack/Telegram file upload | SK-03 | ✓ | `uploadV2` / `InputFile` | The other transport |
| Workspace `*_API_KEY`s in SDK env | (NOT this phase) | ✗ (scrubbed by design) | — | Deferred to Phase 3 (SK-04) |

**Missing dependencies with no fallback:** None that block — the one true gap (delegation marker extraction) is a code change inside this phase's scope, and the channel route is a config fallback.
**Missing dependencies with fallback:** excalidraw `.venv` (create via `uv sync`); delegation extraction (fall back to a routed Slack channel).

## Validation Architecture

`workflow.nyquist_validation: true` — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.9 |
| Config file | `package.json` (`vitest` key) + colocated `*.test.ts` |
| Quick run command | `npx vitest run src/format.test.ts` |
| Full suite command | `npm test` (→ `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SK-01 | Workspace skills discoverable/invocable | manual/smoke | `@aos: list your available skills` then invoke one by trigger phrase; capture transcript | ❌ manual (justified: lives in the SDK subprocess; Phase 1 already showed it) |
| SK-02 | A brand skill returns on-brand result over chat | manual/smoke | `@aos: use mkt-copywriting ...` (or `mkt-ugc-scripts`); compare to `brand_context/voice-profile.md` | ❌ manual (justified: end-to-end over a live transport; Phase 1 transcript exists) |
| SK-03 | Bracketed marker with a space-containing path parses to the full path | unit | `npx vitest run src/format.test.ts -t "space"` | ❌ Wave 0 (add case for `/Users/x/App Repo/y.png`) |
| SK-03 | Delegation path extracts a file marker and calls sendPhoto/sendFile | unit | `npx vitest run src/message-core*.test.ts -t "delegation file"` (mock cb.sendPhoto) | ❌ Wave 0 (add test once branch patched) |
| SK-03 | A real excalidraw PNG is produced and delivered over chat | manual/smoke | `@aos: draw an excalidraw diagram of <X>` → expect a PNG attachment in Slack/Telegram | ❌ manual (justified: full end-to-end render + upload over a live transport) |
| COMPAT-03 | Existing suite still green | full | `npm test` | ✅ (baseline: `format.test.ts` 17 green) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/format.test.ts` (+ the new message-core delegation test once added)
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test` green + a live SK-03 transcript showing a delivered PNG attachment, plus a fresh SK-01/SK-02 transcript.

### Wave 0 Gaps
- [ ] `src/format.test.ts` — add: `extractFileMarkers('[SEND_PHOTO:/Users/x/App Repo/y.png|cap]')` returns the FULL path (covers Pitfall 3 / SK-03 path-with-spaces). Existing tests use space-free `/tmp/` paths only (verified).
- [ ] `src/message-core.test.ts` (or extend existing) — add: a delegated result containing `[SEND_PHOTO:<tmp file>]` causes `cb.sendPhoto` to be called and strips the marker from the posted text (covers the delegation-branch fix). Mirror the mocked-cb pattern in `file-send.integration.test.ts`.
- [ ] (Manual harness) A short checklist doc for the SK-03 live turn (pre-warm venv, send `@aos: draw ...`, confirm attachment) so verification is reproducible.
- Framework install: none — vitest present.

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high` — section included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface. |
| V3 Session Management | no | Reuses per-chat session; delegation uses a fresh inner session (`orchestrator.ts:208`). |
| V4 Access Control | yes | The workspace runs under `bypassPermissions`; the agentic-os deny list still applies (curl/rm/ssh/Read .env). No broadening. The chosen SK-03 skill needs no denied tool. |
| V5 Input Validation | yes | `extractFileMarkers` parses agent-controlled text into a file path that ClaudeClaw then uploads. `fs.existsSync` guards before upload (`message-core.ts:443`). Adding extraction to the delegation branch MUST keep that guard. A malicious/confused agent could emit `[SEND_FILE:/etc/passwd]`; on a personal machine under the user's own agent this matches existing behavior, but the planner should note the path is unrestricted today (same as the main path — no regression, but worth flagging). |
| V6 Cryptography | no | No crypto change. |
| V7 Secrets | yes | The whole SK-03 design avoids API keys precisely so the SDK env scrub stays intact. DO NOT unscrub to deliver files. The chosen skill reads no `.env`. |

### Known Threat Patterns for this phase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent emits a marker pointing at an arbitrary local file (`/etc/passwd`, a secret) → uploaded to chat | Information Disclosure | Existing behavior (main path) already uploads any existsSync path the agent names; the delegation fix inherits the same surface — no new exposure, but note it. The exfiltration guard (`scanForSecrets`) runs on the response TEXT, not on uploaded file CONTENTS — uploading a secret FILE bypasses it. On a single-user personal machine with the user's own agent this is acceptable; flag for the planner as a known limitation, optionally constrain SK-03 uploads to under the workspace `projects/` dir. |
| First-run `uv sync` pulls a compromised PyPI `playwright` | Tampering | Pin via the skill's `uv.lock` (present); pre-warm from a trusted network. Not introduced by this phase (workspace-owned). |
| Workspace hook runs arbitrary script during a file turn | EoP | Trusted local repo (Phase 1 mitigation). Don't point `aos` at an untrusted workspace. |

## Sources

### Primary (HIGH confidence)
- ClaudeClaw source (read directly this session): `src/format.ts` (extractFileMarkers + regex), `src/message-core.ts` (main vs delegation branches, lines 196-233 / 419-456), `src/orchestrator.ts` (`delegateToAgent` 137-246), `src/mission-files.ts` (established extraction reuse), `src/slack-bot.ts` (uploadV2 231-248, channel routing), `src/bot.ts` (InputFile 280-283, format re-export), `src/file-send.integration.test.ts`, `src/format.test.ts`
- Empirical regex test (this session): bracketed form preserves spaces; bare form truncates at first space
- agentic-os workspace (read directly): `.claude/skills/` listing (23 families), `viz-excalidraw-diagram/SKILL.md` + `references/` (render_excalidraw.py grep, pyproject.toml), `viz-nano-banana`/`viz-ugc-heygen`/`viz-interface-design`/`mkt-ugc-scripts` SKILL.md heads, `.claude/settings.json` permissions, `projects/` dir
- Machine state: `uv` 0.11.21, Playwright chromium cache, excalidraw `.venv` absent
- `~/.claudeclaw/agents/aos/agent.yaml` (delegation-only, no slack_channel)
- `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`, Phase 1 `01-RESEARCH.md`, Phase 1 `ws02-ws03-transcripts.md`, `.planning/config.json`

### Secondary (MEDIUM confidence)
- Phase 1 research's cited SDK docs (permissions "deny always wins", hooks load via settingSources) — carried forward, not re-fetched this session.

### Tertiary (LOW confidence)
- None — all load-bearing claims verified against source, the workspace, machine state, or an empirical test.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all components verified in repo + machine.
- Architecture / the delegation marker gap: HIGH — read both branches directly; confirmed `extractFileMarkers` is main-path only.
- Path-with-spaces behavior: HIGH — verified empirically against the actual regex.
- SK-03 skill choice (excalidraw, no-API, local render): HIGH — SKILL.md + script grep + machine state; first-run `uv sync` network caveat logged.
- Agent reliably emitting the bracketed marker (A3): MEDIUM — probabilistic LLM behavior; mitigated by explicit instruction + live transcript.

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (re-verify if `format.ts` regex, the delegation branch, agentic-os deny list, or the excalidraw skill change)
