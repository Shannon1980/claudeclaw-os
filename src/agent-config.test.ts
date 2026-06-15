// Unit tests for the agent.yaml loader's richer schema support and the
// Slack channel routing map.
//
// Fixtures are written under PROJECT_ROOT/agents/<id>/agent.yaml (the
// fallback location resolveAgentDir uses when CLAUDECLAW_CONFIG has no
// matching agent) and removed in afterAll. Tests assert that their own
// fixtures are parsed/present rather than asserting exact collection
// equality, so they tolerate any real agents already on the machine.

import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterAll } from 'vitest';

import { PROJECT_ROOT } from './config.js';
import { loadAgentConfig, resolveAgentModel, getSlackChannelMap } from './agent-config.js';

const created: string[] = [];

function writeAgent(id: string, yaml: string): void {
  const dir = path.join(PROJECT_ROOT, 'agents', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent.yaml'), yaml, 'utf-8');
  created.push(dir);
}

afterAll(() => {
  for (const dir of created) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('loadAgentConfig — richer schema', () => {
  it('parses display_name, project_dir, tools, skills, triggers, mcp alias, slack_channel, model', () => {
    const id = 'zztest_richcfg';
    // project_dir points at PROJECT_ROOT (exists) to avoid a missing-path warning.
    writeAgent(id, [
      'name: Rich',
      'display_name: Rich Agent',
      'description: fixture',
      'model: opus',
      `project_dir: ${PROJECT_ROOT}`,
      'tools:',
      '  - Read',
      '  - Bash',
      'skills:',
      '  - operations:status-report',
      'triggers:',
      '  - SEAS IT',
      'mcp:',
      '  - atlassian',
      'slack_channel: C0RICH123',
      '',
    ].join('\n'));

    const cfg = loadAgentConfig(id);
    expect(cfg.name).toBe('Rich');
    expect(cfg.displayName).toBe('Rich Agent');
    expect(cfg.projectDir).toBe(PROJECT_ROOT);
    expect(cfg.tools).toEqual(['Read', 'Bash']);
    expect(cfg.skills).toEqual(['operations:status-report']);
    expect(cfg.triggers).toEqual(['SEAS IT']);
    expect(cfg.mcpServers).toEqual(['atlassian']); // `mcp:` alias maps to mcpServers
    expect(cfg.slackChannel).toBe('C0RICH123');
    expect(cfg.model).toBe('opus'); // raw value preserved; resolution is separate
  });

  it('prefers mcp_servers over the mcp alias when both are present', () => {
    const id = 'zztest_mcpprec';
    writeAgent(id, [
      'name: McpPrec',
      'mcp_servers:',
      '  - canonical',
      'mcp:',
      '  - alias',
      '',
    ].join('\n'));

    const cfg = loadAgentConfig(id);
    expect(cfg.mcpServers).toEqual(['canonical']);
  });

  it('leaves optional list fields undefined when absent', () => {
    const id = 'zztest_minimal';
    writeAgent(id, 'name: Minimal\ndescription: bare\n');
    const cfg = loadAgentConfig(id);
    expect(cfg.tools).toBeUndefined();
    expect(cfg.skills).toBeUndefined();
    expect(cfg.triggers).toBeUndefined();
    expect(cfg.slackChannel).toBeUndefined();
  });
});

describe('resolveAgentModel', () => {
  it('resolves chat aliases to canonical ids', () => {
    expect(resolveAgentModel('opus')).toBe('claude-opus-4-8');
    expect(resolveAgentModel('sonnet')).toBe('claude-sonnet-4-6');
    expect(resolveAgentModel('haiku')).toBe('claude-haiku-4-5');
  });

  it('passes through a valid full model id unchanged', () => {
    expect(resolveAgentModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('returns undefined for unknown or missing values', () => {
    expect(resolveAgentModel('gpt-5')).toBeUndefined();
    expect(resolveAgentModel(undefined)).toBeUndefined();
    expect(resolveAgentModel('')).toBeUndefined();
  });
});

describe('getSlackChannelMap', () => {
  it('maps a configured slack_channel to its agent id', () => {
    const id = 'zztest_chanmap';
    writeAgent(id, 'name: ChanMap\nslack_channel: C0MAPTEST\n');
    const map = getSlackChannelMap();
    expect(map.get('C0MAPTEST')).toBe(id);
  });

  it('omits agents with no slack_channel', () => {
    const id = 'zztest_nochan';
    writeAgent(id, 'name: NoChan\n');
    const map = getSlackChannelMap();
    expect([...map.values()]).not.toContain(id);
  });

  it('resolves a duplicate channel deterministically (last in sorted-id order wins)', () => {
    // Two agents claim the same channel. Resolution must not depend on
    // filesystem readdir order, so the winner is the last sorted id.
    const a = 'zztest_dup_a';
    const b = 'zztest_dup_b';
    writeAgent(a, 'name: DupA\nslack_channel: C0DUPECHAN\n');
    writeAgent(b, 'name: DupB\nslack_channel: C0DUPECHAN\n');
    const map = getSlackChannelMap();
    // 'zztest_dup_b' sorts after 'zztest_dup_a', so it wins, every run.
    expect(map.get('C0DUPECHAN')).toBe(b);
  });

  it('skips an agent whose config fails to load without dropping the valid one', () => {
    const good = 'zztest_goodcfg';
    const broken = 'zztest_brokencfg';
    writeAgent(good, 'name: Good\nslack_channel: C0GOODCHAN\n');
    // Missing required `name` makes loadAgentConfig throw — the map build must
    // not abort, so the valid agent's channel still maps.
    writeAgent(broken, 'description: no name here\nslack_channel: C0BROKENCHAN\n');
    const map = getSlackChannelMap();
    expect(map.get('C0GOODCHAN')).toBe(good);
    expect(map.has('C0BROKENCHAN')).toBe(false);
  });
});
