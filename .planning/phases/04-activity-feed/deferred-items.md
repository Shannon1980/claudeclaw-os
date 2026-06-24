# Phase 04 Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed by this phase's plans.

| Found | Item | Why deferred |
|-------|------|--------------|
| 04-02 Task 1 | `src/dashboard.contract.test.ts` "auth gate > serves SPA shell at / without a token" and "at /warroom without a token" fail on unmodified HEAD | Pre-existing failures unrelated to the activity feed. They expect a non-401 SPA shell that depends on `DASHBOARD_LEGACY`, which the contract test harness does not set. Verified failing on `git show HEAD` originals before any 04-02 change. Out of scope per the executor scope boundary. |
| 04-03 Task 1 | Undo inverse tool NAMES not confirmed against a live MCP `tools/list` (RESEARCH A1) | No MCP servers were configured in this execution environment (`.claude/settings.json` absent; user `~/.claude/settings.json` has an empty `mcpServers`), so the `[ASSUMED]` inverse tool names could not be confirmed live. See the detailed note below. The executor is structurally correct and the floor family (label-remove) is proven end-to-end against an injected fake server; absent families fail honestly with "Connect <server> in Settings to undo this" (D-08), never faked. Confirm names at end-of-phase human-verify (plan 04). |

## Undo families: end-to-end inverse confirmation (D-08)

**Deferred at:** 04-03 (Undo vertical slice)

D-08 requires at least ONE reversible family to undo end-to-end via a real
inverse. The undo-executor ships all three families (labels, drafts, meetings)
with concrete inverse tool mappings and a structurally-correct MCP dispatch
(mirrors replay-executor.replayMcp). The floor family (label-remove ->
`mcp__gmail__remove-label`) is proven end-to-end in `src/undo-executor.test.ts`
against an injected fake JSON-RPC server: the inverse is dispatched and the
derived structured-JSON arguments round-trip.

**What is deferred:** confirming the exact inverse tool NAMES against the
operator's actually-connected MCP servers. At execution time this environment
had NO MCP servers configured (`.claude/settings.json` absent; user
`~/.claude/settings.json` has an empty `mcpServers`), so the `[ASSUMED]` names
from 04-RESEARCH (A1) could not be confirmed against a live `tools/list`.

The assumed inverse tool names are:
- labels: `mcp__gmail__remove-label` (floor family)
- drafts: `mcp__gmail__delete-draft`
- meetings: `mcp__gcal__delete-event`

**Honest behavior in the meantime:** any family whose server is not connected
fails with "Couldn't undo. Connect <server> in Settings to undo this." It never
fakes an inverse and never silently no-ops (D-08/D-09). When the operator
connects their gmail/gcal servers, confirm the real tool names via
`tools/list` and adjust `inverseFor()` in `src/undo-executor.ts` if they differ
from the assumed names above. The shared `isUndoableFamily` allowlist
(`src/activity.ts`) stays the single source of truth.

**Follow-up owner:** end-of-phase human-verify (plan 04) runs a real
end-to-end undo of the floor family against a connected MCP server.
