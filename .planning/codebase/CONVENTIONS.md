# Coding Conventions

**Analysis Date:** 2026-06-14

## TypeScript Module Style

**Module system:** ES modules throughout. `"type": "module"` in `package.json`. All imports use the `.js` extension even for `.ts` source files (required by NodeNext module resolution):

```typescript
import { classifyError } from './errors.js';
import { logger } from './logger.js';
```

**tsconfig.json settings:**
- `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`
- `"target": "ES2022"`
- `"strict": true` — strict TypeScript is enforced everywhere
- `"rootDir": "./src"`, `"outDir": "./dist"`
- No path aliases configured

**No linting/formatting toolchain** is present (no `.eslintrc`, `.prettierrc`, or `biome.json`). Style is enforced by TypeScript strict mode and code review only. The project uses `// eslint-disable-next-line` comments for targeted suppressions where needed.

## Naming Patterns

**Files:**
- Lowercase kebab-case: `agent-config.ts`, `schedule-cli.ts`, `memory-ingest.ts`
- Test files are named `{module}.test.ts` co-located in `src/`
- Integration tests use `{module}.integration.test.ts`
- Contract tests use `{module}.contract.test.ts`
- CLI entry points use the `{name}-cli.ts` suffix
- HTML-generating modules use the `-html.ts` suffix

**Functions:**
- camelCase: `readEnvFile`, `classifyError`, `buildMemoryContext`, `loadAgentConfig`
- Boolean-returning functions use `is`/`has`/`should` prefixes: `isValidClaudeModel`, `shouldNudgeMemory`, `agentExists`
- Async functions have no special suffix — the `async` keyword is sufficient

**Variables and constants:**
- Module-level exported constants are SCREAMING_SNAKE_CASE: `AGENT_TIMEOUT_MS`, `PROJECT_ROOT`, `TRANSPORT`
- Local variables and function parameters are camelCase
- `let` is used for mutable module-level state (e.g. `export let AGENT_ID = 'main'`)

**Types and interfaces:**
- PascalCase: `AgentError`, `AgentConfig`, `ErrorCategory`, `TransportCallbacks`
- Interfaces use the `I`-prefix-free style
- Union string literal types use lowercase snake_case values: `'auth' | 'rate_limit' | 'subprocess_crash'`
- TypeScript `type` aliases are used for union types; `interface` is used for object shapes

**CLI files:**
- Start with `#!/usr/bin/env node` shebang
- JSDoc block at the top documenting all subcommands with usage examples
- Parse flags manually from `process.argv` (no arg parsing library)
- Use `switch (command)` on the first positional argument
- Error to `console.error` and `process.exit(1)` on bad input
- Log results to `console.log` in a human-readable indented format

## Config and Environment Loading

All configuration is centralized in `src/config.ts`. The pattern is:

```typescript
// 1. Read .env file with readEnvFile() — secrets stay OUT of process.env
const envConfig = readEnvFile(['KEY1', 'KEY2', ...]);

// 2. Export constants: process.env wins, then envConfig, then default
export const SOME_VAR = process.env.SOME_VAR || envConfig.SOME_VAR || 'default';

// 3. For numeric values, always parseInt/parseFloat with a base and default:
export const AGENT_TIMEOUT_MS = parseInt(
  process.env.AGENT_TIMEOUT_MS || envConfig.AGENT_TIMEOUT_MS || '900000',
  10,
);
```

**`src/env.ts`** provides `readEnvFile(keys: string[])` — parses `.env` without polluting `process.env`. This is the only correct way to read secrets. Do NOT use `dotenv` or `process.env` directly for secrets.

**`src/config.ts`** is the single source of truth for all runtime configuration. New config values must be added here, not read ad-hoc in feature modules.

## The `errors.ts` Classification Pattern

All errors from the Claude Code SDK are classified via `classifyError()` in `src/errors.ts`:

```typescript
// Pattern: classify any unknown → AgentError with category + recovery hints
const classified = classifyError(err, contextTokens, resultError);
// classified.category: 'auth' | 'rate_limit' | 'context_exhausted' | etc.
// classified.recovery.shouldRetry: boolean
// classified.recovery.userMessage: string (safe to show to user)
```

**Never throw raw errors to the user layer.** Always classify first. The `AgentError` class carries:
- `category: ErrorCategory` — actionable category
- `recovery: ErrorRecovery` — retry/new-chat/switch-model flags + `retryAfterMs`
- `originalError: Error | undefined` — the raw error for logs

**Pattern matchers** (e.g. `AUTH_PATTERNS`, `RATE_LIMIT_PATTERNS`) are module-level string arrays. Add new patterns to the appropriate array. The `matchesAny()` helper does case-insensitive substring matching.

## Logger Usage (pino)

`src/logger.ts` exports a single `logger` instance. Import and use it everywhere:

```typescript
import { logger } from './logger.js';

logger.info({ agentId, chatId }, 'Processing message');
logger.warn({ err }, 'Recoverable failure');
logger.error({ err, category }, 'Agent error classified');
```

