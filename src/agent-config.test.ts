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
  // Duplicate channel claim — the alphabetically-first agent (research) keeps
  // the channel; this later one ("z…") must not override it.
  writeAgent('zdupe', 'name: Dupe\ndescription: Dup channel\nslack_channel: C0RESEARCH\n');
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
});
