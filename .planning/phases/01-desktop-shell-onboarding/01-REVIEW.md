---
phase: 01-desktop-shell-onboarding
reviewed: 2026-06-22T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - src/desktop-config.ts
  - src/desktop-config.test.ts
  - src/env.ts
  - src/env.test.ts
  - src/config.ts
  - src/config.test.ts
  - src/migrate-runner.ts
  - src/migrate-runner.test.ts
  - scripts/migrate.ts
  - electron/main.cjs
  - electron/config.cjs
  - electron/preload.cjs
  - electron/boot.html
  - electron/onboarding.html
  - build/notarize.cjs
  - package.json
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: resolved
resolution: "All 12 findings addressed by gsd-code-fixer. CR-01 (token redaction) + CR-02 (file-only auth precedence) fixed and verified; WR-01..06 fixed; IN-02/IN-04/IN-01(partial) fixed; IN-01(cross-parser test) + IN-03 skipped as non-blocking with documented reason. Typecheck clean, build clean, 706/707 tests pass (1 pre-existing unrelated failure)."
resolved_at: 2026-06-22T00:00:00Z
fix_commits:
  - 9a7393c  # CR-01
  - 78da079  # CR-02, WR-01
  - f9ebd91  # WR-02, WR-03
  - 7f8c417  # WR-04
  - 881765e  # WR-05
  - ca2d808  # WR-06
  - b49392d  # IN-02
  - 9af8b55  # IN-04
  - 6b6ed42  # IN-01 (partial)
---

# Phase 1: Code Review Report

**Reviewed:** 2026-06-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 1 implements the desktop shell, onboarding wizard, auth-precedence helpers, the CLAUDECLAW_DATA_DIR redirect, and a non-interactive migration runner. The core invariants that the phase set out to protect are mostly well-handled: the pure `resolveAuthWrite` / `activeAuthSource` helpers enforce the never-coexist rule with good test coverage, and `runMigrations` genuinely avoids stdin and `process.exit` (verified by the readline spy in the test).

However, the headline security requirement — "tokens must never be logged or persisted in plaintext" — is violated in practice. The `claude setup-token` subprocess prints the 1-year OAuth token to stdout, and `runStreaming` streams every stdout chunk verbatim to the renderer log via `sendLog`, so the credential lands in the wizard's visible log DOM. A second invariant gap: the auth-source / verify IPC handlers read `process.env` before the `.env` file, so a stale inherited `ANTHROPIC_API_KEY` in the Electron parent environment can silently outrank a fresh OAuth login — the exact crash-loop trap the phase exists to close. Both are below.

## Critical Issues

### CR-01: OAuth token is streamed to the renderer log in plaintext (never-log invariant violated)

**File:** `electron/main.cjs:366-385` (`runStreaming`), reached from `onb:claudeLogin` at `electron/main.cjs:435-453`
**Issue:** `claude setup-token` prints the `sk-ant-oat01…` token to its stdout. `runStreaming` does, for every stdout chunk:

```js
proc.stdout.on('data', (b) => {
  const s = b.toString();
  stdout += s;
  sendLog(s);          // <-- streams the raw chunk (which contains the token) to the renderer
});
```

`sendLog` forwards the line to the renderer over IPC (`onb:log`), and `onboarding.html` appends it directly into the visible `#log` element (`log.textContent += line`). So the token is rendered in the UI, held in renderer DOM/memory, and is exactly the plaintext exposure the file's own SECURITY comments (lines 359-365, 390, 434) claim does not happen. The comment "we do not echo the parsed token anywhere" is true of the *parsed* copy but false of the *raw stream*. This defeats the stated PKG-05 / token-handling requirement.

**Fix:** Redact token-shaped substrings before streaming to the log. Filter inside `runStreaming` (or in a wrapper used only for the login path):

```js
const TOKEN_RE = /sk-ant-(?:oat|api)[0-9A-Za-z._-]+/g;
proc.stdout.on('data', (b) => {
  const s = b.toString();
  stdout += s;                                  // keep raw for extractOauthToken
  sendLog(s.replace(TOKEN_RE, 'sk-ant-***redacted***'));
});
```

