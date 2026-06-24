// The operator-facing Activity surface (TRUST-01 / D-01..D-11). A reverse-
// chronological, plain-language feed of what the team did, attributed by
// teammate, grouped by day, each row carrying an honest accountability tag.
//
// Deliberately UNLIKE Audit (D-01): card/list visual language echoing
// ApprovalItem, never the dense monospace table of Audit.tsx. The action and
// digest affordances do NOT render in this slice (they land in later plans);
// this is the proof-of-path read surface only. Each row carries a View that
// shows exactly the {tool, tier, outcome} the system captured and says so
// (D-05 honesty), never implying more detail than was stored.

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Pill } from '@/components/Pill';
import { AgentAvatar } from '@/components/AgentAvatar';
import { ConfirmModal } from '@/components/ConfirmModal';
import { apiGet, apiPost } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { teammateColor } from '@/lib/teammate';
import { term } from '@/lib/vocabulary';
import { pushToast } from '@/lib/toasts';

// Mirror of the curated row the GET /api/activity endpoint returns
// (src/activity.ts ActivityRow). Carries only param-level fields, no secrets.
interface ActivityRow {
  source: 'queue' | 'audit';
  id: number;
  agent_id: string;
  tool_name: string;
  tier: number;
  tool_input: Record<string, unknown>;
  phrase: string;
  tag: 'Needs you' | 'You approved' | 'Ran on its own' | 'Denied' | 'Expired';
  undoable: boolean;
  created_at: number;
}

type AgentLite = { id: string; name?: string };

// Tag tone (D-06): the per-row accountability signal is the row's focal point.
type PillTone = 'done' | 'neutral' | 'medium' | 'failed' | 'cancelled';
function toneForTag(tag: ActivityRow['tag']): PillTone {
  switch (tag) {
    case 'You approved':
      return 'done'; // green
    case 'Needs you':
      return 'medium'; // amber
    case 'Denied':
      return 'failed'; // red
    case 'Expired':
      return 'cancelled'; // faint
    case 'Ran on its own':
    default:
      return 'neutral'; // quiet grey
  }
}

// Local-timezone day key + a quiet human label (TODAY / YESTERDAY / "MON, JUN 23").
function dayKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'TODAY';
  if (diffDays === 1) return 'YESTERDAY';
  return d
    .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase();
}

// Clock time for the meta line ("9:12am"), local timezone, no monospace.
function clockTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()
    .replace(/\s/g, '');
}

// The fixed chips, then one chip per teammate seen in the feed (D-11).
type FilterValue = 'all' | 'autonomous' | 'needsyou' | string;

