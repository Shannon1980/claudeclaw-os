# Testing Patterns

**Analysis Date:** 2026-06-14

## Test Framework

**Runner:**
- vitest v2.x
- Config: `vitest.config.ts` (project root) + inline `"vitest"` block in `package.json` (both present; `vitest.config.ts` takes precedence)

**Assertion Library:**
- vitest built-in (`expect`, matchers from `@vitest/expect`)

**Coverage:**
- `@vitest/coverage-v8` (V8 native coverage)

**Run Commands:**
```bash
npm test                  # Run all tests once (vitest run)
npm run test:watch        # Watch mode (vitest)
npm run test:coverage     # Run with coverage (vitest run --coverage)
npm run typecheck         # TypeScript check without emitting (tsc --noEmit)
```

## Test File Organization

**Location:** Co-located with source in `src/`. Every test file sits next to its module.

**Naming conventions:**
- Unit tests: `{module}.test.ts` (e.g. `errors.test.ts`, `format.test.ts`)
- Integration tests: `{module}.integration.test.ts` (e.g. `file-send.integration.test.ts`)
- Contract tests: `{module}.contract.test.ts` (e.g. `dashboard.contract.test.ts`)

**Glob pattern** (from `vitest.config.ts`):
```
src/**/*.test.ts
```
This picks up all three suffixes (`.test.ts`, `.integration.test.ts`, `.contract.test.ts`).

**Setup file:** `src/test-env-setup.ts` — runs before any test module loads via `setupFiles`. Sets environment variables that `config.ts` reads at import time:
```typescript
process.env.DASHBOARD_TOKEN = 'test-contract-token';
process.env.WARROOM_ENABLED = 'false';
process.env.DASHBOARD_URL = 'https://dash.test.example';
```
Any new test that exercises code importing `config.ts` may need additional env vars added here.

## Test Suite Structure

Tests are organized with `describe` blocks by function or feature, with nested `describe` for sub-behaviors:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('functionName', () => {
  // Setup and teardown
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Sub-group by behavior
  describe('when condition X', () => {
    it('does Y', () => {
      // arrange
      // act
      // assert
    });
  });

  it('handles edge case Z', () => { ... });
});
```

**Section comments** are used inside describe blocks to group related tests:
```typescript
// ── Category detection ──────────────────────────────────────────────
it('classifies rate limit errors', () => { ... });

