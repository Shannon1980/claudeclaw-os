# Phase 3: Permissions & Autonomy - Research

**Researched:** 2026-06-23
**Domain:** Agent SDK tool-call interception (`canUseTool` gate), autonomy policy engine, approval-queue persistence, audit recording
**Confidence:** HIGH on the gate mechanism (read directly from installed SDK source + type defs); HIGH on storage/audit (read actual db.ts/security.ts).

> **⚠ ORCHESTRATOR CORRECTION (read before planning):** This research was generated from the MAIN checkout, which does NOT contain the Phase 2 routine code. Its original "L-1" finding that routines are absent is **WRONG for this branch.** On this branch Phase 2 IS present: `src/routine-runner.ts` exists with `runRoutineOnce(task, steps, nextRun, deps)` and `execContext = { autonomy: task.autonomy ?? 'unattended' }` (line 96); steps run via `deps.delegateToAgent` (line ~122); `src/scheduler.ts` has a `source==='routine'` branch + an exported `triggerRoutineRun`. **The routine→gate seam is REAL, not forward-compat.** Everywhere this doc says "routines absent / build forward-compatible / one-line pass when Phase 2 lands," instead: wire `execContext.autonomy` (`unattended` | `queue_approval`) into the gate context now, in the same change. The generic `GateContext { attended, routineAutonomy }` design below is still correct — it simply binds to a seam that already exists. All gate-mechanism, storage, audit, and tier-map findings remain valid (they were read from `src/agent.ts`/`db.ts`/`security.ts` + the installed SDK, which are identical in both checkouts).

## Summary

The make-or-break finding is unambiguous: the **installed `@anthropic-ai/claude-agent-sdk@0.2.50`** exposes a first-class `canUseTool` callback option on `query()`. I read its exact signature, its `PermissionResult` return shape, and the runtime wiring in `sdk.mjs`. The callback is `async`, returns `Promise<{behavior:'allow'|'deny', ...}>`, is invoked **before every tool execution** (built-in and MCP), and when supplied the SDK transparently routes all permission decisions through it by pushing `--permission-prompt-tool stdio`. This is exactly the interception point D-09 locked. **`canUseTool` is mutually exclusive only with `permissionPromptToolName`, NOT with `permissionMode`** — so the current `permissionMode: 'bypassPermissions'` line must be removed (or changed to `'default'`) when the gate is introduced, because bypass mode skips prompting entirely. The async return means inline-ask (D-04) and queue-and-wait (D-07/D-08) both fit the SAME mechanism: the callback simply does not resolve until the operator decides (or a TTL fires).

The second critical finding reshapes the plan: **Phase 2 routines code is not on `main` and not on this worktree branch.** There is no `routine-runner.ts`, no `execContext.autonomy`, no `queue_approval` anywhere in `src/`. The CONTEXT and UI-SPEC reference these as existing seams; they do not exist yet. The real background-run paths that exist today are `src/scheduler.ts` (scheduled tasks + mission tasks) calling `runAgent(...)` directly. The gate must be designed to receive a per-run "attended vs background" context that scheduler/mission supply now, with a forward-compatible slot for routine autonomy once Phase 2 lands.

The third finding: `runAgent`/`runAgentWithRetry` in `src/agent.ts` take **positional arguments** (no `agentRuntime`/`opts` object as CONTEXT assumed). Threading gate context (mode, overrides, attended-flag, chatId/agentId for audit + queue attribution) means either appending a positional `gateContext` arg or — cleaner — refactoring to an options object. The existing `audit()` pipeline in `src/security.ts` and the `audit_log` + `dashboard_settings` tables in `src/db.ts` are ready to reuse with minimal extension.

**Primary recommendation:** Build a single `gate.ts` module that exports a `makeCanUseTool(ctx)` factory returning the SDK `CanUseTool` callback. It classifies tool→tier (by name pattern), resolves tier→outcome against the stored mode+overrides, records every decision via `audit()`, and for "ask" outcomes either (a) blocks awaiting an inline yes/no when `ctx.attended` (live chat), or (b) inserts a row into a new `approval_queue` table and resolves `deny` immediately (background runs). Remove `permissionMode: 'bypassPermissions'`; pass `canUseTool` + the gate context per turn. Pin the SDK at the installed `0.2.50` family (`^0.2.34` currently resolves there) and add a startup assertion that `canUseTool` is a supported option.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Locked Tier 4 = money movement (QuickBooks pay / pay-invoice, payment links that move money, purchases), contract signing (DocuSign-style), and permanent data deletion. Never settable to Always, in any mode — always ask, shown with a lock.
- **D-02:** Everything else reaching outside (Slack/Gmail external send, calendar create/move with external attendees, public posts) is Tier 3 (asked in Cautious/Balanced, auto in Autonomous with notify-after), not locked. Tier 2 = low-stakes external (labels, Drive save, internal-only meetings). Tier 1 = read & prepare (research, read, draft, summarize, internal tasks) — always silent.
- **D-03:** Concrete tool→tier mapping for every exposed tool (built-ins, Bash, MCP) is the researcher's enumeration job per D-01/D-02. Unknown/unclassified tools default to the safe side (≥ Tier 3 — ask — never silently auto-run an unclassified external tool).
- **D-04:** Inline in chat, queue for background. Live-chat Tier 3/4 actions ask inline (yes/no) and run the prepared action on yes. Routine/mission/background runs queue as a "Needs you" item.
- **D-05:** Tier 4 inline approval is per-instance only — approving once never sets Always (lock holds). Approving means "approve this ready-to-send thing."
- **D-06:** Gate ALL runs — chat, routines, missions — from the start (single gate, one policy). Routines pass stored autonomy (`unattended` | `queue_approval`) into the same gate.
- **D-07:** Build the approval-queue data model (prepared tool call + params + tier + originating run, with pending/approved/denied/expired state) + a minimal one-tap approve/deny surface on the existing Home page.
- **D-08:** On one-tap approval, the prepared action is replayed (captured tool call runs with stored params). Exact replay mechanism is the researcher's call, but the queued item must carry enough to execute without redoing the agent's reasoning.
- **D-09:** Implement the gate as a `canUseTool` callback on `query()` (replacing `permissionMode:'bypassPermissions'` in `src/agent.ts`). Callback classifies tool→tier, evaluates against mode + per-action overrides, returns proceed / queue / deny. Confirm exact SDK affordance against installed version (DONE — see Standard Stack).
- **D-10:** Every decision recorded via existing `audit()` / `audit_log` (action, detail, blocked, agent_id, chat_id). Record tool, resolved tier, mode, outcome in `detail`. Extend `audit_log` minimally only if needed; rich Audit surface is Phase 5.
- **D-11:** Default mode is Balanced on first run. Mode changes are logged to audit as config events. Global mode is team-wide, not per-teammate.

