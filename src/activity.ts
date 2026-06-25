/**
 * The curated Activity read model (TRUST-01 / D-06). Merges the two existing
 * event sources into one reverse-chronological, deduped, tag-derived,
 * attribution-carrying feed:
 *
 *   1. approval_queue (all statuses): the source of truth for anything that
 *      was queued; the ONLY place captured tool_input lives, so the only rows
 *      that can be undoable.
 *   2. audit_log WHERE action='permission' AND detail.outcome IN
 *      ('allow','approved-inline'): the "Ran on its own" / chat-approved set
 *      that never touched the queue. These rows carry NO tool_input.
 *
 * Dedupe (RESEARCH Pitfall 2): a queued action writes BOTH an audit
 * outcome='queued' row and an approval_queue row. The audit read excludes
 * 'queued' (and 'denied-inline'), so approval_queue owns it and it renders once.
 *
 * Tags are derived read-side from source + status (D-06); no tag column, no
 * touching the Phase 3 write path. Phrases come from the deterministic
 * phraseFor map for rows with tool_input, and from the params-free summarize()
 * fallback for audit allow rows.
 *
 * Security (L-4 / ASVS V8): only param-level fields already stored are surfaced.
 * No env, secret, or scrubbed-SDK material is ever copied into a feed row.
 */

import { getDb } from './db.js';
import { summarize, type Tier } from './gate.js';
import { phraseFor } from './activity-render.js';
import { listApprovals, type ApprovalRow } from './approval-queue.js';

/** Derived tag for a feed row (D-06). Distinct honest states, never dropped. */
export type ActivityTag =
  | 'Needs you'
  | 'You approved'
  | 'Ran on its own'
  | 'Denied'
  | 'Expired';

/** A single curated feed row. Carries only param-level fields already stored. */
export interface ActivityRow {
  /** Which table the row came from. */
  source: 'queue' | 'audit';
  /** Source-table row id (approval_queue.id or audit_log.id). */
  id: number;
  agent_id: string;
  tool_name: string;
  tier: number;
  /** Captured params for queue rows; always {} for audit rows (no params stored). */
  tool_input: Record<string, unknown>;
  /** Plain-language one-liner (phraseFor for queue rows, summarize for audit). */
  phrase: string;
  /** Read-side derived tag (D-06). */
  tag: ActivityTag;
  /** True only when a real inverse can run: queue row, allowlisted, tier<4, has params. */
  undoable: boolean;
  /** UNIX seconds, used for reverse-chron ordering and day grouping. */
  created_at: number;
}

/** Options for buildActivityFeed. */
export interface ActivityFeedOptions {
  /** all | autonomous | needsyou | <agent_id>. Omitted = all. */
  filter?: string;
  /** Max rows to return (after merge + order). Defaults to 100. */
  limit?: number;
}

/** Shape of a permission audit row's decoded detail. */
interface PermissionDetail {
  tool?: string;
  tier?: number;
  outcome?: string;
  queueId?: number | string;
}

/**
 * The undo allowlist predicate: the single source of truth for which tool
 * families have a known safe inverse (drafts, meetings, labels). undo-executor.ts
 * (plan 03) reuses THIS predicate so the feed's `undoable` flag and the executor's
 * dispatch can never drift apart. Everything not matched here is honestly "no undo".
 *
 * @param toolName - The forward tool name (e.g. `mcp__gmail__create-draft`).
 * @returns True iff the tool belongs to a reversible family.
 */
export function isUndoableFamily(toolName: string): boolean {
  // drafts: create -> delete; meetings/events: create -> cancel; labels: apply -> remove.
  return (
    /draft/i.test(toolName) ||
    /(calendar|gcal|event|meeting)/i.test(toolName) ||
    /label/i.test(toolName)
  );
}

/** Defensively decode a permission audit row's JSON detail; never eval, never throws. */
function parseDetail(raw: string): PermissionDetail {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as PermissionDetail;
    }
  } catch {
    /* corrupt detail never crashes a read */
  }
  return {};
}

/** Derive the read-side tag for an approval_queue row (D-06). */
function tagForQueueStatus(status: ApprovalRow['status']): ActivityTag {
  switch (status) {
    case 'pending':
      return 'Needs you';
    case 'approved':
      return 'You approved';
    case 'denied':
      return 'Denied';
    case 'expired':
      return 'Expired';
    default:
      return 'Denied';
  }
}

