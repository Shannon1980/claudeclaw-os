import { Api, RawApi } from 'grammy';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';

import fs from 'fs';
import path from 'path';
import { AGENT_ID, ALLOWED_CHAT_ID, DASHBOARD_PORT, DASHBOARD_TOKEN, DASHBOARD_URL, PROJECT_ROOT, STORE_DIR, WHATSAPP_ENABLED, SLACK_USER_TOKEN, CONTEXT_LIMIT, agentDefaultModel, CLAUDECLAW_CONFIG } from './config.js';
import { isValidClaudeModel } from './models.js';
import crypto from 'crypto';
import {
  getAllScheduledTasks,
  deleteScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
  updateScheduledTask,
  createScheduledTask,
  getRoutineSteps,
  saveRoutineSteps,
  getRoutineRuns,
  getLastRoutineOutcome,
  type RoutineStepInput,
  getConversationPage,
  getDashboardMemoryStats,
  getDashboardPinnedMemories,
  getDashboardLowSalienceMemories,
  getDashboardTopAccessedMemories,
  getDashboardMemoryTimeline,
  getDashboardConsolidations,
  getDashboardMemoriesList,
  getMemoriesForOperatorSurface,
  addOperatorFact,
  updateOperatorFact,
  confirmMemory,
  writeTombstoneForMemory,
  deleteMemory,
  OPERATOR_FACT_CATEGORIES,
  type OperatorFactCategory,
  getDashboardTokenStats,
  getDashboardCostTimeline,
  getDashboardRecentTokenUsage,
  getSession,
  getSessionTokenUsage,
  getHiveMindEntries,
  getAgentTokenStats,
  getAgentRecentConversation,
  getMissionTasks,
  getMissionTask,
  createMissionTask,
  createProject,
  getProject,
  getAllProjects,
  updateProject,
  deleteProject,
  getProjectTasks,
  setMissionTaskProject,
  cancelMissionTask,
  deleteMissionTask,
  reassignMissionTask,
  assignMissionTask,
  getUnassignedMissionTasks,
  getMissionTaskHistory,
  getHomeSummary,
  getTeamRoster,
  isAgentPaused,
  setAgentPaused,
  setMissionTaskBlocked,
  unblockMissionTask,
  requeueMissionTask,
  getTaskMessages,
  getMissionTaskRuns,
  getUpcomingScheduledTasks,
  getAuditLogCount,
  getAuditLogFiltered,
  getAuditLogTypes,
  getAuditRetentionDays,
  getRecentBlockedActions,
  type AuditLogEntry,
  listActiveMeetSessions,
  listRecentMeetSessions,
  getMeetSession,
  type MeetSession,
  createWarRoomMeeting,
  endWarRoomMeeting,
  addWarRoomTranscript,
  getWarRoomMeetings,
  getWarRoomTranscript,
  getAllDashboardSettings,
  getDashboardSetting,
  setDashboardSetting,
  insertAuditLog,
  appendAgentFileHistory,
  listAgentFileHistory,
  getAgentFileHistory,
  pruneAgentFileHistory,
  type AgentFileKind,
  insertAgentSuggestion,
  listActiveAgentSuggestions,
  dismissAgentSuggestion,
  markAgentSuggestionActed,
  getRecentlySuggestedSplits,
} from './db.js';
import { computeNextRun, projectCronRuns, triggerRoutineRun } from './scheduler.js';
import { assembleRoutineDraft } from './routine-draft.js';
import { parseJsonResponse } from './gemini.js';
import { classifyTaskAgent } from './task-router.js';
import { getSecurityStatus } from './security.js';
import { AGENT_ID_RE, SLACK_CHANNEL_RE, agentExists, listAgentIds, loadAgentConfig, refreshWarRoomRoster, resolveAgentDir, setAgentModel, setAgentProfile, setAgentSlackChannel } from './agent-config.js';
import {
  resolveAgentAvatar,
  avatarEtag,
  avatarEtagForId,
  tryFetchTelegramAvatar,
  writeUploadedAvatar,
  deleteUploadedAvatar,
  getMutableAvatarPath,
} from './avatars.js';
import {
  listTemplates,
  validateAgentId,
  validateBotToken,
  createAgent,
  activateAgent,
  deactivateAgent,
  restartAgent,
  deleteAgent,
  suggestBotNames,
  isAgentRunning,
} from './agent-create.js';
import { getMainModelOverride, processMessageFromDashboard } from './bot.js';
import {
  getMode,
  setMode,
  getOverrides,
  setOverride,
  type Mode,
  type OverrideValue,
} from './permissions-config.js';
import { listPending, approve, deny, claimUndo, finalizeUndo, getApprovalById, type ApprovalRow } from './approval-queue.js';
import { listPairings, approvePairing, denyPairing, getPairingById } from './pairing.js';
import { buildActivityFeed, isUndoableFamily } from './activity.js';
import { summarizeDay, SUMMARIZE_DEGRADE } from './activity-summary.js';
import { replayApproval } from './replay-executor.js';
import { safeTarget } from './gate.js';
import { undoAction } from './undo-executor.js';
import { UPLOADS_DIR } from './media.js';
import { collectProjectFiles, collectTaskFiles, allowedProjectDownloadPaths } from './mission-files.js';
import { getDashboardHtml } from './dashboard-html.js';
import { getWarRoomHtml } from './warroom-html.js';
import { getWarRoomPickerHtml } from './warroom-text-picker-html.js';
import { getWarRoomTextHtml } from './warroom-text-html.js';
import { handleTextTurn, cancelMeetingTurns, getRoster, warmupMeeting, isWarmupDone, getActiveTurnIds, waitForMeetingTurnsIdle } from './warroom-text-orchestrator.js';
import { getChannel, closeChannel, startChannelSweeper } from './warroom-text-events.js';
import {
  createTextMeeting,
  getTextMeeting,
  setMeetingPin,
  clearMeetingSessions,
  getOpenTextMeetingIds,
  getTextMeetings,
} from './db.js';
import { messageQueue } from './message-queue.js';
import * as killSwitches from './kill-switches.js';
import { getIngestionQuotaStatus, extractViaClaude } from './memory-ingest.js';
import { deriveProvenance, provenanceLabelsForSurface } from './memory-provenance.js';
import { WARROOM_ENABLED, WARROOM_PORT } from './config.js';
import { logger } from './logger.js';
import { getTelegramConnected, getBotInfo, chatEvents, getIsProcessing, abortActiveQuery, ChatEvent } from './state.js';
import { killProcess, isProcessAlive, findProcessesByPattern } from './platform.js';

// ── Audit export serializers (Phase 5, AUD-02) ─────────────────────────────
//
// The audit log exports the COMPLETE filtered set as a downloadable CSV or JSON
// file (D-21). audit_log.detail is free-text and WILL contain commas, quotes,
// and newlines, and a cell whose first character is `= + - @` executes as a
// formula when the file is opened in Excel (CSV injection, Pitfall 3 / ASVS V8).
// Both serializers live here (not in a CSV library — none is installed) and are
// unit-tested in src/audit-export.test.ts.

/** Neutralize formula injection: prefix a cell starting with `= + - @` (after
 * any leading whitespace, which Excel ignores) with a single quote. */