### Claude's Discretion
- The exact `canUseTool` vs hooks decision and the replay-on-approval mechanism (D-08/D-09).
- Override list granularity (~6 capability rows: research/prepare, draft, send, book meetings, post publicly, send money-locked) — follow spec's capability-level rows unless tool enumeration suggests otherwise.
- Whether mode/override config lives in `dashboard_settings` vs a dedicated table; how the safe-default for unclassified tools is encoded.
- "Needs you" item expiry/TTL semantics and copy.

### Deferred Ideas (OUT OF SCOPE)
- Rich Activity held-entry feed + "Ran on its own"/"You approved" tags + Undo — Phase 4.
- Immutable, exportable Audit log surface + richer audit schema — Phase 5.
- Connected tools / Notifications / Billing sections of Settings — Billing is Phase 8; others conventional.
- Memory-derived preference rules feeding permission defaults — Phase 6.
- Per-teammate autonomy modes (this phase is team-wide global mode + per-action overrides only).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PERM-01 | Set a global autonomy mode (Cautious / Balanced / Autonomous) | Store mode in `dashboard_settings` (key `permissions.mode`); resolution algorithm in `gate.ts` maps mode→per-tier default. UI: `AutonomyModeSelector` per UI-SPEC §1a. |
| PERM-02 | Override what the team may do per action (Always / Ask first) | Store overrides in `dashboard_settings` (key `permissions.overrides`, JSON object keyed by capability id). Resolution: mode default, then per-action override, Tier 4 always-ask. UI: `ActionOverrideList` §1c. |
| PERM-03 | Irreversible actions locked to Ask-first, cannot be Always in any mode (D4) | Tier 4 classifier (`gate.ts` tool→tier map) + resolution never returns Always for Tier 4 regardless of mode/override. UI: `LockedActionRow` §1d renders non-interactive. |
| PERM-04 | Gated action prepared + queued as "Needs you" item for one-tap approval | New `approval_queue` table; gate inserts on background "ask"; `/api/approvals*` routes; `ApprovalItem` in existing `NeedsYouCard`. Replay on approve (D-08). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tool-call interception (the gate) | API / Backend (Node service, in-process) | — | The `canUseTool` callback runs inside the Node host process that calls `query()`; it is NOT in the SDK subprocess or the browser. |
| Tier classification | API / Backend (`gate.ts`) | — | Pure function over tool name + input; no I/O. Lives beside the gate. |
| Mode/override config storage | Database / Storage (`dashboard_settings`) | API (read/write routes) | Single-connection SQLite is the system's config store; `getDashboardSetting`/`setDashboardSetting` already exist. |
| Approval queue persistence | Database / Storage (`approval_queue` table) | API (queue + approve/deny routes) | Survives restarts; read by Home now and Phase 4/5 later. |
| Inline yes/no ask (live chat) | API / Backend (`message-core.ts` turn) | Frontend Server (Slack transport surfaces the prompt) | The decision blocks the in-process callback; the transport renders the question. |
| Approval surface (Home) | Browser / Client (Preact) | API (fetch queue, POST decision) | UI extends existing `NeedsYouCard`; calls `/api/approvals`. |
| Replay on approve | API / Backend | — | Re-invokes the captured tool with stored params server-side. |
| Audit recording | API / Backend (`security.ts audit()`) → Database (`audit_log`) | — | Existing pipeline; one call per gate decision. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | **0.2.50 installed** (declared `^0.2.34`) | Provides `query()` + the `canUseTool` permission callback (the gate) | Already the agent runtime; `canUseTool` is the SDK's official tool-call interception affordance. `[VERIFIED: read node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:95-121, 927-937, 1661 and sdk.mjs runtime]` |
| `better-sqlite3` | (existing) | Synchronous single-connection store for config + approval queue + audit | The whole DB layer (`src/db.ts`) is built on it; no new dependency. `[VERIFIED: src/db.ts]` |
| `hono` | (existing) | `/api/permissions*` + `/api/approvals*` routes | `src/dashboard.ts` is already a Hono app with this exact route pattern. `[VERIFIED: src/dashboard.ts]` |
| Preact + Tailwind v4 + `lucide-preact` | (existing) | Permissions Settings section + Home approval surface | Established dashboard UI stack; UI-SPEC mandates reuse, no new design system. `[CITED: 03-UI-SPEC.md]` |
| `vitest` | 2.x | Unit/contract tests for gate, resolution, queue, audit | Project test runner. `[VERIFIED: .planning/codebase/TESTING.md]` |

**No new external packages are required for this phase.** Everything is built from existing dependencies. The Package Legitimacy Audit below is therefore trivial.

### The `canUseTool` API — exact signature (the make-or-break finding)

`[VERIFIED: node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts]`

```typescript
// sdk.d.ts:95-121
export declare type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;        // unique per tool call within an assistant message
    agentID?: string;         // set when running inside a sub-agent
  }
) => Promise<PermissionResult>;

// sdk.d.ts:927-937 — the return shape
export declare type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;   // can rewrite the tool input
      updatedPermissions?: PermissionUpdate[];   // "always allow this" — we will NOT use this
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      message: string;        // text the model receives as the tool result
      interrupt?: boolean;    // true = abort the whole turn; false = model continues
      toolUseID?: string;
    };

// sdk.d.ts:1661 — the Options field
canUseTool?: CanUseTool;
```

**Runtime wiring confirmed in `sdk.mjs`:**
- When `canUseTool` is provided, the SDK pushes `--permission-prompt-tool stdio` to the CLI, routing every permission request through the callback. `[VERIFIED: sdk.mjs grep]`
- `canUseTool` throws if combined with `permissionPromptToolName` ("cannot be used with permissionPromptToolName. Please use one or the other."). It does NOT conflict with `permissionMode`. `[VERIFIED: sdk.mjs grep]`
- The callback is invoked with the real tool name and the real input object before execution; the SDK maps the stdio response back into `PermissionResult`. `[VERIFIED: sdk.mjs — `canUseTool(Q.request.tool_name, Q.request.input, {...toolUseID, agentID})`]`

### Tool identity exposed to the callback

