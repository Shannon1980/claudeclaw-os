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
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { _initTestDatabase, createMissionTask, claimNextMissionTask, completeMissionTask } from './db.js';
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

  it('POST /api/routines persists project_id and GET reflects it (06-routines: scope to Projects)', async () => {
    const { project } = await createProject({ name: 'Acme', type: 'client' });
    const create = await app.request('/api/routines' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Morning brief',
        schedule: '0 8 * * 1-5',
        project_id: project.id,
        steps: [{ action: 'send me a brief', agent_id: 'main', on_error: 'continue' }],
      }),
    });
    expect(create.status).toBe(201);
    const { routine } = await jsonOf(create);
    expect(routine.project_id).toBe(project.id);

    // Round-trips through the list endpoint too.
    const list = await jsonOf(await get('/api/routines'));
    expect(list.routines.find((r: any) => r.id === routine.id)?.project_id).toBe(project.id);

    // Detach via PUT (project_id: null) and re-read.
    const put = await app.request(`/api/routines/${routine.id}` + Q, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: null }),
    });
    expect(put.status).toBe(200);
    expect((await jsonOf(put)).routine.project_id).toBeNull();
  });

  it('POST /api/routines rejects an unknown project_id with 400', async () => {
    const res = await app.request('/api/routines' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad scope',
        schedule: '0 8 * * 1-5',
        project_id: 'does-not-exist',
        steps: [{ action: 'do a thing', agent_id: 'main', on_error: 'continue' }],
      }),
    });
    expect(res.status).toBe(400);
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

