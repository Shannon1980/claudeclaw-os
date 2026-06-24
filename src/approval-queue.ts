/**
 * The approval queue (PERM-04) — persistence + state machine for background
 * "ask" outcomes from the permission gate.
 *
 * When a non-attended run (scheduler / mission / routine step) hits a Tier 3/4
 * "ask", the gate enqueues a `pending` row here and denies immediately so the
 * subprocess never blocks for hours (P-2). The operator later approves or
 * denies from the dashboard. The approve transition is STATUS-GUARDED so the
 * dashboard click and a scheduler poll cannot double-replay the captured action
 * (L-3): the UPDATE only fires `WHERE status='pending'`, and the function
 * reports whether it actually changed a row (`.changes === 1`).
 *
 * Security (L-4 / ASVS V8): `tool_input` stores ONLY the model-supplied tool
 * params as JSON — never env, secrets, or the scrubbed SDK environment. Long
 * text fields are capped (mirrors the saveRoutineRun .slice precedent). On
 * read, tool_input is JSON.parsed defensively (never eval'd).
 */

import { getDb } from './db.js';
import { summarize, type Tier } from './gate.js';

/** A row as stored, with tool_input already parsed back to an object. */
export interface ApprovalRow {
  id: number;
  agent_id: string;
  chat_id: string;
  run_id: string | null;
  routine_id: string | null;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tier: number;
  mode_at_decision: string;
  summary: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  decided_at: number | null;
  result: string | null;
  created_at: number;
}

/** Raw DB row shape (tool_input/result still JSON/text strings). */
interface RawApprovalRow extends Omit<ApprovalRow, 'tool_input'> {
  tool_input: string;
}

export interface EnqueueApprovalInput {
  toolName: string;
  toolInput: Record<string, unknown>;
  tier: number;
  modeAtDecision: string;
  summary?: string;
  agentId?: string;
  chatId?: string;
  runId?: string;
  routineId?: string;
}

// Mirror saveRoutineRun's 4000-char cap so a runaway model-supplied param
// (e.g. a giant email body) can't bloat the row unbounded.
const TEXT_CAP = 4000;

/**
 * Insert a `pending` approval row and return its id. Stores ONLY the captured
 * model-supplied tool params (never env/secrets, L-4). The serialized
 * tool_input is capped so an oversized param can't bloat the row.
 */
export function enqueueApproval(input: EnqueueApprovalInput): number {
  const now = Math.floor(Date.now() / 1000);
  const toolInputJson = JSON.stringify(input.toolInput ?? {}).slice(0, 200_000);
  const result = getDb()
    .prepare(
      `INSERT INTO approval_queue
         (agent_id, chat_id, run_id, routine_id, tool_name, tool_input,
          tier, mode_at_decision, summary, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      input.agentId ?? 'main',
      input.chatId ?? '',
      input.runId ?? null,
      input.routineId ?? null,
      input.toolName,
      toolInputJson,
      input.tier,
      input.modeAtDecision,
      (input.summary ?? '').slice(0, TEXT_CAP),
      now,
    );
  return Number(result.lastInsertRowid);
}

/**
 * Adapter matching the gate's `GateContext.enqueue` signature
 * (`{toolName,input,tier,mode,agentId,chatId,runId}` → id). Maps the gate's
 * field names onto enqueueApproval and derives a plain-language summary that
 * carries ONLY the tool name + tier (never the input params — L-4). Wired into
 * runAgent as the default background enqueue path.
 */
export function gateEnqueue(item: {
  toolName: string;
  input: Record<string, unknown>;
  tier: Tier;
  mode: string;
  agentId?: string;
  chatId?: string;
  runId?: string;
  routineId?: string;
}): number {
  return enqueueApproval({
    toolName: item.toolName,
    toolInput: item.input,
    tier: item.tier,
    modeAtDecision: item.mode,
    summary: summarize(item.toolName, item.tier),
    agentId: item.agentId,
    chatId: item.chatId,
    runId: item.runId,
    routineId: item.routineId,
  });
}

/** Defensively parse a stored tool_input JSON string; never eval (ASVS V5). */
function parseToolInput(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through to empty object — corrupt row never crashes a read */
  }
  return {};
}

function hydrate(row: RawApprovalRow): ApprovalRow {
  return { ...row, tool_input: parseToolInput(row.tool_input) };
}

/** All pending rows, most recent first. */
export function listPending(): ApprovalRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM approval_queue WHERE status = 'pending' ORDER BY created_at DESC, id DESC`,
    )
    .all() as RawApprovalRow[];
  return rows.map(hydrate);
}

/**
 * Fetch a single approval row by id, in ANY status (the Activity feed and Undo
 * target approved/denied/expired rows, not just pending). Read-only: same
 * defensive hydrate as listPending, so a corrupt tool_input yields {} and never
 * crashes the read. Returns undefined when no row matches.
 */
export function getApprovalById(id: number): ApprovalRow | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM approval_queue WHERE id = ?`)
    .get(id) as RawApprovalRow | undefined;
  return row ? hydrate(row) : undefined;
}

/**
 * Rows in any of the given statuses, most recent first (created_at DESC, id
 * DESC, matching listPending). Uses a parameterized IN list so no status value
 * is string-interpolated into the SQL. An empty status set returns no rows.
 */
export function listApprovals(statuses: ApprovalRow['status'][]): ApprovalRow[] {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(
      `SELECT * FROM approval_queue WHERE status IN (${placeholders}) ORDER BY created_at DESC, id DESC`,
    )
    .all(...statuses) as RawApprovalRow[];
  return rows.map(hydrate);
}

/**
 * Approve a pending row, recording the replay result. STATUS-GUARDED (L-3):
 * only acts if the row is still `pending`. Returns true iff exactly one row
 * changed — a second approve (or a poll race) is a no-op returning false.
 */
export function approve(id: number, result?: unknown): boolean {
  const now = Math.floor(Date.now() / 1000);
  const resultText =
    result === undefined ? null : JSON.stringify(result).slice(0, TEXT_CAP);
  const info = getDb()
    .prepare(
      `UPDATE approval_queue
          SET status = 'approved', decided_at = ?, result = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .run(now, resultText, id);
  return info.changes === 1;
}

/**
 * Deny a pending row. STATUS-GUARDED (L-3) — same replay-once semantics as
 * approve. Returns true iff exactly one row changed.
 */
export function deny(id: number, result?: unknown): boolean {
  const now = Math.floor(Date.now() / 1000);
  const resultText =
    result === undefined ? null : JSON.stringify(result).slice(0, TEXT_CAP);
  const info = getDb()
    .prepare(
      `UPDATE approval_queue
          SET status = 'denied', decided_at = ?, result = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .run(now, resultText, id);
  return info.changes === 1;
}

/**
 * Flip pending rows older than `cutoffEpochSeconds` to `expired`. Status-guarded
 * so an already-decided row is never reopened. Returns the number expired.
 */
export function expireOlderThan(cutoffEpochSeconds: number): number {
  const now = Math.floor(Date.now() / 1000);
  const info = getDb()
    .prepare(
      `UPDATE approval_queue
          SET status = 'expired', decided_at = ?
        WHERE status = 'pending' AND created_at < ?`,
    )
    .run(now, cutoffEpochSeconds);
  return info.changes;
}
