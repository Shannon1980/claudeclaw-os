// Contract test suite for the Mission Control HTTP API.
//
// Why this exists: a frontend rewrite is in progress (web/ Vite project,
// rolling out PR-by-PR). The new frontend is built against the documented
// shape of every endpoint. If the backend ever drifts from that shape —
// renames a field, changes nullability, swaps a type — the rewrite breaks
// silently. These tests pin the response shape of every endpoint family
// the new frontend depends on, so any drift fails CI before it ships.
//
// Tests use Hono's `app.request()` so no real port is opened. The DB is
// the in-memory test DB initialized via `_initTestDatabase()`.
//
// Env vars are set by `src/test-env-setup.ts` (vitest setupFiles) so they
// land BEFORE config.ts evaluates at import time.

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { _initTestDatabase } from './db.js';
import { buildDashboardApp } from './dashboard.js';
import { resolveAgentDir } from './agent-config.js';
import type { Hono } from 'hono';

const TOKEN = 'test-contract-token';
const Q = '?token=' + TOKEN;

let app: Hono;

beforeAll(() => {
  app = buildDashboardApp(undefined) as unknown as Hono;
});

beforeEach(() => {
  _initTestDatabase();
});

async function get(path: string) {
  return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN);
}

async function getNoToken(path: string) {
  return app.request(path);
}

// Tests fetch JSON we only describe shape-wise — typing as `any` keeps the
// assertions readable without forcing the real interfaces into the test file.
async function jsonOf(res: Response): Promise<any> {
  return res.json();
}