/** Map an approval_queue row to a curated feed row. */
function rowFromQueue(r: ApprovalRow): ActivityRow {
  const hasInput = Object.keys(r.tool_input).length > 0;
  const undoable =
    isUndoableFamily(r.tool_name) &&
    r.tier < 4 &&
    hasInput &&
    r.status === 'approved';
  return {
    source: 'queue',
    id: r.id,
    agent_id: r.agent_id,
    tool_name: r.tool_name,
    tier: r.tier,
    tool_input: r.tool_input,
    phrase: phraseFor(r.tool_name, r.tool_input, r.tier),
    tag: tagForQueueStatus(r.status),
    undoable,
    created_at: r.created_at,
  };
}

/** Map an audit permission row (allow / approved-inline) to a curated feed row. */
function rowFromAudit(id: number, agentId: string, createdAt: number, detail: PermissionDetail): ActivityRow {
  const tool = String(detail.tool ?? 'unknown');
  const tier = typeof detail.tier === 'number' ? detail.tier : 0;
  return {
    source: 'audit',
    id,
    agent_id: agentId,
    tool_name: tool,
    tier,
    // Audit permission rows carry NO tool_input; the params live only on the queue.
    tool_input: {},
    // No params to phrase from, so use the params-free fallback (honest, coarse).
    phrase: summarize(tool, tier as Tier),
    tag: 'Ran on its own',
    // No tool_input means no possible inverse: never undoable.
    undoable: false,
    created_at: createdAt,
  };
}

/** Apply the read-side filter to a merged row set. */
function applyFilter(rows: ActivityRow[], filter?: string): ActivityRow[] {
  if (!filter || filter === 'all') return rows;
  if (filter === 'autonomous') return rows.filter((r) => r.tag === 'Ran on its own');
  if (filter === 'needsyou') return rows.filter((r) => r.tag === 'Needs you');
  // Otherwise treat the filter as an agent_id (per-teammate chip, D-11).
  return rows.filter((r) => r.agent_id === filter);
}

/**
 * Build the curated Activity feed: merge approval_queue + permission audit rows,
 * dedupe (audit query excludes queued so the queue owns it), derive tags
 * read-side, attribute by agent_id, mark undoable per the shared allowlist, and
 * order reverse-chronologically (created_at DESC, id DESC).
 *
 * @param options - Optional read-side filter and row limit.
 * @returns Curated, ordered feed rows carrying only param-level fields.
 */
export function buildActivityFeed(options: ActivityFeedOptions = {}): ActivityRow[] {
  const limit = options.limit ?? 100;
  // Over-fetch a bounded multiple per source so the merged feed can satisfy
  // `limit` regardless of which source dominates, without loading whole tables
  // (CR-02 / IN-02). The final .slice(0, limit) still caps the response.
  const sourceLimit = limit * 2;

  // 1. approval_queue, all statuses; source of truth for anything queued.
  //    Bounded at the DB layer (IN-02) so a huge queue never loads in full.
  const queueRows = listApprovals(
    ['pending', 'approved', 'denied', 'expired'],
    sourceLimit,
  ).map(rowFromQueue);

  // 2. audit_log permission rows, filtered to the non-queued set ('allow' /
  //    'approved-inline'). This filter IS the dedupe: a queued action's audit
  //    row (outcome='queued') is excluded, so approval_queue owns it. The
  //    outcome filter is pushed into SQL and the read is bounded with a LIMIT
  //    (CR-02) so a long-running install never deserializes the whole table.
  //    The LIKE is a heuristic prefilter on the detail JSON; parseDetail below
  //    still does the authoritative outcome check.
  const auditRaw = getDb()
    .prepare(
      `SELECT id, agent_id, detail, created_at FROM audit_log
        WHERE action = 'permission'
          AND (detail LIKE '%"outcome":"allow"%' OR detail LIKE '%"outcome":"approved-inline"%')
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )
    .all(sourceLimit) as Array<{ id: number; agent_id: string; detail: string; created_at: number }>;

  const auditRows: ActivityRow[] = [];
  for (const a of auditRaw) {
    const detail = parseDetail(a.detail);
    if (detail.outcome !== 'allow' && detail.outcome !== 'approved-inline') continue;
    auditRows.push(rowFromAudit(a.id, a.agent_id, a.created_at, detail));
  }

  // Merge + reverse-chron (created_at DESC, then id DESC as a stable tiebreak).
  const merged = [...queueRows, ...auditRows].sort((x, y) => {
    if (y.created_at !== x.created_at) return y.created_at - x.created_at;
    return y.id - x.id;
  });

  return applyFilter(merged, options.filter).slice(0, limit);
}