**Rules:**
- First argument is a structured context object (not a string). Key fields: `err`, `agentId`, `chatId`, `category`
- Second argument is the human-readable message string
- Use `logger.debug` for noisy trace-level info; `logger.info` for normal operations; `logger.warn` for recoverable issues; `logger.error` for failures
- The logger auto-redacts Telegram bot tokens from all log output
- The `err` serializer is preconfigured — pass error objects as `{ err }`, not `.message`
- `pino-pretty` is used in non-production environments (colorized, human-readable)
- `console.warn` is acceptable only in `agent-config.ts` for startup config warnings (noted with `// eslint-disable-next-line no-console`)

## CLI Structure (`schedule-cli.ts` / `mission-cli.ts` as Models)

New CLIs must follow this structure (use `src/schedule-cli.ts` and `src/mission-cli.ts` as templates):

1. Shebang + JSDoc block listing all subcommands
2. Named imports from `./db.js` and relevant modules
3. `initDatabase()` call immediately after imports
4. Manual flag parsing from `process.argv` (parse named `--flag value` pairs first, then clean them out of argv)
5. Extract `[, , command, ...rest]` from cleaned argv
6. `switch (command)` with one `case` per subcommand
7. Each case: validate required args, call the DB/service function, log to `console.log`
8. `default:` case logs usage and calls `process.exit(1)`
9. No framework (no commander, yargs, etc.)

**Flag parsing idiom:**
```typescript
const flagIdx = process.argv.indexOf('--flag');
const flagValue = flagIdx !== -1 ? process.argv[flagIdx + 1] ?? 'default' : 'default';
// Clean flag from argv before [, , command, ...rest] destructuring
const cleanedArgv = flagIdx !== -1
  ? process.argv.filter((_, i) => i !== flagIdx && i !== flagIdx + 1)
  : [...process.argv];
const [, , command, ...rest] = cleanedArgv;
```

## Agent YAML Schema Conventions

Agent configuration lives in `agents/{id}/agent.yaml`. The canonical fields (parsed by `src/agent-config.ts`):

```yaml
name: Research           # Required. Human display name.
description: Deep web research, ...  # Required. One line describing the agent's purpose.

telegram_bot_token_env: RESEARCH_BOT_TOKEN  # Optional. Env var name (not value) holding the Telegram token.

model: claude-sonnet-4-6  # Optional. Full model ID or alias (opus/sonnet/haiku). Unset = default.

# Optional. Agent runs in this directory, loading its own CLAUDE.md/.claude settings.
project_dir: /path/to/project

# Optional. Slack channel this agent exclusively owns.
slack_channel: C0XXXXXXX

# Optional. Obsidian vault injection.
obsidian:
  vault: /path/to/vault
  folders:
    - Projects/
  read_only:
    - Daily Notes/

# Optional. MCP server allowlist (names matching ~/.claude/settings.json mcpServers).
mcp_servers:
  - gmail
  - google-calendar

# Optional. War room tool policy override.
warroom_tools:
  - Bash
  - Write
```

**Rules for agent IDs:** lowercase alphanumerics, `_`, and `-` only. Validated by `AGENT_ID_RE = /^[a-z0-9_-]+$/i` in `src/agent-config.ts`.

## Import Organization

Imports are grouped in this order, separated by blank lines:

1. Node built-in modules (`fs`, `path`, `os`, `crypto`)
2. Third-party packages (`grammy`, `pino`, `better-sqlite3`)
3. Internal project imports (`./config.js`, `./logger.js`, `./errors.js`)

No enforced import sorter tooling — this is a manual convention.

## Error Handling

**In service/library code:** throw typed errors or return typed results. Never swallow errors silently.

**In bot/transport handlers:** catch all errors, classify with `classifyError()`, and use `recovery.userMessage` for the user-facing string.

**In CLI scripts:** catch at the top level, `console.error` a human message, `process.exit(1)`.

**Silent catch pattern** (only for non-critical paths):
```typescript
try {
  fs.writeFileSync(path, data);
} catch {
  // Non-fatal — skip silently
}
```
This is acceptable only when the failure truly cannot affect correctness (e.g. writing optional roster files).

## Comments

**JSDoc blocks** on exported functions and classes. Internal helpers use inline comments only when non-obvious.

**Section dividers** within large files use this pattern:
```typescript
// ── Section Name ────────────────────────────────────────────────────
```

**Inline explanations** are used heavily in `src/config.ts` to explain why each default value was chosen.

## Function Design

**Async functions** return `Promise<T>` with explicit return types. Generator-based async iteration (`async function*`) is used in `src/agent.ts` for SDK event streaming.

**Optional parameters** are typed as `param?: string` (not `param: string | undefined`) except when `undefined` must be explicitly passed.

**Exported mutable state** in `src/config.ts` uses `export let` with a companion setter function (e.g. `export function setAgentOverrides(...)`). Callers must use the setter, not assign directly.

---

*Convention analysis: 2026-06-14*
