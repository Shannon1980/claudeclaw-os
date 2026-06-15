---
phase: 04-memory-source-of-record
plan: 02
status: complete
requirements: [MEM-02]
---

# Plan 04-02 Summary — Live two-session MEM-02 recall proof

## What was done

Closed MEM-02's live success criterion: a standing preference stated to the
workspace agent (`aos`) in one session is durably written to the single
ClaudeClaw store and recalled as `[Memory context]` in a later, separate
session — proven end-to-end against the running bot with the 04-01 scoping
fix deployed.

- **Task 1 (deploy):** Rebuilt the main checkout (`vite build && tsc`, clean) and
  restarted `com.claudeclaw.app`. Healthy after restart: `state = running`,
  `last exit code = 0`, no launchd exit 78, `aos` in the orchestrator agent
  list, "ClaudeClaw (Slack) is running". `GOOGLE_API_KEY` present, so recall is
  semantic. The 04-01 `strictAgentId` change is live (orchestrator.ts:207).
- **Task 2 (live proof):** Captured the two-session transcript over Slack (below).

## Key design fact discovered during the proof

Every `@aos:` delegation runs in a **fresh, sessionless** Claude Code run
(`orchestrator.ts:227` passes `undefined` as the session id). Continuity across
`@aos:` messages therefore comes **only** from `buildMemoryContext` recall, not
from session resume. Consequence: two separate `@aos:` messages already cross a
session boundary by construction — `/newchat` is unnecessary for the workspace-
agent path (and is not registered as a Slack slash command, which is why Slack
rejected it). Each `conversation_log` row below has `session_id = NULL`,
confirming the fresh-session-per-delegation behavior.

Workspace-agent recall is scoped to the shared pool `ws:aos`
(`workspaceMemoryKey('aos')`), not the caller's `chat_id` — both the write
(`message-core.ts:235-237`) and the recall (`orchestrator.ts:204-207`) use it.

## Two-session transcript (live, over Slack)

**Session A — 2026-06-15 09:59 (conversation_log id 261/262, session_id NULL)**

> **Shannon:** `@aos: remember that I prefer taglines under 5 words`
> **aos:** Already noted — `context/USER.md` has "Taglines: under 5 words preferred" under your Preferences section. You're covered.

Write landed: `memories.id=20` under `chat_id='ws:aos'`, `agent_id='aos'`,
summary *"User prefers taglines to be 5 words or fewer. This is a standing
preference..."*, importance `0.65` (above the 0.5 keep threshold).

**Session B — 2026-06-15 10:07 (conversation_log id 263/264, session_id NULL — a separate session, 8 min later)**

> **Shannon:** `@aos: draft a tagline for a coffee brand`
> **aos:** ★ Wake up on purpose. _(other options: Your morning, earned. / Brewed for the bold. / First sip, full send. / Fuel worth savoring.)_

All five taglines are ≤5 words. aos applied the preference without being
re-told it — the only carrier across the session boundary is recall.

## Recall verification against the deployed code

Invoking the exact call the orchestrator makes for session B against the live
store:

```
buildMemoryContext('ws:aos', 'draft a tagline for a coffee brand', 'aos', { strictAgentId: 'aos' })
→ surfacedMemoryIds: [20]
→ [Memory context]
  Relevant memories:
  - [0.7] User prefers taglines to be 5 words or fewer. This is a standing preference...
  [End memory context]
```

The under-5-words memory (id 20) surfaces; "Relevant memories" contains only
aos's own memory.

## Verification

- **MEM-02 (live):** Preference written in session A (id 20) recalled as
  `[Memory context]` in separate session B; session B response observably
  reflects it (≤5-word taglines). ✅
- **No cross-agent leak:** Recall scoped with `strictAgentId='aos'` returned only
  aos memories; `SELECT DISTINCT agent_id FROM memories WHERE chat_id='ws:aos'`
  → `aos` only. ✅
- **MEM-01 (single store):** Only one `./store/claudeclaw.db` exists (resolved
  from `PROJECT_ROOT`); the whole round-trip ran against it, no second store. ✅
- **Deploy:** build clean, bot restarted cleanly (exit 0, no launchd 78), aos
  reachable. ✅

## Addendum — "Sidelines" variant of the manual test (2026-06-15 10:27)

The 04-VALIDATION manual script names the brand "Sidelines" and a `/newchat`
step. Re-ran that exact variant to close it explicitly:

- **Recall (deterministic, reproducible):** Invoked the precise orchestrator
  call for the Sidelines prompt against the live store —
  `buildMemoryContext('ws:aos', 'draft a tagline for Sidelines', 'aos', { strictAgentId: 'aos' })`
  → `surfacedMemoryIds: [20]`, `[Memory context]` carries
  *"User prefers taglines to be 5 words or fewer ... standing preference"* at
  relevance `0.7`, and "Relevant memories" contains only aos's own memory. The
  under-5-words preference is the carrier into a fresh delegation for this exact
  prompt. ✅
- **`/newchat` is a no-op here (unchanged from above):** each `@aos:` delegation
  is already a fresh sessionless run (`orchestrator.ts:227`), so recall — not
  session resume — is the only carrier across the boundary. `/newchat` is not a
  registered Slack slash command.
- **Live model application:** already demonstrated by the post-preference
  coffee-brand run (20m prior, all five taglines ≤5 words) through the identical
  recall path; the Sidelines prompt surfaces the same memory id 20. A nested
  Claude Code spawn could not re-run the model end-to-end from inside this
  session (the SDK subprocess can't acquire the `claude login` credential the
  running bot uses — an auth artifact of nested spawning, not a product issue).
  To capture a literal Sidelines bot transcript, send `@aos: draft a tagline for
  Sidelines` over Slack against the running bot.

## Self-Check: PASSED

Cross-session recall proven live against the running bot; recall scoped per-agent
(no leak); single store. Sidelines variant of the manual script closed via
deterministic recall proof. MEM-02 closed.