Apply the same redaction to the stderr handler, since the CLI may echo prompts/values there too.

### CR-02: Auth-source and verify handlers consult `process.env` first, so a stale `ANTHROPIC_API_KEY` outranks a fresh OAuth login

**File:** `electron/config.cjs:88-93` (`readEnv`), consumed by `onb:getAuthSource` (`electron/main.cjs:474-485`) and `onb:verifyAuth` (`electron/main.cjs:495-512`)
**Issue:** `readEnv` resolves each key as `process.env[key] || fileVals[key]`. The Electron main process inherits the launching shell's environment; per the project's own documented crash-loop trap (CLAUDE.md / MEMORY.md "stale ANTHROPIC_API_KEY in .env overriding claude login"), a developer or operator may have `ANTHROPIC_API_KEY` exported in their environment. In that case:

- `onb:getAuthSource` reads `ANTHROPIC_API_KEY` from `process.env`, so `activeAuthSource` returns `'apikey'` even though the wizard just wrote `CLAUDE_CODE_OAUTH_TOKEN` to the `.env` and cleared the key there. The UI then tells the user "Using your API key" after they signed in with OAuth.
- `onb:verifyAuth` (line 502-512) passes the `process.env` `ANTHROPIC_API_KEY` into `getScrubbedSdkEnv`, so verification (and later the real service) authenticates with the stale key, not the credential the operator chose. This is the never-coexist invariant breaking at runtime — exactly the trap this phase is meant to eliminate, just relocated from `.env` to the process environment.

The pure helper `activeAuthSource` is correct; the defect is that the shell feeds it `process.env`-contaminated input. Note `isConfigured` and `checkLogin` correctly read the file only (`parseEnvFile`) — the inconsistency makes the bug easy to miss.

**Fix:** For auth-credential reads, read from the managed `.env` only — never `process.env`. Add a file-only reader and use it in both handlers:

```js
// config.cjs
function readEnvFromFile(envPath, keys) {
  const fileVals = parseEnvFile(envPath || resolveEnvPath());
  const out = {};
  for (const key of keys) out[key] = fileVals[key] || '';
  return out;
}
```

Then in `onb:getAuthSource` and `onb:verifyAuth` use `cfg.readEnvFromFile(ENV_PATH, [...])`. Keep `readEnv`'s `process.env` precedence only for non-secret operational values (e.g. DASHBOARD_PORT) if needed.

## Warnings

### WR-01: `verifyAuth` can pass BOTH auth vars into the scrubbed SDK env, re-creating coexistence at the spawn boundary

**File:** `electron/main.cjs:502-512`
**Issue:** The handler reads both `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` and forwards both to `getScrubbedSdkEnv`:

```js
const sdkEnv = getScrubbedSdkEnv({
  CLAUDE_CODE_OAUTH_TOKEN: secrets.CLAUDE_CODE_OAUTH_TOKEN || undefined,
  ANTHROPIC_API_KEY: secrets.ANTHROPIC_API_KEY || undefined,
});
```

`resolveAuthWrite` guarantees the `.env` never holds both, so in the normal path only one is set. But this code makes no use of `activeAuthSource` and would happily forward both if the `.env` were hand-edited or contaminated (see CR-02). The "one credential only" invariant should be enforced here, not assumed.

**Fix:** Resolve the single active source first and forward only that var:

```js
const source = await cfg.activeAuthSource(secrets); // 'apikey' | 'oauth' | 'none'
const sdkEnv = getScrubbedSdkEnv(
  source === 'apikey'
    ? { ANTHROPIC_API_KEY: secrets.ANTHROPIC_API_KEY }
    : { CLAUDE_CODE_OAUTH_TOKEN: secrets.CLAUDE_CODE_OAUTH_TOKEN },
);
```

### WR-02: Backup rotation can delete the backup just created for the current migration