describe('POST /api/mission/tasks/:id/requeue', () => {
  it('re-runs a completed task: returns it queued with the prior outcome cleared', async () => {
    createMissionTask('req-1', 'Pull the inbox', 'do it', 'comms');
    claimNextMissionTask('comms');
    completeMissionTask('req-1', 'asked for Gmail permission', 'completed');

    const res = await app.request('/api/mission/tasks/req-1/requeue' + Q, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    expect(body.task).toMatchObject({ id: 'req-1', status: 'queued', result: null, completed_at: null });
  });

  it('409s when the task is not re-runnable (still queued) or missing', async () => {
    createMissionTask('req-2', 'Active task', 'do it', 'comms');
    const queued = await app.request('/api/mission/tasks/req-2/requeue' + Q, { method: 'POST' });
    expect(queued.status).toBe(409);
    const missing = await app.request('/api/mission/tasks/nope/requeue' + Q, { method: 'POST' });
    expect(missing.status).toBe(409);
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

// ── Phase 6 Memory Surface: net-new mutation routes (Wave 0 RED) ─────────────
//
// MEM-02 / D-04 / D-08 / D-09. Four mutation routes do not exist yet — plan 03
// lands them. Until then these assertions are RED (404 / wrong shape). They pin:
//   - POST   /api/memory            (Add: confirmed=1, source='you-told-me', category, D-09)
//   - PATCH  /api/memory/:id        (Edit: summary/category, id validated via Number.isInteger)
//   - DELETE /api/memory/:id        (Delete: writes a tombstone BEFORE removing the row, Pitfall 6 / D-08)
//   - POST   /api/memory/:id/confirm (sets confirmed=1, no-op on double-call, D-04)
// Category is validated against the enum {your-business, your-clients, how-you-work}.
describe('memory mutation API contract (MEM-02 / D-04 / D-08 / D-09)', () => {
  async function post(p: string, body?: unknown) {
    return app.request(p + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function patch(p: string, body: unknown) {
    return app.request(p + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  async function del(p: string) {
    return app.request(p + Q, { method: 'DELETE' });
  }

  it('POST /api/memory is auth-gated', async () => {
    const res = await getNoToken('/api/memory');
    // No token -> 401 regardless of method support.
    expect(res.status).toBe(401);
  });

  it('POST /api/memory inserts a confirmed, operator-authored fact with a category (D-09)', async () => {
    const { getDb } = await import('./db.js');
    const res = await post('/api/memory', { summary: 'We bill clients net-30', category: 'your-business' });
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ ok: true });
    const id = body.memory?.id ?? body.id;
    expect(Number.isInteger(id)).toBe(true);

    const row = getDb()
      .prepare(`SELECT source, confirmed, category, summary FROM memories WHERE id = ?`)
      .get(id) as { source: string; confirmed: number; category: string; summary: string };
    expect(row.source).toBe('you-told-me');
    expect(row.confirmed).toBe(1);
    expect(row.category).toBe('your-business');
    expect(row.summary).toBe('We bill clients net-30');
  });

  it('POST /api/memory rejects a category outside the enum (400)', async () => {
    const res = await post('/api/memory', { summary: 'a fact', category: 'random-bucket' });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/memory/:id rejects a non-integer id via Number.isInteger (400)', async () => {
    const res = await patch('/api/memory/not-a-number', { summary: 'x' });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/memory/:id updates summary and category', async () => {
    const { getDb } = await import('./db.js');
    const created = await jsonOf(await post('/api/memory', { summary: 'old summary', category: 'how-you-work' }));
    const id = created.memory?.id ?? created.id;

    const res = await patch(`/api/memory/${id}`, { summary: 'new summary', category: 'your-clients' });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toMatchObject({ ok: true });

    const row = getDb()
      .prepare(`SELECT summary, category FROM memories WHERE id = ?`)
      .get(id) as { summary: string; category: string };
    expect(row.summary).toBe('new summary');
    expect(row.category).toBe('your-clients');
  });

  it('PATCH /api/memory/:id rejects a category outside the enum (400)', async () => {
    const created = await jsonOf(await post('/api/memory', { summary: 's', category: 'your-business' }));
    const id = created.memory?.id ?? created.id;
    const res = await patch(`/api/memory/${id}`, { category: 'nonsense' });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/memory/:id writes a tombstone BEFORE removing the row (Pitfall 6 / D-08)', async () => {
    const { getDb } = await import('./db.js');
    const created = await jsonOf(await post('/api/memory', { summary: 'delete me forever', category: 'your-business' }));
    const id = created.memory?.id ?? created.id;

    const res = await del(`/api/memory/${id}`);
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toMatchObject({ ok: true });

    // The memory row is gone...
    const gone = getDb().prepare(`SELECT id FROM memories WHERE id = ?`).get(id);
    expect(gone).toBeUndefined();
    // ...AND a tombstone exists so the fact cannot re-derive (tombstone-first).
    const tomb = getDb()
      .prepare(`SELECT id FROM memory_tombstones WHERE summary = ?`)
      .get('delete me forever');
    expect(tomb, 'a tombstone row must exist after delete').toBeTruthy();
  });

  it('DELETE /api/memory/:id rejects a non-integer id (400)', async () => {
    const res = await del('/api/memory/not-a-number');
    expect(res.status).toBe(400);
  });

  it('POST /api/memory/:id/confirm sets confirmed=1 and is a no-op on double-call (D-04)', async () => {
    const { getDb } = await import('./db.js');
    // Seed an unconfirmed (machine-inferred) memory directly.
    const now = Math.floor(Date.now() / 1000);
    const info = getDb()
      .prepare(
        `INSERT INTO memories (chat_id, source, raw_text, summary, confirmed, created_at, accessed_at)
         VALUES (?, 'conversation', 'raw', 'an unconfirmed guess', 0, ?, ?)`,
      )
      .run('chat-confirm', now, now);
    const id = Number(info.lastInsertRowid);

    const first = await post(`/api/memory/${id}/confirm`);
    expect(first.status).toBe(200);
    expect(await jsonOf(first)).toMatchObject({ ok: true });
    const afterFirst = getDb().prepare(`SELECT confirmed FROM memories WHERE id = ?`).get(id) as { confirmed: number };
    expect(afterFirst.confirmed).toBe(1);

    // Second confirm is a status-guarded no-op (already confirmed).
    const second = await post(`/api/memory/${id}/confirm`);
    expect(await jsonOf(second)).toMatchObject({ ok: false });
  });

  it('POST /api/memory/:id/confirm rejects a non-integer id (400)', async () => {
    const res = await post('/api/memory/not-a-number/confirm');
    expect(res.status).toBe(400);
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

// ── Phase 5 Audit Log: enriched read + export (Wave 0 RED — AUD-01/AUD-02) ──
//
// These pin the two contracts plans 02/03 build against. RED on purpose:
//   - /api/audit does not yet return enriched columns or the cost JOIN.
//   - /api/audit/export does not exist yet.
//   - insertAuditLog's options-object signature is authored by plan 02.

describe('GET /api/audit enriched (Pitfall 4: cost is per-turn, not per-row)', () => {
  it('returns 3 audit rows sharing one session_id each with that turn\'s cost (not 0, not 3x) + honest NULLs', async () => {
    const { insertAuditLog, saveTokenUsage } = await import('./db.js');

    // Three per-action audit rows from ONE agent turn share one session_id.
    for (let i = 0; i < 3; i++) {
      insertAuditLog({
        agentId: 'main',
        chatId: 'chat-cost',
        action: 'permission',
        detail: JSON.stringify({ tool: 'Bash', tier: 1, outcome: 'allow' }),
        blocked: false,
        eventType: 'permission',
        tool: 'Bash',
        result: 'allow',
        sessionId: 'sess-turn-1',
        model: 'claude-opus-4',
        // target/project/duration deliberately omitted -> must read back NULL
      });
    }

    // Exactly ONE token_usage row records that turn's cost.
    const TURN_COST = 0.0123;
    saveTokenUsage('chat-cost', 'sess-turn-1', 100, 50, 0, 0, TURN_COST, false, 'main');

    const res = await get('/api/audit?limit=50');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const rows = (body.entries as Array<Record<string, unknown>>).filter(
      (r) => r.session_id === 'sess-turn-1',
    );
    expect(rows).toHaveLength(3);

    for (const row of rows) {
      // The JOIN must attach the turn cost to each row — NOT 0 (fan-out lost it)
      // and NOT 3x (fan-out summed it). It is exactly the one turn's cost.
      expect(row.cost_usd).toBeCloseTo(TURN_COST, 6);
      // Uncaptured fields surface as null, never fabricated or blank.
      expect(row.target).toBeNull();
      expect(row.project).toBeNull();
      expect(row.duration_ms).toBeNull();
    }
  });
});

describe('GET /api/audit/export (Pitfall 6: full filtered set, never page-capped)', () => {
  // Insert strictly more rows than the read endpoint's default page size so a
  // copy-pasted LIMIT would visibly truncate the export.
  const ROW_COUNT = 120; // > the /api/audit default page (50)

  async function seedRows() {
    const { insertAuditLog } = await import('./db.js');
    for (let i = 0; i < ROW_COUNT; i++) {
      insertAuditLog({
        agentId: 'main',
        chatId: 'chat-export',
        action: 'message',
        detail: `event ${i}`,
        blocked: false,
        eventType: 'message',
        sessionId: 'sess-export',
      });
    }
  }

  it('CSV export returns the FULL filtered set with attachment Content-Disposition + text/csv', async () => {
    await seedRows();

    const res = await get('/api/audit/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const disp = res.headers.get('content-disposition') ?? '';
    expect(disp).toContain('attachment');
    expect(disp).toMatch(/filename="audit-[^"]+\.csv"/);

    const text = await res.text();
    // Count data rows (drop the header line). RFC-4180 fields may contain
    // newlines, but our seeded `event N` details do not, so a line count of
    // non-empty rows minus the header equals the full row count.
    const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
    expect(lines.length - 1).toBe(ROW_COUNT);
  });

  it('JSON export returns the FULL filtered set with attachment Content-Disposition + application/json', async () => {
    await seedRows();

    const res = await get('/api/audit/export?format=json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const disp = res.headers.get('content-disposition') ?? '';
    expect(disp).toContain('attachment');
    expect(disp).toMatch(/filename="audit-[^"]+\.json"/);

    const body = await jsonOf(res);
    expect(body).toMatchObject({
      exported_at: expect.anything(),
      count: ROW_COUNT,
      rows: expect.any(Array),
    });
    expect(body.rows).toHaveLength(ROW_COUNT);
  });

  it('an invalid format value falls back to csv', async () => {
    await seedRows();

    const res = await get('/api/audit/export?format=xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
  });

  it('requires the dashboard token (mounted under /api/, inherits the gate)', async () => {
    const res = await getNoToken('/api/audit/export?format=csv');
    expect(res.status).toBe(401);
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

describe('PATCH /api/dashboard/settings quick_apps', () => {
  async function patchQuickApps(value: string) {
    return app.request('/api/dashboard/settings' + Q, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'quick_apps', value }),
    });
  }

  it('accepts a well-formed payload', async () => {
    const res = await patchQuickApps(JSON.stringify([
      { id: 'github', name: 'GitHub', kind: 'url', target: 'https://github.com' },
      { id: 'rc', name: 'Repo Commander', kind: 'app', target: 'Repo Commander' },
      { id: 'jenkins', name: 'Jenkins', kind: 'url', target: '' },
    ]));
    expect(res.status).toBe(200);
  });

  it('rejects non-array value with 400', async () => {
    const res = await patchQuickApps(JSON.stringify({ nope: true }));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toMatch(/quick_apps/);
  });

  it('rejects an unknown kind with 400', async () => {
    const res = await patchQuickApps(JSON.stringify([
      { id: 'x', name: 'X', kind: 'script', target: 'rm -rf /' },
    ]));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toMatch(/kind/);
  });

  it('rejects an entry without an id with 400', async () => {
    const res = await patchQuickApps(JSON.stringify([
      { name: 'X', kind: 'url', target: 'https://x.com' },
    ]));
    expect(res.status).toBe(400);
  });

  it('rejects more than 24 apps with 400', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: 'a' + i, name: 'A' + i, kind: 'url', target: 'https://a.com',
    }));
    const res = await patchQuickApps(JSON.stringify(many));
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toMatch(/max 24/);
  });
});

describe('POST /api/apps/launch', () => {
  async function launch(body: unknown) {
    return app.request('/api/apps/launch' + Q, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects a missing name with 400', async () => {
    const res = await launch({});
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: expect.any(String) });
  });

  it('rejects a leading-dash name with 400 (open flag injection)', async () => {
    const res = await launch({ name: '-W' });
    expect(res.status).toBe(400);
  });

  it('rejects an over-long name with 400', async () => {
    const res = await launch({ name: 'x'.repeat(200) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an app that does not exist (darwin only)', async () => {
    if (process.platform !== 'darwin') return;
    const res = await launch({ name: 'Definitely Not An Installed App 8f3a1' });
    expect(res.status).toBe(404);
    expect((await jsonOf(res)).error).toMatch(/could not open/);
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

// ── Phase 3 Permissions & Autonomy (Wave 0 RED) ──────────────────────────────
// The /api/permissions* and /api/approvals* routes do not exist yet — plan 03
// lands them. Until then these assertions are RED (404 / wrong shape). They pin
// the route shapes, the existing-token auth gate, enum validation (V5), and the
// replay-once invariant (L-3 / T-replay-twice): a second approve does NOT replay.

describe('permissions API contract', () => {
  it('GET /api/permissions returns { mode, overrides } and is auth-gated', async () => {
    const noTok = await getNoToken('/api/permissions');
    expect(noTok.status).toBe(401);

    const res = await get('/api/permissions');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ mode: expect.any(String), overrides: expect.any(Object) });
  });

  it('PUT /api/permissions with a valid mode persists and returns ok', async () => {
    const res = await app.request('/api/permissions' + Q, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'autonomous' }),
    });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toMatchObject({ ok: true });

    const after = await jsonOf(await get('/api/permissions'));
    expect(after.mode).toBe('autonomous');
  });

  it('PUT /api/permissions rejects an invalid mode (400)', async () => {
    const res = await app.request('/api/permissions' + Q, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'reckless' }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT /api/permissions rejects an invalid override value (400)', async () => {
    const res = await app.request('/api/permissions' + Q, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'balanced', overrides: { send: 'maybe' } }),
    });
    expect(res.status).toBe(400);
  });
});

describe('approvals API contract', () => {
  it('GET /api/approvals returns { approvals: [...] } and is auth-gated', async () => {
    const noTok = await getNoToken('/api/approvals');
    expect(noTok.status).toBe(401);

    const res = await get('/api/approvals');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ approvals: expect.any(Array) });
  });

  it('POST /api/approvals/:id/approve on a pending item returns ok; a SECOND approve does NOT replay (L-3 / T-replay-twice)', async () => {
    // Seed a pending approval via the queue service so an id exists to approve.
    const { enqueueApproval } = await import('./approval-queue.js');
    const id = enqueueApproval({
      toolName: 'mcp__gmail__send-email',
      toolInput: { to: 'a@b.com', body: 'hi' },
      tier: 3,
      modeAtDecision: 'balanced',
      summary: 'send to a@b.com',
      runId: 'routine-x',
    });

    const first = await postAction(`/api/approvals/${id}/approve`);
    expect(first.status).toBe(200);
    expect(await jsonOf(first)).toMatchObject({ ok: true });

    // Second approve of the same id must be status-guarded — no second replay.
    const second = await postAction(`/api/approvals/${id}/approve`);
    expect(await jsonOf(second)).toMatchObject({ ok: false });
  });

  it('POST /api/approvals/:id/deny sets the item denied', async () => {
    const { enqueueApproval } = await import('./approval-queue.js');
    const id = enqueueApproval({
      toolName: 'mcp__slack__post-message',
      toolInput: { text: 'hi' },
      tier: 3,
      modeAtDecision: 'balanced',
      summary: 'post to slack',
      runId: 'routine-y',
    });
    const res = await postAction(`/api/approvals/${id}/deny`);
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toMatchObject({ ok: true });
  });
});

describe('activity API contract', () => {
  it('GET /api/activity is auth-gated (token gate inherited from app mount, T-04-auth)', async () => {
    const noTok = await getNoToken('/api/activity');
    expect(noTok.status).toBe(401);
    expect(await jsonOf(noTok)).toMatchObject({ error: 'Unauthorized' });
  });

  it('GET /api/activity with the token returns 200 and a rows array', async () => {
    const res = await get('/api/activity');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ rows: expect.any(Array) });
  });

  it('returns the curated tagged shape: a queued pending row tagged "Needs you", an autonomous audit "allow" row tagged "Ran on its own", and no secret fields', async () => {
    const { enqueueApproval } = await import('./approval-queue.js');
    const { insertAuditLog } = await import('./db.js');

    // A queued, still-pending action: approval_queue owns it -> "Needs you".
    enqueueApproval({
      toolName: 'mcp__gmail__send-email',
      toolInput: { to: 'lead@example.com', body: 'follow up' },
      tier: 3,
      modeAtDecision: 'balanced',
      summary: 'send to lead@example.com',
      runId: 'routine-a',
    });

    // An autonomous action that never touched the queue: audit outcome='allow'
    // -> "Ran on its own". detail carries only {tool,tier,outcome}, no params.
    insertAuditLog({
      agentId: 'comms',
      chatId: 'chat-1',
      action: 'permission',
      detail: JSON.stringify({ tool: 'mcp__gmail__apply-label', tier: 1, outcome: 'allow' }),
      blocked: false,
    });

    const res = await get('/api/activity');
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const rows = body.rows as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const tags = rows.map((r) => r.tag);
    expect(tags).toContain('Needs you');
    expect(tags).toContain('Ran on its own');

    // No secret/env material leaks into a feed row (T-04-infodisc-resp).
    const blob = JSON.stringify(body).toLowerCase();
    expect(blob).not.toContain('api_key');
    expect(blob).not.toContain('oauth');
    expect(blob).not.toContain('process.env');
  });

  it('respects the read-side filter (needsyou returns only "Needs you" rows, D-11)', async () => {
    const { enqueueApproval } = await import('./approval-queue.js');
    const { insertAuditLog } = await import('./db.js');
    enqueueApproval({
      toolName: 'mcp__gmail__send-email',
      toolInput: { to: 'x@y.com' },
      tier: 3,
      modeAtDecision: 'balanced',
      summary: 'send',
      runId: 'routine-b',
    });
    insertAuditLog({
      agentId: 'ops',
      chatId: 'chat-1',
      action: 'permission',
      detail: JSON.stringify({ tool: 'mcp__gmail__apply-label', tier: 1, outcome: 'allow' }),
      blocked: false,
    });

    const res = await get('/api/activity?filter=needsyou');
    expect(res.status).toBe(200);
    const rows = (await jsonOf(res)).rows as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.tag === 'Needs you')).toBe(true);
  });
});

// Undo write path (TRUST-02 / D-07/D-08/D-09). The route inherits the token
// gate + DASHBOARD_MUTATIONS_ENABLED kill-switch by mounting on `app`. No MCP
// server is connected in the contract harness, so an allowlisted approved row's
// inverse returns an honest "Connect ... in Settings" failure — but the
// status-guarded CLAIM still acts, so the undo-not-twice invariant is exercised
// without any real external call.
describe('activity undo API contract', () => {
  // Seed an approved, allowlisted (label family), tier<4 row with captured
  // params — the only shape that is undoable.
  async function seedApprovedUndoable() {
    const { enqueueApproval, approve } = await import('./approval-queue.js');
    const id = enqueueApproval({
      toolName: 'mcp__gmail__apply-label',
      toolInput: { message_id: 'msg-1', label: 'Follow up' },
      tier: 1,
      modeAtDecision: 'balanced',
      summary: 'apply label',
      runId: 'routine-undo',
    });
    approve(id, { ok: true });
    return id;
  }

  it('400s on a non-integer id', async () => {
    const res = await postAction('/api/activity/not-a-number/undo');
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ ok: false });
  });

  it('is mutation-gated: returns 503 when DASHBOARD_MUTATIONS_ENABLED is off', async () => {
    const killSwitches = await import('./kill-switches.js');
    const id = await seedApprovedUndoable();
    const prev = process.env.DASHBOARD_MUTATIONS_ENABLED;
    process.env.DASHBOARD_MUTATIONS_ENABLED = 'false';
    killSwitches._reset();
    try {
      const res = await postAction(`/api/activity/${id}/undo`);
      expect(res.status).toBe(503);
    } finally {
      process.env.DASHBOARD_MUTATIONS_ENABLED = prev;
      killSwitches._reset();
    }
  });

  it('undoes an approved undoable row once; a SECOND undo does NOT re-fire (undo-not-twice)', async () => {
    const id = await seedApprovedUndoable();

    const first = await postAction(`/api/activity/${id}/undo`);
    expect(first.status).toBe(200);
    const firstBody = await jsonOf(first);
    // No MCP server connected here, so the inverse fails honestly (ok:false)
    // with the verbatim connect-in-Settings reason — never a generic error.
    expect(firstBody).toHaveProperty('result');
    expect(String(firstBody.result).toLowerCase()).toContain('connect');

    // The CLAIM acted on the first call, so a second undo is a no-op.
    const second = await postAction(`/api/activity/${id}/undo`);
    expect(await jsonOf(second)).toMatchObject({ ok: false, error: 'already undone' });
  });

  it('honestly rejects a Tier 4 row with no inverse run (D-09)', async () => {
    const { enqueueApproval, approve } = await import('./approval-queue.js');
    const id = enqueueApproval({
      toolName: 'mcp__bank__send-money',
      toolInput: { to: 'acct-1', amount: 100 },
      tier: 4,
      modeAtDecision: 'balanced',
      summary: 'send money',
      runId: 'routine-t4',
    });
    approve(id, { ok: true });
    const res = await postAction(`/api/activity/${id}/undo`);
    const body = await jsonOf(res);
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("Undo isn't available");
  });

  it('honestly rejects a non-allowlisted approved row (D-07)', async () => {
    const { enqueueApproval, approve } = await import('./approval-queue.js');
    const id = enqueueApproval({
      toolName: 'mcp__gmail__send-email',
      toolInput: { to: 'a@b.com' },
      tier: 3,
      modeAtDecision: 'balanced',
      summary: 'send email',
      runId: 'routine-na',
    });
    approve(id, { ok: true });
    const res = await postAction(`/api/activity/${id}/undo`);
    const body = await jsonOf(res);
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("Undo isn't available");
  });
});

