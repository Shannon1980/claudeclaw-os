/**
 * Shared policy for Claude Code PreToolUse hooks and the in-process
 * permission gate. Pure functions, no I/O, no SDK imports. The hook runner
 * must stay cheap enough to fire on every Read/Bash call.
 *
 * Two jobs:
 *   1. Block tool calls that would pull live secrets into a session
 *      (.env, store/, *.db, WhatsApp Web session keys).
 *   2. Block ship/deploy Bash that CLAUDE.md marks as operator-only.
 */

export type PolicyCode = 'secret-path' | 'secret-bash' | 'ship-command' | 'hooks-bypass';

export interface PolicyDecision {
  deny: boolean;
  reason?: string;
  code?: PolicyCode;
}

/**
 * Ship-shaped commands. Same list the permission gate uses for Tier 4.
 * Feature-branch `git push`, `git commit`, and `gh pr create` stay off this
 * list on purpose so unattended agents can still open a PR.
 */
const SHIP_PATTERNS: RegExp[] = [
  /\bgit\s+push\b[^|;&]*?(--force|--force-with-lease|\s-f\b)/i,
  /\bgit\s+push\b[^|;&]*?\b(main|master)\b/i,
  /\bgh\s+pr\s+merge\b/i,
  /\bnpm\s+publish\b/i,
  /\bgh\s+release\s+(create|upload|edit)\b/i,
  /\bnpm\s+run\s+(electron:build|migrate)\b/i,
  /\belectron-builder\b/i,
  /\b(ditto|cp|rsync|mv|rm)\b[^|;&]*\/Applications\//i,
  /\blaunchctl\s+(bootstrap|bootout|kickstart|load|unload)\b/i,
  /(?:^|[\s;|&])--no-verify\b/,
  /\bgit\s+config\b[^|;&]*\bcore\.hooksPath\b/i,
];

const HOOKS_DIR = /(^|\/)\.githooks(\/|$)/;
const DOT_ENV_EXAMPLE = /(^|\/)\.env\.example$/;
const DOT_ENV = /(^|\/)\.env(\.[^/]+)?$/;
const STORE_DIR = /(^|\/)store(\/|$)/;
const DB_FILE = /\.(db|db-wal|db-shm|sqlite|sqlite3)$/;
const DB_BACKUP = /\.db\.pre-.*\.bak(-wal|-shm)?$/;
const READER_CMD = /\b(cat|less|more|head|tail|rg|grep|bat|sqlite3|xxd|hexdump|od|strings)\b/i;

export function isShipCommand(command: string): boolean {
  return SHIP_PATTERNS.some((r) => r.test(command));
}

export function isSecretPath(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/').trim();
  if (!p) return false;
  if (DOT_ENV_EXAMPLE.test(p)) return false;
  if (DOT_ENV.test(p)) return true;
  if (STORE_DIR.test(p)) return true;
  if (DB_FILE.test(p) || DB_BACKUP.test(p)) return true;
  return false;
}

export function isHooksBypassPath(filePath: string): boolean {
  return HOOKS_DIR.test(filePath.replace(/\\/g, '/'));
}

function pathFromInput(input: Record<string, unknown>): string[] {
  const keys = ['file_path', 'path', 'glob', 'pattern'] as const;
  const out: string[] = [];
  for (const key of keys) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) out.push(v);
  }
  return out;
}

function extractPathTokens(command: string): string[] {
  const tokens: string[] = [];
  const quoted = command.matchAll(/['"]([^'"]+)['"]/g);
  for (const m of quoted) tokens.push(m[1]);
  for (const part of command.split(/\s+/)) {
    if (!part) continue;
    if (/[\\/]|\.env|\.db|store\//.test(part)) tokens.push(part.replace(/^['"]|['"]$/g, ''));
  }
  return tokens;
}

function deny(code: PolicyCode, reason: string): PolicyDecision {
  return { deny: true, code, reason };
}

export function evaluatePreToolUse(
  toolName: string,
  toolInput: Record<string, unknown> = {},
): PolicyDecision {
  const name = String(toolName || '');
  const mutating = /^(Write|Edit|NotebookEdit)$/.test(name);

  for (const p of pathFromInput(toolInput)) {
    if (mutating && isHooksBypassPath(p)) {
      return deny(
        'hooks-bypass',
        `Blocked write to ${p}. .githooks/ is operator-owned. Do not edit it.`,
      );
    }
    if (isSecretPath(p)) {
      return deny(
        'secret-path',
        `Blocked ${name} on ${p}. .env, store/, and *.db are credentials. Ask the operator for the value you need instead of reading the file.`,
      );
    }
  }

  if (name !== 'Bash') return { deny: false };

  const command = String(toolInput.command ?? '');
  if (!command.trim()) return { deny: false };

  if (/(?:^|[\s;|&])--no-verify\b/.test(command) || /\bgit\s+config\b[^|;&]*\bcore\.hooksPath\b/i.test(command)) {
    return deny(
      'hooks-bypass',
      `Blocked \`${command}\`. --no-verify and core.hooksPath changes bypass the ship gate. Ask the operator.`,
    );
  }

  if (isShipCommand(command)) {
    return deny(
      'ship-command',
      `Blocked \`${command}\`. Ship and deploy stay operator-only (PR, never main, never electron:build / live migrate / launchctl). Open a PR and stop.`,
    );
  }

  if (READER_CMD.test(command)) {
    for (const token of extractPathTokens(command)) {
      if (isSecretPath(token)) {
        return deny(
          'secret-bash',
          `Blocked \`${command}\`. That reads credentials (.env, store/, or a database file). Ask the operator instead.`,
        );
      }
    }
  }

  return { deny: false };
}

export function hookDenyPayload(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
    systemMessage: reason,
  });
}