**File:** `src/migrate-runner.ts:153-188`
**Issue:** The backup filename is `claudeclaw.db.pre-${pendingVersions[0]}.bak`. The rotation step (lines 176-185) keeps the 3 newest `.bak` files by mtime and deletes the rest. If three or more older backups already exist with mtimes ahead of the freshly written one (e.g. filesystem mtime granularity ties, or clock skew on a restored backup), `baks.slice(3)` can include the backup created microseconds earlier in this same run, removing the only pre-migration snapshot before migrations execute. The recovery instructions in `scripts/migrate.ts:210` (`cp store/claudeclaw.db.pre-*.bak`) then point at a file that may not exist.

**Fix:** Exclude the just-created backup from the rotation candidate set, or sort with the current backup pinned:

```js
const baks = fs.readdirSync(storeDir)
  .filter((f) => f.startsWith('claudeclaw.db.pre-') && f.endsWith('.bak') && f !== path.basename(backupPath))
  .map((f) => ({ f, mtime: fs.statSync(path.join(storeDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
for (const old of baks.slice(2)) { /* keep current + 2 = 3 total */ }
```

### WR-03: Migration runner only loads `mod.run` for the FIRST file per version, but pre-flight imports each file twice (no validation that `run` exists)

**File:** `src/migrate-runner.ts:121-146` and `192-210`
**Issue:** The pre-flight loop (123-146) imports every pending migration module to catch load errors, but never asserts the module actually exports a callable `run`. The apply loop (192-210) then casts `as MigrationModule` and calls `mod.run()` without a guard. A migration file that loads fine but is missing `run` (typo, wrong export name) throws `TypeError: mod.run is not a function` mid-apply — *after* the backup/rotation and possibly after earlier versions already mutated the DB and advanced `.applied.json` (line 209). The pre-flight that exists specifically "so a missing/broken file fails before we touch the DB" does not catch this class.

**Fix:** Validate the export shape during pre-flight:

```js
const mod = await import(pathToFileURL(filePath).href);
if (typeof mod.run !== 'function') {
  return { status: 'failed', from: lastApplied, to: latest,
    error: `Migration ${filePath} has no run() export.` };
}
```

### WR-04: `runMigrationsStep` driver inherits the full `process.env` into the migration child

**File:** `electron/main.cjs:200-208`
**Issue:** The migration child is spawned with `{ ...process.env, __MIGRATE_* }`. Migrations run arbitrary code (`await mod.run()`) with the entire shell environment, including any secrets present in the Electron parent (ANTHROPIC_API_KEY, etc.). Given the phase's emphasis on scrubbing the SDK subprocess env via `getScrubbedSdkEnv` for `verifyAuth`, the migration subprocess is an inconsistent, unscrubbed surface. Migrations needing DB access only need `CLAUDECLAW_DATA_DIR` and DB_ENCRYPTION_KEY, not the whole environment.

**Fix:** Pass a minimal env to the migration child (data dir + the keys migrations legitimately need), mirroring the scrubbing discipline applied to the verify spawn.

### WR-05: `loadSecurity()` mutates and reuses `_securityPromise` in a way that breaks the cache contract

**File:** `electron/main.cjs:349-357`
**Issue:**

```js
let _securityPromise = null;
function loadSecurity() {
  if (!_securityPromise) {
    const compiled = path.join(APP_ROOT, 'dist', 'security.js');
    _securityPromise = require('url').pathToFileURL(compiled).href; // string
    _securityPromise = import(_securityPromise);                    // promise
  }
  return _securityPromise;
}
```

If `import()` rejects (e.g. `dist/security.js` missing in a partial build), `_securityPromise` is left holding a *rejected* promise forever; every subsequent `verifyAuth` call returns the same rejection with no chance to retry after the file appears. The intermediate assignment of a string to a variable named `_securityPromise` is also confusing and fragile. Caching a rejected promise is a known anti-pattern.

**Fix:** Cache only on success, and use a local for the URL:

```js
function loadSecurity() {
  if (!_securityPromise) {
    const url = require('url').pathToFileURL(path.join(APP_ROOT, 'dist', 'security.js')).href;
    _securityPromise = import(url).catch((e) => { _securityPromise = null; throw e; });
  }
  return _securityPromise;
}
```

### WR-06: `onb:finish` writes secrets and navigates even when the secret write failed