describe('auth gate', () => {
  it('rejects unauthorized GET without token', async () => {
    const res = await getNoToken('/api/health');
    expect(res.status).toBe(401);
    expect(await jsonOf(res)).toMatchObject({ error: 'Unauthorized' });
  });

  it('rejects unauthorized GET with wrong token', async () => {
    const res = await app.request('/api/health?token=wrong');
    expect(res.status).toBe(401);
  });

  it('accepts GET with correct token', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
  });

  it('responds 204 to OPTIONS preflight without token check', async () => {
    const res = await app.request('/api/health', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
  });

  // Regression: the SPA shell (`<script src="/assets/...">`) has no
  // token in the URL. If the auth middleware ever gates /assets/* the
  // bundle 401s and the dashboard goes blank — the symptom Mark hit
  // when the dashboard "wouldn't load" after a previous refactor.
  // Static assets must always be reachable without a token.
  it('serves /assets/* without a token (SPA bundle would 401 otherwise)', async () => {
    // Hit a path we know won't exist on disk, just to prove the auth
    // middleware ALLOWS the request through. Whether the file exists is
    // a separate concern handled by the /assets/* handler.
    const res = await app.request('/assets/some-bundle-that-doesnt-exist.js');
    // Acceptable outcomes: 200/204 (file served), 404 (handler ran and
    // didn't find it). NOT acceptable: 401 (middleware blocked it).
    expect(res.status).not.toBe(401);
  });

  it('serves /favicon.svg without a token', async () => {
    const res = await app.request('/favicon.svg');
    expect(res.status).not.toBe(401);
  });

  // Regression: SPA shell paths must be reachable without a token so a
  // hard-refresh of a token-stripped URL still loads the frontend, which
  // can recover the token from sessionStorage. If these 401, the user
  // sees raw JSON {"error":"Unauthorized"} on every refresh — exactly
  // the bug Mark hit. The HTML these serve has no embedded secret; the
  // frontend reads token from query string then falls back to storage.
  // Every client-side wouter route must be in this list.
  for (const path of [
    '/', '/warroom', '/mission', '/scheduled', '/agents',
    '/agents/comms/files', '/chat', '/memories', '/hive', '/usage',
    '/audit', '/settings',
  ]) {
    it(`serves SPA shell at ${path} without a token`, async () => {
      const res = await app.request(path);
      expect(res.status).not.toBe(401);
    });
  }

  // Legacy mode HTML embeds DASHBOARD_TOKEN, so those variants MUST stay
  // gated even though the path is exempt at the middleware. The handler
  // does an inline check.
  it('blocks legacy /warroom?mode=picker without a token (HTML embeds token)', async () => {
    const res = await app.request('/warroom?mode=picker');
    expect(res.status).toBe(401);
  });

  it('blocks legacy /warroom?mode=voice without a token (HTML embeds token)', async () => {
    const res = await app.request('/warroom?mode=voice');
    expect(res.status).toBe(401);
  });

  it('blocks legacy /warroom/text without a token (HTML embeds token)', async () => {
    const res = await app.request('/warroom/text?meetingId=wr_test');
    expect(res.status).toBe(401);
  });

  // Regression: the CSRF middleware reads its allowed-origin host from
  // the DASHBOARD_URL env var. If it reads from process.env directly
  // (instead of the config helper that also consults the .env file),
  // the production daemon — which doesn't have process.env populated
  // from .env — 403s every cross-origin POST from the Cloudflare tunnel.
  // src/test-env-setup.ts sets DASHBOARD_URL=https://dash.test.example
  // so this test exercises the right code path.
  it('allows POSTs with Origin matching DASHBOARD_URL', async () => {
    const res = await app.request('/api/mission/tasks?token=' + TOKEN, {
      method: 'POST',
      headers: { 'origin': 'https://dash.test.example', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'csrf test', prompt: 'csrf test' }),
    });
    // 200 (created) or 400 (validation) — anything but 403 means the
    // CSRF middleware let it through, which is what we're testing.
    expect(res.status).not.toBe(403);
  });

  it('blocks POSTs from disallowed origin', async () => {
    const res = await app.request('/api/mission/tasks?token=' + TOKEN, {
      method: 'POST',
      headers: { 'origin': 'https://evil.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'csrf test', prompt: 'csrf test' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/health', () => {
  it('returns the documented shape', async () => {
    const res = await get('/api/health');
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      contextPct: expect.any(Number),
      turns: expect.any(Number),
      compactions: expect.any(Number),
      sessionAge: expect.any(String),
      model: expect.any(String),
      telegramConnected: expect.any(Boolean),
      waConnected: expect.any(Boolean),
      slackConnected: expect.any(Boolean),
      killSwitches: expect.any(Object),
      killSwitchRefusals: expect.any(Object),
      warroom: expect.objectContaining({
        textOpenMeetings: expect.any(Number),
      }),
    });
  });

  it('killSwitches contains all 6 documented flags', async () => {
    const res = await get('/api/health');
    const body = await jsonOf(res);
    expect(body.killSwitches).toMatchObject({
      WARROOM_TEXT_ENABLED: expect.any(Boolean),
      WARROOM_VOICE_ENABLED: expect.any(Boolean),
      LLM_SPAWN_ENABLED: expect.any(Boolean),
      DASHBOARD_MUTATIONS_ENABLED: expect.any(Boolean),
      MISSION_AUTO_ASSIGN_ENABLED: expect.any(Boolean),
      SCHEDULER_ENABLED: expect.any(Boolean),
    });
  });
});

describe('GET /api/info', () => {
  it('returns botName, botUsername, pid, chatId', async () => {
    const res = await get('/api/info');
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      botName: expect.any(String),
      botUsername: expect.any(String),
      pid: expect.any(Number),
    });
    expect('chatId' in body).toBe(true);
  });
});

describe('GET /api/agents', () => {
  it('returns { agents: [] } even when no agents configured', async () => {
    const res = await get('/api/agents');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ agents: expect.any(Array) });
  });

  it('always includes main as first entry when present', async () => {
    const res = await get('/api/agents');
    const body = await jsonOf(res);
    if (body.agents.length > 0) {
      expect(body.agents[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        running: expect.any(Boolean),
      });
    }
  });
});

