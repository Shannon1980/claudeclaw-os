import { describe, it, expect } from 'vitest';
import {
  evaluatePreToolUse,
  hookDenyPayload,
  isSecretPath,
  isShipCommand,
} from './claude-code-policy.js';

describe('isSecretPath', () => {
  it('blocks .env and dotenv variants but not .env.example', () => {
    expect(isSecretPath('.env')).toBe(true);
    expect(isSecretPath('/tmp/project/.env')).toBe(true);
    expect(isSecretPath('/tmp/project/.env.local')).toBe(true);
    expect(isSecretPath('.env.example')).toBe(false);
    expect(isSecretPath('/tmp/project/.env.example')).toBe(false);
  });

  it('blocks store/ and database files, not src/db.ts', () => {
    expect(isSecretPath('store/claudeclaw.db')).toBe(true);
    expect(isSecretPath('/Users/me/app/store/waweb/session')).toBe(true);
    expect(isSecretPath('notes.db')).toBe(true);
    expect(isSecretPath('src/db.ts')).toBe(false);
    expect(isSecretPath('src/db.test.ts')).toBe(false);
  });
});

describe('isShipCommand', () => {
  it('flags landing on main, deploys, and hook bypasses', () => {
    expect(isShipCommand('git push origin main')).toBe(true);
    expect(isShipCommand('npm run electron:build')).toBe(true);
    expect(isShipCommand('npm run migrate')).toBe(true);
    expect(isShipCommand('launchctl bootout gui/501/com.claudeclaw.main')).toBe(true);
    expect(isShipCommand('git commit --no-verify -m x')).toBe(true);
    expect(isShipCommand('git config core.hooksPath /tmp/hooks')).toBe(true);
  });

  it('leaves ordinary PR-flow commands alone', () => {
    expect(isShipCommand('git checkout -b claude/fix-thing')).toBe(false);
    expect(isShipCommand('git commit -m "fix: thing"')).toBe(false);
    expect(isShipCommand('git push -u origin claude/fix-thing')).toBe(false);
    expect(isShipCommand('gh pr create --base main --title x --body y')).toBe(false);
    expect(isShipCommand('npm test')).toBe(false);
  });
});

describe('evaluatePreToolUse', () => {
  it('blocks Read/Grep/Write on secret paths', () => {
    expect(evaluatePreToolUse('Read', { file_path: '/proj/.env' }).deny).toBe(true);
    expect(evaluatePreToolUse('Grep', { path: '/proj/store' }).deny).toBe(true);
    expect(evaluatePreToolUse('Write', { file_path: '/proj/store/waweb/x' }).code).toBe('secret-path');
    expect(evaluatePreToolUse('Read', { file_path: '/proj/.env.example' }).deny).toBe(false);
    expect(evaluatePreToolUse('Read', { file_path: '/proj/src/db.ts' }).deny).toBe(false);
  });

  it('blocks Bash that cats secrets or ships', () => {
    expect(evaluatePreToolUse('Bash', { command: 'cat .env' }).code).toBe('secret-bash');
    expect(evaluatePreToolUse('Bash', { command: "sqlite3 store/claudeclaw.db 'select 1'" }).code).toBe('secret-bash');
    expect(evaluatePreToolUse('Bash', { command: 'npm run electron:build' }).code).toBe('ship-command');
    expect(evaluatePreToolUse('Bash', { command: 'git push --no-verify origin feat' }).code).toBe('hooks-bypass');
  });

  it('allows PR-flow Bash and doc reads', () => {
    expect(evaluatePreToolUse('Bash', { command: 'gh pr create --title x --body y' }).deny).toBe(false);
    expect(evaluatePreToolUse('Bash', { command: 'git push -u origin claude/x' }).deny).toBe(false);
    expect(evaluatePreToolUse('Bash', { command: 'rg store src/' }).deny).toBe(false);
    expect(evaluatePreToolUse('Read', { file_path: '/proj/CLAUDE.md' }).deny).toBe(false);
  });

  it('blocks writes to .githooks/', () => {
    const d = evaluatePreToolUse('Edit', { file_path: '/proj/.githooks/pre-push' });
    expect(d.deny).toBe(true);
    expect(d.code).toBe('hooks-bypass');
  });

  it('emits a deny payload Claude Code can parse', () => {
    const json = JSON.parse(hookDenyPayload('nope'));
    expect(json.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(json.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(json.systemMessage).toBe('nope');
  });
});