function neutralizeFormula(value: string): string {
  // Excel evaluates a cell as a formula when its first non-space char is one of
  // these — prefix with ' so it is treated as literal text.
  if (/^[\s]*[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

/** RFC-4180-quote a single field: double embedded quotes and wrap the field in
 * quotes when it contains a comma, quote, CR, or LF. */
function csvField(value: unknown): string {
  // null / undefined export as an empty cell (honest absence in a flat file).
  const raw = value === null || value === undefined ? '' : String(value);
  const neutralized = neutralizeFormula(raw);
  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

/**
 * Serialize rows to RFC-4180 CSV with a header row. Column order is taken from
 * the union of keys across all rows (first-seen order), so a sparse row still
 * lands its values under the right header. The detail/target/etc. fields are
 * free-text and pass through {@link csvField} (quoting) + formula neutralization
 * — NEVER `.join(',')` raw values.
 */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  const lines: string[] = [];
  lines.push(columns.map(csvField).join(','));
  for (const row of rows) {
    lines.push(columns.map((col) => csvField(row[col])).join(','));
  }
  // RFC-4180 uses CRLF line breaks.
  return lines.join('\r\n');
}

/** JSON export envelope: { exported_at, count, rows }. */
export function toJsonEnvelope(rows: Array<Record<string, unknown>>): {
  exported_at: string;
  count: number;
  rows: Array<Record<string, unknown>>;
} {
  return { exported_at: new Date().toISOString(), count: rows.length, rows };
}

// Meeting id format: wr_<timestampBase36>_<6-hex-random>. Regex also allows
// the same shape without the hex suffix in case an id is created manually
// in tests. Validated on every route that takes meetingId.
const WARROOM_TEXT_ID_RE = /^wr_[a-z0-9_]{4,64}$/i;
// Browser crypto.randomUUID() produces lowercase v4 UUIDs. Accept either case.
const CLIENT_MSG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Build the dashboard Hono app without binding it to a port. Exported for
 * contract tests so the route surface can be exercised via `app.request()`
 * without standing up a real server. Production callers should use
 * `startDashboard` instead, which builds the app then serves it.
 */
/** Validate attachment references coming from the dashboard. Only files
 *  that came through /api/chat/upload (i.e. live inside UPLOADS_DIR) are
 *  accepted, so a token holder can't point Claude at arbitrary filesystem
 *  paths via the attachments field. */
function resolveUploadAttachments(
  raw?: { path?: string; name?: string }[],
): { atts: { path: string; name: string }[]; error?: string } {
  const atts: { path: string; name: string }[] = [];
  for (const att of raw ?? []) {
    if (!att?.path) continue;
    const resolved = path.resolve(att.path);
    if (!resolved.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(resolved)) {
      return { atts: [], error: `Invalid attachment path: ${att.path}` };
    }
    atts.push({ path: resolved, name: att.name || path.basename(resolved) });
  }
  return { atts };
}

/** Build the prompt block that tells Claude where attached files live and
 *  what to do with each kind (read documents, analyze images, gemini for
 *  videos). Appended to chat messages and mission task prompts. */
function attachmentPromptBlock(atts: { path: string; name: string }[]): string {
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic'];
  const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  const lines = atts.map((a) => {
    const ext = path.extname(a.path).toLowerCase();
    const kind = imageExts.includes(ext) ? 'image' : videoExts.includes(ext) ? 'video' : 'document';
    return `- ${kind}: ${a.name} — saved at ${a.path}`;
  });
  const hasVideo = lines.some((l) => l.startsWith('- video'));
  return (
    `[Attached file${atts.length > 1 ? 's' : ''}]\n${lines.join('\n')}\n` +
    `Read and process the attached file(s) as appropriate (analyze images${hasVideo ? '; for videos use the gemini-api-dev skill with GOOGLE_API_KEY from .env' : ''}).`
  );
}

export function buildDashboardApp(relayToUser?: (text: string) => Promise<void>): Hono {
  const app = new Hono();

  // CORS headers for cross-origin access (Cloudflare tunnel, mobile browsers)
  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  // Security headers (defense-in-depth on top of token-in-URL auth).
  //
  //   Referrer-Policy: no-referrer
  //     User clicks an external link from inside the dashboard or war
  //     room — the browser must NOT send `?token=...` via the Referer
  //     header to the destination. Without this header, that's a clear
  //     leak vector for any agent reply that contains a hyperlink.
  //
  //   X-Content-Type-Options: nosniff
  //     Stops MIME-sniff XSS on uploaded assets. Dashboard mostly
  //     serves JSON + HTML, but the favicon and avatar routes return
  //     binary; sniff-XSS is a real class.
  //
  //   X-Frame-Options: DENY
  //     The dashboard should never be embedded in an iframe. Without
  //     this, a phisher with the token-in-URL can embed the dashboard
  //     in a frame and overlay clickjacking UI.
  //
  //   Cache-Control: no-store on authenticated API responses
  //     Memory contents, transcript snippets, and conversation history
  //     are sensitive. Default Hono caching can leak them via shared
  //     proxy caches (Cloudflare, corp proxies). Set no-store on every
  //     API response by default; static favicon already overrides.
  app.use('*', async (c, next) => {
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    await next();
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/')) {
      // After next() so any handler-set Cache-Control would have run; we
      // override here to enforce no-store on API JSON.
      c.header('Cache-Control', 'no-store');
    }
  });

  // Global error handler — prevents unhandled throws from killing the server
  app.onError((err, c) => {
    logger.error({ err: err.message }, 'Dashboard request error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  // Request logging middleware — logs method, path, IP, user agent, auth result
  app.use('*', async (c, next) => {
    const start = Date.now();
    const ip = c.req.header('cf-connecting-ip')
      || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';
    const ua = c.req.header('user-agent') || 'unknown';
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;

    await next();

    const status = c.res.status;
    const ms = Date.now() - start;
    const level = status === 401 || status === 403 ? 'warn' : 'info';
    logger[level](
      { method, path, status, ip, ua, ms },
      `Dashboard ${method} ${path} ${status}`
    );
  });

  // Serve favicon BEFORE the token middleware so browsers don't spam
  // 401 errors in the console. Returns a 1x1 transparent PNG.
  const FAVICON_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  app.get('/favicon.ico', (c) => new Response(FAVICON_BYTES, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
  }));

  // Token auth middleware.
  //
  // Strategy: the v2 SPA does client-side routing across many paths
  // (/mission, /scheduled, /agents, /agents/:id/files, /chat,
  // /memories, /hive, /usage, /audit, /settings, /warroom, /). When a
  // user refreshes any of those URLs the server sees a real GET to
  // that path. None of those response bodies contain secrets — they're
  // all the same SPA shell index.html, which reads the token from
  // window.location at runtime.
  //
  // So the rule is simple: GATE THE API. Everything else passes through
  // the middleware, and the handlers fall through to the SPA-shell
  // catch-all unless an earlier route matched. Legacy HTML routes that
  // DO embed the token (warroom?mode=picker|voice, /warroom/text,
  // / under DASHBOARD_LEGACY=true) call requireToken() inline.
  app.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    // Only gate the API surface. Static and HTML pass through.
    if (!path.startsWith('/api/')) {
      await next();
      return;
    }
    const token = c.req.query('token');
    if (!DASHBOARD_TOKEN || !token || token !== DASHBOARD_TOKEN) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });

  // Inline token check for handlers that USED to rely on the global
  // middleware but now serve a public SPA shell on the same path. Used
  // by legacy fallbacks that DO embed the token in the page source.
  function requireToken(c: any): Response | null {
    const token = c.req.query('token');
    if (!DASHBOARD_TOKEN || !token || token !== DASHBOARD_TOKEN) {
      return c.json({ error: 'Unauthorized' }, 401) as Response;
    }
    return null;
  }

  // Mutation kill-switch middleware. When DASHBOARD_MUTATIONS_ENABLED is
  // off, every non-GET request returns 503 — the runbook's promise is
  // "flip this to put the dashboard in read-only mode during an incident."
  // GET routes (including /api/health) keep working so an operator can
  // diagnose. This MUST run before route handlers so the per-route checks
  // I scattered earlier (now removed) can't be the only line of defense.
  const mutationReadonlyExempt = new Set<string>([
    // Add safe-recovery POST endpoints here if needed; none today.
  ]);
  app.use('*', async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next();
      return;
    }
    const path = new URL(c.req.url).pathname;
    if (mutationReadonlyExempt.has(path)) {
      await next();
      return;
    }
    if (!killSwitches.isEnabled('DASHBOARD_MUTATIONS_ENABLED')) {
      logger.warn({ method, path }, 'mutation refused: DASHBOARD_MUTATIONS_ENABLED off');
      return c.json({ error: 'mutations disabled (incident kill switch)' }, 503);
    }
    await next();
  });

  // CSRF / origin enforcement on state-changing requests.
  //
  // Without this, a malicious page that captured the token (browser
  // history, referer leak, share-link paste) can issue cross-origin
  // POSTs and weaponize the session — wildcard CORS plus token-in-URL
  // is a CSRF foundation. Browsers send `Origin` on cross-origin
  // POST/PATCH/DELETE; we reject if it isn't on our allowlist.
  //
  // Allowlist:
  //   - missing Origin (same-origin form posts, fetch from same page,
  //     curl/CLI tools that don't set Origin) → allow
  //   - localhost / 127.0.0.1 / loopback hostnames → always allow
  //   - DASHBOARD_URL value (if set) → allow if request Origin's host
  //     matches the configured URL's host
  //
  // Operators exposing via Cloudflare tunnel set DASHBOARD_URL to the
  // tunnel URL; everything else is rejected.
  // Read from the config constant (which checks process.env AND the
  // .env file via readEnvFile), not process.env directly. launchd
  // doesn't populate process.env from .env, so process.env.DASHBOARD_URL
  // is empty under the production daemon — meaning every cross-origin
  // POST 403'd from the Cloudflare tunnel even though .env had the
  // right URL.
  const allowedOriginHost = (() => {
    const raw = (DASHBOARD_URL || '').trim();
    if (!raw) return '';
    try { return new URL(raw).hostname; } catch { return ''; }
  })();
  app.use('*', async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      await next();
      return;
    }
    const origin = c.req.header('origin');
    if (origin) {
      let host = '';
      try { host = new URL(origin).hostname; } catch { /* malformed */ }
      const allowed =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '[::1]' ||
        host === '0.0.0.0' ||
        (!!allowedOriginHost && host === allowedOriginHost);
      if (!allowed) {
        logger.warn({ origin, method, path: new URL(c.req.url).pathname }, 'CSRF: rejected cross-origin request');
        return c.json({ error: 'cross-origin request rejected' }, 403);
      }
    }
    await next();
  });

  // Serve dashboard HTML.
  // Default: the new Vite-built Mission Control frontend at dist/web/index.html.
  // Fallback: set DASHBOARD_LEGACY=true in .env to revert to the legacy
  // single-file template HTML (kept around as the rollback ejector seat
  // for the rewrite — see SHIP-CHECKLIST and the rewrite plan).
  const legacyMode = (process.env.DASHBOARD_LEGACY || '').toLowerCase() === 'true';
  const newDashboardIndex = path.join(PROJECT_ROOT, 'dist', 'web', 'index.html');
  app.get('/', (c) => {
    const chatId = c.req.query('chatId') || '';
    if (legacyMode || !fs.existsSync(newDashboardIndex)) {
      // Legacy path interpolates DASHBOARD_TOKEN into the HTML, so it
      // MUST require the token. SPA path doesn't.
      const denied = requireToken(c); if (denied) return denied;
      return c.html(getDashboardHtml(DASHBOARD_TOKEN, chatId, WARROOM_ENABLED));
    }
    // SPA shell. Read fresh on each request so dev rebuilds appear
    // without restart. The frontend reads ?token= and ?chatId= from
    // window.location, falling back to sessionStorage. Serving this
    // unauthenticated means a token-stripped URL still loads the app
    // instead of showing raw 401 JSON.
    const html = fs.readFileSync(newDashboardIndex, 'utf-8');
    return c.html(html);
  });

  // Static asset serving for the Vite-built frontend.
  // Vite emits hashed files under dist/web/assets/.
  app.get('/assets/*', (c) => {
    const url = new URL(c.req.url);
    const rel = url.pathname.replace(/^\//, '');
    const filePath = path.join(PROJECT_ROOT, 'dist', 'web', rel);
    // Defense in depth: ensure the resolved path stays inside dist/web/.
    const root = path.join(PROJECT_ROOT, 'dist', 'web');
    if (!filePath.startsWith(root + path.sep)) return c.text('', 403);
    if (!fs.existsSync(filePath)) return c.text('', 404);
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const ctype = ext === '.js' ? 'application/javascript'
      : ext === '.css' ? 'text/css'
      : ext === '.map' ? 'application/json'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.woff2' ? 'font/woff2'
      : 'application/octet-stream';
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': ctype, 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  });

  // Top-level static files copied from web/public/ at build time
  // (e.g. /brain.glb for the 3D Hive Mind view, /favicon.svg for the app
  // mark). These have stable names so they sit at the root rather than
  // under /assets/. Without this route they fall through to the SPA
  // catch-all and the browser gets index.html back instead of the file.
  app.get('/:filename{.+\\.(glb|gltf|bin|ktx2|wasm|svg|png|ico)}', (c) => {
    const filename = c.req.param('filename');
    const filePath = path.join(PROJECT_ROOT, 'dist', 'web', filename);
    const root = path.join(PROJECT_ROOT, 'dist', 'web');
    if (!filePath.startsWith(root + path.sep)) return c.text('', 403);
    if (!fs.existsSync(filePath)) return c.text('', 404);
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const ctype = ext === '.glb' ? 'model/gltf-binary'
      : ext === '.gltf' ? 'model/gltf+json'
      : ext === '.wasm' ? 'application/wasm'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.png' ? 'image/png'
      : ext === '.ico' ? 'image/x-icon'
      : 'application/octet-stream';
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': ctype,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  });

  // War Room entry.
  //   - ?mode=voice → serve the cinematic legacy voice page (interactive
  //     Pipecat WebSocket UI).
  //   - ?mode=picker → serve the legacy picker (kept around as an escape
  //     hatch when v2 is misbehaving).
  //   - In legacy mode → serve the legacy picker (current pre-v2 behavior).
  //   - Otherwise → fall through to the v2 SPA so a refresh of /warroom
  //     stays inside the new dashboard. The v2 page has its own picker.
  app.get('/warroom', (c) => {
    const chatId = c.req.query('chatId') || '';
    const mode = c.req.query('mode') || '';
    // Legacy variants interpolate DASHBOARD_TOKEN into the HTML so they
    // MUST require a token. The v2 SPA path doesn't.
    if (mode === 'voice') {
      const denied = requireToken(c); if (denied) return denied;
      return c.html(getWarRoomHtml(DASHBOARD_TOKEN, chatId, WARROOM_PORT));
    }
    if (mode === 'picker' || legacyMode || !fs.existsSync(newDashboardIndex)) {
      const denied = requireToken(c); if (denied) return denied;
      return c.html(getWarRoomPickerHtml(DASHBOARD_TOKEN, chatId));
    }
    // v2 SPA shell — no embedded token, safe to serve unauth so a
    // hard-refresh of a token-stripped URL still loads the app.
    return c.html(fs.readFileSync(newDashboardIndex, 'utf-8'));
  });

  // Text War Room page. Expects ?meetingId= (created via POST
  // /api/warroom/text/new). Routing matrix:
  //   - missing/invalid meetingId   → picker (refresh-becomes-fresh)
  //   - meeting not found           → picker
  //   - meeting ended, no ?archive  → picker (so a plain refresh of an
  //                                   ended room starts a new meeting
  //                                   instead of staring at "Meeting
  //                                   ended." forever)
  //   - meeting ended + ?archive=1  → serve read-only (used by the
  //                                   "Recent meetings" list on the
  //                                   picker)
  //   - meeting open                → serve interactive war room
  function pickerRedirect(chatId: string) {
    const q = new URLSearchParams({ token: DASHBOARD_TOKEN });
    if (chatId) q.set('chatId', chatId);
    return '/warroom?' + q.toString();
  }
  app.get('/warroom/text', (c) => {
    // Legacy HTML embeds DASHBOARD_TOKEN — gate it inline since the
    // global middleware now only protects /api/*.
    const denied = requireToken(c); if (denied) return denied;
    const chatId = c.req.query('chatId') || '';
    const meetingId = (c.req.query('meetingId') || '').trim();
    const archive = c.req.query('archive') === '1';
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) {
      return c.redirect(pickerRedirect(chatId));
    }
    const existing = getTextMeeting(meetingId);
    if (!existing) {
      return c.redirect(pickerRedirect(chatId));
    }
    if (existing.ended_at !== null && !archive) {
      return c.redirect(pickerRedirect(chatId));
    }
    // Chat-id mismatch: don't render the page (would let a stale meetingId
    // from chat A render under chat B's session). Send them back to the
    // picker for their actual chat. Legacy meetings with chat_id='' bypass
    // this since they pre-date the migration.
    if (existing.chat_id !== '' && existing.chat_id !== chatId) {
      return c.redirect(pickerRedirect(chatId));
    }
    return c.html(getWarRoomTextHtml(DASHBOARD_TOKEN, chatId, meetingId));
  });

  // Serve War Room background music (user's custom music.mp3 first, then bundled entrance.mp3)
  app.get('/warroom-music', (c) => {
    const musicPath = path.join(PROJECT_ROOT, 'warroom', 'music.mp3');
    if (!fs.existsSync(musicPath)) return c.text('', 404);
    const data = fs.readFileSync(musicPath);
    return new Response(data, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' },
    });
  });

  // Upload custom War Room entrance music from the dashboard
  app.post('/warroom-music-upload', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!file || typeof file === 'string') return c.json({ error: 'No file uploaded' }, 400);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) return c.json({ error: 'File too large (max 20MB)' }, 400);
    if (buf.length < 3) return c.json({ error: 'File too short to be MP3' }, 400);
    // Magic-byte check: ID3v2 header ("ID3") OR MPEG audio frame sync
    // (0xFF 0xFB / 0xFA / 0xF3 / 0xF2 — the common MP3 layer-3 variants).
    const isId3 = buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33;
    const isMpegFrame = buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0;
    if (!isId3 && !isMpegFrame) return c.json({ error: 'Not a valid MP3 file' }, 400);
    fs.writeFileSync(path.join(PROJECT_ROOT, 'warroom', 'music.mp3'), buf);
    return c.json({ ok: true });
  });

  // Serve War Room test audio for the browser-side autotest harness.
  // Used by the mock microphone in warroom browser tests; served only
  // when the dashboard token matches so it's not a public endpoint.
  app.get('/warroom-test-audio', (c) => {
    const audioPath = path.join(PROJECT_ROOT, 'warroom', 'test-audio.wav');
    if (!fs.existsSync(audioPath)) return c.text('', 404);
    const data = fs.readFileSync(audioPath);
    return new Response(data, {
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' },
    });
  });

  // Serve War Room Pipecat client bundle
  app.get('/warroom-client.js', (c) => {
    const bundlePath = path.join(PROJECT_ROOT, 'warroom', 'client.bundle.js');
    if (!fs.existsSync(bundlePath)) return c.text('// bundle not built', 404);
    const data = fs.readFileSync(bundlePath, 'utf-8');
    return new Response(data, {
      headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=3600' },
    });
  });

  // The legacy /warroom-avatar/:id route used to live here. It read
  // ONLY from warroom/avatars/<id>.png (bundled art) and lived outside
  // the /api/ token gate, so it could not safely fall back to per-agent
  // mutable caches or trigger Telegram fetches without leaking those
  // outside the auth boundary. All War Room views now hit the
  // tokenized /api/agents/:id/avatar endpoint, which goes through the
  // unified resolver in avatars.ts.

  // War Room API: meeting state management.
  // We deliberately do NOT return a ws_url here. Older versions of this
  // route sent `ws://localhost:${WARROOM_PORT}`, which broke any
  // Cloudflare-tunneled access since the browser would try to connect to
  // its own localhost instead of the tunnel host. The client-side code
  // in src/warroom-html.ts always has a `window.location.hostname`
  // fallback, so just returning {ok:true} lets the browser build the
  // right WS url on its own.
  app.post('/api/warroom/start', async (c) => {
    if (!WARROOM_ENABLED) {
      return c.json({ error: 'War Room not enabled. Set WARROOM_ENABLED=true in .env with GOOGLE_API_KEY (for live mode) or DEEPGRAM_API_KEY + CARTESIA_API_KEY (for legacy mode).' }, 400);
    }
    // DASHBOARD_MUTATIONS_ENABLED is enforced by the global mutation
    // middleware above; no per-route check needed.
    if (!killSwitches.isEnabled('WARROOM_VOICE_ENABLED')) {
      return c.json({ error: 'voice war room disabled' }, 503);
    }
    // If the pin file was updated recently (agent switch while no meeting
    // was active), the running server has the wrong agent. Kill it so it
    // restarts with the correct persona/voice before we probe readiness.
    try {
      const pinStat = fs.statSync(WARROOM_PIN_PATH);
      const pinAge = Date.now() - pinStat.mtimeMs;
      if (pinAge < 30000) {
        // Pin changed in the last 30 seconds. Kill the server so it
        // picks up the new pin, then poll until it's ready.
        await killWarroomAsync('pin changed recently, restarting for Start Meeting');
        const net = await import('net');
        let serverReady = false;
        for (let attempt = 0; attempt < 15 && !serverReady; attempt++) {
          await new Promise((r) => setTimeout(r, 1000));
          serverReady = await new Promise<boolean>((resolve) => {
            const sock = new net.Socket();
            const t = setTimeout(() => { sock.destroy(); resolve(false); }, 1000);
            sock.connect(WARROOM_PORT, '127.0.0.1', () => { clearTimeout(t); sock.destroy(); resolve(true); });
            sock.on('error', () => { clearTimeout(t); sock.destroy(); resolve(false); });
          });
        }
        if (serverReady) {
          await new Promise((r) => setTimeout(r, 200));
          return c.json({ ok: true, status: 'ready' });
        }
        return c.json({ ok: false, status: 'starting', error: 'War Room server restarting, try again' }, 503);
      }
    } catch { /* pin file might not exist yet, that's fine */ }

    // Probe the Python WebSocket server to verify it's actually accepting
    // connections. Without this, the browser connects before the server is
    // ready and gets silent failures or "only one client allowed" errors.
    try {
      const net = await import('net');
      const ready = await new Promise<boolean>((resolve) => {
        const sock = new net.Socket();
        const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 3000);
        sock.connect(WARROOM_PORT, '127.0.0.1', () => {
          clearTimeout(timer);
          sock.destroy();
          resolve(true);
        });
        sock.on('error', () => { clearTimeout(timer); sock.destroy(); resolve(false); });
      });
      if (!ready) {
        return c.json({ ok: false, status: 'starting', error: 'War Room server not ready yet' }, 503);
      }
      // Small delay after TCP success: the socket may be bound but the
      // Pipecat WebSocket upgrade handler might not be fully initialized.
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      return c.json({ ok: false, status: 'starting', error: 'Could not probe War Room server' }, 503);
    }
    return c.json({ ok: true, status: 'ready' });
  });

  // Return the dynamic agent list for the War Room UI to render cards.
  // Includes main + all configured agents with their display names.
  app.get('/api/warroom/agents', (c) => {
    const ids = ['main', ...listAgentIds().filter((id) => id !== 'main')];
    const agents = ids.map((id) => {
      try {
        if (id === 'main') return { id: 'main', name: 'Main', description: 'General ops and triage' };
        const cfg = loadAgentConfig(id);
        return { id, name: cfg.name || id, description: cfg.description || '' };
      } catch {
        return { id, name: id, description: '' };
      }
    });
    return c.json({ agents });
  });

  // ── War Room meeting history & transcript persistence ──────────────
  app.post('/api/warroom/meeting/start', async (c) => {
    const body: { id?: string; mode?: string; agent?: string } = await c.req.json().catch(() => ({}));
    const id = body.id || crypto.randomUUID();
    createWarRoomMeeting(id, body.mode || 'direct', body.agent || 'main');
    return c.json({ ok: true, meetingId: id });
  });

  app.post('/api/warroom/meeting/end', async (c) => {
    const body: { id?: string; entryCount?: number } = await c.req.json().catch(() => ({}));
    if (body.id) endWarRoomMeeting(body.id, body.entryCount || 0);
    return c.json({ ok: true });
  });

  app.post('/api/warroom/meeting/transcript', async (c) => {
    const body: { meetingId?: string; speaker?: string; text?: string } = await c.req.json().catch(() => ({}));
    if (body.meetingId && body.speaker && body.text) {
      addWarRoomTranscript(body.meetingId, body.speaker, body.text);
    }
    return c.json({ ok: true });
  });

  app.get('/api/warroom/meetings', (c) => {
    const limit = parseInt(c.req.query('limit') || '20');
    return c.json({ meetings: getWarRoomMeetings(limit) });
  });

  app.get('/api/warroom/meeting/:id/transcript', (c) => {
    return c.json({ transcript: getWarRoomTranscript(c.req.param('id')) });
  });

  // ── War Room pin: route all voice utterances to a specific agent ──
  // Lives in /tmp so the Python Pipecat server (a separate process) can
  // read the state without needing an IPC bus. router.py checks this
  // file's mtime and reloads only when it changes. Spoken agent prefixes
  // (e.g. "research, find X") still take precedence over the pin.
  const WARROOM_PIN_PATH = '/tmp/warroom-pin.json';
  const VALID_PIN_MODES = new Set(['direct', 'auto']);
  // Recompute on every call so newly-created agents become pinnable
  // without a dashboard restart. listAgentIds() reads the agent-configs
  // directory which the agent-create flow writes to synchronously.
  const getValidPinAgents = (): Set<string> => new Set(['main', ...listAgentIds()]);

  // Read current pin state from disk. Returns normalized defaults for
  // missing fields so callers can rely on both agent and mode being set.
  function readPinState(): { agent: string | null; mode: string } {
    try {
      if (fs.existsSync(WARROOM_PIN_PATH)) {
        const raw = JSON.parse(fs.readFileSync(WARROOM_PIN_PATH, 'utf-8'));
        const valid = getValidPinAgents();
        const agent = (raw && typeof raw.agent === 'string' && valid.has(raw.agent)) ? raw.agent : null;
        const mode = (raw && typeof raw.mode === 'string' && VALID_PIN_MODES.has(raw.mode)) ? raw.mode : 'direct';
        return { agent, mode };
      }
    } catch { /* fall through to defaults */ }
    return { agent: null, mode: 'direct' };
  }

  app.get('/api/warroom/pin', (c) => {
    const { agent, mode } = readPinState();
    return c.json({ ok: true, agent, mode });
  });

  // Kill the warroom Python subprocess so main's respawn logic in
  // src/index.ts brings up a fresh one with whatever config files
  // (voices.json, pin file, etc.) we just wrote. Runs in the background
  // so the HTTP response doesn't block on the respawn.
  async function killWarroomAsync(reason: string): Promise<number[]> {
    try {
      const pids = await findProcessesByPattern('warroom/server.py');
      for (const pid of pids) killProcess(pid);
      if (pids.length > 0) {
        logger.info({ pids, reason }, 'Killed warroom subprocess for respawn');
      }
      return pids;
    } catch (err) {
      logger.warn({ err, reason }, 'killWarroomAsync failed');
      return [];
    }
  }

  app.post('/api/warroom/pin', async (c) => {
    let body: { agent?: string; mode?: string; restart?: boolean } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }

    // Pin can update agent, mode, or both. Missing fields preserve
    // the current pin file value. An empty body is a noop but still
    // respawns so the caller can force a reload.
    const current = readPinState();
    const nextAgent = body.agent !== undefined ? body.agent : (current.agent ?? 'main');
    const nextMode = body.mode !== undefined ? body.mode : current.mode;

    if (!getValidPinAgents().has(nextAgent)) {
      return c.json({ ok: false, error: 'invalid agent; must be one of main, research, comms, content, ops' }, 400);
    }
    if (!VALID_PIN_MODES.has(nextMode)) {
      return c.json({ ok: false, error: 'invalid mode; must be one of direct, auto' }, 400);
    }

    try {
      fs.writeFileSync(
        WARROOM_PIN_PATH,
        JSON.stringify({ agent: nextAgent, mode: nextMode, pinnedAt: Date.now() }),
        'utf-8',
      );
      // Only respawn the server if the caller says a meeting is active.
      // When no meeting is active, the server picks up the new pin on
      // the next Start Meeting click (the health probe triggers it).
      const needsRestart = body.restart !== false;
      if (needsRestart) {
        killWarroomAsync(`pin changed to agent=${nextAgent} mode=${nextMode}`);
      }
      return c.json({ ok: true, agent: nextAgent, mode: nextMode, respawning: needsRestart });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  app.post('/api/warroom/unpin', async (c) => {
    try {
      if (fs.existsSync(WARROOM_PIN_PATH)) fs.unlinkSync(WARROOM_PIN_PATH);
      killWarroomAsync('unpin');
      return c.json({ ok: true, agent: null, mode: 'direct', respawning: true });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // Text War Room
  //
  // Every route validates meetingId format before touching channels or
  // the DB, so a malformed id can't grow an unbounded channel map.
  // Dedup on clientMsgId happens inside handleTextTurn so retries from
  // a flaky network don't double-process.
  // ──────────────────────────────────────────────────────────────────

  // Recent text meetings, newest first. Used by the picker to surface
  // prior conversations so users can revisit them. Transcripts persist in
  // SQLite (warroom_transcript), so opening an ended meeting re-renders
  // the full conversation in read-only mode (composer disabled).
  app.get('/api/warroom/text/list', (c) => {
    const limit = Math.max(1, Math.min(100, parseInt(c.req.query('limit') || '20', 10) || 20));
    // Optional chat-scope: if the picker passes its current chatId, return
    // only meetings for that chat. Picker without chatId (admin/debug or
    // legacy clients) sees everything.
    const chatIdRaw = c.req.query('chatId');
    const chatId = chatIdRaw !== undefined ? chatIdRaw : undefined;
    return c.json({ ok: true, meetings: getTextMeetings(limit, chatId) });
  });

  app.post('/api/warroom/text/new', async (c) => {
    let body: { chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const chatId = (body.chatId || '').trim();
    const id = `wr_${Math.floor(Date.now() / 1000).toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    createTextMeeting(id, chatId);
    // Prime the channel so the SSE emit for meeting_state has a target.
    getChannel(id);
    // Force-end any prior open text meetings IN THE SAME CHAT so a refresh
    // / new visit starts clean WITHOUT clobbering meetings from other
    // chats sharing the box. Fire-and-forget — DB update is synchronous,
    // only the SSE-emit + cancel-turns wait is async, and the response
    // shouldn't block on those.
    const stale = getOpenTextMeetingIds(id, chatId);
    if (stale.length > 0) {
      logger.info({ closing: stale, newMeetingId: id, chatId }, 'auto-ending stale text meetings on /new');
      for (const sid of stale) {
        void endTextMeeting(sid).catch((err) => {
          logger.warn({
            err: err instanceof Error ? err.message : err,
            staleMeetingId: sid,
          }, 'auto-end of stale meeting failed (non-fatal)');
        });
      }
    }
    return c.json({ ok: true, meetingId: id, autoEnded: stale });
  });

  // Pre-warm the Claude Agent SDK path so the first user turn feels snappy.
  // The client calls this on page load in parallel with the intro animation.
  // Idempotent + fast: if warmup already ran, returns immediately.
  app.post('/api/warroom/text/warmup', async (c) => {
    if (isWarmupDone()) return c.json({ ok: true, already: true });
    // Don't await — the client doesn't need the result, it just wants
    // the server to have started. The promise resolves in the background.
    void warmupMeeting();
    return c.json({ ok: true, started: true });
  });

  app.get('/api/warroom/text/history', (c) => {
    const meetingId = (c.req.query('meetingId') || '').trim();
    const reqChatId = (c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return c.json({ error: 'meeting_not_found' }, 404);
    const chatGate = requireChatMatches(meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    const limit = Math.max(1, Math.min(500, parseInt(c.req.query('limit') || '200', 10) || 200));
    const beforeTsRaw = c.req.query('beforeTs');
    const beforeIdRaw = c.req.query('beforeId');
    const beforeTs = beforeTsRaw ? parseInt(beforeTsRaw, 10) : undefined;
    const beforeId = beforeIdRaw ? parseInt(beforeIdRaw, 10) : undefined;
    // Capture latestSeq BEFORE the transcript query. If a new row is
    // persisted + emits between these two reads, the transcript query
    // sees the row, and the client connects SSE from a seq that still
    // covers the emit — seenSeqs dedup takes care of duplicates.
    // Reverse order (seq-first, then rows) avoids the opposite race where
    // a row emits after the transcript read but before the seq read,
    // causing the client to advance past a row it never received.
    const latestSeq = getChannel(meetingId).latestSeq();
    const rows = getWarRoomTranscript(meetingId, { limit, beforeTs, beforeId }).reverse();
    return c.json({
      ok: true,
      meetingId,
      transcript: rows,
      pinnedAgent: meeting.pinned_agent,
      meetingStartedAt: meeting.started_at,
      endedAt: meeting.ended_at,
      agents: getRoster(),
      latestSeq,
    });
  });

  app.get('/api/warroom/text/stream', (c) => {
    const meetingId = (c.req.query('meetingId') || '').trim();
    const reqChatId = (c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return c.json({ error: 'meeting_not_found' }, 404);
    const chatGate = requireChatMatches(meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    // Clients that reconnect to an already-ended meeting still get a
    // stream — we emit a meeting_ended event immediately then close. This
    // lets the UI show the ended state instead of silently hanging.
    const sinceSeq = Math.max(0, parseInt(c.req.query('sinceSeq') || '0', 10) || 0);

    return streamSSE(c, async (stream) => {
      const channel = getChannel(meetingId);

      // 1. Send meeting_state snapshot with the current roster + pin so
      //    the client can render without waiting for the next real event.
      const stateEvent = {
        type: 'meeting_state' as const,
        meetingId,
        pinnedAgent: meeting.pinned_agent,
        agents: getRoster(),
        isFresh: meeting.ended_at === null && meeting.entry_count === 0,
      };
      await stream.writeSSE({
        event: 'message',
        data: JSON.stringify({ seq: 0, event: stateEvent }),
      });

      // If the meeting already ended when the client connects, tell them
      // immediately so they can render the ended state instead of hanging.
      if (meeting.ended_at !== null) {
        await stream.writeSSE({
          event: 'message',
          data: JSON.stringify({ seq: 0, event: { type: 'meeting_ended', meetingId, at: meeting.ended_at } }),
        });
        return;
      }

      // 2. Subscribe FIRST so events emitted concurrently with the replay
      //    drain aren't lost in the gap between since() and subscribe().
      //    Writes are serialized through a tiny async queue so rapid
      //    chunks can't reorder (EventEmitter.emit doesn't await our
      //    async handler otherwise).
      const seenSeqs = new Set<number>();
      let writeChain: Promise<void> = Promise.resolve();
      const writeOrdered = (seq: number, event: unknown) => {
        if (seenSeqs.has(seq)) return;
        seenSeqs.add(seq);
        writeChain = writeChain.then(async () => {
          try {
            await stream.writeSSE({
              event: 'message',
              data: JSON.stringify({ seq, event }),
            });
          } catch { /* client disconnected */ }
        });
      };

      const unsub = channel.subscribe((entry) => {
        writeOrdered(entry.seq, entry.event);
      });

      // 3. Detect replay gaps. If the client's sinceSeq is older than the
      //    oldest event we still have in the ring buffer, the replay
      //    would silently drop everything between (sinceSeq, oldestSeq).
      //    Tell the client so it can hard-reload the transcript via
      //    /history instead of rendering an inconsistent stream.
      const oldest = channel.oldestSeq();
      const latest = channel.latestSeq();
      if (sinceSeq > 0 && oldest > 0 && sinceSeq < oldest - 1) {
        await stream.writeSSE({
          event: 'message',
          data: JSON.stringify({
            seq: 0,
            event: { type: 'replay_gap', sinceSeq, oldestSeq: oldest, latestSeq: latest },
          }),
        });
      }

      // 4. Drain the replay window AFTER subscribing. The seenSeqs dedup
      //    set guarantees we never duplicate an event that the live
      //    subscription also caught.
      const missed = channel.since(sinceSeq);
      for (const entry of missed) {
        writeOrdered(entry.seq, entry.event);
      }

      const ping = setInterval(async () => {
        try { await stream.writeSSE({ event: 'ping', data: '' }); }
        catch { clearInterval(ping); }
      }, 30_000);

      try {
        await new Promise<void>((_, reject) => {
          stream.onAbort(() => reject(new Error('aborted')));
        });
      } catch {
        // expected: client disconnected
      } finally {
        clearInterval(ping);
        unsub();
      }
    });
  });

  // Shared guard: 404 on unknown, 410 on ended. Returns the meeting row if OK.
  function requireOpenMeeting(meetingId: string) {
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return { error: 'meeting_not_found' as const, status: 404 as const };
    if (meeting.ended_at !== null) return { error: 'meeting_ended' as const, status: 410 as const };
    return { meeting };
  }

  // Strict chat-id guard. Every text-war-room endpoint validates that
  // the request's chatId matches the meeting's chat_id. Without this,
  // a stale or copied meetingId from chat A used in a session running
  // as chat B would happily proceed and leak across chat scopes.
  // Legacy meetings (chat_id === '') accept any chatId so existing
  // pre-migration meetings stay openable; new meetings always have a
  // populated chat_id.
  function requireChatMatches(
    meeting: { chat_id: string },
    requestChatId: string,
  ): { ok: true } | { ok: false; error: string; status: 403 } {
    if (meeting.chat_id === '') return { ok: true };
    if (meeting.chat_id === requestChatId) return { ok: true };
    return { ok: false, error: 'chat_mismatch', status: 403 };
  }

  app.post('/api/warroom/text/send', async (c) => {
    let body: { meetingId?: string; text?: string; clientMsgId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const text = (body.text || '').trim();
    const clientMsgId = (body.clientMsgId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    // DASHBOARD_MUTATIONS_ENABLED + LLM_SPAWN_ENABLED are enforced by
    // global middlewares (mutation middleware above; LLM-spawn refusal
    // happens inside runAgentTurn). Only WARROOM_TEXT_ENABLED is
    // feature-specific and remains here.
    if (!killSwitches.isEnabled('WARROOM_TEXT_ENABLED')) {
      return c.json({ error: 'text war room disabled' }, 503);
    }
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    if (!text) return c.json({ error: 'empty text' }, 400);
    if (text.length > 8000) return c.json({ error: 'text too long (max 8000 chars)' }, 400);
    if (!CLIENT_MSG_ID_RE.test(clientMsgId)) return c.json({ error: 'invalid clientMsgId' }, 400);
    const gate = requireOpenMeeting(meetingId);
    if (gate.error) return c.json({ error: gate.error }, gate.status);
    const chatGate = requireChatMatches(gate.meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);

    // Fire-and-forget through the per-meeting queue. The client learns
    // about progress via SSE. The handleTextTurn call is wrapped in a
    // hard watchdog: if the whole turn takes longer than TURN_BUDGET_MS,
    // we force the queue to unblock so subsequent sends aren't held
    // hostage by a single hung SDK subprocess. The watchdog fires at
    // the queue level (not inside the orchestrator) so even if the
    // orchestrator never returns, the FIFO drains.
    //
    // Budget derivation:
    //   router (20s) + primary (75s)
    //   + 2 × ( intervention gate (25s) + intervener (45s) )
    //   = 235s of agent work,
    //   + ~30s for SDK cold-start + transcript I/O + queue overhead
    //   = ~265s realistic worst case for a healthy long turn.
    // Set TURN_BUDGET_MS to 300_000 so the budget actually clears the
    // worst case by a comfortable margin. The previous 240s was 5s over
    // the bare math, which meant healthy long turns were getting cut
    // off as "took too long".
    const TURN_BUDGET_MS = 300_000;
    messageQueue.enqueue(`warroom-text:${meetingId}`, async () => {
      let finished = false;
      const turnPromise = handleTextTurn(meetingId, text, clientMsgId).finally(() => { finished = true; });
      await Promise.race([
        turnPromise,
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (finished) return;
            // Timed out. Emit a user-visible error via the channel so the
            // UI unfreezes. Use turn_aborted scoped to the actual active
            // turnId(s) — turn_complete with a synthetic 'watchdog' id
            // can't drive turnId-scoped UI cleanup correctly.
            const ch = getChannel(meetingId);
            ch.emit({
              type: 'system_note',
              text: 'That turn took too long to complete and was interrupted. Send again, or end and restart the meeting if this keeps happening.',
              tone: 'warn',
              dismissable: true,
            });
            const activeTurns = getActiveTurnIds(meetingId);
            for (const tid of activeTurns) {
              ch.emit({ type: 'turn_aborted', turnId: tid, clearedAgents: [] });
              // Mark finalized AFTER emitting turn_aborted so the abort
              // event itself reaches the client. From here on, late SDK
              // chunks/agent_done/transcript writes for this turnId are
              // dropped by the channel — they can't leak into the next
              // queued turn's bubbles.
              ch.markTurnFinalized(tid);
            }
            cancelMeetingTurns(meetingId);
            resolve();
          }, TURN_BUDGET_MS);
        }),
      ]);
      // After the race settles (whether the turn finished cleanly or the
      // watchdog fired), give the orchestrator a brief grace window to
      // finish its async cleanup before we let the next queued turn run.
      // This prevents a half-aborted turn's late agent_done from racing
      // with a freshly-started turn's bubbles.
      if (!finished) {
        await Promise.race([
          turnPromise,
          new Promise<void>((r) => setTimeout(r, 2000)),
        ]);
      }
    });
    return c.json({ ok: true, queued: true });
  });

  app.post('/api/warroom/text/abort', async (c) => {
    let body: { meetingId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return c.json({ error: 'meeting_not_found' }, 404);
    const chatGate = requireChatMatches(meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    const count = cancelMeetingTurns(meetingId);
    return c.json({ ok: true, cancelled: count });
  });

  app.post('/api/warroom/text/pin', async (c) => {
    let body: { meetingId?: string; agentId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const agentId = (body.agentId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const rosterIds = new Set(getRoster().map((a) => a.id));
    if (!rosterIds.has(agentId)) return c.json({ error: 'unknown agent' }, 400);
    const gate = requireOpenMeeting(meetingId);
    if (gate.error) return c.json({ error: gate.error }, gate.status);
    const chatGate = requireChatMatches(gate.meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    setMeetingPin(meetingId, agentId);
    // Tell every connected tab so the pin indicator stays in sync
    // without a reload. Without this, tabs that didn't initiate the
    // pin click rendered the wrong roster state until they reconnected.
    getChannel(meetingId).emit({ type: 'meeting_state_update', pinnedAgent: agentId });
    return c.json({ ok: true, meetingId, pinnedAgent: agentId });
  });

  app.post('/api/warroom/text/unpin', async (c) => {
    let body: { meetingId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const gate = requireOpenMeeting(meetingId);
    if (gate.error) return c.json({ error: gate.error }, gate.status);
    const chatGate = requireChatMatches(gate.meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    setMeetingPin(meetingId, null);
    getChannel(meetingId).emit({ type: 'meeting_state_update', pinnedAgent: null });
    return c.json({ ok: true, meetingId, pinnedAgent: null });
  });

  app.post('/api/warroom/text/clear', async (c) => {
    let body: { meetingId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const gate = requireOpenMeeting(meetingId);
    if (gate.error) return c.json({ error: gate.error }, gate.status);
    const chatGate = requireChatMatches(gate.meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    // Cancel any in-flight turn FIRST and wait for it to exit before we
    // wipe sessions. Otherwise runAgentTurn's setSession() can land after
    // clearMeetingSessions() and resurrect the cleared session id, leaving
    // the user with "memory cleared" UX but the agent still resuming the
    // prior thread.
    if (getActiveTurnIds(meetingId).length > 0) {
      cancelMeetingTurns(meetingId);
      await waitForMeetingTurnsIdle(meetingId, 5000);
    }
    const agents = getRoster().map((a) => a.id);
    const cleared = clearMeetingSessions(meetingId, agents);
    // Persist the divider so reload still shows the marker. Speaker
    // __divider__ is handled client-side to render as a dashed divider.
    addWarRoomTranscript(meetingId, '__divider__', 'Memory cleared — agents start fresh from here');
    const channel = getChannel(meetingId);
    channel.emit({
      type: 'divider',
      kind: 'memory_cleared',
      text: 'Memory cleared — agents start fresh from here',
    });
    channel.emit({
      type: 'system_note',
      text: 'Sessions cleared. Next message starts fresh.',
      tone: 'info',
      dismissable: true,
    });
    return c.json({ ok: true, cleared });
  });

  // Internal helper: terminate a single text meeting (DB + SSE + channel
  // teardown). Used both by the /end endpoint and by /new when force-
  // ending stale meetings so a refresh becomes a clean slate.
  async function endTextMeeting(meetingId: string): Promise<{ alreadyEnded: boolean; entryCount: number }> {
    const meeting = getTextMeeting(meetingId);
    if (!meeting || meeting.ended_at !== null) {
      const rows = meeting ? getWarRoomTranscript(meetingId) : [];
      return { alreadyEnded: true, entryCount: rows.length };
    }
    const rows = getWarRoomTranscript(meetingId);
    endWarRoomMeeting(meetingId, rows.length);
    if (getActiveTurnIds(meetingId).length > 0) {
      cancelMeetingTurns(meetingId);
      await waitForMeetingTurnsIdle(meetingId, 3000);
    }
    // Clear the SDK sessions tied to this meeting. Without this, every
    // meeting leaves orphan rows in the `sessions` table keyed on
    // warroom-text:<meetingId>:<agentId>; the rows can't be looked up
    // again (UUID-fresh meetingIds) but they accumulate forever. Mirror
    // the /clear endpoint's behavior so /end is a true cleanup.
    try {
      const agents = getRoster().map((a) => a.id);
      clearMeetingSessions(meetingId, agents);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, meetingId },
        'clearMeetingSessions failed during endTextMeeting (non-fatal)',
      );
    }
    // Notify every connected tab BEFORE we close the channel so they can
    // disable their composers and show the "meeting ended" state.
    const channel = getChannel(meetingId);
    channel.emit({
      type: 'meeting_ended',
      meetingId,
      at: Math.floor(Date.now() / 1000),
    });
    // Close the channel after a short grace period so in-flight SSE
    // writes finish draining to clients.
    setTimeout(() => closeChannel(meetingId), 1500);
    return { alreadyEnded: false, entryCount: rows.length };
  }

  app.post('/api/warroom/text/end', async (c) => {
    let body: { meetingId?: string; chatId?: string } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const meetingId = (body.meetingId || '').trim();
    const reqChatId = (body.chatId || c.req.query('chatId') || '').trim();
    if (!WARROOM_TEXT_ID_RE.test(meetingId)) return c.json({ error: 'invalid meetingId' }, 400);
    const meeting = getTextMeeting(meetingId);
    if (!meeting) return c.json({ error: 'meeting_not_found' }, 404);
    const chatGate = requireChatMatches(meeting, reqChatId);
    if (!chatGate.ok) return c.json({ error: chatGate.error }, chatGate.status);
    const result = await endTextMeeting(meetingId);
    if (result.alreadyEnded) {
      return c.json({ ok: true, meetingId, alreadyEnded: true });
    }
    return c.json({ ok: true, meetingId, entryCount: result.entryCount });
  });

  // ── War Room voice configuration ──
  // warroom/voices.json carries two voice identifiers per agent:
  //   - gemini_voice:     Gemini Live's built-in voice name (used in live mode)
  //   - voice_id:         Cartesia voice id (used in legacy stitched mode)
  // The Python server reads this file on startup. After editing via the
  // dashboard, POST /api/warroom/voices/apply kickstarts the main agent so
  // its child warroom process respawns with the new config.
  const WARROOM_VOICES_PATH = path.join(PROJECT_ROOT, 'warroom', 'voices.json');

  // Full Gemini Live voice catalog with one-word style descriptors. Matches
  // the 30 voices supported by the gemini-2.5-flash-native-audio-preview model
  // (and other Gemini TTS-capable models). Sourced from Google's docs.
  const GEMINI_VOICE_CATALOG: Array<{ name: string; style: string }> = [
    { name: 'Zephyr', style: 'Bright' },
    { name: 'Puck', style: 'Upbeat' },
    { name: 'Charon', style: 'Informative' },
    { name: 'Kore', style: 'Firm' },
    { name: 'Fenrir', style: 'Excitable' },
    { name: 'Leda', style: 'Youthful' },
    { name: 'Orus', style: 'Firm' },
    { name: 'Aoede', style: 'Breezy' },
    { name: 'Callirrhoe', style: 'Easy-going' },
    { name: 'Autonoe', style: 'Bright' },
    { name: 'Enceladus', style: 'Breathy' },
    { name: 'Iapetus', style: 'Clear' },
    { name: 'Umbriel', style: 'Easy-going' },
    { name: 'Algieba', style: 'Smooth' },
    { name: 'Despina', style: 'Smooth' },
    { name: 'Erinome', style: 'Clear' },
    { name: 'Algenib', style: 'Gravelly' },
    { name: 'Rasalgethi', style: 'Informative' },
    { name: 'Laomedeia', style: 'Upbeat' },
    { name: 'Achernar', style: 'Soft' },
    { name: 'Alnilam', style: 'Firm' },
    { name: 'Schedar', style: 'Even' },
    { name: 'Gacrux', style: 'Mature' },
    { name: 'Pulcherrima', style: 'Forward' },
    { name: 'Achird', style: 'Friendly' },
    { name: 'Zubenelgenubi', style: 'Casual' },
    { name: 'Vindemiatrix', style: 'Gentle' },
    { name: 'Sadachbia', style: 'Lively' },
    { name: 'Sadaltager', style: 'Knowledgeable' },
    { name: 'Sulafat', style: 'Warm' },
  ];
  const GEMINI_VOICE_NAMES = new Set(GEMINI_VOICE_CATALOG.map((v) => v.name));

  // Default voice assignments for agents that don't have an entry yet.
  // This is how a newly-spawned sub-agent gets a voice without any extra
  // setup. We skip Charon (reserved for main) so new agents always sound
  // distinct from the main voice.
  const NEW_AGENT_VOICE_POOL = [
    'Kore', 'Aoede', 'Leda', 'Alnilam', 'Puck',
    'Fenrir', 'Laomedeia', 'Achird', 'Sulafat', 'Vindemiatrix',
  ];

  function readVoicesFile(): Record<string, { voice_id?: string; gemini_voice?: string; name?: string }> {
    try {
      return JSON.parse(fs.readFileSync(WARROOM_VOICES_PATH, 'utf-8'));
    } catch {
      return {};
    }
  }

  function writeVoicesFile(obj: Record<string, unknown>) {
    fs.writeFileSync(WARROOM_VOICES_PATH, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  }

  function pickDefaultGeminiVoice(used: Set<string>): string {
    for (const v of NEW_AGENT_VOICE_POOL) {
      if (!used.has(v)) return v;
    }
    return NEW_AGENT_VOICE_POOL[0];
  }

  app.get('/api/warroom/voices', (c) => {
    const configured = readVoicesFile();
    // Return one row per known agent. Agents missing from voices.json get
    // a default Gemini voice suggestion from the pool so the UI can show
    // something reasonable without requiring the user to save first.
    const knownAgents = ['main', ...listAgentIds().filter((id) => id !== 'main')];
    const usedGeminiVoices = new Set(
      Object.values(configured)
        .map((v) => v && typeof v === 'object' ? (v as { gemini_voice?: string }).gemini_voice : undefined)
        .filter((v): v is string => typeof v === 'string'),
    );
    const rows = knownAgents.map((agent) => {
      const entry = configured[agent] || {};
      let geminiVoice = entry.gemini_voice;
      let isDefault = false;
      if (!geminiVoice) {
        geminiVoice = agent === 'main' ? 'Charon' : pickDefaultGeminiVoice(usedGeminiVoices);
        usedGeminiVoices.add(geminiVoice);
        isDefault = true;
      }
      return {
        agent,
        gemini_voice: geminiVoice,
        voice_id: entry.voice_id || '',
        name: entry.name || '',
        is_default: isDefault,
      };
    });
    return c.json({
      ok: true,
      voices: rows,
      gemini_catalog: GEMINI_VOICE_CATALOG,
    });
  });

  app.post('/api/warroom/voices', async (c) => {
    let body: { updates?: Array<{ agent: string; gemini_voice?: string; voice_id?: string; name?: string }> } = {};
    try { body = await c.req.json(); } catch { /* empty */ }
    const updates = body.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return c.json({ ok: false, error: 'updates must be a non-empty array of {agent, gemini_voice?, voice_id?, name?}' }, 400);
    }

    const configured = readVoicesFile();
    const errors: string[] = [];
    for (const u of updates) {
      if (!u.agent || typeof u.agent !== 'string') {
        errors.push('each update must have an agent id');
        continue;
      }
      const entry = configured[u.agent] || {};
      if (u.gemini_voice !== undefined) {
        if (typeof u.gemini_voice !== 'string' || !GEMINI_VOICE_NAMES.has(u.gemini_voice)) {
          errors.push(`${u.agent}: invalid gemini_voice '${u.gemini_voice}' (must be one of the 30 Gemini voices)`);
          continue;
        }
        entry.gemini_voice = u.gemini_voice;
      }
      if (u.voice_id !== undefined) {
        if (typeof u.voice_id !== 'string') {
          errors.push(`${u.agent}: voice_id must be a string`);
          continue;
        }
        entry.voice_id = u.voice_id;
      }
      if (u.name !== undefined) {
        if (typeof u.name !== 'string') {
          errors.push(`${u.agent}: name must be a string`);
          continue;
        }
        entry.name = u.name;
      }
      configured[u.agent] = entry;
    }
    if (errors.length > 0) {
      return c.json({ ok: false, error: errors.join('; ') }, 400);
    }
    try {
      writeVoicesFile(configured);
      return c.json({ ok: true, voices: configured, applied: false });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // Cooldown guard so rapid /apply hits can't pile up respawns. Each
  // apply kills the Python subprocess; main's respawner kicks in within
  // 300ms. Without a cooldown, three clicks in 400ms queue three
  // sequential SIGTERMs and reset the crash counter spuriously.
  let _lastVoicesApplyMs = 0;
  app.post('/api/warroom/voices/apply', async (c) => {
    const now = Date.now();
    if (now - _lastVoicesApplyMs < 3000) {
      return c.json({
        ok: false,
        error: 'voice config apply cooldown — wait 3s between reloads',
      }, 429);
    }
    _lastVoicesApplyMs = now;
    // Kill the warroom Python subprocess so main's respawn logic in
    // src/index.ts picks up a fresh one that re-reads voices.json.
    // IMPORTANT: we do NOT kickstart the main launchd service here,
    // because that would kill the dashboard process we're currently
    // running inside — the HTTP response would never be delivered.
    try {
      const pids = await findProcessesByPattern('warroom/server.py');
      if (pids.length === 0) {
        return c.json({ ok: false, error: 'no warroom server process found' }, 500);
      }
      for (const pid of pids) killProcess(pid);
      logger.info({ pids }, 'Killed warroom subprocess for voice config reload');
      return c.json({
        ok: true,
        applied: true,
        killed_pids: pids,
        note: 'warroom server will be respawned by the main agent in ~0.5s with fresh voices.json',
      });
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 500);
    }
  });

  // Scheduled tasks
  app.get('/api/tasks', (c) => {
    const tasks = getAllScheduledTasks();
    return c.json({ tasks });
  });

  // Delete a scheduled task
  app.delete('/api/tasks/:id', (c) => {
    const id = c.req.param('id');
    deleteScheduledTask(id);
    return c.json({ ok: true });
  });

  // Edit a scheduled task: prompt, schedule (cron), agent_id, and/or next_run.
  // Returns the updated next_run so the UI can reflect the new firing time
  // without waiting for the 30s poll. `next_run` (epoch seconds) moves a single
  // upcoming fire to a specific date without touching the cron — the schedule
  // resumes normally after that run.
  app.patch('/api/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({})) as {
      prompt?: string;
      schedule?: string;
      agent_id?: string;
      next_run?: number;
    };
    const all = getAllScheduledTasks();
    const existing = all.find((t) => t.id === id);
    if (!existing) return c.json({ ok: false, error: 'task not found' }, 404);

    const patch: { prompt?: string; schedule?: string; nextRun?: number; agentId?: string } = {};
    if (typeof body.prompt === 'string') {
      const trimmed = body.prompt.trim();
      if (!trimmed) return c.json({ ok: false, error: 'prompt cannot be empty' }, 400);
      patch.prompt = trimmed;
    }
    if (typeof body.schedule === 'string' && body.schedule.trim() !== existing.schedule) {
      const cron = body.schedule.trim();
      try {
        patch.nextRun = computeNextRun(cron);
        patch.schedule = cron;
      } catch (err: any) {
        return c.json({ ok: false, error: 'invalid cron: ' + (err?.message || String(err)) }, 400);
      }
    }
    if (typeof body.agent_id === 'string') {
      const agentId = body.agent_id.trim();
      if (!agentId) return c.json({ ok: false, error: 'agent_id cannot be empty' }, 400);
      patch.agentId = agentId;
    }
    // Explicit next_run wins over the schedule-derived one (checked last).
    if (body.next_run !== undefined) {
      const at = body.next_run;
      if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) {
        return c.json({ ok: false, error: 'next_run must be a positive epoch-seconds number' }, 400);
      }
      patch.nextRun = Math.floor(at);
    }

    updateScheduledTask(id, patch);
    const updated = getAllScheduledTasks().find((t) => t.id === id);
    return c.json({ ok: true, task: updated });
  });

  // Pause a scheduled task
  app.post('/api/tasks/:id/pause', (c) => {
    const id = c.req.param('id');
    pauseScheduledTask(id);
    return c.json({ ok: true });
  });

  // Resume a scheduled task
  app.post('/api/tasks/:id/resume', (c) => {
    const id = c.req.param('id');
    resumeScheduledTask(id);
    return c.json({ ok: true });
  });

  // Calendar feed: every scheduled item that lands inside [from, to), one row
  // per occurrence. The persisted next_run is the source of truth for the FIRST
  // occurrence (it may sit in the past — an overdue task shows on the day it was
  // due, flagged `overdue`); later occurrences are projected from the cron.
  // Paused tasks surface their stored next_run only (they won't actually fire),
  // flagged by status so the UI can grey them out.
  app.get('/api/schedule/calendar', (c) => {
    const from = Number(c.req.query('from'));
    const to = Number(c.req.query('to'));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      return c.json({ error: 'from/to must be epoch seconds with to > from' }, 400);
    }
    if (to - from > 92 * 24 * 60 * 60) {
      return c.json({ error: 'range too large (max 92 days)' }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const items: Array<{
      id: string;
      occurs_at: number;
      title: string;
      agent_id: string;
      source: string;
      status: string;
      schedule: string;
      overdue: boolean;
      projected: boolean;
    }> = [];

    // A month of an every-30-minutes-on-weekdays cron is ~500 fires, so the old
    // 50 cap blanked the back half of the month with nothing saying why. Bound
    // per task high enough to cover a dense month, bound the payload overall,
    // and tell the UI when either bound actually bit.
    const PER_TASK_LIMIT = 750;
    const TOTAL_LIMIT = 3000;
    const truncatedTasks: string[] = [];

    for (const t of getAllScheduledTasks()) {
      const title = t.prompt.length > 140 ? t.prompt.slice(0, 137) + '…' : t.prompt;
      const base = {
        id: t.id, title, agent_id: t.agent_id, source: t.source,
        status: t.status, schedule: t.schedule,
      };
      if (t.next_run >= from && t.next_run < to) {
        items.push({ ...base, occurs_at: t.next_run, overdue: t.status === 'active' && t.next_run < now, projected: false });
      }
      if (t.status !== 'active') continue;
      // Project recurrences after next_run; skip crons the parser rejects
      // (legacy rows) rather than failing the whole feed.
      try {
        const projectFrom = Math.max(from, t.next_run);
        const runs = projectCronRuns(t.schedule, projectFrom, to, PER_TASK_LIMIT);
        if (runs.length === PER_TASK_LIMIT) truncatedTasks.push(t.id);
        for (const at of runs) {
          if (at === t.next_run) continue;
          items.push({ ...base, occurs_at: at, overdue: false, projected: true });
        }
      } catch { /* unparseable cron — surface next_run only */ }
    }

    items.sort((a, b) => a.occurs_at - b.occurs_at);
    const overTotal = items.length > TOTAL_LIMIT;
    return c.json({
      from,
      to,
      items: overTotal ? items.slice(0, TOTAL_LIMIT) : items,
      truncated: overTotal || truncatedTasks.length > 0,
      truncated_tasks: truncatedTasks,
    });
  });

  // ── Routines (Phase 2, RTN-01/02/04) ─────────────────────────────────
  // A routine IS a scheduled_tasks row with source='routine'; its ordered steps
  // and run history hang off routine_steps/routine_runs (FK CASCADE). These
  // routes mirror the /api/tasks* patterns above and mount behind the same
  // DASHBOARD_TOKEN gate (T-02-07 — no new auth surface). Operator-facing fields
  // carry schedule_text/plain language, never raw cron (RTN-02 / D-06).

  // Validation bounds (V5 — bound untrusted request bodies).
  const ROUTINE_AUTONOMY = new Set(['unattended', 'queue_approval']);
  const ROUTINE_ON_ERROR = new Set(['continue', 'stop']);
  const MAX_ROUTINE_STEPS = 50;

  // Coerce an untrusted request-body step list into validated RoutineStepInput
  // rows, assigning step_order by position. Returns null (with a reason) when
  // the list is empty or malformed so the route can 400. agent_id is validated
  // by saveRoutineSteps' callers via the roster; here we keep the operator's
  // chosen teammate verbatim (the draft assembler already coerced unknown ids).
  const buildRoutineSteps = (
    raw: unknown,
  ): { steps: RoutineStepInput[] } | { error: string } => {
    if (!Array.isArray(raw) || raw.length === 0) {
      return { error: 'a routine needs at least one step' };
    }
    if (raw.length > MAX_ROUTINE_STEPS) {
      return { error: `too many steps (max ${MAX_ROUTINE_STEPS})` };
    }
    const validAgents = new Set(['main', ...listAgentIds()]);
    const steps: RoutineStepInput[] = [];
    for (let i = 0; i < raw.length; i++) {
      const entry = raw[i];
      if (!entry || typeof entry !== 'object') {
        return { error: `step ${i + 1} is malformed` };
      }
      const s = entry as Record<string, unknown>;
      const action = typeof s.action === 'string' ? s.action.trim().slice(0, 2000) : '';
      if (!action) return { error: `step ${i + 1} has no action` };
      const rawAgent = typeof s.agent_id === 'string' ? s.agent_id : '';
      const agent_id = validAgents.has(rawAgent) ? rawAgent : 'main';
      const onErr = typeof s.on_error === 'string' ? s.on_error : 'continue';
      if (!ROUTINE_ON_ERROR.has(onErr)) {
        return { error: `step ${i + 1} on_error must be 'continue' or 'stop'` };
      }
      steps.push({ step_order: i, action, agent_id, on_error: onErr });
    }
    return { steps };
  };

  // Enrich a routine row for the operator list/detail. Renders the stored cron
  // as `schedule_text` would (the row label is plain-language) but never leaks
  // raw cron as the primary field — `schedule` stays available for the advanced
  // (cron) escape hatch only.
  const enrichRoutine = (t: ReturnType<typeof getAllScheduledTasks>[number]) => ({
    id: t.id,
    name: t.prompt,
    schedule: t.schedule,
    next_run: t.next_run,
    last_run: t.last_run,
    last_status: t.last_status,
    status: t.status,
    autonomy: t.autonomy,
    project_id: t.project_id,
    created_at: t.created_at,
    steps: getRoutineSteps(t.id),
    last_outcome: getLastRoutineOutcome(t.id),
  });

  // Validate an incoming project_id field. Returns { project_id } on success
  // (null when unscoped / detaching) or { error } when the id names no project.
  // Accepts null/'' as "no project" so the operator can clear the scope.
  const resolveProjectId = (raw: unknown): { project_id: string | null } | { error: string } => {
    if (raw === undefined || raw === null || raw === '') return { project_id: null };
    if (typeof raw !== 'string') return { error: 'project_id must be a string or null' };
    if (!getProject(raw)) return { error: 'Unknown project: ' + raw };
    return { project_id: raw };
  };

  const listRoutines = () => getAllScheduledTasks().filter((t) => t.source === 'routine');

  // List routines.
  app.get('/api/routines', (c) => {
    const routines = listRoutines().map(enrichRoutine);
    return c.json({ routines });
  });

  // Draft a routine from a plain-language description. D-05: this writes NO
  // rows — it only runs the server-side assembler and returns JSON. The browser
  // can't call runAgent (scrubbed SDK env), so assembly lives server-side here.
  app.post('/api/routines/draft', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { description?: unknown };
    const description = typeof body.description === 'string' ? body.description : '';
    try {
      const draft = await assembleRoutineDraft(description);
      return c.json(draft);
    } catch (err: any) {
      // An invalid assembled cron surfaces here — return a friendly 400, not a
      // 500. Nothing was persisted.
      return c.json({ error: 'could not assemble routine: ' + (err?.message || String(err)) }, 400);
    }
  });

  // Run a routine now (RTN-04). Reuses the scheduler's ONE-claim mechanism via
  // triggerRoutineRun, which itself does the single claimDueTask + runningTaskIds
  // guard — so a manual run and a scheduled tick can never double-fire. Returns
  // 409 when the routine can't be claimed (already running / not found / paused).
  app.post('/api/routines/:id/run', (c) => {
    const id = c.req.param('id');
    const task = listRoutines().find((t) => t.id === id);
    if (!task) return c.json({ ok: false, error: 'already running or not runnable' }, 409);
    let nextRun: number;
    try {
      nextRun = computeNextRun(task.schedule);
    } catch (err: any) {
      return c.json({ ok: false, error: 'invalid cron: ' + (err?.message || String(err)) }, 400);
    }
    // triggerRoutineRun returns false if the claim is lost (already running) —
    // the SINGLE claim path. Never claim here too.
    if (!triggerRoutineRun(task, nextRun)) {
      return c.json({ ok: false, error: 'already running' }, 409);
    }
    return c.json({ ok: true });
  });

  // Routine detail: row + ordered steps + recent run history.
  app.get('/api/routines/:id', (c) => {
    const id = c.req.param('id');
    const task = listRoutines().find((t) => t.id === id);
    if (!task) return c.json({ error: 'routine not found' }, 404);
    return c.json({
      routine: enrichRoutine(task),
      steps: getRoutineSteps(id),
      runs: getRoutineRuns(id),
    });
  });

  // Create a routine. Validates cron (computeNextRun), autonomy + on_error
  // enums, and the step list before persisting (V5 / T-02-09). source='routine',
  // agent_id='main' — the main loop owns/fires it (A1).
  app.post('/api/routines', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: unknown;
      schedule?: unknown;
      autonomy?: unknown;
      project_id?: unknown;
      steps?: unknown;
    };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ ok: false, error: 'name required' }, 400);

    const schedule = typeof body.schedule === 'string' ? body.schedule.trim() : '';
    if (!schedule) return c.json({ ok: false, error: 'schedule required' }, 400);
    let nextRun: number;
    try {
      nextRun = computeNextRun(schedule);
    } catch (err: any) {
      return c.json({ ok: false, error: 'invalid cron: ' + (err?.message || String(err)) }, 400);
    }

    const autonomy = typeof body.autonomy === 'string' ? body.autonomy : 'unattended';
    if (!ROUTINE_AUTONOMY.has(autonomy)) {
      return c.json({ ok: false, error: "autonomy must be 'unattended' or 'queue_approval'" }, 400);
    }

    const proj = resolveProjectId(body.project_id);
    if ('error' in proj) return c.json({ ok: false, error: proj.error }, 400);

    const built = buildRoutineSteps(body.steps);
    if ('error' in built) return c.json({ ok: false, error: built.error }, 400);

    const id = crypto.randomUUID();
    createScheduledTask(id, name, schedule, nextRun, 'main', 'routine', autonomy, proj.project_id);
    saveRoutineSteps(id, built.steps);
    const created = listRoutines().find((t) => t.id === id);
    return c.json({ ok: true, routine: created ? enrichRoutine(created) : null }, 201);
  });

  // Edit / reorder a routine (RTN-03). Updates the schedule (re-validating cron)
  // and/or replaces the full ordered step list.
  const editRoutine = async (c: any) => {
    const id = c.req.param('id');
    const existing = listRoutines().find((t) => t.id === id);
    if (!existing) return c.json({ ok: false, error: 'routine not found' }, 404);

    const body = (await c.req.json().catch(() => ({}))) as {
      name?: unknown;
      schedule?: unknown;
      autonomy?: unknown;
      project_id?: unknown;
      steps?: unknown;
    };

    const patch: { prompt?: string; schedule?: string; nextRun?: number; projectId?: string | null } = {};
    if (typeof body.name === 'string') {
      const trimmed = body.name.trim();
      if (!trimmed) return c.json({ ok: false, error: 'name cannot be empty' }, 400);
      patch.prompt = trimmed;
    }
    if (typeof body.schedule === 'string' && body.schedule.trim() !== existing.schedule) {
      const cron = body.schedule.trim();
      try {
        patch.nextRun = computeNextRun(cron);
        patch.schedule = cron;
      } catch (err: any) {
        return c.json({ ok: false, error: 'invalid cron: ' + (err?.message || String(err)) }, 400);
      }
    }
    if (typeof body.autonomy === 'string' && !ROUTINE_AUTONOMY.has(body.autonomy)) {
      return c.json({ ok: false, error: "autonomy must be 'unattended' or 'queue_approval'" }, 400);
    }
    // project_id: only touched when the key is present, so a steps-only or
    // schedule-only edit never clears the scope. Sending null detaches.
    if ('project_id' in body) {
      const proj = resolveProjectId(body.project_id);
      if ('error' in proj) return c.json({ ok: false, error: proj.error }, 400);
      patch.projectId = proj.project_id;
    }

    if (Object.keys(patch).length > 0) updateScheduledTask(id, patch);

    // Steps are optional on an edit — only replace when the client sends them.
    if (body.steps !== undefined) {
      const built = buildRoutineSteps(body.steps);
      if ('error' in built) return c.json({ ok: false, error: built.error }, 400);
      saveRoutineSteps(id, built.steps);
    }

    const updated = listRoutines().find((t) => t.id === id);
    return c.json({ ok: true, routine: updated ? enrichRoutine(updated) : null });
  };
  app.put('/api/routines/:id', editRoutine);
  app.patch('/api/routines/:id', editRoutine);

  // Delete a routine. FK CASCADE wipes its steps + run history.
  app.delete('/api/routines/:id', (c) => {
    const id = c.req.param('id');
    deleteScheduledTask(id);
    return c.json({ ok: true });
  });

  // Pause / resume a routine (RTN-04 on/off — non-destructive, verbatim reuse).
  app.post('/api/routines/:id/pause', (c) => {
    const id = c.req.param('id');
    pauseScheduledTask(id);
    return c.json({ ok: true });
  });
  app.post('/api/routines/:id/resume', (c) => {
    const id = c.req.param('id');
    resumeScheduledTask(id);
    return c.json({ ok: true });
  });

  // ── Mission Control endpoints ────────────────────────────────────────

  app.get('/api/mission/tasks', (c) => {
    const agentId = c.req.query('agent') || undefined;
    const status = c.req.query('status') || undefined;
    const tasks = getMissionTasks(agentId, status);
    return c.json({ tasks });
  });

  app.get('/api/mission/tasks/:id', (c) => {
    const id = c.req.param('id');
    const task = getMissionTask(id);
    if (!task) return c.json({ error: 'Not found' }, 404);
    return c.json({ task });
  });

  // Home daily-loop payload, grouped server-side (operator-product 03-home.md).
  // One call returns the three zones, the needs-you queue, and "Today"
  // suggestions. "Today" is derived from routines due in the next 24h — the
  // only schedule data this process can surface honestly without a
  // calendar/email integration (D2: no unprompted inbox scan). The frontend
  // falls back to starter prompts when both needsYou and today are empty.
  app.get('/api/home/summary', (c) => {
    // ?project=<id> scopes the loop to one project (the project detail view is
    // the Home skeleton scoped down — see specs/operator-product/04-projects.md).
    const projectId = c.req.query('project') || undefined;
    const summary = getHomeSummary(7, projectId);
    const upcoming = getUpcomingScheduledTasks(24 * 60 * 60);
    const today = upcoming.slice(0, 4).map((r) => ({
      id: r.id,
      kind: 'routine' as const,
      text: r.prompt.length > 80 ? r.prompt.slice(0, 77) + '…' : r.prompt,
      when: r.next_run,
    }));
    const status = {
      needsYou: summary.needsYou.length,
      waiting: summary.waiting.length,
      shipped: summary.shipped.length,
      hasAnyWork:
        summary.needsYou.length + summary.onPlate.length +
        summary.waiting.length + summary.shipped.length > 0,
    };
    return c.json({ ...summary, today, status });
  });

  app.post('/api/mission/tasks', async (c) => {
    const body = await c.req.json<{
      title?: string;
      prompt?: string;
      assigned_agent?: string;
      priority?: number;
      attachments?: { path?: string; name?: string }[];
      project_id?: string;
    }>();

    const title = body?.title?.trim();
    let prompt = body?.prompt?.trim();
    const assignedAgent = body?.assigned_agent?.trim() || null;
    const priority = Math.max(0, Math.min(10, body?.priority ?? 0));
    const projectId = body?.project_id?.trim() || null;

    if (!title || title.length > 200) return c.json({ error: 'title required (max 200 chars)' }, 400);
    if (!prompt || prompt.length > 10000) return c.json({ error: 'prompt required (max 10000 chars)' }, 400);
    if (projectId && !getProject(projectId)) return c.json({ error: 'Unknown project: ' + projectId }, 400);

    // Optional file/image attachments uploaded via /api/chat/upload.
    // Appended to the prompt so the target agent knows where they live.
    const resolved = resolveUploadAttachments(body?.attachments);
    if (resolved.error) return c.json({ error: resolved.error }, 400);
    if (resolved.atts.length > 0) {
      prompt = `${prompt}\n\n${attachmentPromptBlock(resolved.atts)}`;
    }

    // Validate agent if provided
    if (assignedAgent) {
      const validAgents = ['main', ...listAgentIds()];
      if (!validAgents.includes(assignedAgent)) {
        return c.json({ error: `Unknown agent: ${assignedAgent}. Valid: ${validAgents.join(', ')}` }, 400);
      }
    }

    const id = crypto.randomBytes(4).toString('hex');
    createMissionTask(id, title, prompt, assignedAgent, 'dashboard', priority, projectId);

    const task = getMissionTask(id);
    return c.json({ task }, 201);
  });

  app.post('/api/mission/tasks/:id/cancel', (c) => {
    const id = c.req.param('id');
    const ok = cancelMissionTask(id);
    return c.json({ ok });
  });

  // Park a task as "waiting on others" with a free-text note of who/what.
  app.post('/api/mission/tasks/:id/block', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ blocked_on?: string }>().catch(() => ({} as { blocked_on?: string }));
    const blockedOn = (body?.blocked_on ?? '').trim();
    if (!blockedOn) return c.json({ error: 'blocked_on required' }, 400);
    if (blockedOn.length > 200) return c.json({ error: 'blocked_on too long (max 200 chars)' }, 400);
    const ok = setMissionTaskBlocked(id, blockedOn);
    if (!ok) return c.json({ error: 'Task not found or not blockable' }, 409);
    return c.json({ ok, task: getMissionTask(id) });
  });

  // Return a blocked task to the queue.
  app.post('/api/mission/tasks/:id/unblock', (c) => {
    const id = c.req.param('id');
    const ok = unblockMissionTask(id);
    if (!ok) return c.json({ error: 'Task not blocked' }, 409);
    return c.json({ ok, task: getMissionTask(id) });
  });

  // Re-run a settled task (completed/failed/blocked/cancelled) — clears the
  // prior outcome and returns it to the queue. Powers the Home "Re-run" action,
  // e.g. retrying a task that only "shipped" because a tool was gated, after the
  // operator grants access. An optional `reply` answers a 'needs_you' task the
  // agent kicked back (a missing path, a decision); it is folded into the prompt
  // so the resumed run sees the operator's answer.
  app.post('/api/mission/tasks/:id/requeue', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const reply = typeof body?.reply === 'string' ? body.reply : undefined;
    const ok = requeueMissionTask(id, reply);
    if (!ok) return c.json({ error: 'Task not found or not re-runnable' }, 409);
    return c.json({ ok, task: getMissionTask(id) });
  });

  // The per-task conversation thread (agent kick-backs + operator answers).
  // Powers the "Show details" full-context view on a blocked-on-you card.
  app.get('/api/mission/tasks/:id/messages', (c) => {
    const id = c.req.param('id');
    return c.json({ messages: getTaskMessages(id) });
  });

  // The task's run history (output versioning): every settled run kept as its
  // own version, so the Shipped card can page through what shipped before a
  // re-run and see the feedback that drove each rework.
  app.get('/api/mission/tasks/:id/runs', (c) => {
    const id = c.req.param('id');
    return c.json({ runs: getMissionTaskRuns(id) });
  });

  // Auto-assign all unassigned tasks. MUST register before /:id/auto-assign
  // so the static path is not captured by the parameterized route.
  app.post('/api/mission/tasks/auto-assign-all', async (c) => {
    if (!killSwitches.isEnabled('MISSION_AUTO_ASSIGN_ENABLED')) {
      return c.json({ error: 'Auto-assign is disabled (MISSION_AUTO_ASSIGN_ENABLED)' }, 503);
    }
    const tasks = getUnassignedMissionTasks();
    if (tasks.length === 0) return c.json({ assigned: 0, results: [] });

    const CONCURRENCY = 5;
    const results: Array<{ id: string; agent: string }> = [];
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const batch = tasks.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(batch.map(async (task) => {
        const agent = await classifyTaskAgent(task.prompt);
        if (agent && assignMissionTask(task.id, agent)) {
          return { id: task.id, agent };
        }
        return null;
      }));
      for (const r of settled) if (r) results.push(r);
    }
    return c.json({ assigned: results.length, results });
  });

  // Auto-assign a single task via the shared task router (Haiku → Gemini → main)
  app.post('/api/mission/tasks/:id/auto-assign', async (c) => {
    if (!killSwitches.isEnabled('MISSION_AUTO_ASSIGN_ENABLED')) {
      return c.json({ error: 'Auto-assign is disabled (MISSION_AUTO_ASSIGN_ENABLED)' }, 503);
    }
    const id = c.req.param('id');
    const task = getMissionTask(id);
    if (!task) return c.json({ error: 'Not found' }, 404);
    if (task.assigned_agent) return c.json({ error: 'Already assigned' }, 400);

    const agent = await classifyTaskAgent(task.prompt);
    if (!agent) return c.json({ error: 'Classification failed' }, 500);

    assignMissionTask(id, agent);
    return c.json({ ok: true, assigned_agent: agent });
  });

  app.patch('/api/mission/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const task = getMissionTask(id);
    if (!task) return c.json({ error: 'Not found' }, 404);

    const body = await c.req.json<{ assigned_agent?: string; project_id?: string | null }>();

    // Attach/detach project (null detaches). Works for any task status so
    // completed tasks can be pulled into a project retroactively.
    if (body && 'project_id' in body) {
      const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : null;
      if (projectId && !getProject(projectId)) return c.json({ error: 'Unknown project' }, 400);
      const ok = setMissionTaskProject(id, projectId || null);
      if (!body.assigned_agent) return c.json({ ok });
      if (!ok) return c.json({ ok: false }, 400);
    }

    const newAgent = body?.assigned_agent?.trim();
    if (!newAgent) return c.json({ error: 'assigned_agent or project_id required' }, 400);
    const validAgents = ['main', ...listAgentIds()];
    if (!validAgents.includes(newAgent)) return c.json({ error: 'Unknown agent' }, 400);
    const ok = reassignMissionTask(id, newAgent);
    // A silent {ok:false} 200 here used to make the UI toast "Assigned" while
    // nothing moved. Fail loudly instead so the client can say why.
    if (!ok) return c.json({ error: 'Task not reassignable in its current status' }, 409);
    return c.json({ ok, task: getMissionTask(id) });
  });

  app.delete('/api/mission/tasks/:id', (c) => {
    const id = c.req.param('id');
    const ok = deleteMissionTask(id);
    return c.json({ ok });
  });

  app.get('/api/mission/history', (c) => {
    const limit = parseInt(c.req.query('limit') || '30', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    return c.json(getMissionTaskHistory(limit, offset));
  });

  // ── Projects (group mission tasks, track to completion) ─────────────

  app.get('/api/projects', (c) => {
    return c.json({ projects: getAllProjects() });
  });

  app.post('/api/projects', async (c) => {
    const body = await c.req.json<{ name?: string; description?: string; type?: string; task_ids?: string[] }>();
    const name = body?.name?.trim();
    const description = body?.description?.trim() || null;
    if (!name || name.length > 120) return c.json({ error: 'name required (max 120 chars)' }, 400);
    const type = ['client', 'internal', 'hiring', 'other'].includes(body?.type ?? '')
      ? (body!.type as 'client' | 'internal' | 'hiring' | 'other')
      : 'internal';

    const id = crypto.randomBytes(4).toString('hex');
    createProject(id, name, description, type);

    // Optionally pull existing tasks into the new project
    for (const taskId of body?.task_ids ?? []) {
      if (typeof taskId === 'string' && taskId) setMissionTaskProject(taskId, id);
    }

    return c.json({ project: getProject(id) }, 201);
  });

  app.get('/api/projects/:id', (c) => {
    const id = c.req.param('id');
    const project = getProject(id);
    if (!project) return c.json({ error: 'Not found' }, 404);
    const tasks = getProjectTasks(id);
    const tasksWithFiles = tasks.map((t) => ({ ...t, ...collectTaskFiles(t) }));
    return c.json({ project, tasks: tasksWithFiles, files: collectProjectFiles(tasks) });
  });

  app.get('/api/projects/:id/files/download', (c) => {
    const id = c.req.param('id');
    const project = getProject(id);
    if (!project) return c.json({ error: 'Not found' }, 404);
    const rawPath = c.req.query('path');
    if (!rawPath) return c.json({ error: 'path required' }, 400);

    const tasks = getProjectTasks(id);
    const allowed = new Set(allowedProjectDownloadPaths(tasks));
    const resolved = path.resolve(rawPath);
    if (!allowed.has(resolved)) return c.json({ error: 'File not part of this project' }, 403);
    if (!fs.existsSync(resolved)) return c.json({ error: 'File not found on disk' }, 404);

    const data = fs.readFileSync(resolved);
    const name = path.basename(resolved);
    return new Response(data, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
      },
    });
  });

  app.patch('/api/projects/:id', async (c) => {
    const id = c.req.param('id');
    if (!getProject(id)) return c.json({ error: 'Not found' }, 404);
    const body = await c.req.json<{ name?: string; description?: string | null; status?: string; type?: string }>();

    const fields: { name?: string; description?: string | null; status?: 'active' | 'completed' | 'closed'; type?: 'client' | 'internal' | 'hiring' | 'other' } = {};
    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name || name.length > 120) return c.json({ error: 'name must be 1-120 chars' }, 400);
      fields.name = name;
    }
    if (body && 'description' in body) {
      fields.description = typeof body.description === 'string' ? body.description.trim() || null : null;
    }
    if (typeof body?.type === 'string') {
      if (!['client', 'internal', 'hiring', 'other'].includes(body.type)) {
        return c.json({ error: 'type must be client, internal, hiring, or other' }, 400);
      }
      fields.type = body.type as 'client' | 'internal' | 'hiring' | 'other';
    }
    if (typeof body?.status === 'string') {
      if (!['active', 'completed', 'closed'].includes(body.status)) {
        return c.json({ error: 'status must be active, completed, or closed' }, 400);
      }
      fields.status = body.status as 'active' | 'completed' | 'closed';
    }

    const ok = updateProject(id, fields);
    return c.json({ ok, project: getProject(id) });
  });

  app.delete('/api/projects/:id', (c) => {
    const id = c.req.param('id');
    const ok = deleteProject(id);
    return c.json({ ok });
  });

  // ── Live Meetings (Pika meet-cli wrapper) ──────────────────────────
  // Three endpoints that shell out to dist/meet-cli.js. Actual join/leave
  // logic lives there so Telegram triggers and the dashboard go through
  // the same code path.

  const MEET_CLI = path.join(PROJECT_ROOT, 'dist', 'meet-cli.js');
  const MEET_URL_RE = /^https:\/\/meet\.google\.com\/[a-z0-9-]+/i;

  // Run meet-cli as a subprocess and parse its final JSON line from stdout.
  async function runMeetCli(args: string[], timeoutMs: number): Promise<{
    ok: boolean;
    data: Record<string, unknown>;
    stderr: string;
    code: number;
  }> {
    if (!fs.existsSync(MEET_CLI)) {
      return { ok: false, data: { error: 'meet-cli not built; run npm run build' }, stderr: '', code: -1 };
    }
    const { spawn } = await import('child_process');
    const proc = spawn(process.execPath, [MEET_CLI, ...args], {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    return await new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch { /* ok */ }
      }, timeoutMs);

      proc.on('close', (code: number | null) => {
        clearTimeout(killTimer);
        // meet-cli emits one JSON object on its final stdout line
        const lines = stdout.trim().split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]) as Record<string, unknown>;
            resolve({ ok: parsed.ok === true, data: parsed, stderr, code: code ?? 1 });
            return;
          } catch { /* try earlier line */ }
        }
        resolve({ ok: false, data: { error: 'no parseable output from meet-cli', stderr: stderr.slice(-400) }, stderr, code: code ?? 1 });
      });
    });
  }

  app.get('/api/meet/sessions', (c) => {
    const active = listActiveMeetSessions();
    const recent = listRecentMeetSessions(15).filter(
      (s: MeetSession) => s.status !== 'joining' && s.status !== 'live',
    );
    return c.json({ ok: true, active, recent });
  });

  app.post('/api/meet/join', async (c) => {
    let body: { agent?: string; meet_url?: string; auto_brief?: boolean; context?: string } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }

    const agent = body.agent?.trim();
    const meetUrl = body.meet_url?.trim();
    const autoBrief = body.auto_brief !== false; // default true
    const context = body.context?.trim();

    if (!agent) return c.json({ ok: false, error: 'agent required' }, 400);
    if (!meetUrl || !MEET_URL_RE.test(meetUrl)) {
      return c.json({ ok: false, error: 'invalid meet_url (must match https://meet.google.com/...)' }, 400);
    }
    const validAgents = new Set(['main', ...listAgentIds()]);
    if (!validAgents.has(agent)) {
      return c.json({ ok: false, error: `unknown agent: ${agent}` }, 400);
    }

    const args = ['join', '--agent', agent, '--meet-url', meetUrl];
    if (autoBrief) args.push('--auto-brief');
    if (context) args.push('--context', context);

    // Budget: auto-brief (up to 75s) + Pika join (up to 120s) + slack = 220s
    const result = await runMeetCli(args, 220_000);
    return c.json(result.data, result.ok ? 200 : 500);
  });

  app.post('/api/meet/join-daily', async (c) => {
    let body: { agent?: string; mode?: string; auto_brief?: boolean; context?: string; ttl_sec?: number } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }

    const agent = body.agent?.trim();
    const mode = body.mode?.trim() || 'direct';
    const autoBrief = body.auto_brief !== false; // default true
    const context = body.context?.trim();
    const ttlSec = body.ttl_sec;

    if (!agent) return c.json({ ok: false, error: 'agent required' }, 400);
    if (mode !== 'direct' && mode !== 'auto') {
      return c.json({ ok: false, error: 'mode must be direct or auto' }, 400);
    }
    const validAgents = new Set(['main', ...listAgentIds()]);
    if (!validAgents.has(agent)) {
      return c.json({ ok: false, error: `unknown agent: ${agent}` }, 400);
    }

    const args = ['join-daily', '--agent', agent, '--mode', mode];
    if (autoBrief) args.push('--auto-brief');
    if (context) args.push('--context', context);
    if (typeof ttlSec === 'number' && ttlSec > 0) args.push('--ttl-sec', String(ttlSec));

    // Budget: briefing (~75s) + room creation (~2s) + agent spawn (~3s) = ~90s
    const result = await runMeetCli(args, 120_000);
    return c.json(result.data, result.ok ? 200 : 500);
  });

  app.post('/api/meet/leave', async (c) => {
    let body: { session_id?: string } = {};
    try { body = await c.req.json(); } catch { /* empty body */ }
    const sessionId = body.session_id?.trim();
    if (!sessionId) return c.json({ ok: false, error: 'session_id required' }, 400);
    if (!getMeetSession(sessionId)) {
      return c.json({ ok: false, error: 'session not found' }, 404);
    }
    const result = await runMeetCli(['leave', '--session-id', sessionId], 45_000);
    return c.json(result.data, result.ok ? 200 : 500);
  });

  // Memory stats
  app.get('/api/memories', (c) => {
    const chatId = c.req.query('chatId') || '';
    const stats = getDashboardMemoryStats(chatId);
    const fading = getDashboardLowSalienceMemories(chatId, 10);
    const topAccessed = getDashboardTopAccessedMemories(chatId, 5);
    const timeline = getDashboardMemoryTimeline(chatId, 30);
    const consolidations = getDashboardConsolidations(chatId, 5);
    return c.json({ stats, fading, topAccessed, timeline, consolidations });
  });

  // Memory list (for drill-down drawer)
  app.get('/api/memories/pinned', (c) => {
    const chatId = c.req.query('chatId') || '';
    const memories = getDashboardPinnedMemories(chatId);
    return c.json({ memories });
  });

  app.get('/api/memories/list', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const sortBy = (c.req.query('sort') || 'importance') as 'importance' | 'salience' | 'recent';
    const result = getDashboardMemoriesList(chatId, limit, offset, sortBy);
    return c.json(result);
  });

  // ---------------------------------------------------------------------------
  // Operator Memory surface (Phase 6, MEM-01/MEM-02/D-04/D-08/D-09).
  // GET is read-only; POST/PATCH/DELETE inherit the query-token gate (:432),
  // the DASHBOARD_MUTATIONS_ENABLED kill switch on non-GET (:449), and the
  // CSRF Origin allowlist (:495) from app middleware. NO per-route auth here
  // (RESEARCH "Don't Hand-Roll"). All SQL is delegated to db.ts seams.
  // ---------------------------------------------------------------------------

  // GET /api/memory — operator-surface rows, provenance-tagged, groupable by
  // category. Advertises the email tag only when an email-sourced row exists
  // (D-05 honest coverage).
  app.get('/api/memory', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const rows = getMemoriesForOperatorSurface(chatId);
    const memories = rows.map((r) => ({
      id: r.id,
      summary: r.summary,
      category: r.category,
      confirmed: r.confirmed === 1,
      provenance: deriveProvenance(r),
      importance: r.importance,
      created_at: r.created_at,
    }));
    return c.json({
      memories,
      categories: OPERATOR_FACT_CATEGORIES,
      provenanceLabels: provenanceLabelsForSurface(rows),
    });
  });

  // POST /api/memory — Add a fact (D-09). Stores confirmed=1, source='you-told-me'.
  app.post('/api/memory', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { summary?: string; category?: string };
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    if (!summary) return c.json({ ok: false, error: 'summary required' }, 400);
    const category = body.category;
    if (!OPERATOR_FACT_CATEGORIES.includes(category as OperatorFactCategory)) {
      return c.json({ ok: false, error: 'invalid category' }, 400);
    }
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const id = addOperatorFact(chatId, summary, category as OperatorFactCategory);
    return c.json({ ok: true, id, memory: { id } }, 201);
  });

  // PATCH /api/memory/:id — Edit a fact's summary and/or category.
  app.patch('/api/memory/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
    const body = await c.req.json().catch(() => ({})) as { summary?: string; category?: string };
    if (typeof body.category === 'string' &&
        !OPERATOR_FACT_CATEGORIES.includes(body.category as OperatorFactCategory)) {
      return c.json({ ok: false, error: 'invalid category' }, 400);
    }
    const fields: { summary?: string; category?: string } = {};
    if (typeof body.summary === 'string') {
      const trimmed = body.summary.trim();
      if (!trimmed) return c.json({ ok: false, error: 'summary cannot be empty' }, 400);
      fields.summary = trimmed;
    }
    if (typeof body.category === 'string') fields.category = body.category;
    const changed = updateOperatorFact(id, fields);
    if (!changed) return c.json({ ok: false, error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  // DELETE /api/memory/:id — tombstone FIRST (D-08, Pitfall 6 fail-safe), then
  // remove the row. 404 when the memory does not exist.
  app.delete('/api/memory/:id', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
    const tomb = writeTombstoneForMemory(id);
    if (!tomb) return c.json({ ok: false, error: 'not found' }, 404);
    const changed = deleteMemory(id);
    return c.json({ ok: changed });
  });

  // POST /api/memory/:id/confirm — promote an unconfirmed fact (D-04).
  // Status-guarded: a double-click flips nothing the second time (no-op).
  app.post('/api/memory/:id/confirm', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
    const changed = confirmMemory(id);
    return c.json({ ok: changed });
  });

  // System health
  app.get('/api/health', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const sessionId = getSession(chatId);
    let contextPct = 0;
    let turns = 0;
    let compactions = 0;
    let sessionAge = '-';

    if (sessionId) {
      const summary = getSessionTokenUsage(sessionId);
      if (summary) {
        turns = summary.turns;
        compactions = summary.compactions;
        const contextTokens = (summary.lastContextTokens || 0) + (summary.lastCacheRead || 0);
        contextPct = contextTokens > 0 ? Math.round((contextTokens / CONTEXT_LIMIT) * 100) : 0;
        const ageSec = Math.floor(Date.now() / 1000) - summary.firstTurnAt;
        if (ageSec < 3600) sessionAge = Math.floor(ageSec / 60) + 'm';
        else if (ageSec < 86400) sessionAge = Math.floor(ageSec / 3600) + 'h';
        else sessionAge = Math.floor(ageSec / 86400) + 'd';
      }
    }

    // War-room visibility: surface counters an operator needs to spot a
    // degraded system without using the dashboard. Cheap reads only —
    // /api/health gets hit on a polling interval from the UI.
    let warroomTextOpenMeetings = 0;
    try {
      warroomTextOpenMeetings = getOpenTextMeetingIds(undefined, undefined).length;
    } catch { /* DB read failure is non-fatal for health */ }
    // Voice subprocess liveness — best-effort process check. Not exposed
    // as a primary health metric until the subprocess module exports a
    // proper accessor.

    return c.json({
      contextPct,
      turns,
      compactions,
      sessionAge,
      model: agentDefaultModel || 'sonnet-4-6',
      telegramConnected: getTelegramConnected(),
      waConnected: WHATSAPP_ENABLED,
      slackConnected: !!SLACK_USER_TOKEN,
      // Surface kill-switch state so an operator who just flipped a flag
      // in .env can verify from outside the process that it took effect.
      killSwitches: killSwitches.snapshot(),
      // Counter of refusals since boot. Bumps every time a switch
      // intercepted an LLM spawn or a mutation — visible proof the gates
      // are actually firing during an incident.
      killSwitchRefusals: killSwitches.refusalCounts(),
      // War-room counters for incident triage.
      warroom: {
        textOpenMeetings: warroomTextOpenMeetings,
      },
      // Memory ingestion can pause itself when Gemini returns 429. Without
      // this surfaced, ingestion is silently dead and conversations stop
      // generating long-term memories with no visible signal.
      memoryIngestion: getIngestionQuotaStatus(),
    });
  });

  // Token / cost stats
  app.get('/api/tokens', (c) => {
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const stats = getDashboardTokenStats(chatId);
    const costTimeline = getDashboardCostTimeline(chatId, 30);
    const recentUsage = getDashboardRecentTokenUsage(chatId, 20);
    return c.json({ stats, costTimeline, recentUsage });
  });

  // Bot info (name, PID, chatId) — reads dynamically from state
  app.get('/api/info', (c) => {
    const chatId = c.req.query('chatId') || '';
    const info = getBotInfo();
    return c.json({
      botName: info.name || 'ClaudeClaw',
      botUsername: info.username || '',
      pid: process.pid,
      chatId: chatId || null,
    });
  });

  // ── Agent endpoints ──────────────────────────────────────────────────

  // List all configured agents with status
  app.get('/api/agents', (c) => {
    const agentIds = listAgentIds();
    const agents = agentIds.map((id) => {
      try {
        const config = loadAgentConfig(id);
        // Check if agent process is alive via PID file
        const pidFile = path.join(STORE_DIR, `agent-${id}.pid`);
        let running = false;
        if (fs.existsSync(pidFile)) {
          try {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
            running = isProcessAlive(pid);
          } catch { /* process not running */ }
        }
        const stats = getAgentTokenStats(id);
        const mainOverride = id === 'main' ? getMainModelOverride() : undefined;
        return {
          id,
          name: config.name,
          description: config.description,
          model: mainOverride ?? config.model ?? 'claude-opus-4-6',
          slackChannel: config.slackChannel ?? '',
          running,
          // No bot token = no standalone process; reachable only via
          // delegation through the main bot (@agent: / mission tasks).
          delegationOnly: !config.botToken,
          // Operator paused this teammate: no new mission tasks, no routines.
          paused: isAgentPaused(id),
          todayTurns: stats.todayTurns,
          todayCost: stats.todayCost,
          // Cache-bust token for <img> URLs across all surfaces. Derived
          // from filesystem mtime+size of the resolved avatar — changes
          // the moment a user upload or Telegram fetch lands.
          avatar_etag: avatarEtagForId(id),
        };
      } catch {
        return { id, name: id, description: '', model: 'unknown', slackChannel: '', running: false, delegationOnly: false, paused: isAgentPaused(id), todayTurns: 0, todayCost: 0, avatar_etag: avatarEtagForId(id) };
      }
    });

    // Include main bot too
    const mainPidFile = path.join(STORE_DIR, 'claudeclaw.pid');
    let mainRunning = false;
    if (fs.existsSync(mainPidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(mainPidFile, 'utf-8').trim(), 10);
        mainRunning = isProcessAlive(pid);
      } catch { /* not running */ }
    }
    const mainStats = getAgentTokenStats('main');
    const allAgents = [
      { id: 'main', name: 'Main', description: 'Primary ClaudeClaw bot', model: getMainModelOverride() ?? 'claude-opus-4-6', slackChannel: '', running: mainRunning, delegationOnly: false, paused: isAgentPaused('main'), todayTurns: mainStats.todayTurns, todayCost: mainStats.todayCost, avatar_etag: avatarEtagForId('main') },
      ...agents,
    ];

    return c.json({ agents: allAgents });
  });

  // Team roster rollup (operator-product spec 05-team.md). Per-teammate live
  // activity + workload + paused state, keyed by agent id. The Team page merges
  // this onto /api/agents; agents absent from the map have no active work.
  app.get('/api/team/roster', (c) => {
    return c.json({ roster: getTeamRoster() });
  });

  // Pause a teammate (non-destructive): the scheduler stops assigning it new
  // mission tasks and stops firing its routines until it resumes. The standalone
  // service, if any, keeps running — pause halts new autonomous work, not the
  // process (that's the builder's start/stop control).
  app.post('/api/agents/:id/pause', (c) => {
    const agentId = c.req.param('id');
    setAgentPaused(agentId, true);
    return c.json({ ok: true, id: agentId, paused: true });
  });

  app.post('/api/agents/:id/resume', (c) => {
    const agentId = c.req.param('id');
    setAgentPaused(agentId, false);
    return c.json({ ok: true, id: agentId, paused: false });
  });

  // Agent-specific recent conversation
  app.get('/api/agents/:id/conversation', (c) => {
    const agentId = c.req.param('id');
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const limit = parseInt(c.req.query('limit') || '4', 10);
    const turns = getAgentRecentConversation(agentId, chatId, limit);
    return c.json({ turns });
  });

  // Agent-specific tasks
  app.get('/api/agents/:id/tasks', (c) => {
    const agentId = c.req.param('id');
    const tasks = getAllScheduledTasks(agentId);
    return c.json({ tasks });
  });

  // Agent-specific token stats
  app.get('/api/agents/:id/tokens', (c) => {
    const agentId = c.req.param('id');
    const stats = getAgentTokenStats(agentId);
    return c.json(stats);
  });

  // Update ALL agent models at once. MUST be registered before the
  // parameterized /:id variant below: Hono matches routes first-win, so
  // if this came second, a PATCH /api/agents/model would match the
  // parameterized route with id="model" and the bulk endpoint would be
  // unreachable (the dashboard "Set all" button was silently a no-op).
  app.patch('/api/agents/model', async (c) => {
    const body = await c.req.json<{ model?: string }>();
    const model = body?.model?.trim();
    if (!model) return c.json({ error: 'model required' }, 400);

    if (!isValidClaudeModel(model)) return c.json({ error: 'Invalid model' }, 400);

    const agentIds = listAgentIds();
    const updated: string[] = [];
    const restartRequired: string[] = [];
    for (const id of agentIds) {
      try {
        setAgentModel(id, model);
        updated.push(id);
        // Yaml is now updated, but a sub-agent's already-running process
        // froze its model at startup. Flag for the UI to offer a restart.
        if (id !== 'main') restartRequired.push(id);
      } catch {}
    }
    return c.json({ ok: true, model, updated, restartRequired });
  });

  // Update agent model
  app.patch('/api/agents/:id/model', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json<{ model?: string }>();
    const model = body?.model?.trim();
    if (!model) return c.json({ error: 'model required' }, 400);

    if (!isValidClaudeModel(model)) return c.json({ error: 'Invalid model' }, 400);

    try {
      if (agentId === 'main') {
        // Main applies in-memory immediately — no restart needed.
        const { setMainModelOverride } = await import('./bot.js');
        setMainModelOverride(model);
        return c.json({ ok: true, agent: agentId, model, restartRequired: false });
      }
      // Sub-agents read agentDefaultModel into config.ts module state once
      // at process startup. Yaml change takes effect only after the agent
      // process restarts. We don't auto-restart because that would kill any
      // in-flight mission task or Telegram turn — surface the requirement
      // so the UI can prompt deliberately.
      setAgentModel(agentId, model);
      return c.json({ ok: true, agent: agentId, model, restartRequired: true });
    } catch (err) {
      return c.json({ error: 'Failed to update model' }, 500);
    }
  });

  // Update agent display name / description (agent.yaml for sub-agents).
  app.patch('/api/agents/:id/profile', async (c) => {
    const agentId = c.req.param('id');
    if (!AGENT_ID_RE.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    if (agentId === 'main') {
      return c.json({ error: 'main agent has no agent.yaml; edit CLAUDE.md for persona name' }, 400);
    }
    if (!agentExists(agentId)) return c.json({ error: 'agent not found' }, 404);

    const body = await c.req.json().catch(() => null) as { name?: string; description?: string } | null;
    if (!body || (body.name === undefined && body.description === undefined)) {
      return c.json({ error: 'expected { name?: string, description?: string }' }, 400);
    }

    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const description = typeof body.description === 'string' ? body.description.trim() : undefined;
    if (name !== undefined && !name) return c.json({ error: 'name cannot be empty' }, 400);
    if (name !== undefined && name.length > 80) return c.json({ error: 'name max 80 chars' }, 400);
    if (description !== undefined && description.length > 500) {
      return c.json({ error: 'description max 500 chars' }, 400);
    }

    try {
      setAgentProfile(agentId, { name, description });
      refreshWarRoomRoster();
      insertAuditLog({ agentId, chatId: '', action: 'edit_agent_profile', detail: JSON.stringify({ name, description }), blocked: false });
      const config = loadAgentConfig(agentId);
      return c.json({
        ok: true,
        agent: agentId,
        name: config.name,
        description: config.description,
      });
    } catch (err: any) {
      return c.json({ error: err?.message || 'Failed to update profile' }, 500);
    }
  });

  // Set or clear the Slack channel that routes to this agent (agent.yaml
  // slack_channel key). An empty string clears the key. The channel→agent
  // map is built once at createSlackBot startup, so the bot must restart
  // before a change here takes effect — surfaced as restartRequired so the
  // UI can prompt for it.
  app.patch('/api/agents/:id/slack-channel', async (c) => {
    const agentId = c.req.param('id');
    if (!AGENT_ID_RE.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    if (agentId === 'main') {
      return c.json({ error: 'main agent has no agent.yaml; set the main bot channel via .env' }, 400);
    }
    if (!agentExists(agentId)) return c.json({ error: 'agent not found' }, 404);

    const body = await c.req.json().catch(() => null) as { channel?: string } | null;
    if (!body || typeof body.channel !== 'string') {
      return c.json({ error: 'expected { channel: string }' }, 400);
    }

    // A non-empty channel must look like a Slack channel/group id. Empty
    // clears routing.
    const channel = body.channel.trim();
    if (channel && !SLACK_CHANNEL_RE.test(channel)) {
      return c.json({ error: 'invalid Slack channel id (expected e.g. C0XXXX or G0XXXX)' }, 400);
    }

    try {
      setAgentSlackChannel(agentId, channel);
      insertAuditLog({ agentId, chatId: '', action: 'edit_agent_slack_channel', detail: JSON.stringify({ channel }), blocked: false });
      return c.json({ ok: true, agent: agentId, slackChannel: channel, restartRequired: true });
    } catch (err: any) {
      logger.error({ err, agentId }, 'Failed to update agent slack_channel');
      return c.json({ error: err?.message || 'Failed to update Slack channel' }, 500);
    }
  });

  // ── Agent file editor (CLAUDE.md + agent.yaml) ──────────────────────
  // Lets the dashboard edit each agent's persona (CLAUDE.md) and config
  // (agent.yaml) directly. CLAUDE.md hot-reloads per turn (the Agent SDK
  // re-reads it via settingSources: ['project']) so a save takes effect
  // on the very next turn without a restart. agent.yaml is loaded once
  // at process startup, so editing it returns restartRequired=true and
  // the UI surfaces a one-click restart.
  //
  // Sensitive fields in agent.yaml (notably the bot token) are redacted
  // to `***REDACTED***` on GET and restored from disk on PUT if the
  // client echoes the redacted value back. Means the UI can never leak
  // tokens to a screenshot, and editing other fields doesn't accidentally
  // wipe the token.

  // Lazily-imported to keep the module free of heavyweight YAML parsing
  // unless someone actually edits a file. Same lazy import pattern as the
  // setEnvKey usage at the bottom of this file.
  async function getAtomicWriter() {
    const { atomicEnvWrite } = await import('./env-write.js');
    return atomicEnvWrite;
  }

  // Snapshot the current on-disk content into agent_file_history BEFORE
  // overwriting. Result: every save leaves a versioned trail in SQLite
  // the user can browse and restore from. Pruned to 100 versions per
  // (agent, kind) so the table stays bounded.
  function snapshotPriorVersion(
    agentId: string,
    kind: AgentFileKind,
    diskPath: string,
  ): void {
    if (!fs.existsSync(diskPath)) return;
    try {
      const prior = fs.readFileSync(diskPath, 'utf-8');
      if (!prior) return;
      const sha = crypto.createHash('sha256').update(prior).digest('hex');
      // Skip if the most recent history row already matches this content
      // (prevents duplicate rows when the user clicks Save without making
      // any changes — which Monaco's onChange wouldn't catch if they
      // typed-and-deleted).
      const recent = listAgentFileHistory(agentId, kind, 1);
      if (recent.length > 0 && recent[0].sha256 === sha) return;
      appendAgentFileHistory(agentId, kind, prior, sha);
      pruneAgentFileHistory(agentId, kind, 100);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err, agentId, kind }, 'failed to snapshot prior file version');
    }
  }

  function loadAgentFiles(agentDir: string): { claudeMd: string; agentYaml: string; agentYamlRedacted: string } {
    const claudePath = path.join(agentDir, 'CLAUDE.md');
    const yamlPath = path.join(agentDir, 'agent.yaml');
    const claudeMd = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, 'utf-8') : '';
    const agentYaml = fs.existsSync(yamlPath) ? fs.readFileSync(yamlPath, 'utf-8') : '';
    // Redact bot_token line so the dashboard never displays it. Most
    // agent.yaml files use telegram_bot_token_env to reference an env
    // var by name (not a literal token), so this is defense-in-depth
    // for any older agent.yaml that still inlines the token.
    const agentYamlRedacted = agentYaml.replace(
      /^(\s*bot_token\s*:\s*)([^\n#]+?)(\s*(?:#.*)?)$/m,
      '$1"***REDACTED***"$3',
    );
    return { claudeMd, agentYaml, agentYamlRedacted };
  }

  // Main is the host process — it has no agents/main/ directory and no
  // agent.yaml (its config lives in .env). Its CLAUDE.md is loaded from
  // CLAUDECLAW_CONFIG/CLAUDE.md (preferred) or PROJECT_ROOT/CLAUDE.md
  // (legacy fallback). The editor exposes only the persona for main.
  function resolveMainClaudeMdPath(): string {
    const external = path.join(CLAUDECLAW_CONFIG, 'CLAUDE.md');
    if (fs.existsSync(external)) return external;
    const repo = path.join(PROJECT_ROOT, 'CLAUDE.md');
    if (fs.existsSync(repo)) return repo;
    // Neither exists — write goes to the external path (the canonical
    // location). Read returns empty.
    return external;
  }

  app.get('/api/agents/:id/files', (c) => {
    const agentId = c.req.param('id');
    if (!/^[a-z0-9_-]+$/i.test(agentId)) return c.json({ error: 'invalid id' }, 400);

    if (agentId === 'main') {
      const mainClaude = resolveMainClaudeMdPath();
      const claudeMd = fs.existsSync(mainClaude) ? fs.readFileSync(mainClaude, 'utf-8') : '';
      return c.json({
        agent_id: 'main',
        claude_md: claudeMd,
        agent_yaml: '',
        bot_token_redacted: false,
        // Tells the UI to hide the Config tab — main has no agent.yaml.
        config_editable: false,
        claude_md_path: mainClaude,
      });
    }

    let agentDir: string;
    try { agentDir = resolveAgentDir(agentId); }
    catch { return c.json({ error: 'agent not found' }, 404); }
    const files = loadAgentFiles(agentDir);
    return c.json({
      agent_id: agentId,
      claude_md: files.claudeMd,
      agent_yaml: files.agentYamlRedacted,
      bot_token_redacted: files.agentYaml !== files.agentYamlRedacted,
      config_editable: true,
    });
  });

  app.put('/api/agents/:id/files/claudemd', async (c) => {
    const agentId = c.req.param('id');
    if (!/^[a-z0-9_-]+$/i.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    const body = await c.req.json().catch(() => null) as { content?: string } | null;
    if (!body || typeof body.content !== 'string') {
      return c.json({ error: 'expected { content: string }' }, 400);
    }
    if (body.content.length > 200_000) {
      return c.json({ error: 'CLAUDE.md exceeds 200KB' }, 400);
    }

    // Resolve target path — main's CLAUDE.md lives outside the agents/
    // tree. For sub-agents, the file goes into the agent's resolved dir
    // (which respects CLAUDECLAW_CONFIG override).
    let target: string;
    if (agentId === 'main') {
      target = resolveMainClaudeMdPath();
      // Make sure the parent dir exists — fresh installs may not have
      // created CLAUDECLAW_CONFIG yet.
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch {}
    } else {
      let agentDir: string;
      try { agentDir = resolveAgentDir(agentId); }
      catch { return c.json({ error: 'agent not found' }, 404); }
      target = path.join(agentDir, 'CLAUDE.md');
    }
    try {
      snapshotPriorVersion(agentId, 'claudemd', target);
      const atomicEnvWrite = await getAtomicWriter();
      atomicEnvWrite(target, body.content);
      // Loosen perms — CLAUDE.md is not sensitive (no tokens), and 0600
      // would prevent an editor running as a different user from reading
      // it locally.
      try { fs.chmodSync(target, 0o644); } catch {}
      // For main, the persona is injected into NEW sessions via the
      // bot's agentSystemPrompt module variable (src/bot.ts). It's
      // captured at startup, so a CLAUDE.md edit wouldn't reach the
      // bot without this in-memory update. Sub-agents don't need this:
      // the Agent SDK re-reads CLAUDE.md from cwd via settingSources on
      // every turn, so saves are hot-loaded automatically.
      if (agentId === 'main') {
        try {
          const { updateAgentSystemPrompt } = await import('./config.js');
          updateAgentSystemPrompt(body.content);
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : err }, 'failed to refresh main agentSystemPrompt');
        }
      }
      insertAuditLog({ agentId, chatId: '', action: 'edit_claudemd', detail: `${body.content.length} bytes`, blocked: false });
      return c.json({ ok: true, takes_effect: 'next-turn' });
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to write CLAUDE.md');
      return c.json({ error: 'Failed to write file' }, 500);
    }
  });

  app.put('/api/agents/:id/files/agent-yaml', async (c) => {
    const agentId = c.req.param('id');
    if (!/^[a-z0-9_-]+$/i.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    if (agentId === 'main') {
      // Main is the host process — its config lives in .env, not yaml.
      return c.json({ error: 'main agent has no agent.yaml; edit .env directly' }, 400);
    }
    const body = await c.req.json().catch(() => null) as { content?: string } | null;
    if (!body || typeof body.content !== 'string') {
      return c.json({ error: 'expected { content: string }' }, 400);
    }
    if (body.content.length > 64 * 1024) {
      return c.json({ error: 'agent.yaml exceeds 64KB' }, 400);
    }
    let agentDir: string;
    try { agentDir = resolveAgentDir(agentId); }
    catch { return c.json({ error: 'agent not found' }, 404); }

    // Validate as YAML before writing — no point poisoning the file.
    let parsed: any;
    try {
      const yaml = await import('js-yaml');
      parsed = yaml.load(body.content);
    } catch (err: any) {
      return c.json({ error: 'YAML parse error: ' + (err?.message || err) }, 400);
    }
    if (!parsed || typeof parsed !== 'object') {
      return c.json({ error: 'agent.yaml must be a YAML object' }, 400);
    }
    // Canonical schema (src/agent-config.ts loadAgentConfig): only name is
    // required. telegram_bot_token_env is optional — delegation-only agents
    // have no Telegram token. id is derived from the directory name, NOT
    // a yaml field. Reject the save if name is missing so we never poison
    // the file and break the agent on next load.
    if (!parsed.name) {
      return c.json({ error: 'agent.yaml requires a name field' }, 400);
    }

    // If the client posted back the redacted token, splice in the real
    // value from the file currently on disk. Means partial edits don't
    // require the user to know the real token.
    let content = body.content;
    if (/bot_token\s*:\s*"?\*\*\*REDACTED\*\*\*"?/.test(content)) {
      const yamlPath = path.join(agentDir, 'agent.yaml');
      const onDisk = fs.existsSync(yamlPath) ? fs.readFileSync(yamlPath, 'utf-8') : '';
      const tokenMatch = onDisk.match(/^\s*bot_token\s*:\s*([^\n#]+?)\s*(?:#.*)?$/m);
      const realToken = tokenMatch ? tokenMatch[1] : '';
      if (realToken && realToken !== '"***REDACTED***"') {
        content = content.replace(/^(\s*bot_token\s*:\s*)"?\*\*\*REDACTED\*\*\*"?(\s*(?:#.*)?)$/m, `$1${realToken}$2`);
      }
    }

    const target = path.join(agentDir, 'agent.yaml');
    try {
      snapshotPriorVersion(agentId, 'agent-yaml', target);
      const atomicEnvWrite = await getAtomicWriter();
      atomicEnvWrite(target, content);
      // Keep restrictive perms — file holds the bot token.
      try { fs.chmodSync(target, 0o600); } catch {}
      insertAuditLog({ agentId, chatId: '', action: 'edit_agent_yaml', detail: `${content.length} bytes`, blocked: false });
      return c.json({ ok: true, takes_effect: 'restart' });
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to write agent.yaml');
      return c.json({ error: 'Failed to write file' }, 500);
    }
  });

  // List versioned history for an agent file. Newest-first, no content
  // (callers fetch full content via the next endpoint to keep this list
  // payload small).
  app.get('/api/agents/:id/files/history', (c) => {
    const agentId = c.req.param('id');
    if (!/^[a-z0-9_-]+$/i.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    const kindParam = c.req.query('kind');
    if (kindParam !== 'claudemd' && kindParam !== 'agent-yaml') {
      return c.json({ error: 'kind must be "claudemd" or "agent-yaml"' }, 400);
    }
    const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
    const versions = listAgentFileHistory(agentId, kindParam as AgentFileKind, limit);
    return c.json({ versions });
  });

  // Fetch a specific version's full content. Used by the editor when the
  // user clicks a version in the history drawer to preview/restore.
  app.get('/api/agents/:id/files/history/:versionId', (c) => {
    const agentId = c.req.param('id');
    if (!/^[a-z0-9_-]+$/i.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    const versionId = parseInt(c.req.param('versionId'), 10);
    if (!Number.isFinite(versionId)) return c.json({ error: 'invalid version id' }, 400);
    const row = getAgentFileHistory(versionId);
    if (!row || row.agent_id !== agentId) return c.json({ error: 'version not found' }, 404);
    return c.json({ version: row });
  });

  // Restore a specific version: snapshots the current on-disk content
  // (so a restore is itself a versioned change), then writes the chosen
  // version back to disk. The user can always undo by restoring the
  // version that was just snapshotted.
  app.post('/api/agents/:id/files/history/:versionId/restore', async (c) => {
    const agentId = c.req.param('id');
    if (!/^[a-z0-9_-]+$/i.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    const versionId = parseInt(c.req.param('versionId'), 10);
    if (!Number.isFinite(versionId)) return c.json({ error: 'invalid version id' }, 400);
    const row = getAgentFileHistory(versionId);
    if (!row || row.agent_id !== agentId) return c.json({ error: 'version not found' }, 404);

    // Resolve target path with the same rules the GET/PUT endpoints use.
    let target: string;
    if (agentId === 'main') {
      if (row.file_kind !== 'claudemd') return c.json({ error: 'main has no agent.yaml' }, 400);
      target = resolveMainClaudeMdPath();
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch {}
    } else {
      let agentDir: string;
      try { agentDir = resolveAgentDir(agentId); }
      catch { return c.json({ error: 'agent not found' }, 404); }
      target = path.join(agentDir, row.file_kind === 'claudemd' ? 'CLAUDE.md' : 'agent.yaml');
    }

    try {
      snapshotPriorVersion(agentId, row.file_kind as AgentFileKind, target);
      const atomicEnvWrite = await getAtomicWriter();
      atomicEnvWrite(target, row.content);
      try { fs.chmodSync(target, row.file_kind === 'agent-yaml' ? 0o600 : 0o644); } catch {}
      // Same in-memory refresh as the PUT path — main's bot caches the
      // CLAUDE.md content at startup and only sees disk changes via this
      // setter.
      if (agentId === 'main' && row.file_kind === 'claudemd') {
        try {
          const { updateAgentSystemPrompt } = await import('./config.js');
          updateAgentSystemPrompt(row.content);
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : err }, 'failed to refresh main agentSystemPrompt');
        }
      }
      insertAuditLog({ agentId, chatId: '', action: 'restore_' + row.file_kind, detail: `version ${versionId} (${row.byte_size} bytes)`, blocked: false });
      return c.json({
        ok: true,
        takes_effect: row.file_kind === 'claudemd' ? 'next-turn' : 'restart',
        restored_version: versionId,
      });
    } catch (err) {
      logger.error({ err, agentId, versionId }, 'Failed to restore agent file');
      return c.json({ error: 'restore failed' }, 500);
    }
  });

  // ── Agent split suggestions ─────────────────────────────────────────
  // Scans hive_mind for the last 200 actions per agent, sends the bag
  // (agent description + their recent action summaries) to Haiku, and
  // asks "is any one agent doing several distinct domains that warrant
  // a split?" Suggestions land in agent_suggestions and surface as a
  // lightbulb badge on the AgentCard. The user can dismiss (= "no
  // thanks") or act (= "open the wizard pre-filled"); both states stick
  // so re-running analysis doesn't keep re-suggesting the same split.

  app.get('/api/agents/suggestions', (c) => {
    return c.json({ suggestions: listActiveAgentSuggestions() });
  });

  app.post('/api/agents/suggestions/refresh', async (c) => {
    const liveAgents = ['main', ...listAgentIds()];
    const agentMeta: Array<{ id: string; description: string; rawCount: number; recentSummaries: string[] }> = [];
    for (const id of liveAgents) {
      let description = '';
      if (id !== 'main') {
        try { description = loadAgentConfig(id).description || ''; } catch { /* skip */ }
      } else {
        description = 'Primary ClaudeClaw bot — general triage and routing';
      }
      const entries = getHiveMindEntries(200, id);
      const allFiltered = entries
        .map((e) => `[${e.action}] ${e.summary}`)
        .filter((s) => s.length > 0);
      // Sample evenly across the agent's last 200 entries, picking 12
      // representative summaries. We want diversity (different domains,
      // not just the latest cluster) without bloating the prompt past
      // Haiku's comfort zone — total prompt with 6 agents × 12
      // summaries × ~80 chars stays under ~2 KB and typically completes
      // in 15–25s.
      const target = 12;
      const recentSummaries = allFiltered.length <= target
        ? allFiltered
        : allFiltered.filter((_, i) => i % Math.ceil(allFiltered.length / target) === 0).slice(0, target);
      agentMeta.push({ id, description, rawCount: allFiltered.length, recentSummaries });
    }

    // Skip agents with too little signal — splitting an agent that's
    // done 5 things isn't useful, and Haiku will hallucinate splits.
    const eligible = agentMeta.filter((a) => a.rawCount >= 20);
    if (eligible.length === 0) {
      return c.json({ ok: true, suggestions: [], reason: 'not enough hive_mind activity to analyze' });
    }

    const recentlySuggested = new Set(
      getRecentlySuggestedSplits(30).map((r) => `${r.from_agent}::${r.suggested_id}`),
    );

    // Prompt: "for each agent, is one doing many distinct domains?"
    // Constrain the model to suggest AT MOST one split per agent and
    // require activity_share_pct so the user knows whether the
    // suggestion is meaningful (a 5%-share split isn't worth doing).
    const promptParts = [
      'You analyze a multi-agent system to spot when an agent has drifted into doing many distinct things and should be split.',
      '',
      'For each agent below, decide: is there ONE coherent sub-domain handling >= 25% of their recent activity that would benefit from being its own specialized agent? Only suggest a split when the new agent would have a clean scope and the parent agent would be more focused after the split.',
      '',
      'Return JSON with this exact shape:',
      '{ "suggestions": [{ "from_agent": "<id>", "suggested_id": "<lowercase-id>", "suggested_name": "<Title Case>", "suggested_description": "<one-sentence scope, 80 chars max>", "reasoning": "<why now, 200 chars max>", "activity_share_pct": <integer 0-100> }] }',
      '',
      'Rules:',
      '- suggested_id must be lowercase letters, numbers, hyphens; not match an existing agent.',
      '- Suggest at most one split per from_agent.',
      '- Skip suggestions where activity_share_pct < 25.',
      '- If no agent needs splitting, return { "suggestions": [] }.',
      '',
      'Agents:',
    ];
    for (const a of eligible) {
      promptParts.push('');
      promptParts.push(`AGENT: ${a.id}`);
      promptParts.push(`DESCRIPTION: ${a.description || '(no description)'}`);
      promptParts.push('RECENT ACTIVITY:');
      for (const s of a.recentSummaries) {
        promptParts.push(`  - ${s}`);
      }
    }
    const existingIds = new Set(liveAgents);

    let raw = '';
    const promptStr = promptParts.join('\n');
    logger.info({ promptBytes: promptStr.length, agentCount: eligible.length }, 'agent suggestion: starting analysis');
    const t0 = Date.now();
    try {
      // 120s timeout — the dashboard process spawns the SDK subprocess
      // alongside its own busy event loop (war-room polling, memory
      // ingest, scheduler). Cold-starts under load have measured up to
      // 90s in practice, vs 4–5s for a standalone CLI call with the
      // same prompt size. Better to wait than fail spuriously.
      raw = await extractViaClaude(promptStr, 120_000);
      logger.info({ elapsedMs: Date.now() - t0, responseBytes: raw.length }, 'agent suggestion: Haiku replied');
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err, elapsedMs: Date.now() - t0 }, 'agent suggestion analysis failed');
      return c.json({ error: 'analysis failed (Haiku unavailable)' }, 503);
    }
    const parsed = parseJsonResponse<{ suggestions: any[] }>(raw);
    const list = Array.isArray(parsed?.suggestions) ? parsed!.suggestions : [];

    let inserted = 0;
    let skipped = 0;
    for (const s of list) {
      if (!s || typeof s !== 'object') { skipped++; continue; }
      const fromAgent = String(s.from_agent || '').trim();
      const suggestedId = String(s.suggested_id || '').trim().toLowerCase();
      const suggestedName = String(s.suggested_name || '').trim();
      const suggestedDescription = String(s.suggested_description || '').trim();
      const reasoning = String(s.reasoning || '').trim();
      const sharePct = Math.max(0, Math.min(100, Math.round(Number(s.activity_share_pct) || 0)));

      if (!fromAgent || !existingIds.has(fromAgent)) { skipped++; continue; }
      if (!/^[a-z0-9-]{2,32}$/.test(suggestedId)) { skipped++; continue; }
      if (existingIds.has(suggestedId)) { skipped++; continue; }
      if (!suggestedName || !suggestedDescription || !reasoning) { skipped++; continue; }
      if (sharePct < 25) { skipped++; continue; }
      // Don't re-suggest the exact same split we already proposed in
      // the last 30 days (whether dismissed or still active).
      if (recentlySuggested.has(`${fromAgent}::${suggestedId}`)) { skipped++; continue; }

      insertAgentSuggestion({
        from_agent: fromAgent,
        suggested_id: suggestedId,
        suggested_name: suggestedName,
        suggested_description: suggestedDescription.slice(0, 200),
        reasoning: reasoning.slice(0, 500),
        activity_share_pct: sharePct,
      });
      inserted++;
    }
    insertAuditLog({ agentId: 'main', chatId: '', action: 'agent_suggestion_refresh', detail: `inserted=${inserted} skipped=${skipped}`, blocked: false });
    return c.json({ ok: true, inserted, skipped, suggestions: listActiveAgentSuggestions() });
  });

  app.post('/api/agents/suggestions/:id/dismiss', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    const ok = dismissAgentSuggestion(id);
    if (!ok) return c.json({ error: 'not found or already dismissed' }, 404);
    insertAuditLog({ agentId: 'main', chatId: '', action: 'agent_suggestion_dismiss', detail: `id=${id}`, blocked: false });
    return c.json({ ok: true });
  });

  app.post('/api/agents/suggestions/:id/acted', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    const ok = markAgentSuggestionActed(id);
    if (!ok) return c.json({ error: 'not found or already acted' }, 404);
    insertAuditLog({ agentId: 'main', chatId: '', action: 'agent_suggestion_acted', detail: `id=${id}`, blocked: false });
    return c.json({ ok: true });
  });

  // ── Agent Creation & Management ──────────────────────────────────────

  // List available agent templates
  app.get('/api/agents/templates', (c) => {
    return c.json({ templates: listTemplates() });
  });

  // Validate an agent ID (before creation)
  app.get('/api/agents/validate-id', (c) => {
    const id = c.req.query('id') || '';
    const result = validateAgentId(id);
    const suggestions = id ? suggestBotNames(id) : null;
    return c.json({ ...result, suggestions });
  });

  // Validate a bot token
  app.post('/api/agents/validate-token', async (c) => {
    const body = await c.req.json<{ token?: string }>();
    const token = body?.token?.trim();
    if (!token) return c.json({ ok: false, error: 'token required' }, 400);
    const result = await validateBotToken(token);
    return c.json(result);
  });

  // Create a new agent. botToken is OPTIONAL: without it the agent is
  // delegation-only (no standalone Telegram process). claudeMd / agentYaml
  // let the user supply their own files instead of template copies.
  app.post('/api/agents/create', async (c) => {
    const body = await c.req.json<{
      id?: string;
      name?: string;
      description?: string;
      model?: string;
      template?: string;
      botToken?: string;
      claudeMd?: string;
      agentYaml?: string;
    }>();

    const id = body?.id?.trim();
    const name = body?.name?.trim();
    const description = body?.description?.trim();
    const botToken = body?.botToken?.trim() || undefined;
    const claudeMd = typeof body?.claudeMd === 'string' ? body.claudeMd : undefined;
    const agentYaml = typeof body?.agentYaml === 'string' ? body.agentYaml : undefined;

    if (!id) return c.json({ error: 'id required' }, 400);
    if (!name) return c.json({ error: 'name required' }, 400);
    if (!description) return c.json({ error: 'description required' }, 400);
    if (claudeMd && claudeMd.length > 200_000) return c.json({ error: 'CLAUDE.md exceeds 200KB' }, 400);
    if (agentYaml && agentYaml.length > 64 * 1024) return c.json({ error: 'agent.yaml exceeds 64KB' }, 400);

    try {
      const result = await createAgent({
        id,
        name,
        description,
        model: body?.model?.trim() || undefined,
        template: body?.template?.trim() || undefined,
        botToken,
        claudeMd,
        agentYaml,
      });
      return c.json({ ok: true, ...result }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });

  // Activate an agent (install service + start)
  app.post('/api/agents/:id/activate', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot activate main via this endpoint' }, 400);
    // Delegation-only agents (no Telegram token) have no standalone service.
    try {
      const cfg = loadAgentConfig(agentId);
      if (!cfg.botToken) {
        return c.json({
          error: 'This agent has no Telegram bot token, so there is no standalone service to start. It is delegation-only: reach it via @' + agentId + ': or /delegate from the main bot. To run it standalone, add a token to its agent.yaml (telegram_bot_token_env) and .env.',
        }, 400);
      }
    } catch { /* fall through — activateAgent reports config errors */ }
    const result = activateAgent(agentId);
    return c.json(result);
  });

  // Deactivate an agent (stop + uninstall service)
  app.post('/api/agents/:id/deactivate', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot deactivate main via this endpoint' }, 400);
    const result = deactivateAgent(agentId);
    return c.json(result);
  });

  // Restart an agent (kill + relaunch service)
  app.post('/api/agents/:id/restart', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot restart main via this endpoint. Restart the main process manually.' }, 400);
    const result = restartAgent(agentId);
    if (result.ok) {
      return c.json({ ok: true, message: `Agent ${agentId} restarted` });
    }
    return c.json({ error: result.error }, 500);
  });

  // Delete an agent entirely
  app.delete('/api/agents/:id/full', (c) => {
    const agentId = c.req.param('id');
    if (agentId === 'main') return c.json({ error: 'Cannot delete main' }, 400);
    const result = deleteAgent(agentId);
    if (result.ok) {
      return c.json({ ok: true });
    }
    return c.json({ error: result.error }, 500);
  });

  // Check if a specific agent is running
  app.get('/api/agents/:id/status', (c) => {
    const agentId = c.req.param('id');
    return c.json({ running: isAgentRunning(agentId) });
  });

  // Unified avatar resolver, used by Mission Control, both War Room
  // surfaces, and the Daily.co spawner. Source priority lives in
  // src/avatars.ts. ETag is mtime+size based, so the moment a user
  // upload or Telegram fetch lands on disk, the next request picks up
  // a new tag and the browser revalidates.
  app.get('/api/agents/:id/avatar', async (c) => {
    const agentId = c.req.param('id');
    if (!AGENT_ID_RE.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    if (!agentExists(agentId)) return c.json({ error: 'agent not found' }, 404);
    const ctxQ = c.req.query('context');
    const context: 'default' | 'meet' = ctxQ === 'meet' ? 'meet' : 'default';

    // Fast path: hit resolver, return file with ETag/304 support.
    const serve = (): Response | undefined => {
      const r = resolveAgentAvatar(agentId, { context });
      if (!r) return undefined;
      const etag = avatarEtag(r);
      const ifNoneMatch = c.req.header('if-none-match');
      if (ifNoneMatch && ifNoneMatch === etag) {
        return new Response(null, {
          status: 304,
          headers: {
            'ETag': etag,
            'Cache-Control': 'no-cache, must-revalidate',
          },
        });
      }
      const data = fs.readFileSync(r.absPath);
      // Sniff the magic bytes so JPEG/WebP uploads (PUT accepts both)
      // are served with the correct Content-Type. The on-disk filename
      // is always *.png by convention, but the bytes can be anything
      // we accepted at upload time. Browsers cope either way; strict
      // proxies and image processors do not.
      let contentType = 'image/png';
      if (data.length >= 12) {
        if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
          contentType = 'image/jpeg';
        } else if (
          data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
          data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
        ) {
          contentType = 'image/webp';
        }
      }
      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, must-revalidate',
          'ETag': etag,
        },
      });
    };

    const fast = serve();
    if (fast) return fast;

    // No mutable file and no bundled fallback. For sub-agents we can
    // try Telegram once (writes to mutable path on success). Main has
    // no bot token of its own here, so we don't attempt.
    if (agentId !== 'main') {
      const fetched = await tryFetchTelegramAvatar(agentId);
      if (fetched) {
        const after = serve();
        if (after) return after;
      }
    }

    return c.body(null, 204);
  });

  // Upload a custom avatar from the dashboard. Always writes to the
  // mutable, runtime-owned location (resolveAgentDir(id)/avatar.png for
  // sub-agents, STORE_DIR/avatars/main.png for main). Never writes to
  // warroom/avatars/ — that namespace stays bundled, immutable art.
  // PNG / JPEG / WebP, 5 MB max.
  //
  // Telegram propagation is NOT possible via the Bot API — the bot's
  // profile picture can only be set by the bot owner through @BotFather
  // (/setuserpic). The frontend surfaces the manual step.
  app.put('/api/agents/:id/avatar', async (c) => {
    const agentId = c.req.param('id');
    if (!AGENT_ID_RE.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    if (!agentExists(agentId)) return c.json({ error: 'agent not found' }, 404);

    // Two upload modes — multipart/form-data with `image` field, or
    // application/octet-stream with the raw bytes (handier for CLI).
    let bytes: Buffer | null = null;
    const ct = c.req.header('content-type') || '';
    try {
      if (ct.startsWith('multipart/form-data')) {
        const form = await c.req.formData();
        const file = form.get('image');
        if (!file || typeof file === 'string') {
          return c.json({ error: 'missing "image" file field' }, 400);
        }
        bytes = Buffer.from(await (file as File).arrayBuffer());
      } else {
        const buf = await c.req.arrayBuffer();
        if (buf.byteLength === 0) return c.json({ error: 'empty body' }, 400);
        bytes = Buffer.from(buf);
      }
    } catch (err) {
      return c.json({ error: 'failed to read upload' }, 400);
    }

    if (!bytes || bytes.length === 0) return c.json({ error: 'empty upload' }, 400);
    if (bytes.length > 5 * 1024 * 1024) return c.json({ error: 'image too large (max 5 MB)' }, 400);

    try {
      const result = await writeUploadedAvatar(agentId, bytes);
      insertAuditLog({ agentId, chatId: '', action: 'upload_avatar', detail: `${bytes.length} bytes`, blocked: false });
      return c.json({
        ok: true,
        bytes: result.bytes,
        path: result.absPath,
        // Echo the new etag so the client can cache-bust render sites
        // immediately without waiting for a list refresh.
        avatar_etag: `${Math.floor(result.mtimeMs)}-${result.size}`,
      });
    } catch (err: any) {
      const msg = (err && err.message) || 'failed to save avatar';
      const code = msg.startsWith('image must be') ? 400 : 500;
      if (code === 500) logger.error({ err, agentId }, 'Failed to write avatar');
      return c.json({ error: msg }, code);
    }
  });

  app.delete('/api/agents/:id/avatar', async (c) => {
    const agentId = c.req.param('id');
    if (!AGENT_ID_RE.test(agentId)) return c.json({ error: 'invalid id' }, 400);
    if (!agentExists(agentId)) return c.json({ error: 'agent not found' }, 404);
    try {
      await deleteUploadedAvatar(agentId);
      insertAuditLog({ agentId, chatId: '', action: 'delete_avatar', detail: '', blocked: false });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: 'failed to delete avatar' }, 500);
    }
  });

  // ── Dashboard personalization ────────────────────────────────────────
  // Tiny key/value store backed by the dashboard_settings table. Used by
  // the workspace name, hotkey mod choice, mission column order/widths,
  // and any future per-workspace personalization. Values are arbitrary
  // strings (the client encodes JSON for non-string payloads).
  //
  // Allowed keys are explicit so a typo on the client doesn't quietly
  // create a junk row, and so future migrations have a finite list to
  // reason about.
  const ALLOWED_SETTING_KEYS = new Set([
    'workspace_name',
    'hotkey_mod', // 'meta' | 'ctrl' | 'auto'
    'sidebar_collapsed_sections', // JSON array of section ids
    'mission_column_order', // JSON array of agent ids
    'mission_column_widths', // JSON object { id: px }
    // JSON {agents: [{id, enabled}], maxSpeakers}. Drives /standup
    // and /discuss in the text War Room — the user picks who's in,
    // their order, and the cap. Read by pickSlashRoster() in
    // src/warroom-text-orchestrator.ts. UI: web/src/pages/StandupConfig.tsx.
    'standup_config',
    // JSON array of {id, name, kind: 'url'|'app', target}. Quick-launch
    // apps shown in the sidebar and command palette. URL kinds open
    // client-side; 'app' kinds launch via POST /api/apps/launch below.
    // UI: web/src/pages/Settings.tsx, store: web/src/lib/apps.ts.
    'quick_apps',
  ]);
  const SETTING_VALUE_MAX_BYTES = 4 * 1024;

  app.get('/api/dashboard/settings', (c) => {
    return c.json(getAllDashboardSettings());
  });

  // Per-key shape validators. The byte cap upstream of this catches a
  // hostile blob; per-key shape validation catches the case where a bug
  // in the UI saves a structurally wrong but small payload that would
  // then read back as defaults at /standup time.
  function validateStandupConfigJson(value: string): string | null {
    let parsed: unknown;
    try { parsed = JSON.parse(value); }
    catch { return 'standup_config: value must be valid JSON'; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'standup_config: value must be a JSON object';
    }
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.agents)) {
      return 'standup_config: agents must be an array';
    }
    for (const a of obj.agents) {
      if (!a || typeof a !== 'object' || typeof (a as { id?: unknown }).id !== 'string') {
        return 'standup_config: each agent entry must be { id: string, enabled?: boolean }';
      }
      const enabled = (a as { enabled?: unknown }).enabled;
      if (enabled !== undefined && typeof enabled !== 'boolean') {
        return 'standup_config: agent.enabled must be boolean when present';
      }
    }
    if (typeof obj.maxSpeakers !== 'number' || !Number.isFinite(obj.maxSpeakers)
        || !Number.isInteger(obj.maxSpeakers) || obj.maxSpeakers < 1 || obj.maxSpeakers > 8) {
      return 'standup_config: maxSpeakers must be an integer in [1, 8]';
    }
    return null;
  }

  // Structural check only. Target content is validated at use time: the
  // client refuses non-http(s) URLs before window.open, and the launch
  // endpoint below re-validates app names. Partial values (a URL mid-typing)
  // are allowed so the Settings editor's debounced saves don't bounce.
  function validateQuickAppsJson(value: string): string | null {
    let parsed: unknown;
    try { parsed = JSON.parse(value); }
    catch { return 'quick_apps: value must be valid JSON'; }
    if (!Array.isArray(parsed)) return 'quick_apps: value must be a JSON array';
    if (parsed.length > 24) return 'quick_apps: max 24 apps';
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return 'quick_apps: each entry must be an object';
      }
      const a = entry as Record<string, unknown>;
      if (typeof a.id !== 'string' || !a.id || a.id.length > 64) {
        return 'quick_apps: id must be a non-empty string (max 64 chars)';
      }
      if (typeof a.name !== 'string' || a.name.length > 40) {
        return 'quick_apps: name must be a string (max 40 chars)';
      }
      if (a.kind !== 'url' && a.kind !== 'app') {
        return "quick_apps: kind must be 'url' or 'app'";
      }
      if (typeof a.target !== 'string' || a.target.length > 512) {
        return 'quick_apps: target must be a string (max 512 chars)';
      }
    }
    return null;
  }

  app.patch('/api/dashboard/settings', async (c) => {
    const body = await c.req.json().catch(() => null) as { key?: string; value?: string } | null;
    if (!body || typeof body.key !== 'string' || typeof body.value !== 'string') {
      return c.json({ error: 'expected { key: string, value: string }' }, 400);
    }
    if (!ALLOWED_SETTING_KEYS.has(body.key)) {
      return c.json({ error: `unknown setting key: ${body.key}` }, 400);
    }
    if (Buffer.byteLength(body.value, 'utf8') > SETTING_VALUE_MAX_BYTES) {
      return c.json({ error: `value exceeds ${SETTING_VALUE_MAX_BYTES} bytes` }, 400);
    }
    if (body.key === 'standup_config') {
      const err = validateStandupConfigJson(body.value);
      if (err) return c.json({ error: err }, 400);
    }
    if (body.key === 'quick_apps') {
      const err = validateQuickAppsJson(body.value);
      if (err) return c.json({ error: err }, 400);
    }
    // Workspace name has its own length cap so the sidebar layout stays
    // sane. Strip control chars + zero-width joiners; trim whitespace.
    let value = body.value;
    if (body.key === 'workspace_name') {
      value = value.replace(/[\u0000-\u001f\u200b-\u200d\ufeff]/g, '').trim();
      if (value.length > 32) value = value.slice(0, 32);
    }
    setDashboardSetting(body.key, value);
    insertAuditLog({ agentId: 'main', chatId: '', action: 'dashboard_setting_change', detail: `${body.key}=${value.slice(0, 80)}`, blocked: false });
    return c.json({ ok: true, key: body.key, value });
  });

  // ── App launcher ─────────────────────────────────────────────────────
  // Launches a local desktop application via macOS `open -a <name>`.
  // Only the 'app' kind of quick-launch apps hits this — URL kinds open
  // client-side (Electron's setWindowOpenHandler routes window.open to
  // shell.openExternal). execFile with a fixed binary and an args array
  // means the name is never shell-interpreted; the leading-dash check
  // stops flag injection into `open` itself.
  app.post('/api/apps/launch', async (c) => {
    const body = await c.req.json().catch(() => null) as { name?: string } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 128 || name.startsWith('-')) {
      return c.json({ error: 'expected { name: string } — an app name without a leading dash' }, 400);
    }
    if (process.platform !== 'darwin') {
      return c.json({ error: 'app launching is only supported on macOS' }, 501);
    }
    const { execFile } = await import('child_process');
    const ok = await new Promise<boolean>((resolve) => {
      execFile('open', ['-a', name], { timeout: 10_000 }, (err) => resolve(!err));
    });
    insertAuditLog({ agentId: 'main', chatId: '', action: 'launch_app', detail: name, blocked: !ok });
    if (!ok) return c.json({ error: `could not open "${name}" — is it installed on this Mac?` }, 404);
    return c.json({ ok: true });
  });

  // ── Security & Audit ─────────────────────────────────────────────────

  app.get('/api/security/status', (c) => {
    return c.json(getSecurityStatus());
  });

  // Toggle a kill switch by name. Writes the flag to .env atomically;
  // kill-switches.ts re-reads .env every 1.5s so the change takes effect
  // without a process restart.
  const ALLOWED_KILL_SWITCHES = new Set([
    'WARROOM_TEXT_ENABLED',
    'WARROOM_VOICE_ENABLED',
    'LLM_SPAWN_ENABLED',
    'DASHBOARD_MUTATIONS_ENABLED',
    'MISSION_AUTO_ASSIGN_ENABLED',
    'SCHEDULER_ENABLED',
  ]);
  app.post('/api/security/kill-switch', async (c) => {
    const body = await c.req.json<{ key?: string; enabled?: boolean }>();
    const key = body?.key;
    const enabled = body?.enabled;
    if (!key || typeof enabled !== 'boolean') {
      return c.json({ error: 'key (string) and enabled (boolean) required' }, 400);
    }
    if (!ALLOWED_KILL_SWITCHES.has(key)) {
      return c.json({ error: 'unknown kill switch: ' + key }, 400);
    }
    try {
      const envPath = path.join(PROJECT_ROOT, '.env');
      const { setEnvKey } = await import('./env-write.js');
      setEnvKey(envPath, key, enabled ? 'true' : 'false');
      logger.info({ key, enabled }, 'Kill switch toggled via dashboard');
      return c.json({ ok: true, key, enabled });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'Failed to write .env: ' + msg }, 500);
    }
  });

  // ── Permissions & Autonomy (Phase 3, PERM-01/02/03) ────────────────
  //
  // Mounted on the shared `app`, so both routes inherit the token gate
  // (:332) and the DASHBOARD_MUTATIONS_ENABLED kill-switch 503 (:366) for
  // PUT. Mode + override changes are audited server-side by permissions-config
  // (D-11). PUT enum-validates mode + every override value (V5) → 400 on bad
  // input. Tier 4 is never settable to "always" here — the gate's resolveOutcome
  // lock is the real enforcement, but we also refuse to persist an override on
  // the send-money capability so the API can't even record one (D-05/PERM-03).

  const VALID_MODES = new Set<Mode>(['cautious', 'balanced', 'autonomous']);
  const VALID_OVERRIDE_VALUES = new Set<OverrideValue>(['always', 'ask']);
  // The locked Tier 4 capability key (gate.ts TIER_CAPABILITY[4]). An "always"
  // here would be a no-op against the gate lock, but we reject it outright so
  // the persisted config never contains a misleading Tier 4 "always" (D-05).
  const LOCKED_CAPABILITY = 'send-money';

  app.get('/api/permissions', (c) => {
    return c.json({ mode: getMode(), overrides: getOverrides() });
  });

  app.put('/api/permissions', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      mode?: unknown;
      overrides?: unknown;
    };

    // Validate mode (V5).
    if (typeof body.mode !== 'string' || !VALID_MODES.has(body.mode as Mode)) {
      return c.json({ ok: false, error: "mode must be one of 'cautious', 'balanced', 'autonomous'" }, 400);
    }
    const mode = body.mode as Mode;

    // Validate overrides if present: an object of capability → 'always' | 'ask'.
    let overrides: Record<string, OverrideValue> = {};
    if (body.overrides !== undefined) {
      if (
        body.overrides === null ||
        typeof body.overrides !== 'object' ||
        Array.isArray(body.overrides)
      ) {
        return c.json({ ok: false, error: 'overrides must be an object of capability to value' }, 400);
      }
      for (const [cap, value] of Object.entries(body.overrides as Record<string, unknown>)) {
        if (typeof value !== 'string' || !VALID_OVERRIDE_VALUES.has(value as OverrideValue)) {
          return c.json({ ok: false, error: `override "${cap}" must be 'always' or 'ask'` }, 400);
        }
        // PERM-03 / D-05: the locked Tier 4 capability can never be set to
        // 'always'. Reject so the stored config never carries a Tier 4 'always'.
        if (cap === LOCKED_CAPABILITY && value === 'always') {
          return c.json({ ok: false, error: 'this action always asks and cannot be set to always' }, 400);
        }
        overrides[cap] = value as OverrideValue;
      }
    }

    // Persist (each setter audits a config-change event — D-11).
    setMode(mode);
    for (const [cap, value] of Object.entries(overrides)) {
      setOverride(cap, value);
    }
    return c.json({ ok: true });
  });

  // ── Approvals ("Needs you" queue, PERM-04) ─────────────────────────

  /** Shape the queue row for the dashboard (plain fields, no raw secrets). */
  function approvalView(row: ApprovalRow) {
    return {
      id: row.id,
      agent_id: row.agent_id,
      tool_name: row.tool_name,
      tier: row.tier,
      mode_at_decision: row.mode_at_decision,
      summary: row.summary,
      // The ONE scrubbed, length-capped target worth showing so the operator
      // can decide with context (e.g. the Bash command, the file a Write touches).
      // Reuses the same secret-safe extraction the audit log trusts — never the
      // raw input object, never a secret-shaped field (gate.ts safeTarget).
      target: safeTarget(row.tool_name, row.tool_input) ?? null,
      status: row.status,
      run_id: row.run_id,
      routine_id: row.routine_id,
      created_at: row.created_at,
    };
  }

  app.get('/api/approvals', (c) => {
    return c.json({ approvals: listPending().map(approvalView) });
  });

  // Approve a pending item → replay the captured action, then status-guarded
  // transition (L-3). The transition is the source of truth for `ok`: a second
  // approve finds no pending row, so approve() returns false and we return
  // { ok:false } WITHOUT replaying again (T-replay-twice). Replay success or the
  // honest failure reason is stored in `result` and surfaced to the operator.
  app.post('/api/approvals/:id/approve', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);

    // Find the still-pending row to replay. If it's not pending, do NOT replay.
    const pending = listPending().find((r) => r.id === id);
    if (!pending) {
      return c.json({ ok: false, error: 'not pending (already decided or unknown)' });
    }

    // Run the prepared action. Tier 4 approval is per-instance only — approving
    // never writes an "always" (D-05); we only replay this one captured call.
    const replay = await replayApproval(pending.tool_name, pending.tool_input);

    // Status-guarded transition. If we lost a race (a poll/another click already
    // moved it), changed is false and we report ok:false — no double replay.
    const changed = approve(id, replay.message);
    if (!changed) {
      return c.json({ ok: false, error: 'already decided' });
    }
    return c.json({ ok: true, replayed: replay.ok, result: replay.message });
  });

  app.post('/api/approvals/:id/deny', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
    const changed = deny(id, 'Discarded by operator.');
    if (!changed) return c.json({ ok: false, error: 'not pending (already decided or unknown)' });
    return c.json({ ok: true });
  });

  app.get('/api/pairings', (c) => {
    const status = c.req.query('status');
    const rows =
      status === 'pending' || status === 'approved' || status === 'denied'
        ? listPairings(status)
        : listPairings();
    return c.json({
      pairings: rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        sender_id: r.sender_id,
        display_name: r.display_name,
        status: r.status,
        pairing_code: r.pairing_code,
        created_at: r.created_at,
        decided_at: r.decided_at,
        last_seen_at: r.last_seen_at,
      })),
    });
  });

  app.post('/api/pairings/:id/approve', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
    if (!getPairingById(id)) return c.json({ ok: false, error: 'not found' }, 404);
    const changed = approvePairing(id);
    if (!changed) return c.json({ ok: false, error: 'already decided' });
    return c.json({ ok: true });
  });

  app.post('/api/pairings/:id/deny', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);
    if (!getPairingById(id)) return c.json({ ok: false, error: 'not found' }, 404);
    const changed = denyPairing(id);
    if (!changed) return c.json({ ok: false, error: 'not pending (already decided or unknown)' });
    return c.json({ ok: true });
  });

  // Parse the shared audit filter params off a request. Used by BOTH the read
  // endpoint and the export so they apply identical filtering (the export scope
  // must match what is on screen). Every value binds via `?` placeholders in
  // getAuditLogFiltered — nothing here is concatenated into SQL (T-05-05).
  // Dates arrive as either epoch seconds or an ISO/date string; both are parsed
  // to integer epoch seconds and silently dropped when unparseable (clamp, not
  // fail) so a malformed date can never poison the query.
  function parseAuditFilters(c: import('hono').Context): {
    agentId?: string;
    eventType?: string;
    search?: string;
    startAt?: number;
    endAt?: number;
  } {
    const agentId = c.req.query('agent') || undefined;
    const type = c.req.query('type') || undefined;
    const search = c.req.query('search') || undefined;
    const parseEpoch = (raw: string | undefined): number | undefined => {
      if (!raw) return undefined;
      // Bare integer => already epoch seconds.
      if (/^\d+$/.test(raw)) {
        const n = parseInt(raw, 10);
        return Number.isInteger(n) ? n : undefined;
      }
      const ms = Date.parse(raw);
      return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
    };
    return {
      agentId,
      eventType: type,
      search,
      startAt: parseEpoch(c.req.query('from')),
      endAt: parseEpoch(c.req.query('to')),
    };
  }

  app.get('/api/audit', (c) => {
    const rawLimit = parseInt(c.req.query('limit') || '50', 10);
    const rawOffset = parseInt(c.req.query('offset') || '0', 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 50;
    const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const filters = parseAuditFilters(c);
    // Enriched read: filtered rows carry the read-side cost (cost_usd subquery)
    // and honest NULLs for uncaptured fields. The retention window + the set of
    // event types with backing data ride in the same envelope so the UI can
    // render the retention banner and HONEST type chips without a second call.
    const entries = getAuditLogFiltered({ ...filters, limit, offset });
    const total = getAuditLogCount(filters.agentId);
    return c.json({
      entries,
      total,
      retention_days: getAuditRetentionDays(),
      types: getAuditLogTypes(),
    });
  });

  // Complete-set export (D-21). Mounted under /api/ so it inherits the existing
  // query-token gate (T-05-07); GET is mutations-exempt by design. Streams the
  // FULL filtered set — NO limit/offset — so a copy-pasted page cap can never
  // truncate the download (Pitfall 6). format âˆˆ {csv,json}; anything else falls
  // back to csv. Returned as a download via Content-Disposition: attachment,
  // mirroring the project file-download precedent. No [SEND_FILE] marker — this
  // is an HTTP response, not a chat-bot attachment.
  app.get('/api/audit/export', (c) => {
    const rawFormat = (c.req.query('format') || 'csv').toLowerCase();
    const format = rawFormat === 'json' ? 'json' : 'csv';
    const filters = parseAuditFilters(c);
    const rows = getAuditLogFiltered(filters) as Array<AuditLogEntry>;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'json') {
      const body = JSON.stringify(toJsonEnvelope(rows as Array<Record<string, unknown>>));
      return new Response(body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-${ts}.json"`,
        },
      });
    }

    const body = toCsv(rows as Array<Record<string, unknown>>);
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-${ts}.csv"`,
      },
    });
  });

  app.get('/api/audit/blocked', (c) => {
    const limit = parseInt(c.req.query('limit') || '10', 10);
    return c.json({ entries: getRecentBlockedActions(limit) });
  });

  // ── Activity (operator feed, TRUST-01 / D-06) ──────────────────────
  //
  // The curated, plain-language read model the operator looks at. GET, so it
  // inherits the query-token gate from the app-level middleware above (T-04-auth)
  // by mounting on `app`, no bespoke auth here. The response carries ONLY the
  // curated, param-level row fields buildActivityFeed already projects (no env,
  // no secrets, mirrors the approvalView no-raw-secrets rule, T-04-infodisc-resp).
  // Read-side filter (all | autonomous | needsyou | <agent_id>, D-11) and a
  // bounded limit are passed straight through to the plan-01 read model.
  app.get('/api/activity', (c) => {
    const filter = c.req.query('filter') || undefined;
    const rawLimit = parseInt(c.req.query('limit') || '100', 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
    const rows = buildActivityFeed({ filter, limit });
    return c.json({ rows });
  });

  // Undo a reversible action (TRUST-02 / D-07/D-08/D-09). POST, so it inherits
  // the DASHBOARD_MUTATIONS_ENABLED kill-switch 503 and the token gate from the
  // app-level middleware above (T-04-undo-auth) by mounting on `app` -- no
  // bespoke gating here. Flow, mirroring the approve route's status-guarded
  // "act once" shape:
  //   1. parseInt + Number.isInteger -> 400 on a bad id (V5).
  //   2. getApprovalById(id): must exist, be status='approved', undoable
  //      (allowlisted family, tier<4, has tool_input). Else honest rejection.
  //   3. claimUndo(id) status-guarded CLAIM, BEFORE any dispatch: only one
  //      caller claims an approved, not-yet-undone row (T-04-undo-doublefire).
  //      A second click finds it claimed and is a no-op -- the inverse never
  //      fires twice because the claim gates the dispatch.
  //   4. undoAction(tool_name, tool_input, tier) runs the real inverse (or
  //      refuses Tier 4 before dispatch / returns honest "no undo").
  //   5. finalizeUndo(id, result) records the verbatim outcome on the claimed row.
  // The verbatim honest result is returned on failure, never a generic error.
  app.post('/api/activity/:id/undo', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isInteger(id)) return c.json({ ok: false, error: 'invalid id' }, 400);

    // Failure branches carry an appropriate non-200 status (WR-01) so monitoring
    // and future clients can distinguish success from failure by HTTP status,
    // not just the body. The honest verbatim body is unchanged; only the status
    // is added. 404 not-found, 409 wrong-state / already-undone, 400 not-undoable.
    const row = getApprovalById(id);
    if (!row) {
      return c.json({ ok: false, error: 'no undoable action for that id' }, 404);
    }
    if (row.status !== 'approved') {
      return c.json({ ok: false, error: 'only an approved action can be undone' }, 409);
    }
    const hasInput = Object.keys(row.tool_input).length > 0;
    if (!isUndoableFamily(row.tool_name) || row.tier >= 4 || !hasInput) {
      // Honest "no undo": Tier 4, non-allowlisted, or no captured params.
      return c.json({ ok: false, error: `Undo isn't available for ${row.tool_name}.` }, 400);
    }

    // Claim BEFORE dispatch so the inverse can never fire twice. If we lost the
    // race (a second click already claimed it), report ok:false and do NOT run
    // the inverse again.
    if (!claimUndo(id)) {
      return c.json({ ok: false, error: 'already undone' }, 409);
    }

    // Run the real inverse. undoAction refuses Tier 4 before dispatch and never
    // throws; it returns the honest verbatim message either way.
    const result = await undoAction(row.tool_name, row.tool_input, row.tier);
    finalizeUndo(id, result.message);
    return c.json({ ok: result.ok, result: result.message });
  });

  // Summarize Today: the one acceptable on-demand LLM affordance (D-10). POST,
  // so it inherits the token gate + DASHBOARD_MUTATIONS_ENABLED kill-switch 503
  // by mounting on `app` (T-04-summarize-auth) -- no bespoke gating here. On top
  // of that it is governed by the LLM_SPAWN_ENABLED kill-switch (T-04-llm-dos):
  // when LLM spawning is disabled the route short-circuits with the honest
  // degrade and makes NO LLM call at all. It is operator-invoked only (no
  // per-row, no on-mount), and summarizeDay carries only params-free phrases
  // into the prompt (scrubbed env, bounded timeout, T-04-summarize-infodisc).
  // It always returns 200 with { text } -- either the digest or the honest
  // degrade -- and never throws or fabricates (D-05).
  app.post('/api/activity/summarize', async (c) => {
    // Kill-switch FIRST: if LLM spawning is off, return the honest degrade and
    // make no LLM call. This is the DoS chokepoint for the summarize path.
    if (!killSwitches.isEnabled('LLM_SPAWN_ENABLED')) {
      return c.json({ ok: true, text: SUMMARIZE_DEGRADE, disabled: true });
    }
    // Today's rows only (local midnight forward), so the digest is "today".
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sinceSeconds = Math.floor(startOfDay.getTime() / 1000);
    const today = buildActivityFeed({ filter: 'all', limit: 200 }).filter(
      (r) => r.created_at >= sinceSeconds,
    );
    const text = await summarizeDay(today);
    return c.json({ ok: true, text });
  });

  // Hive mind feed
  app.get('/api/hive-mind', (c) => {
    const agentId = c.req.query('agent');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const entries = getHiveMindEntries(limit, agentId || undefined);
    return c.json({ entries });
  });

  // ── Chat endpoints ─────────────────────────────────────────────────

  // SSE stream for real-time chat updates
  app.get('/api/chat/stream', (c) => {
    return streamSSE(c, async (stream) => {
      // Send initial processing state
      const state = getIsProcessing();
      await stream.writeSSE({
        event: 'processing',
        data: JSON.stringify({ processing: state.processing, chatId: state.chatId }),
      });

      // Forward chat events to SSE client
      const handler = async (event: ChatEvent) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        } catch {
          // Client disconnected
        }
      };

      chatEvents.on('chat', handler);

      // Keepalive ping every 30s
      const pingInterval = setInterval(async () => {
        try {
          await stream.writeSSE({ event: 'ping', data: '' });
        } catch {
          clearInterval(pingInterval);
        }
      }, 30_000);

      // Wait until the client disconnects
      try {
        await new Promise<void>((_, reject) => {
          stream.onAbort(() => reject(new Error('aborted')));
        });
      } catch {
        // Expected: client disconnected
      } finally {
        clearInterval(pingInterval);
        chatEvents.off('chat', handler);
      }
    });
  });

  // Chat history (paginated)
  app.get('/api/chat/history', (c) => {
    // Default to the configured chat when the dashboard is opened
    // without ?chatId. Other endpoints already do this; previously this
    // route 400'd and the error landed in the user-facing UI.
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    if (!chatId) return c.json({ turns: [] });
    const limit = parseInt(c.req.query('limit') || '40', 10);
    const beforeId = c.req.query('beforeId');
    const turns = getConversationPage(chatId, limit, beforeId ? parseInt(beforeId, 10) : undefined);
    return c.json({ turns });
  });

  // Upload attachments (documents, spreadsheets, images, etc.) for chat
  // messages and mission tasks. Files land in workspace/uploads/ — the same
  // directory Telegram media uses, so the 24h cleanup sweep applies to them
  // too. The client then references the returned paths in /api/chat/send or
  // /api/mission/tasks.
  app.post('/api/chat/upload', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const raw = body['files'] ?? body['file'];
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
      (f): f is File => typeof f !== 'string' && !!f,
    );
    if (list.length === 0) return c.json({ error: 'No files uploaded' }, 400);
    if (list.length > 5) return c.json({ error: 'Max 5 files per message' }, 400);

    const saved: { name: string; path: string; size: number }[] = [];
    for (const file of list) {
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.length > 50 * 1024 * 1024) {
        return c.json({ error: `"${file.name}" is too large (max 50MB)` }, 400);
      }
      const safeName = (file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
      const localPath = path.join(UPLOADS_DIR, `dash_${Date.now()}_${saved.length}_${safeName}`);
      fs.writeFileSync(localPath, buf);
      saved.push({ name: file.name || safeName, path: localPath, size: buf.length });
    }
    logger.info({ count: saved.length }, 'Dashboard chat attachments uploaded');
    return c.json({ files: saved });
  });

  // Send message from dashboard
  app.post('/api/chat/send', async (c) => {
    if (!relayToUser) return c.json({ error: 'Chat relay not available' }, 503);
    const body = await c.req.json<{ message?: string; attachments?: { path?: string; name?: string }[] }>();
    let message = body?.message?.trim() || '';

    const resolved = resolveUploadAttachments(body?.attachments);
    if (resolved.error) return c.json({ error: resolved.error }, 400);
    const attachments = resolved.atts;

    if (!message && attachments.length === 0) {
      return c.json({ error: 'message required' }, 400);
    }

    if (attachments.length > 0) {
      const block = attachmentPromptBlock(attachments);
      message = message ? `${message}\n\n${block}` : block;
    }

    // Reject if a turn is already in flight. Without this guard, rapid
    // clicks (or a scripted token holder) can stack N agent invocations,
    // each consuming context and Anthropic budget.
    if (getIsProcessing().processing) {
      return c.json({ error: 'busy', reason: 'already_processing' }, 429);
    }

    // Fire-and-forget: response comes via SSE
    void processMessageFromDashboard(relayToUser, message);
    return c.json({ ok: true });
  });

  // Abort current processing
  app.post('/api/chat/abort', (c) => {
    const { chatId } = getIsProcessing();
    if (!chatId) return c.json({ ok: false, reason: 'not_processing' });
    const aborted = abortActiveQuery(chatId);
    return c.json({ ok: aborted });
  });

  // SPA catch-all — any unmatched GET to a non-/api/* path falls through
  // to here and serves the v2 SPA index.html. Wouter (the SPA's router)
  // then takes over client-side. This is what makes a hard-refresh of
  // /mission, /scheduled, /agents, /agents/:id/files, /chat, /memories,
  // /hive, /usage, /audit, /settings work without a token: the page
  // loads the SPA, which reads ?token= from the URL or sessionStorage
  // before making any API call.
  app.get('*', (c) => {
    const path = new URL(c.req.url).pathname;
    // /api/* would have been gated earlier, but if it slipped through
    // somehow (no handler matched), still don't serve the SPA.
    if (path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
    if (!fs.existsSync(newDashboardIndex)) {
      return c.text('Dashboard not built. Run `npm run build`.', 503);
    }
    const html = fs.readFileSync(newDashboardIndex, 'utf-8');
    return c.html(html);
  });

  return app;
}