**File:** `electron/main.cjs:584-604`
**Issue:** If the `try` block at 585-591 throws, the handler returns `{ ok: false, error }` (good). But `bootDashboard` later calls `refreshConfig()` which reads `DASHBOARD_TOKEN`; if generation failed there is no token and the dashboard URL has no token, yet there is no signal back to the user beyond the rejected IPC. More importantly, the renderer's `done()` Next handler (`onboarding.html:463-468`) calls `await api.finish()` and unconditionally returns ("main navigates to the dashboard") without checking `res.ok`. A failed finish leaves the wizard stuck on "Starting…" with no error surfaced.

**Fix:** In `onboarding.html` check the result: `const r = await api.finish(); if (!r.ok) { alert(r.error); nextBtn.disabled = false; nextBtn.textContent = 'Open dashboard'; return; }`.

## Info

### IN-01: Duplicated env-parsing logic across three implementations

**File:** `src/env.ts:30-45`, `electron/config.cjs:61-85`, `scripts/migrate.ts` (semver)
**Issue:** The .env line parser is reimplemented in `src/env.ts` (TS, ESM) and `electron/config.cjs` (CJS) with the same quote-stripping rules, and `parseSemver`/`compareSemver` are duplicated between `scripts/migrate.ts:34-46` and `src/migrations.ts` (the runner imports the latter). Drift between the two parsers (e.g. one handling `export KEY=` or escaped quotes, the other not) would silently desync the desktop and service views of `.env`.
**Fix:** Accept the CJS/ESM split is forced, but add a cross-test that feeds the same fixture through both parsers and asserts equality; delete the duplicate semver helpers in `scripts/migrate.ts` and import from `src/migrations.ts`.

### IN-02: `extractOauthToken` regex will also match `sk-ant-oat` tokens embedded in surrounding text without boundaries

**File:** `electron/main.cjs:391-395`
**Issue:** `/sk-ant-oat[0-9A-Za-z._-]+/` has no trailing boundary, so it greedily consumes any trailing `._-` characters that happen to follow the token (e.g. a trailing period in prose "...token sk-ant-oat01abc." would not be captured here since `.` is in the class — the period is swallowed into the token). Low impact because the captured value is only used as a credential the CLI itself accepts, but a swallowed trailing `.` or `-` could produce an invalid token that then fails `verifyAuth` with a confusing error.
**Fix:** Anchor to whitespace/end: `/sk-ant-oat[0-9A-Za-z_-]+/` (drop `.` from the class if the token format does not contain dots) or match on a per-line basis after trimming.

### IN-03: `boot.html` retry button has no failure feedback and stays disabled forever on repeated failure

**File:** `electron/boot.html:146-154`
**Issue:** Clicking Retry sets `retry.disabled = true` and invokes `boot.retryMigration()`, but `bootDashboard` reloads a fresh `boot.html` only on success/known states; if migration fails again the main process loads `migrating-failed` again (a new page), so the disabled state is reset by the reload — acceptable. But the fire-and-forget invoke result is ignored; no user-visible spinner restart on this page between click and reload.
**Fix:** Minor UX; optionally re-enable after a timeout or show a transient "retrying…" state. Non-blocking.

### IN-04: `package.json` `extraResources` copies `migrations/**` but the dev tsx runner path expects `node_modules/.bin/tsx` which is not bundled

**File:** `package.json:94-106`, `electron/main.cjs:175-182`
**Issue:** `resolveMigrationRunner`/`resolveServiceCommand` fall back to `node_modules/.bin/tsx` when `dist/` is absent. In a packaged build `extraResources` ships only `dist/`, `agents/`, `warroom/`, `migrations/`, `package.json` — not `node_modules`. The dist path should always exist in a real build so the tsx fallback is dev-only, but if a packaged build ever ships without `dist/migrate-runner.js` (build ordering bug), the fallback resolves a nonexistent tsx and migration fails with an opaque spawn error rather than a clear "build incomplete" message.
**Fix:** In packaged mode (`app.isPackaged`), treat a missing `dist/` as a hard configuration error with an explicit message rather than silently attempting the tsx fallback.

---

_Reviewed: 2026-06-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