- **Built-in tools:** bare PascalCase names — `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `Agent`, `NotebookEdit`, `AskUserQuestion`. `[VERIFIED: src/agent.ts:108-120 TOOL_LABELS already enumerates these]`
- **MCP tools:** prefixed `mcp__<server>__<tool>` (triple-underscore segments). `src/agent.ts:125-127` already parses this exact pattern (`toolName.split('__')`). `[VERIFIED: src/agent.ts:122-129]`
- **The `system/init` event** carries the full live `tools: string[]` and `mcp_servers` list for the session — usable to log/snapshot what the gate is governing. `[VERIFIED: sdk.d.ts:1687-1713 SDKSystemMessage]`

### Deny behavior mid-turn (drives D-04/D-07/D-08 UX)

`[VERIFIED: SDK type comments + CITED: docs.claude.com/en/docs/agent-sdk/permissions]`

- `behavior:'deny'` with `interrupt:false` (or omitted) → the tool does **not** run; `message` is returned to the model as the tool result, and **the turn continues** — the model can adapt (e.g. say "I've queued that for your approval"). This is exactly the "prepared then queued" path.
- `behavior:'deny'` with `interrupt:true` → the whole turn aborts.
- `behavior:'allow'` → tool runs (optionally with `updatedInput`).
- **The callback is `async` and the SDK awaits it.** For inline-ask (D-04, attended), the gate returns a Promise that resolves `allow`/`deny` only after the operator answers — the turn naturally pauses on the tool call. For background runs, the gate resolves `deny` immediately after enqueuing.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `canUseTool` | `hooks: { PreToolUse: [...] }` | Hooks also intercept (`PreToolUseHookSpecificOutput` supports allow/deny), but `canUseTool` is the purpose-built, simpler, single-callback path and is what D-09 locks. Use hooks only if you need multiple independent matchers — not needed here. |
| `canUseTool` async-block for queue | `deny` immediately + later replay | For BACKGROUND runs use deny+replay (no one is waiting; blocking the subprocess for minutes/hours is wrong). For ATTENDED chat, async-block is fine (operator is present, short wait). This split IS the D-04 design. |
| `updatedPermissions` "always allow" | per-call decisions only | Never return `updatedPermissions` — it would let the SDK cache an allow and bypass the gate on later calls, breaking Tier 4 lock (D-05). Every call must re-enter the gate. |
| Replay = resume agent turn | Replay = re-invoke tool directly | **Recommend re-invoke directly** for D-08: the queue row stores `{toolName, input}`; on approve, execute that specific MCP/built-in call server-side and record the result. Resuming the agent turn is heavier, risks re-reasoning, and the SDK's `resume` reattaches a whole session. See Pitfall P-3 for the direct-invoke caveat (built-in tools like `Bash`/`Write` are executed by the SDK subprocess, not trivially callable standalone). |

**Installation:** No install. Add a startup guard instead:
```typescript
// assert the gate API exists in the resolved SDK before serving traffic
import * as sdk from '@anthropic-ai/claude-agent-sdk';
// canUseTool is an Options field, not a runtime export — assert via a typed smoke test
// in gate.test.ts that query() accepts { options: { canUseTool } } without throwing.
```

**Version verification:**
- Installed: `0.2.50` `[VERIFIED: node -e require('@anthropic-ai/claude-agent-sdk/package.json').version]`
- npm latest: `0.3.186`, next `0.3.187` `[VERIFIED: npm view @anthropic-ai/claude-agent-sdk dist-tags]`
- `canUseTool` exists in the installed 0.2.50. **Do NOT upgrade as part of this phase** — pin to the installed family and treat any SDK bump as a separate, tested change (L-5).

## Package Legitimacy Audit

> No external packages are installed this phase. All work uses already-present dependencies.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@anthropic-ai/claude-agent-sdk` | npm | already a project dep | high | github.com/anthropics/claude-agent-sdk | n/a (existing) | Already installed — no new install |
| `better-sqlite3` / `hono` / `preact` / `lucide-preact` / `vitest` | npm | existing deps | high | official | n/a (existing) | Already installed |

**Packages removed due to slopcheck [SLOP] verdict:** none (no installs).
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌──────────────────────────────────────────┐
  live chat turn          │  ATTENDED PATH (D-04 inline)               │
  (message-core.ts) ─────►│  gate ctx { attended:true, chatId, ... }   │
                          └──────────────┬─────────────────────────────┘
                                         │
  scheduler / mission     ┌──────────────▼─────────────────────────────┐
  (scheduler.ts) ────────►│  BACKGROUND PATH                            │
                          │  gate ctx { attended:false, runId, ... }    │
                          └──────────────┬─────────────────────────────┘
                                         │  runAgent(..., gateCtx)
                                         ▼
                          ┌──────────────────────────────────────────┐
                          │  agent.ts query({ canUseTool, env, ... })  │
                          │  (permissionMode:'bypassPermissions' REMOVED)│
                          └──────────────┬─────────────────────────────┘
                                         │  per tool call
                                         ▼
        ┌────────────────────────  gate.ts makeCanUseTool(ctx)  ───────────────────────┐
        │  1. classify(toolName, input) -> tier (1..4)  [name-pattern map]              │
        │  2. resolve(tier, mode, overrides) -> 'allow' | 'ask'                          │
        │     - Tier 4 -> ALWAYS 'ask' (lock, ignores mode+override)  (PERM-03)          │
        │  3. audit({ action:'permission', detail:{tool,tier,mode,outcome}, blocked })   │
        │  4. branch on outcome:                                                          │
        │       allow -> { behavior:'allow' }                                            │
        │       ask + attended -> await inlinePrompt(chatId) -> allow/deny               │
        │       ask + background -> INSERT approval_queue(pending); return deny(message) │
        └───────────────────────────────────┬──────────────────────────────────────────┘
                                             │
              ┌──────────────────────────────┼───────────────────────────────┐
              ▼                              ▼                                 ▼
       audit_log (D-10)            approval_queue (PERM-04)              inline yes/no
       (every decision)           pending/approved/denied/expired       (Slack transport)
                                             │
                                  /api/approvals (Home)
                                             │  on approve
                                             ▼
                                  replay: re-invoke {toolName,input} (D-08)
                                             │
                                             ▼
                                  audit_log (outcome: approved+replayed)
```

### Recommended Project Structure
```
src/
├── gate.ts                  # NEW: makeCanUseTool(ctx), classifyTier, resolveOutcome
├── gate.test.ts             # NEW: classification + resolution + lock matrix
├── permissions-config.ts    # NEW: get/set mode + overrides over dashboard_settings (thin)
├── approval-queue.ts        # NEW: enqueue/list/approve/deny/expire over approval_queue table
├── approval-queue.test.ts   # NEW
├── agent.ts                 # EDIT: accept gateCtx, wire canUseTool, drop bypassPermissions
├── message-core.ts          # EDIT: build attended gateCtx + inline-prompt resolver
├── scheduler.ts             # EDIT: build background gateCtx for task + mission runs
├── db.ts                    # EDIT: add approval_queue table + addColumnIfMissing mirror
├── dashboard.ts             # EDIT: /api/permissions, /api/approvals routes
migrations/
└── v1.2.x/                  # NEW versioned migration: create approval_queue (+ version.json)
web/src/
├── pages/Settings.tsx       # EDIT: PermissionsSection
├── pages/Home.tsx /         # EDIT: render ApprovalItem inside NeedsYouCard
│   components/DailyLoop.tsx
└── components/...            # NEW: AutonomyModeSelector, ActionOverrideRow, LockedActionRow, etc.
```

### Pattern 1: The gate factory (per-turn context, no module globals)
**What:** A factory that closes over the per-turn context and returns the SDK callback. Mirrors the codebase rule "per-turn identity travels the call path, not module globals" (CONTEXT code_context).
**When to use:** Built once per `query()` call inside `runAgent`, from the `gateCtx` argument.
```typescript
// src/gate.ts  [pattern — signatures verified against sdk.d.ts]
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { audit } from './security.js';
import { getMode, getOverrides } from './permissions-config.js';
import { enqueueApproval } from './approval-queue.js';