/**
 * Start the dashboard: build the Hono app, bind it to DASHBOARD_PORT, and
 * wire up the WebSocket proxy for the voice War Room.
 */
export function startDashboard(relayToUser?: (text: string) => Promise<void>): void {
  if (!DASHBOARD_TOKEN) {
    logger.info('DASHBOARD_TOKEN not set, dashboard disabled');
    return;
  }

  const app = buildDashboardApp(relayToUser);

  // Default to loopback. Anyone on the same LAN is otherwise one
  // dashboard-token leak away from full mutation access. Operators who
  // want Cloudflare-tunneled or LAN access opt in via DASHBOARD_BIND in
  // .env (e.g. `DASHBOARD_BIND=0.0.0.0`).
  const bindHost = (process.env.DASHBOARD_BIND || '127.0.0.1').trim() || '127.0.0.1';
  if (bindHost !== '127.0.0.1' && bindHost !== 'localhost') {
    logger.warn(
      { bindHost, port: DASHBOARD_PORT },
      'Dashboard binding to a non-loopback address — every host that can reach this port can hit the dashboard if the token leaks. Confirm DASHBOARD_BIND is intentional.',
    );
  }
  let server: ReturnType<typeof serve>;
  try {
    server = serve({ fetch: app.fetch, port: DASHBOARD_PORT, hostname: bindHost }, () => {
      logger.info({ port: DASHBOARD_PORT, host: bindHost }, 'Dashboard server running');
    });
    // Start the text War Room channel sweeper so abandoned meetings
    // don't accumulate MeetingChannel instances in memory.
    startChannelSweeper();
  } catch (err: any) {
    if (err?.code === 'EADDRINUSE') {
      logger.error({ port: DASHBOARD_PORT }, 'Dashboard port already in use. Change DASHBOARD_PORT in .env or kill the process using port %d.', DASHBOARD_PORT);
    } else {
      logger.error({ err }, 'Dashboard server failed to start');
    }
    return;
  }

  // ── WebSocket proxy: /ws/warroom → localhost:WARROOM_PORT ──────────
  // Allows the War Room to work through a single Cloudflare tunnel on
  // the dashboard port. Without this, remote/mobile users can't reach
  // the Python WebSocket server on port 7860.
  if (WARROOM_ENABLED) {
    void import('ws').then((wsModule: any) => {
    const WS = wsModule.default?.WebSocket ?? wsModule.WebSocket;
    const WSServer = wsModule.default?.WebSocketServer ?? wsModule.WebSocketServer;

    if (WSServer) {
      const wss = new WSServer({ noServer: true });

      // Bound on the buffered queue used while the backend WS is still
      // opening. Without these, an unauthenticated or slow client could
      // flood the proxy and grow node memory unbounded. Numbers are
      // generous for real audio bursts (16kHz PCM16 @ ~50fps) during the
      // <1s backend open window but small enough to reject abuse.
      const MAX_BUFFERED_MESSAGES = 256;
      const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

      (server as unknown as import('http').Server).on('upgrade', (
        req: import('http').IncomingMessage,
        socket: import('stream').Duplex,
        head: Buffer,
      ) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        if (url.pathname !== '/ws/warroom') return;

        // Enforce the same token gate Hono enforces on every other route.
        // Without this, anyone who can reach the dashboard port could
        // proxy into the local Pipecat War Room socket with no auth.
        const token = url.searchParams.get('token');
        if (!DASHBOARD_TOKEN || token !== DASHBOARD_TOKEN) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (clientWs: any) => {
          const remote = new WS(`ws://127.0.0.1:${WARROOM_PORT}`);
          let remoteReady = false;
          const buffered: (Buffer | ArrayBuffer | string)[] = [];
          let bufferedBytes = 0;

          remote.on('open', () => {
            remoteReady = true;
            for (const msg of buffered) remote.send(msg);
            buffered.length = 0;
            bufferedBytes = 0;
          });
          remote.on('message', (data: Buffer | ArrayBuffer | string) => {
            if (clientWs.readyState === 1) clientWs.send(data);
          });
          remote.on('close', () => clientWs.close());
          remote.on('error', (err: Error) => {
            logger.warn({ err }, 'War Room WS proxy: remote error');
            try { clientWs.close(1011, 'War Room server error'); } catch { /* ok */ }
          });

          clientWs.on('message', (data: Buffer | ArrayBuffer | string) => {
            if (remoteReady) { remote.send(data); return; }
            const size = typeof data === 'string'
              ? Buffer.byteLength(data)
              : (data as Buffer | ArrayBuffer).byteLength ?? 0;
            if (buffered.length >= MAX_BUFFERED_MESSAGES || bufferedBytes + size > MAX_BUFFERED_BYTES) {
              logger.warn({ buffered: buffered.length, bufferedBytes }, 'War Room WS proxy: buffer overflow, closing client');
              try { clientWs.close(1013, 'backend not ready'); } catch { /* ok */ }
              try { remote.close(); } catch { /* ok */ }
              return;
            }
            buffered.push(data);
            bufferedBytes += size;
          });
          clientWs.on('close', () => {
            if (remote.readyState <= 1) remote.close();
          });
        });
      });

      logger.info('War Room WebSocket proxy active at /ws/warroom');
    }
    }).catch((err: unknown) => {
      logger.warn({ err }, 'Could not set up War Room WS proxy');
    });
  }
}