export function Activity() {
  const [filter, setFilter] = useState<FilterValue>('all');
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [agents, setAgents] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The set of teammate ids seen across the session, so narrowing to one
  // teammate doesn't make the other chips vanish (matches Audit's sticky set).
  const [knownTeammates, setKnownTeammates] = useState<string[]>([]);
  const [openRow, setOpenRow] = useState<number | null>(null);
  // Summarize Today (D-10): operator-invoked only. summary holds the digest or
  // the honest degrade; never auto-runs on mount, never summarizes per row.
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  // Run the daily digest. Always renders an honest line: the model paragraph,
  // or "Couldn't summarize right now. The feed below is complete." on failure
  // or when the LLM_SPAWN_ENABLED kill-switch is off. Never a generic error.
  const summarizeToday = useCallback(async () => {
    setSummarizing(true);
    try {
      const res = await apiPost<{ ok: boolean; text?: string }>('/api/activity/summarize');
      setSummary(res.text || "Couldn't summarize right now. The feed below is complete.");
    } catch {
      setSummary("Couldn't summarize right now. The feed below is complete.");
    } finally {
      setSummarizing(false);
    }
  }, []);

  // Resolve teammate display names once (best effort; falls back to agent_id).
  useEffect(() => {
    let cancelled = false;
    apiGet<{ agents: AgentLite[] }>('/api/agents')
      .then((data) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const a of data.agents) map[a.id] = a.name || a.id;
        setAgents(map);
      })
      .catch(() => {
        /* names are a nicety; the feed renders fine without them */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Read-side filtering: pass the active filter straight to the endpoint (D-11).
  const load = useCallback(
    (signal?: { cancelled: boolean }) => {
      setLoading(true);
      setError(null);
      const q = filter === 'all' ? '' : `?filter=${encodeURIComponent(filter)}`;
      return apiGet<{ rows: ActivityRow[] }>(`/api/activity${q}`)
        .then((data) => {
          if (signal?.cancelled) return;
          setRows(data.rows);
          setKnownTeammates((prev) => {
            const next = new Set(prev);
            for (const r of data.rows) next.add(r.agent_id);
            return Array.from(next).sort();
          });
        })
        .catch((err: any) => {
          if (!signal?.cancelled) setError(err?.message || String(err));
        })
        .finally(() => {
          if (!signal?.cancelled) setLoading(false);
        });
    },
    [filter],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  const teammateName = (id: string) => agents[id] || id;

  // Group the (already reverse-chron) rows by local day, preserving order.
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; rows: ActivityRow[] }> = [];
    let current: { key: string; label: string; rows: ActivityRow[] } | null = null;
    for (const r of rows) {
      const key = dayKey(r.created_at);
      if (!current || current.key !== key) {
        current = { key, label: dayLabel(r.created_at), rows: [] };
        out.push(current);
      }
      current.rows.push(r);
    }
    return out;
  }, [rows]);

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={term('page.activity')}
        actions={
          <>
            <span class="text-[11px] text-[var(--color-text-muted)]">What your team did</span>
            <button
              type="button"
              onClick={() => void summarizeToday()}
              disabled={summarizing}
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
            >
              {summarizing ? 'Summarizing…' : 'Summarize Today'}
            </button>
          </>
        }
        tabs={
          <>
            <Tab label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
            <Tab
              label="Ran on its own"
              active={filter === 'autonomous'}
              onClick={() => setFilter('autonomous')}
            />
            <Tab
              label="Needs you"
              active={filter === 'needsyou'}
              onClick={() => setFilter('needsyou')}
            />
            {knownTeammates.length > 0 && (
              <span class="mx-1 text-[var(--color-text-faint)]">·</span>
            )}
            {knownTeammates.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                class={[
                  'px-3 py-1 rounded-md text-[12px] transition-colors flex items-center gap-1.5',
                  filter === id
                    ? 'bg-[var(--color-elevated)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]',
                ].join(' ')}
              >
                <span
                  class="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: teammateColor(id) }}
                />
                {teammateName(id)}
              </button>
            ))}
          </>
        }
      />

      {/* Summarize Today result: a quiet inline panel near the header, not a
          per-row element. Renders the plain-language paragraph (weight 400) or
          the honest degrade. Operator-invoked; absent until the action runs. */}
      {summary && (
        <div class="mx-6 mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-[12.5px] font-normal leading-snug text-[var(--color-text)]">
          {summary}
        </div>
      )}

      {error && <PageState error={error} />}
      {loading && rows.length === 0 && <PageState loading />}
      {!loading && !error && rows.length === 0 && (
        <PageState
          empty
          emptyTitle="Nothing yet today"
          emptyDescription="When your team does something, it shows up here. You will see what ran on its own and what is waiting on you."
        />
      )}

      {rows.length > 0 && (
        <div class="flex-1 overflow-y-auto px-6 py-4">
          {groups.map((g) => (
            <div key={g.key} class="mb-8">
              <div class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-2">
                {g.label}
              </div>
              <div class="flex flex-col gap-4">
                {g.rows.map((r) => (
                  <ActivityRowCard
                    key={`${r.source}-${r.id}`}
                    row={r}
                    teammate={teammateName(r.agent_id)}
                    open={openRow === rowUid(r)}
                    onToggle={() =>
                      setOpenRow(openRow === rowUid(r) ? null : rowUid(r))
                    }
                    onUndone={() => void load()}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// A stable per-row identity across the merged queue + audit sources.
function rowUid(r: ActivityRow): number {
  return (r.source === 'queue' ? 1 : 2) * 1_000_000 + r.id;
}

// Name the concrete inverse so the confirmation says exactly what Undo will do
// (D-08 honesty). Falls back to a generic but truthful line for an allowlisted
// family without a more specific phrase. No em dashes.
function undoCopy(toolName: string): { body: string; success: string } {
  if (/draft/i.test(toolName)) {
    return { body: 'This will delete the draft.', success: 'Draft deleted.' };
  }
  if (/label/i.test(toolName)) {
    return { body: 'This will remove the label.', success: 'Label removed.' };
  }
  if (/(calendar|gcal|event|meeting)/i.test(toolName)) {
    return { body: 'This will cancel the meeting.', success: 'Meeting cancelled.' };
  }
  return { body: 'This will reverse the action.', success: 'Undone.' };
}

// One feed row, echoing the ApprovalItem card anatomy (card on --color-elevated,
// border, rounded-md, p-3). Teammate dot, plain-language phrase, meta line, the
// right-aligned accountability tag, an honest View toggle, and (only when the
// row is genuinely undoable) an Undo affordance that runs a real inverse.
function ActivityRowCard({
  row,
  teammate,
  open,
  onToggle,
  onUndone,
}: {
  row: ActivityRow;
  teammate: string;
  open: boolean;
  onToggle: () => void;
  onUndone: () => void;
}) {
  // Undo interaction model mirrors ApprovalItem: busy + honest-failure state,
  // a destructive ConfirmModal, apiPost, and a success / honest-failure toast.
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const copy = undoCopy(row.tool_name);

  async function undoNow() {
    setBusy(true);
    setFailure(null);
    try {
      const res = await apiPost<{ ok: boolean; result?: string; error?: string }>(
        `/api/activity/${row.id}/undo`,
      );
      if (res.ok) {
        pushToast({ tone: 'success', title: 'Undone.', description: res.result || copy.success });
        onUndone();
      } else {
        // The route ran (or refused) honestly. Surface the verbatim reason,
        // never a generic failure line. If a server is absent the reason
        // itself reads "Connect Gmail in Settings to undo this."
        const reason = res.result || res.error || 'Could not undo this action.';
        setFailure(reason);
        pushToast({ tone: 'error', title: 'Could not undo', description: reason, durationMs: 6000 });
        onUndone();
      }
    } catch (err: any) {
      const reason = err?.body?.error || err?.message || String(err);
      setFailure(reason);
      pushToast({ tone: 'error', title: 'Could not undo', description: reason, durationMs: 6000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-3">
      <div class="flex items-start gap-2">
        <span
          class="inline-block w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
          style={{ backgroundColor: teammateColor(row.agent_id) }}
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-start gap-2">
            <div class="text-[12.5px] text-[var(--color-text)] leading-snug line-clamp-2 flex-1">
              {row.phrase}
            </div>
            <Pill tone={toneForTag(row.tag)}>{row.tag}</Pill>
          </div>
          <div class="flex items-center gap-1.5 mt-1 text-[11px] text-[var(--color-text-muted)]">
            <AgentAvatar agentId={row.agent_id} name={teammate} size={16} />
            <span class="truncate tabular-nums">
              {teammate} · {clockTime(row.created_at)}
            </span>
            <button
              type="button"
              onClick={onToggle}
              class="ml-auto text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              {open ? 'Hide' : 'View'}
            </button>
            {/* Undo renders ONLY when the row is genuinely undoable (server-
                computed flag: approved + allowlisted + tier<4 + has params).
                Otherwise it is ABSENT, never a dead or no-op button
                (D-07/D-08/D-09; UI-SPEC interaction table). */}
            {row.undoable && (
              <button
                type="button"
                onClick={() => setConfirmUndo(true)}
                disabled={busy}
                class="text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] transition-colors disabled:opacity-40"
              >
                {busy ? '…' : 'Undo'}
              </button>
            )}
          </div>

          {failure && (
            <div class="text-[10.5px] text-[var(--color-status-failed)] font-mono line-clamp-2 mt-1.5">
              {failure}
            </div>
          )}

          {open && (
            <div class="mt-2 pt-2 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)] flex flex-col gap-0.5">
              <div>
                Tool: <span class="text-[var(--color-text)]">{row.tool_name}</span>
              </div>
              <div>
                Tier: <span class="text-[var(--color-text)]">{row.tier}</span>
              </div>
              <div>
                Tag: <span class="text-[var(--color-text)]">{row.tag}</span>
              </div>
              {row.source === 'audit' && (
                <div class="text-[var(--color-text-faint)] mt-1 leading-snug">
                  This action ran on its own, so only the tool and tier were
                  captured. There are no further details to show.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {row.undoable && (
        <ConfirmModal
          open={confirmUndo}
          onClose={() => setConfirmUndo(false)}
          onConfirm={() => void undoNow()}
          title="Undo this?"
          body={copy.body}
          confirmLabel="Undo"
          destructive
        />
      )}
    </div>
  );
}