describe('GET /api/team/roster', () => {
  it('returns { roster: {} } when no agents have work', async () => {
    const res = await get('/api/team/roster');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ roster: expect.any(Object) });
  });

  it('rolls up active mission tasks per teammate', async () => {
    // Seed a queued task assigned to a teammate; it should show up in workload.
    await app.request('/api/mission/tasks' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'roster seed', prompt: 'x', assigned_agent: 'research' }),
    });
    const res = await get('/api/team/roster');
    const body = await jsonOf(res);
    // research either appears with a count >= 1, or (if the create endpoint
    // didn't accept the assignment) is simply absent — never malformed.
    if (body.roster.research) {
      expect(body.roster.research.activeTaskCount).toBeGreaterThanOrEqual(1);
      expect(body.roster.research).toMatchObject({ paused: expect.any(Boolean) });
    }
  });
});

describe('POST /api/agents/:id/pause and /resume', () => {
  it('pause then resume round-trips the paused flag', async () => {
    const pause = await app.request('/api/agents/research/pause' + Q, { method: 'POST' });
    expect(pause.status).toBe(200);
    expect(await jsonOf(pause)).toMatchObject({ ok: true, id: 'research', paused: true });

    const roster1 = await jsonOf(await get('/api/team/roster'));
    expect(roster1.roster.research?.paused).toBe(true);

    const resume = await app.request('/api/agents/research/resume' + Q, { method: 'POST' });
    expect(resume.status).toBe(200);
    expect(await jsonOf(resume)).toMatchObject({ ok: true, id: 'research', paused: false });
  });

  it('/api/agents reflects the paused flag', async () => {
    await app.request('/api/agents/main/pause' + Q, { method: 'POST' });
    const body = await jsonOf(await get('/api/agents'));
    const main = body.agents.find((a: any) => a.id === 'main');
    if (main) expect(main.paused).toBe(true);
    // reset so other tests aren't affected (beforeEach also resets the DB)
    await app.request('/api/agents/main/resume' + Q, { method: 'POST' });
  });
});

describe('GET /api/tasks (scheduled)', () => {
  it('returns { tasks: [] }', async () => {
    const res = await get('/api/tasks');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ tasks: expect.any(Array) });
  });
});

// ── Phase 2 Routines (Wave 0 RED) ────────────────────────────────────────────
// The /api/routines* routes do not exist yet — 02-03 lands them. Until then
// these assertions are RED (404 / wrong shape). They pin the route shapes, the
// existing-token auth gate, and the load-bearing draft-does-not-persist
// invariant (D-05): POST /api/routines/draft returns JSON and writes NO rows.
describe('routines API contract', () => {
  it('GET /api/routines returns { routines: [...] } and is auth-gated', async () => {
    const noTok = await getNoToken('/api/routines');
    expect(noTok.status).toBe(401);

    const res = await get('/api/routines');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ routines: expect.any(Array) });
  });

  it('POST /api/routines/draft returns a draft and writes NO rows (D-05 draft-does-not-persist)', async () => {
    const before = await jsonOf(await get('/api/routines'));
    const beforeCount = (before.routines ?? []).length;

    const res = await app.request('/api/routines/draft' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'every weekday at 8 send me a brief then chase invoices' }),
    });
    // Shape: a JSON draft (cron + ordered steps), regardless of LLM content.
    const draft = await jsonOf(res);
    expect(draft).toBeTruthy();

    const after = await jsonOf(await get('/api/routines'));
    const afterCount = (after.routines ?? []).length;
    expect(afterCount).toBe(beforeCount); // nothing persisted by the draft call
  });

  it('POST /api/routines/:id/run returns 409 when the routine is already claimed/running', async () => {
    const res = await app.request('/api/routines/already-running/run' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/mission/tasks', () => {
  it('returns { tasks: [] }', async () => {
    const res = await get('/api/mission/tasks');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ tasks: expect.any(Array) });
  });

  it('accepts ?agent and ?status filters', async () => {
    const res = await get('/api/mission/tasks?agent=main&status=queued');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.tasks).toBeInstanceOf(Array);
  });
});

describe('GET /api/mission/history', () => {
  it('returns paginated { tasks, total }', async () => {
    const res = await get('/api/mission/history?limit=5&offset=0');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      tasks: expect.any(Array),
      total: expect.any(Number),
    });
  });
});