// ── Recovery properties ─────────────────────────────────────────────
it('rate_limit has positive retryAfterMs', () => { ... });
```

## Mocking

**Framework:** vitest's built-in `vi.mock()` and `vi.fn()`.

**Top-level mocking pattern** (all vi.mock calls go before any imports):

```typescript
// Mock declarations — must be at top of file, before all imports
vi.mock('./db.js', () => ({
  searchMemories: vi.fn(),
  getSession: vi.fn(() => undefined),
  setSession: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Imports come AFTER all vi.mock() calls
import { buildMemoryContext } from './memory.js';
import { searchMemories } from './db.js';
```

**Typed mock references:**
```typescript
const mockSearchMemories = vi.mocked(searchMemories);
// Then in tests:
mockSearchMemories.mockReturnValue([...]);
mockSearchMemories.mockReturnValueOnce([...]);
```

**What to mock:**
- All I/O: `db.js` functions, file system calls, external HTTP APIs
- The `logger.js` instance (prevents noise in test output)
- The Claude SDK `@anthropic-ai/claude-agent-sdk` `query` function
- `config.js` when tests need to control env-derived values

**What NOT to mock:**
- Pure utility functions (`format.ts`, `errors.ts`) — test them directly
- In-memory SQLite via `_initTestDatabase()` — use the real DB layer for DB tests

**Async generator mocking** (for SDK query events):
```typescript
function mockQueryEvents(events: Array<Record<string, unknown>>) {
  return async function* () {
    for (const ev of events) yield ev;
  };
}
mockQuery.mockReturnValue(mockQueryEvents([...])());
```

**vi.hoisted** is used when mock setup code must run before the module factory evaluates (e.g. creating temp directories for filesystem-dependent config mocks):
```typescript
const FIXTURE_ROOT = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'));
});
vi.mock('./config.js', () => ({ CLAUDECLAW_CONFIG: FIXTURE_ROOT, PROJECT_ROOT: FIXTURE_ROOT }));
```

## In-Memory Database Testing

`src/db.ts` exports `_initTestDatabase()` (underscore prefix signals test-only). Call it in `beforeEach` for full DB coverage:

```typescript
import { _initTestDatabase, setSession, getSession } from './db.js';

describe('database', () => {
  beforeEach(() => {
    _initTestDatabase();  // Fresh in-memory SQLite before each test
  });

  it('stores and retrieves a session', () => {
    setSession('chat1', 'sess-abc');
    expect(getSession('chat1')).toBe('sess-abc');
  });
});
```

This approach covers the real SQL schema and query logic without touching the developer's actual `store/claudeclaw.db`.

## Fixtures and Factories

**Object factories** are used in tests with complex data shapes (avoids repetition):

```typescript
function makeMemory(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    chat_id: 'chat1',
    source: 'conversation',
    agent_id: 'main',
    summary: 'A test memory',
    importance: 0.7,
    salience: 1.0,
    // ... all required fields with sensible defaults
    ...overrides,
  };
}
// Usage:
makeMemory({ summary: 'Custom summary', importance: 0.9 })
```

**Filesystem fixtures** are created in temp directories using `os.tmpdir()`:

```typescript
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeclaw-test-'));
// Always clean up in afterEach/afterAll:
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });
```

**Agent YAML fixtures** (for `agent-config.test.ts`) are written into temp directories via a helper:
```typescript
function writeAgent(id: string, yamlBody: string, claudeMd?: string): void {
  const dir = path.join(FIXTURE_ROOT, 'agents', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent.yaml'), yamlBody);
  if (claudeMd !== undefined) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);
}
```

## Test Types

**Unit tests** (majority): exercise a single function or module in isolation. Mock all external dependencies. Location: `src/*.test.ts`.

**Integration tests:** run real pipelines with minimal mocking. Example: `src/file-send.integration.test.ts` tests the full parse-to-send pipeline against a mocked Grammy context. Real API calls are gated by `it.skipIf(!canRunRealTests)`.

**Contract tests:** pin the HTTP response shape of the dashboard API. Use Hono's `app.request()` (no real port opened). Located in `src/dashboard.contract.test.ts`. These rely on `_initTestDatabase()` and the `test-env-setup.ts` setup file.

**CLI integration tests** (`src/schedule-cli.test.ts`): run the compiled CLI binary as a child process via `execSync`. These require the build output at `dist/schedule-cli.js` to be present before running.

**Skippable real-API tests:** pattern for tests that require live credentials:
```typescript
const canRunRealTests = !!(token && chatId);
it.skipIf(!canRunRealTests)('sends a real document', async () => {
  // ...
}, 15000); // Custom timeout for network calls
```

## Coverage

**Requirements:** None enforced (no coverage threshold in config).

**View coverage:**
```bash
npm run test:coverage
```
Coverage is measured via V8. Output goes to `coverage/` (not committed).

## Well-Covered Modules

These modules have comprehensive dedicated test files:

| Module | Test File | Coverage depth |
|--------|-----------|----------------|
| `src/errors.ts` | `src/errors.test.ts` | All 9 error categories, recovery flags, result-level API errors |
| `src/env.ts` | `src/env.test.ts` | All parsing edge cases |
| `src/db.ts` | `src/db.test.ts` | Full schema: sessions, memories, consolidations, dashboard queries |
| `src/format.ts` | `src/format.test.ts` | splitMessage, extractFileMarkers, formatForSlack transforms |
| `src/agent-config.ts` | `src/agent-config.test.ts` | slack_channel routing, model alias resolution, project_dir, runtime resolution |
| `src/memory.ts` | `src/memory.test.ts` | buildMemoryContext, dedup, consolidations, decay sweep |
| `src/agent.ts` | `src/agent.test.ts` | runAgentWithRetry retry logic, model fallback chain |
| `src/dashboard.ts` | `src/dashboard.contract.test.ts` | All HTTP endpoint shapes, auth gate, CSRF |

## Untested Modules (Coverage Gaps)

These modules have no corresponding `*.test.ts` file:

- `src/config.ts` — no tests; env var resolution logic is implicitly tested via other modules
- `src/orchestrator.ts` — delegation routing untested
- `src/security.ts` — kill phrase and exfiltration guard (partially covered via `exfiltration-guard.test.ts`)
- `src/slack.ts`, `src/whatsapp.ts` — third-party API wrappers untested
- `src/message-queue.ts`, `src/state.ts` — runtime state modules untested
- `src/index.ts` — boot sequence untested (startup wiring)
- `src/mission-cli.ts` — no test; only `schedule-cli.ts` has CLI integration tests
- `src/models.ts` — pure data module; model alias tested indirectly via `agent-config.test.ts`
- All `warroom-*.ts` modules except `warroom-text-orchestrator.test.ts` and `warroom-text-db.test.ts`

## Patterns a Contributor Must Follow When Adding Tests

1. **Co-locate the test file** next to the source: `src/newmodule.ts` → `src/newmodule.test.ts`

2. **Mock all I/O at the top**, before any imports. Include `./db.js`, `./logger.js`, and any external packages the module touches.

3. **Use `_initTestDatabase()`** in `beforeEach` whenever the test needs real SQLite behavior.

4. **Use `vi.clearAllMocks()` in `beforeEach`** when mocks are shared across tests.

5. **Create object factories** for any repeated data shape with more than 3 fields.

6. **Use `os.tmpdir()` and `fs.mkdtempSync()`** for all temp file fixtures. Clean up in `afterEach` or `afterAll`.

7. **Gate real-API tests** with `it.skipIf(!canRunRealTests)` and add a custom timeout (e.g. `}, 15000)`).

8. **Section comments** within large describe blocks improve scannability:
   ```typescript
   // ── Specific behavior name ──────────────────────────────────────
   ```

9. **Do not add env var dependencies** to tests without updating `src/test-env-setup.ts` first if the module reads from `config.ts` at import time.

---

*Testing analysis: 2026-06-14*