export interface GateContext {
  agentId: string;
  chatId: string;
  attended: boolean;                 // true = live chat (inline ask); false = background (queue)
  runId?: string;                    // mission/scheduled task id for attribution
  routineId?: string;                // forward-compat slot for Phase 2 (currently always undefined)
  routineAutonomy?: 'unattended' | 'queue_approval'; // forward-compat; absent today
  requestInline?: (q: { summary: string; tier: Tier; toolName: string }) => Promise<boolean>;
}

export function makeCanUseTool(ctx: GateContext): CanUseTool {
  return async (toolName, input, _opts): Promise<PermissionResult> => {
    const tier = classifyTier(toolName, input);
    const mode = getMode();
    const outcome = resolveOutcome(tier, mode, getOverrides()); // 'allow' | 'ask'

    if (outcome === 'allow') {
      audit({ agentId: ctx.agentId, chatId: ctx.chatId, action: 'permission',
              detail: encodeDecision({ toolName, tier, mode, outcome: 'allow' }), blocked: false });
      return { behavior: 'allow' };
    }

    // outcome === 'ask'
    if (ctx.attended && ctx.requestInline) {
      const ok = await ctx.requestInline({ summary: summarize(toolName, input), tier, toolName });
      audit({ agentId: ctx.agentId, chatId: ctx.chatId, action: 'permission',
              detail: encodeDecision({ toolName, tier, mode, outcome: ok ? 'approved-inline' : 'denied-inline' }),
              blocked: !ok });
      return ok ? { behavior: 'allow' }
                : { behavior: 'deny', message: 'Operator declined this action.' };
    }

    // background -> queue + deny (turn continues, model reports it queued)
    const id = enqueueApproval({ toolName, input, tier, mode,
                                 agentId: ctx.agentId, chatId: ctx.chatId, runId: ctx.runId });
    audit({ agentId: ctx.agentId, chatId: ctx.chatId, action: 'permission',
            detail: encodeDecision({ toolName, tier, mode, outcome: 'queued', queueId: id }), blocked: true });
    return { behavior: 'deny',
             message: `This action needs your approval and has been queued for you. (ref ${id})` };
  };
}
```

### Pattern 2: Tier classification by name pattern (NOT a fixed enumeration)
**What:** Classify by tool-name pattern + (for Bash) command inspection, because MCP servers are configured per-user/per-agent in `~/.claude/settings.json` and are NOT present as a fixed list in the repo (verified: no `mcpServers` in repo `.claude/settings.json`).
**When to use:** Pure function, unit-tested with a matrix.
```typescript
// src/gate.ts
export type Tier = 1 | 2 | 3 | 4;

// Tier 4 LOCKED (D-01) — match by intent keyword in MCP tool names
const TIER4_PATTERNS = [/pay/i, /invoice/i, /payment[-_]?link/i, /purchase/i, /charge/i,
                        /sign(ature)?/i, /docusign/i, /contract/i,
                        /delete[-_]?permanent/i, /permanent[-_]?delete/i, /purge/i, /destroy/i];

// Tier 1 — read & prepare (built-ins + read-only MCP)
const TIER1_BUILTINS = new Set(['Read','Glob','Grep','WebSearch','WebFetch','NotebookRead']);
const TIER1_MCP = [/(^|__)(get|list|read|search|find|fetch|summar)/i, /draft/i];

// Tier 3 — consequential external send/post/book-with-external
const TIER3_PATTERNS = [/send/i, /post/i, /publish/i, /reply/i, /^mcp__slack__/i, /^mcp__gmail__send/i,
                        /calendar.*(create|move|update)/i];

// Tier 2 — low-stakes external (labels, save, internal meeting)
const TIER2_PATTERNS = [/label/i, /save/i, /upload/i, /drive/i, /archive/i];

export function classifyTier(toolName: string, input: Record<string, unknown>): Tier {
  if (TIER4_PATTERNS.some(r => r.test(toolName))) return 4;
  if (TIER1_BUILTINS.has(toolName)) return 1;
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') return 2; // local file write = reversible-ish
  if (toolName === 'Bash') return classifyBash(input);                                       // see below
  if (TIER1_MCP.some(r => r.test(toolName))) return 1;
  if (TIER3_PATTERNS.some(r => r.test(toolName))) return 3;
  if (TIER2_PATTERNS.some(r => r.test(toolName))) return 2;
  // D-03 safe default: unknown/unclassified -> at least Tier 3 (ask), never silent auto-run
  return 3;
}