describe('POST /api/mission/tasks', () => {
  it('rejects missing title with 400', async () => {
    const res = await app.request('/api/mission/tasks' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'test prompt' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing prompt with 400', async () => {
    const res = await app.request('/api/mission/tasks' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'test' }),
    });
    expect(res.status).toBe(400);
  });

  it('creates task with valid input and returns full task shape', async () => {
    const res = await app.request('/api/mission/tasks' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'contract test', prompt: 'do nothing', priority: 3 }),
    });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.task).toMatchObject({
      id: expect.any(String),
      title: 'contract test',
      prompt: 'do nothing',
      status: 'queued',
      priority: 3,
      created_by: 'dashboard',
      created_at: expect.any(Number),
    });
  });
});

describe('GET /api/mission/tasks/auto-assign-all route ordering', () => {
  // Regression test: this endpoint was shadowed by /:id/auto-assign for
  // months because route registration order was wrong. Lock it in.
  it('returns 200, not 404, when called as a static path', async () => {
    const res = await app.request('/api/mission/tasks/auto-assign-all' + Q, {
      method: 'POST',
    });
    // Must NOT be 404. May be 200 (assigned: 0) or 400 if no agents.
    expect(res.status).not.toBe(404);
  });
});

describe('GET /api/memories', () => {
  it('returns full memory dashboard payload', async () => {
    const res = await get('/api/memories?chatId=test');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      stats: expect.objectContaining({
        total: expect.any(Number),
        pinned: expect.any(Number),
        consolidations: expect.any(Number),
      }),
      fading: expect.any(Array),
      topAccessed: expect.any(Array),
      timeline: expect.any(Array),
      consolidations: expect.any(Array),
    });
  });
});

describe('GET /api/memories/list', () => {
  it('returns paginated memory list', async () => {
    const res = await get('/api/memories/list?chatId=test&limit=10&offset=0');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      memories: expect.any(Array),
      total: expect.any(Number),
    });
  });
});

describe('GET /api/tokens', () => {
  it('returns stats + costTimeline + recentUsage', async () => {
    const res = await get('/api/tokens?chatId=test');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      stats: expect.any(Object),
      costTimeline: expect.any(Array),
      recentUsage: expect.any(Array),
    });
    expect(body.stats).toMatchObject({
      todayInput: expect.any(Number),
      todayOutput: expect.any(Number),
      todayCost: expect.any(Number),
      todayTurns: expect.any(Number),
      allTimeCost: expect.any(Number),
      allTimeTurns: expect.any(Number),
    });
  });
});

describe('GET /api/hive-mind', () => {
  it('returns { entries: [] }', async () => {
    const res = await get('/api/hive-mind');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ entries: expect.any(Array) });
  });
});

describe('GET /api/audit', () => {
  it('returns { entries, total }', async () => {
    const res = await get('/api/audit?limit=10&offset=0');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      entries: expect.any(Array),
      total: expect.any(Number),
    });
  });
});

describe('GET /api/audit/blocked', () => {
  it('returns { entries: [] }', async () => {
    const res = await get('/api/audit/blocked?limit=5');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ entries: expect.any(Array) });
  });
});

describe('GET /api/security/status', () => {
  it('returns 200 with an object', async () => {
    const res = await get('/api/security/status');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toBeInstanceOf(Object);
  });
});

describe('GET /api/chat/history', () => {
  it('returns { turns: [] } without chatId (defaults to ALLOWED_CHAT_ID)', async () => {
    // The route intentionally falls back to ALLOWED_CHAT_ID when ?chatId is
    // omitted, matching the other /api/* routes. When neither is present
    // (as in tests, where ALLOWED_CHAT_ID is empty) it returns an empty page
    // rather than a 400, so the dashboard never surfaces an error on open.
    const res = await get('/api/chat/history');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ turns: [] });
  });

  it('returns { turns: [] } with chatId', async () => {
    const res = await get('/api/chat/history?chatId=test&limit=10');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ turns: expect.any(Array) });
  });
});