// Summarize Today (D-10 / T-04-llm-dos). POST, so it inherits the token gate +
// DASHBOARD_MUTATIONS_ENABLED kill-switch by mounting on `app`. On top of that
// it is governed by LLM_SPAWN_ENABLED: when off it short-circuits with the
// honest degrade and makes NO LLM call. With a fresh in-memory DB the feed is
// empty, so summarizeDay returns the honest degrade WITHOUT a real LLM call
// either way — the contract harness never reaches Anthropic.
describe('activity summarize API contract', () => {
  const DEGRADE = "Couldn't summarize right now. The feed below is complete.";

  it('is mutation-gated: returns 503 when DASHBOARD_MUTATIONS_ENABLED is off', async () => {
    const killSwitches = await import('./kill-switches.js');
    const prev = process.env.DASHBOARD_MUTATIONS_ENABLED;
    process.env.DASHBOARD_MUTATIONS_ENABLED = 'false';
    killSwitches._reset();
    try {
      const res = await postAction('/api/activity/summarize');
      expect(res.status).toBe(503);
    } finally {
      process.env.DASHBOARD_MUTATIONS_ENABLED = prev;
      killSwitches._reset();
    }
  });

  it('short-circuits with the honest degrade and NO LLM call when LLM_SPAWN_ENABLED is off', async () => {
    const killSwitches = await import('./kill-switches.js');
    const memory = await import('./memory-ingest.js');
    const spy = vi.spyOn(memory, 'extractViaClaude');
    const prev = process.env.LLM_SPAWN_ENABLED;
    process.env.LLM_SPAWN_ENABLED = 'false';
    killSwitches._reset();
    try {
      const res = await postAction('/api/activity/summarize');
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body).toMatchObject({ ok: true, text: DEGRADE, disabled: true });
      // The kill-switch chokepoint fired before any LLM call.
      expect(spy).not.toHaveBeenCalled();
    } finally {
      process.env.LLM_SPAWN_ENABLED = prev;
      killSwitches._reset();
      spy.mockRestore();
    }
  });

  it('returns text-or-honest-failure (degrade on an empty feed, no LLM call)', async () => {
    const memory = await import('./memory-ingest.js');
    const spy = vi.spyOn(memory, 'extractViaClaude');
    try {
      const res = await postAction('/api/activity/summarize');
      expect(res.status).toBe(200);
      const body = await jsonOf(res);
      expect(body.ok).toBe(true);
      expect(typeof body.text).toBe('string');
      // Fresh DB -> empty feed -> honest degrade, summarizeDay never calls the LLM.
      expect(body.text).toBe(DEGRADE);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