// Bash is special: classify by the command. Default to Tier 3 (ask) on anything that
// isn't a recognized read-only command, because Bash can do anything (incl. money/delete).
function classifyBash(input: Record<string, unknown>): Tier {
  const cmd = String(input.command ?? '');
  const READ_ONLY = /^(\s*(ls|cat|grep|rg|find|head|tail|wc|pwd|echo|git (status|log|diff|show)|node -e "console)\b)/;
  const DESTRUCTIVE = /\b(rm\s+-rf?\b|git push --force|drop table|shred|dd if=)/i;
  if (DESTRUCTIVE.test(cmd)) return 4;     // irreversible
  if (READ_ONLY.test(cmd)) return 1;
  return 3;                                 // unknown command = ask (safe default, D-03)
}
```

### Pattern 3: Resolution algorithm (mode → tier default → override → Tier 4 lock)
```typescript
// src/gate.ts
export type Mode = 'cautious' | 'balanced' | 'autonomous';
// auto = silent allow; ask = gate
const TIER_DEFAULT: Record<Mode, Record<Tier,'auto'|'ask'>> = {
  cautious:   {1:'auto', 2:'ask',  3:'ask',  4:'ask'},
  balanced:   {1:'auto', 2:'auto', 3:'ask',  4:'ask'},
  autonomous: {1:'auto', 2:'auto', 3:'auto', 4:'ask'},
};

export function resolveOutcome(tier: Tier, mode: Mode,
                               overrides: Record<string,'always'|'ask'>): 'allow'|'ask' {
  if (tier === 4) return 'ask';                       // PERM-03 LOCK — ignores mode + override
  const capability = capabilityForTier(tier);          // map tier -> override key
  const ov = overrides[capability];
  if (ov === 'always') return 'allow';
  if (ov === 'ask') return 'ask';
  return TIER_DEFAULT[mode][tier] === 'auto' ? 'allow' : 'ask';
}
```

### Anti-Patterns to Avoid
- **Keeping `permissionMode: 'bypassPermissions'` alongside `canUseTool`:** bypass mode skips prompting; the callback may never fire. Remove it (or set `'default'`). `[VERIFIED: PermissionMode comment sdk.d.ts:905, runtime]`
- **Returning `updatedPermissions` ("always allow"):** caches an allow in the SDK session and bypasses the gate on later identical calls — breaks Tier 4 lock and per-instance approval (D-05). Never use.
- **Blocking the callback for hours on background runs:** the SDK subprocess stays alive holding the turn; collides with the scheduler's abort/timeout. Background = enqueue + `deny` immediately.
- **Module-global gate state:** breaks Slack multi-agent concurrency (one process runs many agents). Gate context must travel per-turn (Pattern 1), mirroring `agentRuntime` in `message-core.ts`.
- **Failing CLOSED on a classifier exception:** if `classifyTier` throws, do NOT deny everything (would brick all chats). Catch, log, and fall back to Tier 3 (ask) — fail to the SAFE side, which for a personal bot means "ask," not "block all." See landmine L-2 for the fail-open-vs-closed rollout decision.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool-call interception | A wrapper around MCP transport / your own permission prompt protocol | SDK `canUseTool` | The SDK already routes every tool call (built-in + MCP) through it via `--permission-prompt-tool stdio`. Reimplementing means re-parsing the stream-json protocol. |
| Decision recording | A new logging table/pipeline | existing `audit()` + `audit_log` (`src/security.ts`, `src/db.ts:293`) | D-10 locks reuse; the table has `action/detail/blocked/agent_id/chat_id/created_at` already. Encode tier/mode/outcome into `detail` (JSON string). |
| Config storage | A bespoke settings file | `dashboard_settings` k/v + `getDashboardSetting`/`setDashboardSetting` (`src/db.ts:3412-3425`) | Already restart-safe, last-write-wins, dashboard-token-auth-scoped. |
| Kill-switch / single chokepoint | A second enforcement entrypoint | mirror `requireEnabled()` pattern (`src/kill-switches.ts`) | The gate is a richer sibling at the SAME chokepoint (`runAgent`). One enforcement point, like the existing kill switch. |
| Migration runner | Ad-hoc `ALTER TABLE` at boot | versioned `migrations/vX.Y.Z/*.ts` + `migrations/version.json` + `addColumnIfMissing` mirror in `db.ts` | Skipping the versioned file crash-loops the live service (`checkPendingMigrations`, CONTEXT). Dual-write is mandatory. |

**Key insight:** This phase is almost entirely *wiring* existing primitives (SDK callback + audit + settings + Hono routes + Preact components) plus ONE new table. The novel logic is the ~3 pure functions in `gate.ts` (classify, resolve, summarize). Keep them pure and unit-test them exhaustively; everything else is integration.

## Runtime State Inventory

> This is an EXTENSION on the live agent path, not a rename. Inventory focuses on live runtime systems the change touches.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `dashboard_settings` (config), `audit_log` (decisions) exist and are reused; NEW `approval_queue` table | Migration: create `approval_queue` (versioned file + `addColumnIfMissing`/`CREATE TABLE IF NOT EXISTS` mirror). Seed default mode = `balanced` (D-11) lazily on first read, not as a migration row. |
| Live service config | SDK `query()` options in `src/agent.ts` change for EVERY run (chat/scheduler/mission). `permissionMode:'bypassPermissions'` + `allowDangerouslySkipPermissions:true` are removed/changed. | Single edit at the one `query()` call site (agent.ts:246-282). Affects all callers simultaneously — see L-1/L-2. |
| OS-registered state | launchd/scheduler runs the live service; the 60s/5s scheduler poll (`scheduler.ts`) drives background runs that now hit the gate | No OS re-registration. But approval-queue concurrency with the scheduler poll must be considered (L-3). |
| Secrets/env vars | `getScrubbedSdkEnv` strips secrets before the SDK subprocess; gate runs in the PARENT process (has full access) | None — the gate is in-process, before/around `query()`. It must not leak the unscrubbed env into queue rows (store tool input only, never env). |
| Build artifacts | `dist/` compiled output; `npm run migrate` must run before restart (per MEMORY.md deploy note) | After adding the migration: `npm run migrate` then restart, or `checkPendingMigrations` crash-loops the live service. |

**Nothing found that requires data migration of existing rows** — all changes are additive (new table, new settings keys, richer `detail` text). Verified by reading `src/db.ts` schema and `src/security.ts`.

## Common Pitfalls

### Pitfall P-1: bypassPermissions silently swallows the gate
**What goes wrong:** Leaving `permissionMode:'bypassPermissions'` (and `allowDangerouslySkipPermissions:true`) means the SDK never prompts, so `canUseTool` may not be consulted — the gate is a no-op and every action runs.
**Why it happens:** The two settings look independent; bypass is the current value and easy to forget.
**How to avoid:** In the same edit that adds `canUseTool`, remove both bypass lines (set `permissionMode:'default'`). Add a test asserting that with the gate wired, a Tier 3 tool in Balanced mode produces a queued/denied result.
**Warning signs:** Gate audit rows show only `allow`; nothing ever queues; Tier 4 actions execute.

### Pitfall P-2: Blocking the SDK subprocess on a queued (background) decision
**What goes wrong:** Returning an awaited Promise that resolves only when the operator approves, for a *background* run, holds the SDK turn open indefinitely, fights the scheduler's `AGENT_TIMEOUT`/abort, and can pile up subprocesses.
**Why it happens:** The same callback shape serves both attended and background paths.
**How to avoid:** Branch on `ctx.attended`. Background = enqueue + immediate `deny`. Only attended (live chat) may block on `requestInline`, and that should itself have a bounded timeout.
**Warning signs:** Scheduler runs that never complete; rising process count; missions stuck "running."

### Pitfall P-3: Replay of built-in tools (D-08) is not a simple function call
**What goes wrong:** A queued `Write`/`Edit`/`Bash` cannot be "re-invoked" the way an MCP HTTP/stdio tool can — those are executed inside the SDK subprocess, not exposed as standalone callables.
**Why it happens:** D-08 assumes "re-invoke the captured tool with stored params" uniformly.
**How to avoid:** Two-track replay. (a) **MCP tools:** call the MCP server directly with stored params (the queue row has `toolName=mcp__server__tool` + `input`) — this is the clean path and covers the money/send/post actions that actually get gated. (b) **Built-in side-effect tools** (`Write`/`Edit`/`Bash`): on approve, perform the equivalent operation directly in Node (write the file, run the command) using the stored input — a small, explicit executor keyed by tool name. Most gated Tier 3/4 actions are MCP tools, so (a) is the common case; document (b)'s allowlist. **Recommend: scope MVP replay to MCP tools + a tiny built-in executor for `Bash`/`Write`; reject replay of anything not in the executor map with an honest error** (UI-SPEC already specifies honest replay-failure copy).
**Warning signs:** Approve succeeds in UI but nothing happens; "tool not replayable" errors.

### Pitfall P-4: Migration drift between in-memory test DB and live DB
**What goes wrong:** Adding `approval_queue` only in the versioned migration file makes the in-memory test DB (built from `createSchema`+`runMigrations`, no versioned-file run) lack the table; adding it only in `db.ts` makes the live DB miss it until restart.
**Why it happens:** The codebase deliberately dual-writes (CONTEXT, v1.2.1 precedent).
**How to avoid:** Add `CREATE TABLE IF NOT EXISTS approval_queue (...)` in `db.ts createSchema` AND a versioned `migrations/v1.2.x/create-approval-queue.ts` registered in `version.json`. Run `npm run migrate` before restart.
**Warning signs:** `no such table: approval_queue` in tests or live; `checkPendingMigrations` crash-loop.

### Pitfall P-5: Threading the gate context through positional args
**What goes wrong:** `runAgent`/`runAgentWithRetry` already take 9-11 positional args; appending another is error-prone, and every caller (bot.ts x2, scheduler.ts x3, orchestrator.ts, message-core.ts) must pass it.
**Why it happens:** No options-object signature exists today.
**How to avoid:** Prefer a small refactor to an options object for the gate context only (keep existing positional args, add a trailing `gateCtx?: GateContext`). Default `gateCtx` to a **safe background context** when omitted, so any missed caller fails to the ask/queue side, not to silent-allow. Update all 7 call sites.
**Warning signs:** A caller passes no context and its runs silently auto-execute Tier 3 (means the default wasn't safe).

## Code Examples

### Wiring the gate into the query() call (the core edit)
```typescript
// src/agent.ts — replaces lines ~260-262
// BEFORE: permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true,
// AFTER:
        permissionMode: 'default',
        canUseTool: makeCanUseTool(gateCtx),   // gateCtx threaded in via new arg
```

### Reading/writing mode over dashboard_settings
```typescript
// src/permissions-config.ts
import { getDashboardSetting, setDashboardSetting } from './db.js';
const MODE_KEY = 'permissions.mode';
const OV_KEY = 'permissions.overrides';
export function getMode(): Mode {
  return (getDashboardSetting(MODE_KEY) as Mode) ?? 'balanced';   // D-11 default
}
export function setMode(m: Mode, agentId: string): void {
  setDashboardSetting(MODE_KEY, m);
  audit({ agentId, chatId: '', action: 'permission',
          detail: JSON.stringify({ event: 'mode_change', mode: m }), blocked: false }); // D-11 config event
}
export function getOverrides(): Record<string,'always'|'ask'> {
  try { return JSON.parse(getDashboardSetting(OV_KEY) ?? '{}'); } catch { return {}; }
}
```

### approval_queue table (shaped for Phase 4/5 readers)
```sql
-- db.ts createSchema + versioned migration
CREATE TABLE IF NOT EXISTS approval_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id      TEXT NOT NULL DEFAULT 'main',
  chat_id       TEXT NOT NULL DEFAULT '',
  run_id        TEXT,                      -- mission/scheduled task id (NULL for chat)
  routine_id    TEXT,                      -- forward-compat for Phase 2 (NULL today)
  tool_name     TEXT NOT NULL,
  tool_input    TEXT NOT NULL,             -- JSON of the captured params (D-08 replay)
  tier          INTEGER NOT NULL,
  mode_at_decision TEXT NOT NULL,          -- mode when gated (audit/Phase 5)
  summary       TEXT NOT NULL DEFAULT '',  -- plain-language "Send the proposal to Acme"
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|approved|denied|expired
  decided_at    INTEGER,                   -- when approved/denied
  result        TEXT,                      -- replay outcome (success text or honest error)
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_approval_pending ON approval_queue(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_agent ON approval_queue(agent_id, created_at DESC);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `permissionMode:'bypassPermissions'` (trust-everything personal bot) | `canUseTool` gate at tool-call layer | This phase | Every external/irreversible action is checked before it runs. |
| Routines pass `execContext.autonomy` into the gate (CONTEXT/UI-SPEC assumption) | **Routines do not exist on this branch yet** | — | The gate must be built routine-agnostic with a forward-compat `routineAutonomy` slot; scheduler/mission are the real background callers today (L-1). |

**Deprecated/outdated:**
- The CONTEXT assumption that `src/routine-runner.ts` and `opts.agentRuntime` on `runAgent` exist: `routine-runner.ts` is absent; `runAgent` uses positional args; `agentRuntime` is a field on `ProcessOptions` in `message-core.ts` only (not on `runAgent`). Plan against the real signatures.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The MCP tool names for money/send/etc. follow `mcp__<server>__<verb>` and match the keyword patterns (e.g. QuickBooks `pay`, Gmail `send`) | classifyTier patterns | If a server uses non-obvious tool names, a Tier 4 action could mis-classify LOW. **Mitigation: the safe default is Tier 3 (ask), and Tier 4 keyword list is broad; verify actual tool names against the operator's connected MCP servers before locking the map.** No MCP servers are configured in the repo, so the live names are unknown at research time. |
| A2 | Background queued actions should `deny` immediately (not block) | gate Pattern 1 / P-2 | If a future requirement wants synchronous background approval, this changes. Low risk — D-04 explicitly says background = queue. |
| A3 | Replay re-invokes the captured tool directly rather than resuming the agent turn | D-08 / P-3 | Built-in tools need an explicit executor; if the gated actions turn out to be mostly built-in `Bash`, the executor scope grows. MEDIUM — verify which tools actually gate in practice. |
| A4 | `interrupt:false` deny lets the turn continue and the model reports "queued for approval" gracefully | deny semantics | If the model instead errors or retries the tool, UX degrades. Mitigation: clear `message` text; tested via integration. CITED by docs, not yet observed in this codebase. |
| A5 | Mode + overrides fit in `dashboard_settings` (k/v) rather than a dedicated table | storage | Low risk — the override set is ~6 capabilities; JSON in one key is sufficient. |

## Open Questions

1. **Exact MCP tool names for the connected integrations (QuickBooks, Gmail, Calendar, Drive, Slack).**
   - What we know: tool names are `mcp__<server>__<tool>`; classification is by keyword pattern.
   - What's unclear: the literal tool names — no MCP servers are configured in the repo's `.claude/settings.json`; they live in the operator's `~/.claude/settings.json`.
   - Recommendation: at runtime, snapshot the `system/init` event's `tools` list (it lists all live tools) and log unclassified-but-gated names; let the planner add a task to verify the Tier 4 keyword list against the operator's actual connected servers before shipping. Safe default (Tier 3 ask) prevents silent auto-run meanwhile.

2. **Replay executor scope for built-in tools (D-08 / P-3).**
   - What we know: MCP-tool replay is clean (re-call with params); built-in side-effect tools need an explicit executor.
   - What's unclear: how many gated actions will be built-in `Bash`/`Write` vs MCP.
   - Recommendation: MVP = MCP replay + a minimal `Bash`/`Write` executor; reject other built-ins with an honest "can't replay" error (UI-SPEC supports honest failure copy).

3. **Inline-ask transport plumbing in Slack (D-04).**
   - What we know: `TransportCallbacks` (`message-core.ts:106`) has `sendPlain`/`editPlain` but no built-in interactive yes/no primitive; the gate's `requestInline` must be supplied by `message-core.ts`.
   - What's unclear: whether to use Slack interactive buttons or parse a follow-up text "yes/no" within the same turn while the callback is awaiting.
   - Recommendation: MVP can park inline-ask as a queued item even for chat if interactive plumbing is heavy, but D-04 prefers true inline. Planner should scope the Slack interactive-button path as its own task with a text-reply fallback; the `attended` branch + `requestInline` resolver isolates this complexity.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@anthropic-ai/claude-agent-sdk` with `canUseTool` | The gate (D-09) | ✓ | 0.2.50 (installed) | none needed — API confirmed present |
| `better-sqlite3` | config + queue + audit | ✓ | existing | — |
| Connected MCP servers (QuickBooks/Gmail/Calendar/Drive/Slack) | Tier 4/3 classification accuracy | ✗ (not in repo settings) | — | Classify by keyword pattern + safe default Tier 3; verify names against operator's live config |
| Phase 2 routines (`routine-runner.ts`, `execContext.autonomy`) | D-06 routine→gate seam | ✗ (not on branch) | — | Build gate routine-agnostic with forward-compat slot; scheduler/mission are the real background callers now |

**Missing dependencies with no fallback:** none that block the phase.
**Missing dependencies with fallback:**
- Live MCP tool names → keyword classification + safe default (handled).
- Phase 2 routine seam → forward-compat `routineAutonomy` field, no-op today (handled).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.x `[VERIFIED: .planning/codebase/TESTING.md]` |
| Config file | `vitest.config.ts` (root) + inline block in `package.json`; `vitest.config.ts` wins |
| Quick run command | `npx vitest run src/gate.test.ts` |
| Full suite command | `npm test` (`vitest run`) |
| Test location | Co-located `src/{module}.test.ts`; glob `src/**/*.test.ts` |
| Setup | `src/test-env-setup.ts` sets env vars before modules load |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PERM-01 | Mode resolution: each mode maps tiers to auto/ask correctly | unit | `npx vitest run src/gate.test.ts -t "resolveOutcome mode matrix"` | ❌ Wave 0 |
| PERM-01 | `getMode` defaults to `balanced` on empty settings (D-11) | unit | `npx vitest run src/permissions-config.test.ts -t "default balanced"` | ❌ Wave 0 |
| PERM-02 | Per-action override flips Tier 2/3 between always/ask; mode default applies when no override | unit | `npx vitest run src/gate.test.ts -t "override"` | ❌ Wave 0 |
| PERM-03 | Tier 4 returns 'ask' in EVERY mode AND with an 'always' override present (lock holds) | unit | `npx vitest run src/gate.test.ts -t "tier4 locked"` | ❌ Wave 0 |
| PERM-03 | classifyTier: money/sign/delete keywords + destructive Bash → Tier 4; unknown → Tier 3 | unit | `npx vitest run src/gate.test.ts -t "classify"` | ❌ Wave 0 |
| PERM-04 | Background 'ask' enqueues a pending row and returns `behavior:'deny'` | unit | `npx vitest run src/gate.test.ts -t "background queue deny"` | ❌ Wave 0 |
| PERM-04 | enqueue/list/approve/deny/expire transitions; pending→approved sets decided_at + result | unit | `npx vitest run src/approval-queue.test.ts` | ❌ Wave 0 |
| PERM-04 | `/api/approvals` GET lists pending; POST approve triggers replay; POST deny sets denied | contract | `npx vitest run src/dashboard.contract.test.ts -t "approvals"` | ❌ Wave 0 (extend existing contract file) |
| PERM-01/02 | `/api/permissions` GET returns mode+overrides; PUT persists + audits config event | contract | `npx vitest run src/dashboard.contract.test.ts -t "permissions"` | ❌ Wave 0 |
| D-10 | Every gate decision writes an `audit_log` row with tool/tier/mode/outcome in detail | unit | `npx vitest run src/gate.test.ts -t "audit recorded"` (mock `audit()`) | ❌ Wave 0 |
| Gate wiring | `permissionMode` is NOT 'bypassPermissions' when gate is active; canUseTool present | unit | `npx vitest run src/agent.test.ts -t "gate wired"` (assert options object) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/gate.test.ts src/approval-queue.test.ts` (the pure-logic core, < 5s)
- **Per wave merge:** `npm test` (full vitest run) + `npm run typecheck`
- **Phase gate:** Full suite green + `npm run typecheck` clean before `/gsd-verify-work`. Manual smoke: run a Balanced-mode scheduled task that triggers a Tier 3 MCP send and confirm it lands in `approval_queue` (status pending) and an `audit_log` row exists.

### Wave 0 Gaps
- [ ] `src/gate.test.ts` — classify + resolve + Tier 4 lock matrix + audit (PERM-01/02/03, D-10)
- [ ] `src/approval-queue.test.ts` — queue transitions (PERM-04)
- [ ] `src/permissions-config.test.ts` — default mode + override read/write (PERM-01/02)
- [ ] Extend `src/dashboard.contract.test.ts` — `/api/permissions` + `/api/approvals` routes (PERM-01/02/04)
- [ ] `src/agent.test.ts` (new or extend) — assert gate options wiring, no bypass (gate wiring)
- [ ] No new framework install needed — vitest is present.

## Security Domain

> `security_enforcement` not explicitly false in config — included. This phase IS a security feature (the permission boundary), so the domain is central.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Single enforcement chokepoint (`canUseTool` at the one `query()` call site), mirroring the existing kill-switch chokepoint. No bypass path. |
| V4 Access Control | yes | The gate IS access control over tool execution. Tier 4 lock is a non-overridable deny (PERM-03). Dashboard token is the auth boundary for `/api/permissions` + `/api/approvals` (matches existing dashboard routes). |
| V5 Input Validation | yes | Validate `tool_input` JSON before storing in `approval_queue`; validate mode ∈ {cautious,balanced,autonomous} and override values ∈ {always,ask} on the API. Never `eval` stored input on replay. |
| V7 Logging | yes | Every decision → `audit_log` (D-10). Append-only is honored by the existing table (no deletes in this phase). |
| V8 Data Protection | yes | Do NOT store secrets/env in `approval_queue.tool_input` — store only the model-supplied params. The gate runs in the parent process which has the unscrubbed env; keep it out of queue rows and audit detail. |
| V6 Cryptography | no | No new crypto. |
| V2/V3 Auth/Session | no | Reuses existing dashboard token + SDK OAuth; not changed here. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Gate no-op via leftover `bypassPermissions` | Elevation of Privilege | Remove bypass; test asserts gate active (P-1). |
| Mis-classified Tier 4 action runs silently | Elevation of Privilege | Safe default Tier 3 (ask); broad Tier 4 keyword set; verify live tool names (A1). |
| "Always allow" cached by SDK, bypassing later checks | Elevation of Privilege | Never return `updatedPermissions`; every call re-enters the gate (D-05). |
| Replay executes arbitrary stored input | Tampering | Whitelist replayable tools; validate/parse stored JSON; no shell interpolation beyond the captured `Bash` command which was already gated as Tier 3/4. |
| Secret leakage into queue/audit rows | Information Disclosure | Store only tool params, never env; exfiltration guard already redacts outbound text. |
| Approval-queue race with 60s scheduler poll | Tampering | Mark rows `pending`→`approved` atomically (single-connection SQLite is serialized); replay is idempotent-guarded by status check (L-3). |
| Classifier throws → all chats brick | Denial of Service | Catch in gate; fall back to Tier 3 ask, never deny-all (fail to safe-but-usable side, L-2). |

## Risks / Landmines

- **L-1 (CORRECTED — not a landmine on this branch): routines ARE present.** The original draft (generated from the main checkout) wrongly claimed `routine-runner.ts`/`execContext.autonomy`/`queue_approval` were absent. On THIS branch they exist (Phase 2 shipped here). **The plan SHOULD wire the routine seam:** the gate's `GateContext { attended, routineAutonomy }` binds to `routine-runner.ts`'s `execContext.autonomy` (`unattended` | `queue_approval`) — a routine step is `attended:false` and carries its `routineAutonomy`. Real background callers are `scheduler.ts` (scheduled + mission, `attended:false`, no routineAutonomy) AND the `source==='routine'` branch / `runRoutineOnce` step calls. D-06 "gate all runs" is satisfied by gating chat + scheduler/mission + routine steps now — no deferral needed. The generic `GateContext` design is still the right abstraction; it just has a real routine seam to bind today.
- **L-2 (HIGH): Changing the live agent path affects EVERY run at once.** The single `query()` edit gates chat, scheduler, and mission simultaneously. **Rollout: fail to the SAFE-USABLE side, not closed.** A classifier/config error must degrade to "ask/queue" (Tier 3), never "deny everything" (which bricks the personal bot) and never "allow everything" (which defeats the gate). Consider a kill-switch-style env flag (`PERMISSION_GATE_ENABLED`, default on) so the gate can be disabled in an emergency without a redeploy, mirroring `requireEnabled()`.
- **L-3 (MEDIUM): Approval-queue concurrency with the scheduler poll.** The scheduler polls every ~5s/60s; a queued item approved via the dashboard is replayed by the API path. Guard replay with a status check (`UPDATE ... WHERE status='pending'` then act only if a row was changed) so double-approve / poll-race cannot replay twice. Single-connection SQLite serializes writes, which helps.
- **L-4 (MEDIUM): `messageQueue` + scrubbed-env rules.** The gate runs in the parent process and must not reintroduce secrets into the SDK env or queue rows; keep using `getScrubbedSdkEnv`. The gate must respect the existing per-chat serialization (`setProcessing`/`messageQueue`) — do not introduce a parallel queue that lets two turns for the same chat run concurrently.
- **L-5 (MEDIUM): SDK version pinning.** Installed `0.2.50` has `canUseTool`; npm latest is `0.3.186`. `^0.2.34` could drift within 0.2.x on a fresh install. **Pin to the verified family and add a startup/test assertion that `query()` accepts `canUseTool`.** Do not bump the SDK in this phase.
- **L-6 (LOW): Migration discipline.** Add `approval_queue` to BOTH `db.ts createSchema` and a versioned `migrations/v1.2.x/` file in `version.json`; run `npm run migrate` before restart or `checkPendingMigrations` crash-loops the service (MEMORY.md deploy note). Note the worktree currently shows only `v1.2.1` — confirm the next version number against `main` at plan time.

## Sources

### Primary (HIGH confidence)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (installed 0.2.50) — `CanUseTool` (95-121), `PermissionResult` (927-937), `Options.canUseTool` (1661), `PermissionMode` (905), `SDKSystemMessage.tools` (1687-1713)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` — runtime wiring: `--permission-prompt-tool stdio` on `canUseTool`; mutual-exclusion with `permissionPromptToolName`; callback invocation with real tool_name/input/toolUseID/agentID
- `src/agent.ts` — `query()` call site (246-282), bypass (260-262), tool name parsing (122-129), `runAgent`/`runAgentWithRetry` signatures
- `src/security.ts` — `audit()`/`setAuditCallback()` (104-113), `getScrubbedSdkEnv`
- `src/db.ts` — `audit_log` (293-303), `dashboard_settings` (308-312), `getDashboardSetting`/`setDashboardSetting` (3412-3425), `addColumnIfMissing`/`runMigrations` (460-540)
- `src/message-core.ts` — `TransportCallbacks` (106-133), `ProcessOptions.agentRuntime` (153-159), agent invocation (407-421)
- `src/scheduler.ts` — background `runAgent` callers (256-257, 284, 396)
- `migrations/version.json` + `migrations/v1.2.1/add-aos-cron-scheduled-task-columns.ts` — versioned migration pattern
- `git grep` confirming absence of `routine-runner.ts`/`queue_approval`/`execContext` on main + branch
- `specs/operator-product/07-permissions-settings.md`, `08-activity-audit.md` — engine + downstream record shape
- `.planning/phases/03-permissions-autonomy/03-CONTEXT.md`, `03-UI-SPEC.md`, `.planning/REQUIREMENTS.md`

### Secondary (MEDIUM confidence)
- `npm view @anthropic-ai/claude-agent-sdk dist-tags` — latest 0.3.186, next 0.3.187 (version currency)
- docs.claude.com/en/docs/agent-sdk/permissions — `PermissionResultDeny` semantics: `interrupt:false` → model continues, `interrupt:true` → abort turn (confirms deny-mid-turn behavior)

### Tertiary (LOW confidence)
- Live MCP tool names for connected integrations — UNVERIFIED (no MCP servers configured in repo; classify by pattern + safe default; verify against operator config before locking the Tier 4 map)

## Metadata

**Confidence breakdown:**
- Gate mechanism (`canUseTool`): HIGH — read directly from installed SDK types + runtime source.
- Storage/audit reuse: HIGH — read actual `db.ts`/`security.ts`.
- Tier classification map: MEDIUM — logic is sound, but live MCP tool names are unknown (A1, mitigated by safe default).
- Routine integration: MEDIUM — Phase 2 code absent (L-1); designed forward-compatible.
- Replay-on-approval: MEDIUM — MCP path clean, built-in path needs explicit executor (P-3).
- Inline-ask transport: MEDIUM — `requestInline` seam isolated, Slack interactive plumbing is a scoped unknown (Open Q3).

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stable; re-verify the SDK API if the SDK is bumped past 0.2.x)
