import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Point the config dir + project root at a throwaway fixture tree so the
// loader reads our agent.yaml files instead of the developer's real config.
// Created via vi.hoisted so it exists before the hoisted vi.mock factory runs.
const FIXTURE_ROOT = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const f = require('fs') as typeof import('fs');
  const o = require('os') as typeof import('os');
  const p = require('path') as typeof import('path');
  return f.mkdtempSync(p.join(o.tmpdir(), 'cc-agent-config-'));
});

vi.mock('./config.js', () => ({
  CLAUDECLAW_CONFIG: FIXTURE_ROOT,
  PROJECT_ROOT: FIXTURE_ROOT,
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

import {
  loadAgentConfig,
  getSlackChannelMap,
  resolveAgentRuntime,
  resolveAgentModel,
} from './agent-config.js';

function writeAgent(id: string, yamlBody: string, claudeMd?: string): void {
  const dir = path.join(FIXTURE_ROOT, 'agents', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent.yaml'), yamlBody);
  if (claudeMd !== undefined) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);
}

beforeAll(() => {
  writeAgent(
    'research',
    'name: Research\ndescription: Deep web research\nmodel: claude-sonnet-4-6\nslack_channel: C0RESEARCH\n',
    '# Research\nYou are the research agent.\n',
  );
  writeAgent('comms', 'name: Comms\ndescription: Comms\nslack_channel: C0COMMS\n');
  writeAgent('nochan', 'name: NoChannel\ndescription: No Slack channel\n');
  // Malformed config (no `name` → loadAgentConfig throws). It must be skipped
  // without aborting the map build or dropping the valid agents.
  writeAgent('zbroken', 'description: no name here\nslack_channel: C0BROKEN\n');
  // Duplicate channel claim — the alphabetically-first agent (research) keeps
  // the channel; this later one ("z…") must not override it.
  writeAgent('zdupe', 'name: Dupe\ndescription: Dup channel\nslack_channel: C0RESEARCH\n');
  // Model alias (`opus`) instead of a full id — resolved at runtime.
  writeAgent('aliased', 'name: Aliased\ndescription: Alias model\nmodel: opus\n', '# Aliased\n');
  // project_dir points at a directory that exists (FIXTURE_ROOT) so the
  // runtime uses it as cwd instead of the agent's own dir.
  writeAgent('projdir', `name: ProjDir\ndescription: Project dir\nproject_dir: ${FIXTURE_ROOT}\n`, '# ProjDir\n');
  // project_dir points at a path that does NOT exist; the runtime must fall
  // back to the agent's own dir (non-fatal) rather than the missing path.
  writeAgent(
    'projdirmissing',
    `name: ProjDirMissing\ndescription: Missing project dir\nproject_dir: ${path.join(FIXTURE_ROOT, 'does-not-exist-xyz')}\n`,
    '# ProjDirMissing\n',
  );
});

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('loadAgentConfig slack_channel', () => {
  it('parses slack_channel when present', () => {
    expect(loadAgentConfig('research').slackChannel).toBe('C0RESEARCH');
  });

  it('leaves slack_channel undefined when absent', () => {
    expect(loadAgentConfig('nochan').slackChannel).toBeUndefined();
  });
});

describe('getSlackChannelMap', () => {
  it('maps each declared channel to its agent', () => {
    const map = getSlackChannelMap();
    expect(map.get('C0RESEARCH')).toBe('research');
    expect(map.get('C0COMMS')).toBe('comms');
  });

  it('omits agents with no slack_channel', () => {
    const map = getSlackChannelMap();
    expect([...map.values()]).not.toContain('nochan');
  });

  it('keeps the first agent when two claim the same channel', () => {
    const map = getSlackChannelMap();
    // research and zdupe both claim C0RESEARCH; the alphabetically-first
    // agent wins deterministically (never silently swapped by scan order).
    expect(map.get('C0RESEARCH')).toBe('research');
  });

  it('skips an agent whose config fails to load without dropping the valid ones', () => {
    const map = getSlackChannelMap();
    // zbroken (no `name`) is skipped, but the valid channels still map.
    expect(map.has('C0BROKEN')).toBe(false);
    expect(map.get('C0RESEARCH')).toBe('research');
    expect(map.get('C0COMMS')).toBe('comms');
  });
});

describe('resolveAgentRuntime', () => {
  it('resolves cwd, model, system prompt, and mcp allowlist', () => {
    const rt = resolveAgentRuntime('research');
    expect(rt.agentId).toBe('research');
    expect(rt.cwd).toBe(path.join(FIXTURE_ROOT, 'agents', 'research'));
    expect(rt.model).toBe('claude-sonnet-4-6');
    expect(rt.systemPrompt).toContain('You are the research agent.');
  });

  it('throws for an unknown agent', () => {
    expect(() => resolveAgentRuntime('ghost')).toThrow();
  });

  it('resolves a model alias to a canonical id', () => {
    expect(resolveAgentRuntime('aliased').model).toBe('claude-opus-4-8');
  });

  it('uses project_dir as cwd when it exists', () => {
    expect(resolveAgentRuntime('projdir').cwd).toBe(FIXTURE_ROOT);
  });

  it('falls back to the agent dir when project_dir does not exist', () => {
    // Non-fatal fallback: a missing project_dir must not throw and must not
    // be used as cwd; the agent's own dir is used instead.
    expect(resolveAgentRuntime('projdirmissing').cwd).toBe(
      path.join(FIXTURE_ROOT, 'agents', 'projdirmissing'),
    );
  });
});

describe('loadAgentConfig project_dir', () => {
  it('parses project_dir when present', () => {
    expect(loadAgentConfig('projdir').projectDir).toBe(FIXTURE_ROOT);
  });

  it('leaves projectDir undefined when absent', () => {
    expect(loadAgentConfig('research').projectDir).toBeUndefined();
  });
});

describe('resolveAgentModel', () => {
  it('resolves chat aliases to canonical ids', () => {
    expect(resolveAgentModel('opus')).toBe('claude-opus-4-8');
    expect(resolveAgentModel('sonnet')).toBe('claude-sonnet-4-6');
    expect(resolveAgentModel('haiku')).toBe('claude-haiku-4-5');
  });

  it('passes a valid full model id through unchanged', () => {
    expect(resolveAgentModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('returns undefined for unknown or missing values', () => {
    expect(resolveAgentModel('gpt-5')).toBeUndefined();
    expect(resolveAgentModel(undefined)).toBeUndefined();
    expect(resolveAgentModel('')).toBeUndefined();
  });
});