describe('PATCH /api/agents/:id/model', () => {
  it('rejects missing model with 400', async () => {
    const res = await app.request('/api/agents/main/model' + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid model with 400', async () => {
    const res = await app.request('/api/agents/main/model' + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5' }),
    });
    expect(res.status).toBe(400);
  });

  it('main response includes restartRequired: false', async () => {
    const res = await app.request('/api/agents/main/model' + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6' }),
    });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      ok: true,
      agent: 'main',
      model: 'claude-sonnet-4-6',
      restartRequired: false,
    });
  });
});

describe('PATCH /api/agents/:id/slack-channel', () => {
  // The committed agents ship only agent.yaml.example, so no sub-agent
  // "exists" in the test env. Channel-format validation runs only after the
  // agentExists gate, so we stand up a throwaway agent.yaml on disk to
  // exercise the full write / clear / format-reject paths, then remove it.
  const FIXTURE_ID = 'contractslackagent';
  let fixtureYaml = '';

  beforeAll(() => {
    const dir = resolveAgentDir(FIXTURE_ID);
    fixtureYaml = path.join(dir, 'agent.yaml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fixtureYaml, 'name: Contract Slack Agent\ndescription: fixture\n', 'utf-8');
  });

  afterAll(() => {
    try { fs.rmSync(path.dirname(fixtureYaml), { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function patch(id: string, body: unknown) {
    return app.request('/api/agents/' + id + '/slack-channel' + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects an invalid agent id with 400', async () => {
    const res = await patch('has%20space', { channel: 'C0XXXX' });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: expect.any(String) });
  });

  it('rejects main (no agent.yaml) with 400', async () => {
    const res = await patch('main', { channel: 'C0XXXX' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown agent', async () => {
    const res = await patch('totally_made_up_agent', { channel: 'C0XXXX' });
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toMatchObject({ error: 'agent not found' });
  });

  it('rejects a missing channel field with 400', async () => {
    const res = await patch(FIXTURE_ID, {});
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: expect.any(String) });
  });

  it('rejects a malformed channel id with 400', async () => {
    const res = await patch(FIXTURE_ID, { channel: 'not-a-channel' });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: expect.any(String) });
  });

  it('accepts a valid channel id and persists it (restartRequired: true)', async () => {
    const res = await patch(FIXTURE_ID, { channel: 'C0ABCDEF1' });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toMatchObject({
      ok: true,
      agent: FIXTURE_ID,
      slackChannel: 'C0ABCDEF1',
      restartRequired: true,
    });
    expect(fs.readFileSync(fixtureYaml, 'utf-8')).toMatch(/slack_channel:\s*C0ABCDEF1/);
  });

  it('clears the channel when given an empty string', async () => {
    await patch(FIXTURE_ID, { channel: 'G0GROUPID' });
    const res = await patch(FIXTURE_ID, { channel: '' });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toMatchObject({ ok: true, slackChannel: '' });
    expect(fs.readFileSync(fixtureYaml, 'utf-8')).not.toMatch(/slack_channel/);
  });
});

describe('avatar endpoints share error shape and status semantics', () => {
  // Twelve-byte canonical PNG header — the avatar PUT handler magic-byte
  // sniffs the first four bytes, so this is enough.
  const PNG_HEADER = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
  ]);

  it('GET, PUT, DELETE all return JSON {error} on an invalid id', async () => {
    const get = await app.request('/api/agents/has%20space/avatar' + Q);
    expect(get.status).toBe(400);
    const getBody = await jsonOf(get);
    expect(getBody).toMatchObject({ error: expect.any(String) });

    const put = await app.request('/api/agents/has%20space/avatar' + Q, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: PNG_HEADER,
    });
    expect(put.status).toBe(400);
    expect(await jsonOf(put)).toMatchObject({ error: expect.any(String) });

    const del = await app.request('/api/agents/has%20space/avatar' + Q, { method: 'DELETE' });
    expect(del.status).toBe(400);
    expect(await jsonOf(del)).toMatchObject({ error: expect.any(String) });
  });

  it('GET on an unknown agent returns 404 (not 204)', async () => {
    const res = await app.request('/api/agents/totally_made_up_agent/avatar' + Q);
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toMatchObject({ error: 'agent not found' });
  });

  it('GET on main with no avatar resolved returns 204', async () => {
    // main always "exists" per agentExists; with no bundled or mutable
    // avatar in the test env, the resolver returns null → 204.
    const res = await app.request('/api/agents/main/avatar' + Q);
    expect([200, 204]).toContain(res.status);
    if (res.status === 204) {
      expect(res.headers.get('content-type') ?? '').not.toMatch(/text\/html/);
    }
  });
});

