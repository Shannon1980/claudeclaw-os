# Phase 3: Skill Hardening - Research

**Researched:** 2026-06-15
**Domain:** agentic-os Quality-of-Life behaviors (auto-download, humanizer gate, CC Notify, clickable paths) under headless SDK execution via the `aos` workspace agent x ClaudeClaw `[SEND_FILE:]` routing and the `context/learnings.md` self-improvement write path
**Confidence:** HIGH

## Summary

The Phase 1/2 work already de-risked the dangerous failure modes (env scrub, deny list, the delegation marker-extraction gap). Phase 3 is the cleanup: prove the remaining agentic-os "Quality of Life" behaviors don't hard-fail headless, and that skill self-improvement feedback still persists when a skill is run one-shot over chat. The good news, verified directly against the workspace, is that **nothing hard-fails today** — every QoL behavior either no-ops gracefully or silently misbehaves (does the wrong thing quietly). So SK-04 is mostly "confirm no hard failure + route file output through `[SEND_FILE:]`," and SK-05 is one real gap with a small, host-agnostic fix.

The four README QoL features break down cleanly by mechanism. **CC Notify** is a hook (`run-ccnotify.js` → `hooks_info/ccnotify.py`); it writes to its own SQLite and calls `osascript`, all wrapped in `try/except` that swallows failures and logs — verified running cleanly under the Phase 1/2 bot turns (its log shows `Notification sent` for the `aos` sessions). It NO-OPS safely headless: the OS toast just goes unseen. **Auto-download** is NOT a hook — it is inline `SKILL.md` steps ("Copy to `~/Downloads/`") in only four skills (`tool-stitch`, `viz-interface-design`, `viz-stitch-design`, `meta-skill-creator`). It uses `cp`, which the deny list does NOT block (only `rm`/`curl`/`wget`/`pip install` are denied), so it silently SUCCEEDS — copying a file to a Downloads folder the chat user never sees. This silent-misbehave-not-hard-fail is the heart of SK-04: the fix is to ALSO route the file through `[SEND_FILE:]` (Phase 2's delivered marker path), not to delete the Downloads step. **Humanizer gate** is a skill (`tool-humanizer`), pure reasoning, no API key, mandated by `AGENTS.md`; it runs fine headless. **Clickable file paths** is just printed text — harmless, and the printed absolute path is exactly what the agent reuses to emit a `[SEND_FILE:]` marker.

SK-05 is the one substantive gap. `context/learnings.md` is written two ways, and **neither reliably fires under a one-shot delegated bot turn**: (a) per-skill inline "Log feedback to `context/learnings.md`" steps that are gated behind an interactive feedback question (e.g. `mkt-copywriting` Step 10: *"Ask: Does this sound like you?"* THEN log) — the bot turn produces the deliverable and stops, the feedback turn never comes, so the log step is skipped; and (b) `meta-wrap-up`, which only triggers on interactive session-end signals ("thanks", "done for today") that a one-shot delegation never sends. Verified by file mtime: `learnings.md` was last modified **2026-06-12**, BEFORE any of the 06-14 bot runs — confirming bot-invoked skills are not writing learnings today. The minimal, host-agnostic fix is to make the learnings write happen INLINE during the skill turn (decoupled from the interactive feedback question), so a bot-run skill appends a dated entry to its `## <skill>` section as part of execution. A ClaudeClaw post-turn hook is the heavier alternative and is currently un-wired (`src/hooks.ts` defines a registry but nothing calls `createHookRegistry`/`loadHooksFromDir` in the live pipeline — verified).

**Primary recommendation:** (1) SK-04: confirm via the existing transcript evidence and one new live turn that no QoL behavior hard-fails headless; for the file-producing/auto-download skills, instruct the `aos` agent (role-level, host-agnostic) to ALSO emit a bracketed `[SEND_FILE:<abs path>]` after any save-or-copy-to-Downloads step, reusing the Phase 2 delivery path. Do NOT fork the agentic-os skills and do NOT relax the env scrub or deny list. (2) SK-05: add a short, host-agnostic instruction so a bot-run skill writes its dated learnings entry inline (not gated on an interactive feedback reply), and verify a bot turn produces a new `learnings.md` entry. Prefer an `aos` agent-role / `SKILL.local.md` convention over editing upstream `SKILL.md` files, to keep the workspace portable. (3) Unit-test what is deterministic (the `[SEND_FILE:]` routing already covered in Phase 2; a learnings-append helper if one is built); leave the end-to-end "no hard fail + learnings persisted" proof to a live chat transcript.

## User Constraints (from CONTEXT.md)

No CONTEXT.md exists for this phase (verified: the phase dir `.planning/phases/03-skill-hardening/` contains no `*-CONTEXT.md`). This phase has not been through `/gsd-discuss-phase`, so there are no locked decisions. The planner has full discretion within the requirements (SK-04, SK-05) and the standing project decisions in `PROJECT.md`. Relevant standing constraints that bound this phase:

- ClaudeClaw is the host; agentic-os is the consumed workspace, run in place via cwd. **Do not vendor/copy or fork the workspace skills** — keep them portable so a terminal Claude Code session still works. (PROJECT.md Key Decisions)
- Both modes (terminal Claude Code session AND chat bot) must keep working after this phase. (COMPAT-01/02)
- The existing test suite must pass after this phase. (COMPAT-03)
- **DO NOT relax `getScrubbedSdkEnv` or the agentic-os deny list** to make API/file skills work — re-exposing secrets to a workspace skill is explicitly out of scope and a security regression. (Phase 1 + Phase 2 research, Security Domain)
- Prefer ClaudeClaw-side or settings-level guards, or a small workspace `SKILL.local.md`/agent-role convention, over forking upstream `SKILL.md`. (additional_context, this phase)
- The `aos` agent exists at `~/.claudeclaw/agents/aos/agent.yaml` (`project_dir` → agentic-os), delegation-only via `@aos:`, no `slack_channel` (user chose to skip it in Phase 2). (verified on disk)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SK-04 | Skills that assume the Command Centre, agentic-os hooks, or auto-download-to-Downloads degrade gracefully headless (no hard failure; fall back or route output through `[SEND_FILE:]`) | **Verified: no QoL behavior hard-fails headless today.** CC Notify (hook) no-ops gracefully (try/except swallows; log confirms it ran clean under bot turns). Auto-download (inline `cp ~/Downloads/`, NOT a hook, in 4 skills) silently succeeds but the chat user never sees the file → route via `[SEND_FILE:]` (Phase 2 path). Humanizer (skill, no API key) works headless. Clickable paths = harmless printed text. Full per-feature analysis + minimal fixes below. |
| SK-05 | Skill self-improvement feedback written to `context/learnings.md` is produced when a skill is invoked via the bot | **The real gap.** Both write paths fail one-shot: per-skill "Log feedback" is gated behind an interactive feedback question; `meta-wrap-up` only fires on interactive session-end. Verified: `learnings.md` mtime 2026-06-12 (before all 06-14 bot runs). Minimal fix: make the learnings append happen INLINE during the skill turn, decoupled from the feedback reply, via an `aos` role / `SKILL.local.md` convention. ClaudeClaw post-turn hook registry exists but is un-wired (heavier alternative). |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fire agentic-os hooks (ccnotify, session-sync, auto-commit) | Claude Agent SDK subprocess (loads `cwd/.claude/settings.json` via `settingSources:['project']`) | agentic-os hook scripts | The SDK runs the project hooks; ClaudeClaw only sets cwd. Hook failure mode is owned by the hook script's own error handling. |
| Decide whether an OS notification is shown | macOS `osascript` invoked by `ccnotify.py` | OS notification daemon | Headless launchd context: the toast posts but is unseen. Not ClaudeClaw's concern; it just must not crash the turn. |
| Copy binary output to `~/Downloads/` | Skill `SKILL.md` inline step (`cp`) running in the SDK subprocess | agentic-os skill instructions | Inline skill behavior, not a hook. Survives headless (cp allowed) but is invisible over chat → needs the chat-delivery overlay. |
| Deliver a produced file to the chat user | The agent's response text emitting `[SEND_FILE:]`/`[SEND_PHOTO:]` | ClaudeClaw `extractFileMarkers` (delegation branch, fixed in Phase 2) → transport upload | This is the SK-04 file-routing replacement for auto-download. Built and proven in Phase 2 (PNG delivered over `@aos:`). |
| Run the humanizer gate | `tool-humanizer` skill inside the SDK subprocess | `AGENTS.md` mandate + calling skill | Pure-reasoning skill, no external dependency; degrades to `standard` mode when no voice-profile. No headless issue. |
| Write skill feedback to `context/learnings.md` | Skill logic inside the SDK subprocess (the model performing a `Write`/`Edit`) | agentic-os `SKILL.md` "Log feedback" step / `meta-wrap-up` | **Today gated on interactivity → the SK-05 gap.** The write tool itself is allowed (`Edit(*)`/`Write(*)` in settings); only the trigger is missing under one-shot. Fix lives in the instruction layer (role / `SKILL.local.md`), not in ClaudeClaw code. |
| Persist a learnings write to git | `skill-auto-commit.js` PostToolUse hook | — | **Does NOT cover `learnings.md`** — the hook only matches `SKILL.local.md` and `CLAUDE.local.md` (verified). A learnings write stays uncommitted unless the agent commits it (allowed: `git add`/`git commit`). Note for the planner; not a blocker (the file change persists on disk regardless). |

## Standard Stack

No new npm packages. Brownfield instruction/config + verification phase using the existing stack. The agentic-os skills bring their own toolchain (already installed system-wide; verified in Phase 2).

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | 0.2.50 installed (`^0.2.34` floor) | Spawns `claude` in cwd=agentic-os; loads project hooks/settings; runs skills | Already the engine. [VERIFIED: Phase 1/2 research, node_modules] |
| `vitest` | ^2.1.9 installed | Test runner; COMPAT-03 gate | Existing suite (baseline 519 pass, 4 pre-existing failures per Phase 2 transcript). [VERIFIED: Phase 2] |
| `extractFileMarkers` + delegation file-send | shipped (Phase 2, PRs #16/#17) | Strips `[SEND_FILE:]`/`[SEND_PHOTO:]` and uploads the local path on the delegation path | The SK-04 file-routing replacement for auto-download; already proven delivering a PNG over `@aos:`. [VERIFIED: Phase 2 transcript + `src/format.ts`/`src/message-core.ts`] |
| `osascript` (macOS) | system | CC Notify backend | Built into macOS; ccnotify wraps it in try/except. [VERIFIED: ccnotify.py:472-487] |
| `tool-humanizer` skill | workspace | Strips AI patterns from publishable text | Pure reasoning, no API key, degrades to `standard` mode. [VERIFIED: SKILL.md head + AGENTS.md:426] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline learnings write (decoupled from feedback question) | ClaudeClaw post-turn hook that writes learnings | Heavier: `src/hooks.ts` registry is defined but **un-wired** (no caller of `createHookRegistry`/`loadHooksFromDir` in the live pipeline — verified). Would require wiring `postMessage`/`onSessionEnd` into `message-core.ts` + a hook that parses what skill ran. Couples learnings to ClaudeClaw and only helps the bot path (terminal still needs the inline write). The inline-instruction fix keeps both modes consistent and the workspace portable. Recommend inline; surface the hook option to the user. |
| Route auto-download files via `[SEND_FILE:]` | Delete the `~/Downloads/` copy step from the 4 skills | Forking upstream skills breaks terminal use and the "don't vendor" decision. Keep the Downloads step (harmless headless); ADD the marker via a role/`SKILL.local.md` overlay. |
| `aos` role-prompt instruction for marker + learnings | Per-skill `SKILL.local.md` overlays | Role-prompt is one place, applies to every skill, host-agnostic (lives in `~/.claudeclaw/agents/aos/`, not the shared workspace). `SKILL.local.md` is per-skill and is the upstream-blessed customization channel (auto-committed). Recommend role-prompt as primary, `SKILL.local.md` if per-skill nuance is needed. Decide in `/gsd-discuss-phase`. |

**Installation:** None.

## Package Legitimacy Audit

Not applicable — this phase installs no npm/PyPI/cargo packages into ClaudeClaw or the workspace. All work is instruction/config + verification reusing components already on disk. (If the planner adds a test helper that pulls a dependency, run the Package Legitimacy Gate at that point.)

## Architecture Patterns

### System Architecture Diagram (a QoL-touching skill turn, headless via `@aos:`)

```
Slack/Telegram: "@aos: design a login screen and send it to me"
        │
        ▼
[message-core.ts] processUserMessage → delegation branch (@aos:)
        │   delegateToAgent(aos) → runAgent(cwd = agentic-os, env scrubbed)
        ▼
Claude Agent SDK spawns `claude` in cwd = /Users/.../agentic-os
        │
        ├─ loads .claude/settings.json
        │     ├─ HOOKS fire on the turn:
        │     │    • UserPromptSubmit → run-ccnotify.js (records prompt; no-op visible)  [safe]
        │     │    • Stop            → run-ccnotify.js (osascript toast, unseen)          [safe — try/except]
        │     │    • Stop            → session-sync-stop.js (writes Command-Centre board) [safe — fire&forget]
        │     │    • PostToolUse Write/Edit on *.local.md → skill-auto-commit.js          [does NOT touch learnings]
        │     └─ DENY rules apply (curl/rm/wget/Read .env) — cp NOT denied
        │
        ├─ runs viz-interface-design / viz-stitch-design / tool-stitch
        │     ├─ Step "Save Output": writes file under projects/<skill>/...
        │     ├─ inline step: cp <file> ~/Downloads/         ◄── SUCCEEDS but chat user never sees it
        │     ├─ Humanizer gate (if publishable text): tool-humanizer, no API key  [safe]
        │     └─ inline step: "Log feedback to learnings.md" — GATED behind a feedback Q  ◄── SK-05 gap (skipped one-shot)
        │
        └─ agent final text:
              "Saved the login screen.
               [SEND_FILE:/Users/.../App Repo/agentic-os/projects/viz-interface-design/.../login.html]"   ◄── SK-04 fix
        │
        ▼
[message-core.ts] delegation branch → extractFileMarkers (Phase 2 fix) → cb.sendFile(path)
        ▼
File delivered as a chat attachment (the user-visible replacement for auto-download)
```

Two SK-04 overlays to add (host-agnostic, via the `aos` role / `SKILL.local.md`): emit the bracketed `[SEND_FILE:]` after any save/Downloads step. One SK-05 overlay: write the dated learnings entry inline, not gated on a feedback reply.

### Pattern 1: Chat-delivery overlay on top of auto-download (don't replace, augment)
**What:** Keep the agentic-os skill's `cp ~/Downloads/` step exactly as-is (it's harmless and keeps terminal behavior intact). Add an instruction — at the `aos` agent-role level — that after a skill saves a file or copies it to Downloads, the agent emits a bracketed `[SEND_FILE:<absolute path>]` (or `[SEND_PHOTO:]` for images) in its final message.
**When to use:** Any file-producing skill run over chat.
**Why it matters:** The Downloads copy is invisible to a chat user. The `[SEND_FILE:]` marker is the proven (Phase 2) headless delivery path. Augmenting rather than replacing keeps the workspace portable (terminal users still get the Downloads copy).
**Example (the marker the agent emits — bracketed form is mandatory for the `App Repo` space, per Phase 2):**
```text
Saved the login screen and copied it to Downloads.
[SEND_FILE:/Users/shannongueringer/App Repo/agentic-os/projects/viz-interface-design/2026-06-15_login/login.html|Login screen]
```

### Pattern 2: Inline learnings write, decoupled from the interactive feedback question
**What:** Instruct a bot-run skill to append its dated `## <skill>` learnings entry as part of execution (e.g. a one-line note of what was produced and any self-observed adjustment), instead of only logging "after the user answers the feedback question."
**Why it matters:** The one-shot bot turn never reaches the feedback reply (`mkt-copywriting` Step 10, `viz-*` "Log feedback" steps) and never triggers `meta-wrap-up`. An inline write fires during the turn the skill is already running. The `Write`/`Edit` tools are allowed by settings; the only missing piece is the trigger.
**Example (entry format, matches the existing file convention):**
```text
## mkt-copywriting
- 2026-06-15: Drafted SignMeUp taglines over chat (bot turn). Top pick "Sign-ups without the signup." Voice-profile applied; no user feedback turn in one-shot mode.
```
**Note:** A learnings write does NOT trigger `skill-auto-commit.js` (that hook only matches `SKILL.local.md`/`CLAUDE.local.md` — verified). The on-disk change persists regardless; if git persistence is wanted, instruct the agent to `git add context/learnings.md && git commit` (both allowed by the deny/allow lists).

### Anti-Patterns to Avoid
- **Deleting or rewriting the `cp ~/Downloads/` step in the upstream skills.** Forks the workspace, breaks terminal use, violates the "don't vendor" decision. Augment with a marker instead.
- **Relaxing `getScrubbedSdkEnv` or the deny list to "fix" anything.** No QoL feature needs it; doing so re-exposes every secret. (Phase 1/2 standing rule.)
- **Disabling agentic-os hooks to "harden" SK-04.** None of them hard-fail; disabling them would diverge terminal vs chat and lose the Command-Centre board sync that later phases (CKPT) rely on. Leave hooks running; they no-op safely.
- **Building a ClaudeClaw post-turn hook just for learnings.** The registry is un-wired; wiring it is more blast radius than an instruction, only helps the bot path, and couples learnings to the host. Reserve as the fallback if the inline instruction proves unreliable.
- **Editing upstream `SKILL.md` to hard-code a `[SEND_FILE:]` marker or an inline-learnings rule.** Couples the workspace to ClaudeClaw and breaks terminal. Use the `aos` role / `SKILL.local.md` overlay.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deliver a produced file over chat | A new upload path | `[SEND_FILE:]`/`[SEND_PHOTO:]` marker → `extractFileMarkers` + delegation file-send (Phase 2) | Already shipped and proven delivering a PNG over `@aos:`. Identical Slack/Telegram contract. |
| Detect that a skill produced a file | A file-watcher / parser of skill output | The agent already knows the absolute path it saved to; instruct it to emit the marker | The path is in the skill's own "show the user the full path" step; reuse it. |
| Strip AI patterns before saving | A custom humanizer | `tool-humanizer` skill (already mandated by AGENTS.md) | Pure reasoning, no API key, voice-aware; degrades to `standard` mode. |
| Persist skill feedback | A new feedback DB | Append to `context/learnings.md` `## <skill>` (existing convention) | The file, sections, and entry format already exist; only the trigger is missing one-shot. |
| Notify on task completion | Re-implement notifications for the bot | The bot already replies in chat (that IS the completion signal); CC Notify's unseen toast is irrelevant over chat | The chat reply replaces the OS toast; no work needed. |

**Key insight:** Almost everything for SK-04/SK-05 already exists. SK-04 file routing is a Phase-2 component reused via a one-line agent instruction; SK-05 is a trigger problem solved by moving an existing write step earlier in the skill flow. The temptation to "fix" the workspace (disable hooks, delete Downloads steps, wire a host hook) is the wrong instinct — the right fix is a thin, portable instruction overlay.

## Runtime State Inventory

Not a rename/refactor phase. This phase adds (a) an `aos` agent-role / `SKILL.local.md` instruction overlay and (b) verification artifacts. Inventory for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `ccnotify.db` (per-skill prompt/notification log, the hook's own SQLite) and `.command-centre/data.db` (board, written by `session-sync-*` hooks) accumulate rows from bot turns. This is expected and harmless; the Command-Centre repoint is Phase 9 (CKPT). No ClaudeClaw DB key/collection changes this phase. `context/learnings.md` gains new entries (the SK-05 goal). | None (learnings growth is the intended outcome) |
| Live service config | If the SK-04/SK-05 fix is a ClaudeClaw code change (NOT recommended — instruction is preferred), `npm run build` + restart, since the bot runs from `dist/`. If the fix is the `aos` agent-role text (in `~/.claudeclaw/agents/aos/CLAUDE.md`), restart the bot to clear the runtime cache (Phase 1 Pitfall 5). If the fix is a workspace `SKILL.local.md`, no rebuild — it's read live by the SDK at turn time. | Restart bot after role-text or code change; none for `SKILL.local.md` |
| OS-registered state | None new. The `aos` agent is delegation-only (no launchd plist, no `slack_channel`). CC Notify hook is OS-touching but already registered via settings.json (unchanged). | None |
| Secrets/env vars | None. Explicitly DO NOT add `*_API_KEY` to the SDK env. The QoL behaviors in scope need no key (humanizer is reasoning-only; auto-download/learnings are file ops). | None |
| Build artifacts | Only if a ClaudeClaw `src/*.ts` file is changed (not recommended). `dist/` rebuild + restart then. Instruction-only / `SKILL.local.md` changes need no rebuild. | Rebuild only if source changes |

**Verified explicitly:** No scheduler rows, no ClaudeClaw encrypted columns, no memory-DB collections, and no Task Scheduler entries are affected by this phase.

## Common Pitfalls

### Pitfall 1: Assuming auto-download "hard-fails" headless (it doesn't — it silently misbehaves)
**What goes wrong:** A planner reads "auto-download to Downloads may hard-fail headless" and writes a task to guard/disable it. In reality `cp <file> ~/Downloads/` SUCCEEDS under the bot (`~/Downloads/` exists; `cp` is not on the deny list — only `rm`/`curl`/`wget`/`pip install` are). The failure is invisibility: the chat user gets no file.
**Why it happens:** The deny list blocks destructive/network commands, not `cp`. [VERIFIED: settings.json deny block — no `cp`, no `Bash(cp *)`]
**How to avoid:** Don't guard `cp`. ADD a `[SEND_FILE:]` marker so the file reaches chat. Treat SK-04 as "make output visible over chat," not "stop a crash."
**Warning signs:** Skill replies "saved to Downloads" / "copied to ~/Downloads" with no attachment in chat.

### Pitfall 2: SK-05 learnings write is gated behind an interactive feedback turn that never comes
**What goes wrong:** A plan assumes the per-skill "Log feedback to learnings.md" step runs automatically. It does not — it is the LAST step, after "Ask: Does this sound like you?" (`mkt-copywriting` Step 10) or an equivalent feedback prompt. A one-shot delegation produces the deliverable and returns; the feedback exchange never happens, so the log step is skipped.
**Why it happens:** Skills were authored for interactive terminal sessions with a human reply loop. [VERIFIED: `mkt-copywriting/SKILL.md:130-136`; multiple skills grep-confirmed; `learnings.md` mtime 2026-06-12 predates all 06-14 bot runs]
**How to avoid:** Instruct the skill (via `aos` role / `SKILL.local.md`) to write a concise dated learnings entry INLINE during execution, independent of any feedback reply. Verify by diffing `learnings.md` after a bot turn.
**Warning signs:** `learnings.md` mtime/content unchanged after a bot-run skill; no new `## <skill>` entry.

### Pitfall 3: meta-wrap-up never fires under the bot
**What goes wrong:** Relying on `meta-wrap-up` to sweep up learnings at "session end." It triggers only on interactive end signals ("thanks", "done for today", "/wrap-up"). A delegated bot turn sends none of these; there is no session-end event.
**Why it happens:** `meta-wrap-up` is explicitly an interactive end-of-session checklist. [VERIFIED: meta-wrap-up/SKILL.md description + trigger list]
**How to avoid:** Do not depend on `meta-wrap-up` for SK-05. Use the inline write (Pitfall 2 fix). If the user wants a periodic sweep, a scheduled `@aos: run meta-wrap-up` job is possible later (Phase 7 scheduler), but it is not the SK-05 mechanism.
**Warning signs:** Plan tasks that reference "session end" or "wrap-up" for a bot turn.

### Pitfall 4: learnings.md writes are not auto-committed
**What goes wrong:** Assuming the `skill-auto-commit.js` PostToolUse hook persists a learnings write to git. It does not — it matches only `.claude/skills/<name>/SKILL.local.md` and `CLAUDE.local.md` (verified regex). A learnings write lands on disk but stays uncommitted.
**Why it happens:** The auto-commit hook was scoped to skill-customization files, not learnings. [VERIFIED: skill-auto-commit.js:31-43]
**How to avoid:** This is usually fine (the on-disk change is what SK-05 requires). If git durability is wanted, the SK-05 instruction can add `git add context/learnings.md && git commit -m "..."` (both git subcommands are allow-listed). Flag for the planner; don't change the hook.
**Warning signs:** `git status` shows `context/learnings.md` modified-but-uncommitted after a bot turn (this is acceptable, just note it).

### Pitfall 5: CC Notify's "Notification sent" log is not proof a human saw anything
**What goes wrong:** Treating the ccnotify log line `Notification sent` as evidence the QoL feature "works" over chat. Under launchd headless, `osascript` may post to a session no one is viewing (or be swallowed by the try/except). The chat reply is the real completion signal; the toast is dead weight headless.
**Why it happens:** `send_notification` wraps everything in `try/except Exception` and logs success/failure without affecting the turn. [VERIFIED: ccnotify.py:431-470; log shows clean runs under the 06-14 bot sessions]
**How to avoid:** For SK-04, the acceptance criterion for CC Notify is simply "does not hard-fail the turn" (it doesn't). No fix needed; document it as a graceful no-op.
**Warning signs:** None — this is the safe case. The pitfall is over-engineering a fix for a non-problem.

### Pitfall 6: SKILL.local.md overlay must match the auto-commit path or it won't persist as a customization
**What goes wrong:** If the planner chooses `SKILL.local.md` overlays (instead of the `aos` role) and writes them to the wrong path, `skill-auto-commit.js` won't commit them and a future workspace update could clobber expectations.
**Why it happens:** The hook matches exactly `.claude/skills/<name>/SKILL.local.md`. [VERIFIED: skill-auto-commit.js:35]
**How to avoid:** If using `SKILL.local.md`, write to the exact `.claude/skills/<skill>/SKILL.local.md` path so the auto-commit hook persists it and updates never overwrite it (it's gitignored-from-overwrite by design per README "Your Data is Safe"). Prefer the `aos` role overlay (single location, no path trap) unless per-skill nuance is required.
**Warning signs:** Overlay file in a non-standard path; customization lost after a workspace pull.

### Pitfall 7: hooks fire on every workspace turn (carried from Phase 1/2)
**What goes wrong:** Every bot turn against the workspace fires SessionStart/UserPromptSubmit/Stop/PostToolUse/PreToolUse hooks, including `gsd-check-update.js` (background network update check) and `session-sync-*` (Command-Centre board writes). These are noise, not failures.
**Why it happens:** `settingSources:['project']` loads the hooks. [CITED: code.claude.com/docs/en/agent-sdk/hooks; verified Phase 1]
**How to avoid:** Accept them. They each parse stdin in try/catch and return silently on bad input (verified). Don't disable in this phase. The Command-Centre board writes are wanted later (CKPT phase).
**Warning signs:** SDK stderr noise about hook scripts; background commits — both benign here.

## Code Examples

### The `[SEND_FILE:]` marker the agent must emit (SK-04 file routing) — bracketed form mandatory
```text
# Source: Phase 2 research (verified parser-safe with the "App Repo" space)
Saved the diagram and copied it to Downloads.
[SEND_FILE:/Users/shannongueringer/App Repo/agentic-os/projects/viz-stitch-design/2026-06-15_login/login.png|Login mockup]
```

### Inline learnings entry (SK-05) — append to the skill's existing `## <skill>` section
```text
# Source: context/learnings.md existing convention (verified format)
## viz-interface-design
- 2026-06-15: Produced a login screen over chat (bot, one-shot). Delivered via [SEND_FILE:]. No interactive feedback turn; logged inline.
```

### CC Notify gracefully swallows failures (no hard-fail) — for the planner's reference, do NOT change
```python
# Source: agentic-os/.claude/hooks_info/ccnotify.py:431-470 (verified)
try:
    if system == "Darwin":
        self._notify_macos(title, subtitle, message)   # osascript; may raise
        logging.info("Notification sent: %s - %s", title, subtitle)
        return
    ...
except Exception as error:
    logging.error("Error sending notification: %s", error)   # swallowed — turn continues
```

### skill-auto-commit does NOT cover learnings.md — for the planner's reference
```javascript
// Source: agentic-os/.claude/hooks/skill-auto-commit.js:35-43 (verified)
const skillMatch  = normalized.match(/\.claude\/skills\/([^/]+)\/SKILL\.local\.md$/);
const claudeMatch = normalized.match(/(?:^|\/)CLAUDE\.local\.md$/);
// no match for context/learnings.md → a learnings write is NOT auto-committed
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Skill feedback persisted at interactive session end (meta-wrap-up) or after a feedback reply | One-shot bot turns never reach either trigger → learnings must be written inline during the turn | This consolidation (Phase 3) | SK-05 is a trigger relocation, not a new system. |
| File output reached the user via `~/Downloads/` (desktop assumption) | Over chat, the file must be emitted as a `[SEND_FILE:]` marker (Phase 2 path) and ALSO copied to Downloads for terminal parity | Phase 2 + this phase | Augment, don't replace, the Downloads step. |
| QoL features assumed an interactive desktop (toasts, clickable paths, Downloads) | Headless bot turn: toasts unseen (safe no-op), paths are just text, Downloads invisible → chat delivery + chat reply replace them | This phase | None hard-fail; the work is making output user-visible over chat. |

**Deprecated/outdated:** None. No package or API is stale. The agentic-os skills are interactive-first; the consolidation overlays bot-friendly behavior without forking them.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `aos` agent will reliably emit a bracketed `[SEND_FILE:]` after a save/Downloads step when instructed via its role | Pattern 1 / SK-04 | LLM compliance is probabilistic (same risk class as Phase 2's marker emission, which worked). Mitigated: explicit short instruction + a live transcript as proof. If flaky, fall back to a `SKILL.local.md` per-skill rule or (last resort) a deterministic ClaudeClaw-side converter. |
| A2 | An inline learnings-write instruction will make a bot-run skill append to `learnings.md` without an interactive feedback turn | Pattern 2 / SK-05 | Same probabilistic-compliance risk. Mitigated by an explicit "write the entry as part of finishing, do not wait for feedback" instruction + verifying the file diff after a turn. The un-wired ClaudeClaw post-turn hook remains the deterministic fallback if needed. |
| A3 | No agentic-os QoL behavior hard-fails the turn headless | SK-04 summary / Pitfalls 1,5,7 | Verified for CC Notify (try/except + clean log), auto-download (cp allowed), humanizer (no API key), session-sync (fire&forget, Phase 1). Residual risk: an untested file-producing skill could shell out to a denied tool — mitigated by running the SK-04 proof against a known-safe skill (`viz-interface-design` or `viz-stitch-design`, HTML/PNG, no network at save time) and capturing the transcript. |
| A4 | The four README QoL features are the complete SK-04 surface | SK-04 | If a skill has another desktop assumption not surfaced in the README (e.g. opening a browser, an MCP that needs a GUI), it could misbehave. Mitigated: the README QoL list + the four enumerated mechanisms (hook / inline cp / skill / printed text) were each traced to source. Broaden the live test if a skill in scope uses an MCP (`tool-stitch` uses `mcp__stitch__*` — confirm that MCP is available headless or treat that skill as out-of-scope for the proof). |

## Open Questions

1. **Where should the SK-04 marker + SK-05 inline-learnings instructions live — `aos` agent-role (`~/.claudeclaw/agents/aos/CLAUDE.md`) or per-skill `SKILL.local.md` overlays?**
   - What we know: Role text is one host-agnostic location applying to all skills (prepended as `[Agent role]` on the first message — Phase 1 Pattern 2). `SKILL.local.md` is the upstream-blessed, auto-committed, update-safe per-skill customization channel, but is per-skill and lives in the shared workspace.
   - Recommendation: **`aos` role-prompt as primary** (single place, host-agnostic, no path trap), reserving `SKILL.local.md` for any skill that needs nuance the role can't express. Decide in `/gsd-discuss-phase`.

2. **Which skill is the SK-04 file-routing proof?**
   - What we know: `viz-excalidraw-diagram` already proved file delivery in Phase 2 but does NOT do the Downloads copy. The auto-download skills are `tool-stitch` (needs `mcp__stitch__*` — MCP availability headless unknown), `viz-interface-design` and `viz-stitch-design` (HTML/PNG, local), `meta-skill-creator` (eval set, niche).
   - Recommendation: Use `viz-interface-design` or `viz-stitch-design` as the SK-04 proof (does the `cp ~/Downloads/` step AND a local file output, no network at save). Confirm one delivers via `[SEND_FILE:]` over chat while still copying to Downloads. Avoid `tool-stitch` for the proof unless the stitch MCP is confirmed headless-available.

3. **Does the user want learnings writes committed to git automatically?**
   - What we know: A learnings write is NOT auto-committed (Pitfall 4); it persists on disk regardless. Committing requires the agent to run `git add`/`git commit` (allowed).
   - Recommendation: SK-05 acceptance = a new on-disk entry after a bot turn (sufficient per the requirement wording "feedback written to learnings.md"). Offer optional auto-commit to the user; don't make it the gate.

4. **Automatable vs live-transcript verification?**
   - What we know: The `[SEND_FILE:]` delegation routing already has Phase 2 unit coverage. The "no hard-fail headless" and "learnings entry appears" behaviors live inside the SDK subprocess + LLM compliance — not unit-testable in ClaudeClaw.
   - Recommendation: Unit-test only what's deterministic (already covered by Phase 2; add a tiny helper test only if a new helper is built). Prove SK-04/SK-05 end-to-end with one live chat transcript: a file-producing skill turn that (a) does not error, (b) delivers the file via `[SEND_FILE:]`, and (c) leaves a new dated `learnings.md` entry.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `aos` agent (`~/.claudeclaw/agents/aos/agent.yaml`) | SK-04/SK-05 (the cwd + delegation route) | ✓ | exists, delegation-only, no `slack_channel` | None — required |
| `[SEND_FILE:]` delegation routing (Phase 2 #16/#17) | SK-04 file delivery | ✓ | shipped + proven (PNG over `@aos:`) | Route `aos` via `slack_channel` (main path also extracts markers) |
| `~/Downloads/` dir | auto-download skills | ✓ | standard macOS dir | n/a |
| `cp` (not deny-listed) | auto-download step | ✓ | system | n/a |
| `osascript` | CC Notify | ✓ | system (macOS) | Failure swallowed; no fallback needed |
| `tool-humanizer` skill | humanizer gate | ✓ | workspace `.claude/skills/tool-humanizer` | Degrades to `standard` mode without voice-profile |
| `context/learnings.md` | SK-05 | ✓ | exists, sectioned by skill | n/a |
| `Edit(*)`/`Write(*)` permission | SK-05 inline write | ✓ | allow-listed in settings.json | n/a |
| `mcp__stitch__*` (only if `tool-stitch` is the proof) | tool-stitch | ✗ unknown headless | — | Use `viz-interface-design`/`viz-stitch-design` instead (no MCP) |
| ClaudeClaw post-turn hook registry | SK-05 fallback only | ✗ defined but un-wired | `src/hooks.ts` | Inline-instruction fix (primary) makes this unnecessary |

**Missing dependencies with no fallback:** None block this phase. The `aos` agent and the Phase 2 delivery path are present.
**Missing dependencies with fallback:** `mcp__stitch__*` (choose a non-MCP proof skill); the un-wired ClaudeClaw hook (use the inline-instruction fix).

## Validation Architecture

`workflow.nyquist_validation: true` — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.9 |
| Config file | `package.json` (`vitest` key) + colocated `*.test.ts` |
| Quick run command | `npx vitest run src/format.test.ts src/message-core.test.ts` |
| Full suite command | `npm test` (→ `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SK-04 | `[SEND_FILE:]` with a space-containing workspace path delivers via the delegation branch | unit | `npx vitest run src/format.test.ts -t "space"` and the Phase 2 delegation file test | ✅ (shipped in Phase 2; re-assert, no new code) |
| SK-04 | A file-producing skill that copies to Downloads ALSO delivers the file over chat, and the turn does not hard-fail | manual/smoke | `@aos: design a login screen with viz-interface-design and send it to me` → expect a chat attachment + no error | ❌ manual-only (justified: SDK subprocess + LLM compliance over a live transport) |
| SK-04 | CC Notify / session-sync hooks do not hard-fail the turn | manual/smoke | observe a normal completed reply; check no SDK error surfaced; ccnotify.log shows a clean run | ❌ manual-only (justified: hook behavior lives in the subprocess) |
| SK-05 | A bot-run skill appends a new dated entry to `context/learnings.md` `## <skill>` | manual/smoke | capture `learnings.md` before; run `@aos:` skill turn; `git diff context/learnings.md` shows a new dated entry | ❌ manual-only (justified: write happens inside the subprocess via LLM-followed instruction) |
| SK-05 | (optional) A learnings-append helper, if built, formats the entry correctly | unit | `npx vitest run <new helper>.test.ts` | ❌ Wave 0 only if a helper is built (likely NOT needed — fix is instructional) |
| COMPAT-03 | Existing suite still green | full | `npm test` | ✅ (baseline 519 pass, 4 pre-existing failures per Phase 2) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/format.test.ts src/message-core.test.ts` (only if any ClaudeClaw source changes; this phase is mostly instruction/config)
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test` at the documented baseline + a live transcript showing (a) no hard-fail, (b) `[SEND_FILE:]` delivery from an auto-download skill, (c) a new `learnings.md` entry from a bot turn.

### Wave 0 Gaps
- [ ] (Likely none.) The deterministic surface (`extractFileMarkers`, delegation file-send) is already covered by Phase 2 tests. Only add a unit test if the planner chooses to build a learnings-append helper rather than a pure instruction.
- [ ] (Manual harness) A short reproducible checklist for the SK-04/SK-05 live turn: capture `learnings.md` mtime/diff before, run the `aos` skill turn, confirm attachment + new learnings entry + clean ccnotify.log.
- Framework install: none — vitest present.

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high` — section included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface. |
| V3 Session Management | no | Reuses the per-chat delegation session; no change. |
| V4 Access Control | yes | The workspace runs under `bypassPermissions`; the agentic-os deny list still applies (curl/rm/ssh/Read .env). This phase adds NO new tool access — `cp`, `Write`/`Edit` of `learnings.md`, and `git add/commit` are already allow-listed. No broadening. |
| V5 Input Validation | yes | The `[SEND_FILE:]` marker path (reused from Phase 2) parses agent-controlled text into a file path uploaded by ClaudeClaw; `fs.existsSync` guards before upload (Phase 2). No new parsing introduced. The inline learnings write targets a fixed file (`context/learnings.md`) within the workspace. |
| V6 Cryptography | no | No crypto change. |
| V7 Secrets | yes | **DO NOT relax `getScrubbedSdkEnv` or the deny list.** No QoL behavior in scope needs a secret: humanizer is reasoning-only, auto-download/learnings are local file ops, CC Notify is local osascript. Keeping the scrub + deny intact is a hard constraint. [VERIFIED: Phase 1/2 Security Domain] |

### Known Threat Patterns for this phase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent emits `[SEND_FILE:]` pointing at an arbitrary local file (a secret, `/etc/passwd`) and uploads it to chat | Information Disclosure | Carried from Phase 2: the main-path behavior already uploads any `existsSync` path the agent names; the exfiltration text-scan does NOT inspect uploaded file CONTENTS. On a single-user personal machine with the user's own agent this is the existing surface — no regression. Optionally constrain SK-04 uploads to under the workspace `projects/` / `~/Downloads/` dirs. Flag for the planner. |
| Inline learnings write injects attacker-controlled text into `learnings.md`, later loaded as skill context (prompt-injection persistence) | Tampering / EoP | The content written is the agent's own dated note about its own run, on a trusted local repo. Low risk on a personal machine; the file is human-readable and the user can audit/revert. Keep entries to short factual notes (the instruction should say so). |
| A QoL hook is replaced with a malicious script in the workspace | EoP | Trusted local repo (Phase 1 mitigation); don't point `aos` at an untrusted workspace. No new hooks added this phase. |

## Sources

### Primary (HIGH confidence)
- agentic-os workspace (read directly this session): `.claude/settings.json` (full hooks + permissions), `.claude/hooks/` listing, `run-ccnotify.js`, `skill-auto-commit.js`, `hooks_info/ccnotify.py` (Stop/notify/exit), `hooks_info/ccnotify.log` (confirming clean hook runs under the 06-14 bot sessions), `context/learnings.md` (format + mtime 2026-06-12), `.claude/skills/meta-wrap-up/SKILL.md`, `.claude/skills/tool-humanizer/SKILL.md` (head), `.claude/skills/mkt-copywriting/SKILL.md` (feedback step), `tool-stitch`/`viz-interface-design`/`viz-stitch-design` Downloads steps, `AGENTS.md` Humanizer Gate (:424-430), `README.md` Quality of Life (:422-441)
- ClaudeClaw source (read directly): `src/hooks.ts` (registry defined, un-wired — confirmed no caller of `createHookRegistry`/`loadHooksFromDir` in `src/`), `src/agent.ts` (settingSources, error/result handling), `~/.claudeclaw/agents/aos/agent.yaml`
- `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`, `.planning/config.json`
- Phase 1 `01-RESEARCH.md` (env scrub, deny list, hooks-fire, path-with-spaces, caching), Phase 2 `02-RESEARCH.md` + `sk01-sk02-sk03-transcripts.md` (delegation marker fix shipped, PNG delivered over `@aos:`, bracketed-marker rule)

### Secondary (MEDIUM confidence)
- Claude Agent SDK docs cited in Phase 1 (hooks load via `settingSources:['project']`; deny always wins under bypass) — carried forward, not re-fetched.
  - https://code.claude.com/docs/en/agent-sdk/hooks
  - https://code.claude.com/docs/en/agent-sdk/permissions

### Tertiary (LOW confidence)
- None — every load-bearing claim verified against the workspace files, ClaudeClaw source, machine state (file mtimes, ccnotify log), or Phase 1/2 verified findings.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all components verified on disk + reused from Phase 2.
- SK-04 per-feature failure analysis (CC Notify no-op, auto-download silent-success, humanizer fine, paths harmless): HIGH — each mechanism traced to source (hook scripts, SKILL.md steps, settings.json deny list) and CC Notify confirmed running clean under the actual 06-14 bot sessions.
- SK-05 root cause (interactive-gated learnings write + meta-wrap-up never fires one-shot): HIGH — confirmed by SKILL.md inspection AND `learnings.md` mtime predating all bot runs. The inline-write fix is sound; LLM compliance (A1/A2) is MEDIUM and mitigated by live-transcript verification.
- "No hard-fail" claim (A3): HIGH for the four enumerated features; MEDIUM residual for any unexamined skill with a different desktop assumption — mitigated by choosing a known-safe proof skill.

**Research date:** 2026-06-15
**Valid until:** 2026-07-15 (re-verify if agentic-os hooks/settings.json, the four QoL skills, the `learnings.md` convention, or the ClaudeClaw delegation/marker path change)