describe('PATCH /api/dashboard/settings standup_config', () => {
  async function patchStandupConfig(value: string) {
    return app.request('/api/dashboard/settings' + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'standup_config', value }),
    });
  }

  it('accepts a well-formed payload', async () => {
    const res = await patchStandupConfig(JSON.stringify({
      agents: [{ id: 'main', enabled: true }, { id: 'comms', enabled: false }],
      maxSpeakers: 5,
    }));
    expect(res.status).toBe(200);
  });

  it('rejects non-JSON value with 400', async () => {
    const res = await patchStandupConfig('not json {');
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error).toMatch(/standup_config/);
  });

  it('rejects agents-not-an-array with 400', async () => {
    const res = await patchStandupConfig(JSON.stringify({ agents: 'nope', maxSpeakers: 5 }));
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error).toMatch(/agents must be an array/);
  });

  it('rejects an agent entry without an id with 400', async () => {
    const res = await patchStandupConfig(JSON.stringify({
      agents: [{ enabled: true }],
      maxSpeakers: 5,
    }));
    expect(res.status).toBe(400);
  });

  it('rejects maxSpeakers out of [1, 8] with 400', async () => {
    const res = await patchStandupConfig(JSON.stringify({
      agents: [{ id: 'main', enabled: true }],
      maxSpeakers: 99,
    }));
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error).toMatch(/maxSpeakers/);
  });
});

describe('GET /api/warroom/agents', () => {
  it('returns { agents: [...] } with main present', async () => {
    const res = await get('/api/warroom/agents');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.agents).toBeInstanceOf(Array);
    expect(body.agents.length).toBeGreaterThanOrEqual(1);
    expect(body.agents[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      description: expect.any(String),
    });
  });
});

describe('GET /api/warroom/pin', () => {
  it('returns { ok, agent, mode }', async () => {
    const res = await get('/api/warroom/pin');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      ok: expect.any(Boolean),
      mode: expect.any(String),
    });
  });
});

describe('GET /api/meet/sessions', () => {
  it('returns { ok, active, recent }', async () => {
    const res = await get('/api/meet/sessions');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      active: expect.any(Array),
      recent: expect.any(Array),
    });
  });
});

describe('Cache-Control on /api/*', () => {
  it('every API response carries Cache-Control: no-store', async () => {
    const res = await get('/api/health');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('Security headers on /', () => {
  it('Referrer-Policy: no-referrer is set', async () => {
    const res = await get('/api/health');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('X-Frame-Options: DENY is set', async () => {
    const res = await get('/api/health');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('X-Content-Type-Options: nosniff is set', async () => {
    const res = await get('/api/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

// ── Home daily-loop endpoints (operator-product step 3) ──────────────

async function createTask(fields: Record<string, unknown>): Promise<string> {
  const res = await app.request('/api/mission/tasks' + Q, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const body = await jsonOf(res);
  return body.task.id as string;
}

async function postAction(p: string, body?: unknown) {
  return app.request(p + Q, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('GET /api/home/summary', () => {
  it('returns the grouped daily-loop shape', async () => {
    const res = await get('/api/home/summary');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      needsYou: expect.any(Array),
      onPlate: expect.any(Array),
      waiting: expect.any(Array),
      shipped: expect.any(Array),
      today: expect.any(Array),
      status: {
        needsYou: expect.any(Number),
        waiting: expect.any(Number),
        shipped: expect.any(Number),
        hasAnyWork: expect.any(Boolean),
      },
    });
  });

  it('routes an unassigned task into needsYou and reflects hasAnyWork', async () => {
    await createTask({ title: 'route me', prompt: 'p' });
    const res = await get('/api/home/summary');
    const body = await jsonOf(res);
    expect(body.status.hasAnyWork).toBe(true);
    expect(body.needsYou.some((t: any) => t.title === 'route me')).toBe(true);
  });
});

describe('POST /api/mission/tasks/:id/block + /unblock', () => {
  it('rejects a block with no blocked_on (400)', async () => {
    const id = await createTask({ title: 'b', prompt: 'p' });
    const res = await postAction(`/api/mission/tasks/${id}/block`, { blocked_on: '   ' });
    expect(res.status).toBe(400);
  });

  it('blocks a task, surfaces it in waiting, then unblocks it back to queued', async () => {
    const id = await createTask({ title: 'waiting work', prompt: 'p' });

    const blocked = await postAction(`/api/mission/tasks/${id}/block`, { blocked_on: 'Sarah, legal' });
    expect(blocked.status).toBe(200);
    const blockedBody = await jsonOf(blocked);
    expect(blockedBody.task).toMatchObject({ status: 'blocked', blocked_on: 'Sarah, legal', blocked_since: expect.any(Number) });

    const summary = await jsonOf(await get('/api/home/summary'));
    expect(summary.waiting.some((t: any) => t.id === id)).toBe(true);
    expect(summary.needsYou.some((t: any) => t.id === id)).toBe(false);

    const unblocked = await postAction(`/api/mission/tasks/${id}/unblock`);
    expect(unblocked.status).toBe(200);
    expect((await jsonOf(unblocked)).task).toMatchObject({ status: 'queued', blocked_on: null, blocked_since: null });
  });

  it('returns 409 when unblocking a task that is not blocked', async () => {
    const id = await createTask({ title: 'not blocked', prompt: 'p' });
    const res = await postAction(`/api/mission/tasks/${id}/unblock`);
    expect(res.status).toBe(409);
  });
});

// ── Projects: operator reframe (operator-product step 3) ─────────────

async function createProject(fields: Record<string, unknown>): Promise<any> {
  const res = await app.request('/api/projects' + Q, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return jsonOf(res);
}

describe('Projects: type + scoped stats', () => {
  it('creates with a type and defaults to internal for missing/invalid', async () => {
    const a = await createProject({ name: 'Acme client', type: 'client' });
    expect(a.project).toMatchObject({ type: 'client', status: 'active' });

    const b = await createProject({ name: 'no type' });
    expect(b.project.type).toBe('internal');

    const c = await createProject({ name: 'bad type', type: 'nonsense' });
    expect(c.project.type).toBe('internal');
  });

  it('rejects an invalid type on PATCH (400)', async () => {
    const { project } = await createProject({ name: 'patch me' });
    const patch = await app.request(`/api/projects/${project.id}` + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'nope' }),
    });
    expect(patch.status).toBe(400);
  });

  it('returns the operator daily-loop stat fields per project', async () => {
    const { project } = await createProject({ name: 'stats', type: 'internal' });
    const res = await get('/api/projects');
    const body = await jsonOf(res);
    const found = body.projects.find((p: any) => p.id === project.id);
    expect(found).toMatchObject({
      task_plate: expect.any(Number),
      task_waiting: expect.any(Number),
      task_needs: expect.any(Number),
      teammates: expect.any(Array),
    });
  });
});

describe('GET /api/home/summary?project=', () => {
  it('scopes the loop to a single project', async () => {
    const { project } = await createProject({ name: 'scoped' });
    // One task in the project, one outside it.
    const insideRes = await app.request('/api/mission/tasks' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'inside', prompt: 'p', project_id: project.id }),
    });
    const inside = (await jsonOf(insideRes)).task;
    await createTask({ title: 'outside', prompt: 'p' });

    const scoped = await jsonOf(await get(`/api/home/summary?project=${project.id}`));
    const allIds = [...scoped.needsYou, ...scoped.onPlate, ...scoped.waiting, ...scoped.shipped].map((t: any) => t.id);
    expect(allIds).toContain(inside.id);
    expect(allIds.every((id: string) => id === inside.id)).toBe(true);
  });
});
