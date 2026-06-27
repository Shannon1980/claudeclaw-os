// Shared daily-loop building blocks (operator-product 03-home.md / 04-projects.md).
//
// Home renders the all-projects loop; a project detail renders the SAME loop
// scoped to one project. Both compose these pieces so the two surfaces never
// fork — "reuse Home components, do not build a parallel layout."

import { useState } from 'preact/hooks';
import {
  Inbox, Hourglass, CheckCircle2, X, Wand2, Sparkles, Trash2, ArrowRight,
  Clock, Undo2, PauseCircle, RotateCcw,
} from 'lucide-preact';
import { Pill, StatusDot } from '@/components/Pill';
import { AgentAvatar } from '@/components/AgentAvatar';
import { ApprovalItem, type Approval } from '@/components/ApprovalItem';
import { type MissionTask, type Agent } from '@/components/TaskModals';
import { apiPost, apiPatch, apiDelete } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { pushToast } from '@/lib/toasts';

export interface TodaySuggestion { id: string; kind: 'routine'; text: string; when: number | null }
export interface HomeSummary {
  needsYou: MissionTask[];
  onPlate: MissionTask[];
  waiting: MissionTask[];
  shipped: MissionTask[];
  today: TodaySuggestion[];
  status: { needsYou: number; waiting: number; shipped: number; hasAnyWork: boolean };
}

// ── Needs you / Today ───────────────────────────────────────────────

export function NeedsYouCard({ needsYou, approvals, today, starters, agents, agentById, onChange, onSuggest, variant }: {
  needsYou: MissionTask[];
  approvals?: Approval[];
  today?: TodaySuggestion[];
  starters?: string[];
  agents: Agent[];
  agentById: Map<string, Agent>;
  onChange: () => void;
  onSuggest?: (text: string) => void;
  variant: 'home' | 'project';
}) {
  const approvalItems = approvals ?? [];
  // Gated approval items are decisions only the operator can make — they count
  // toward "Needs you" alongside flagged tasks (do not render a zero, spec 03).
  const hasNeeds = needsYou.length > 0 || approvalItems.length > 0;
  const needsCount = needsYou.length + approvalItems.length;
  const todayItems = today ?? [];
  const starterItems = starters ?? [];
  const title = hasNeeds ? 'Needs you' : variant === 'home' ? 'Today' : 'Needs you';
  const subtitle = hasNeeds
    ? 'Decisions only you can make'
    : variant === 'home' ? 'A few ways to get me going' : 'Nothing needs your input here';

  return (
    <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div class="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center gap-2">
        <span class="text-[13px] font-semibold text-[var(--color-text)]">{title}</span>
        {hasNeeds && <span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">{needsCount}</span>}
        <span class="ml-auto text-[11px] text-[var(--color-text-faint)]">{subtitle}</span>
      </div>
      <div class="p-2.5 space-y-1.5">
        {hasNeeds ? (
          <>
            {approvalItems.map((a) => (
              <ApprovalItem key={`approval-${a.id}`} approval={a} agent={agentById.get(a.agent_id)} onChange={onChange} />
            ))}
            {needsYou.slice(0, 6).map((t) => (
              <NeedsItem key={t.id} task={t} agents={agents} agentById={agentById} onChange={onChange} />
            ))}
            {needsYou.length > 6 && (
              <div class="text-[11px] text-[var(--color-text-faint)] text-center pt-1">
                +{needsYou.length - 6} more need you
              </div>
            )}
          </>
        ) : (
          <>
            {todayItems.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSuggest?.(`Help me get ready for: ${s.text}`)}
                class="w-full text-left flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)] transition-colors"
              >
                <Clock size={12} class="text-[var(--color-accent)] shrink-0" />
                <span class="flex-1 truncate">Coming up — {s.text}</span>
                {s.when && <span class="text-[10px] text-[var(--color-text-faint)] tabular-nums shrink-0">{formatRelativeTime(s.when)}</span>}
              </button>
            ))}
            {starterItems.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSuggest?.(s)}
                class="w-full text-left flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)] transition-colors group"
              >
                <Sparkles size={12} class="text-[var(--color-accent)] shrink-0" />
                <span class="flex-1">{s}</span>
                <ArrowRight size={12} class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            ))}
            {todayItems.length === 0 && starterItems.length === 0 && (
              <div class="text-[11.5px] text-[var(--color-text-faint)] text-center py-4">Nothing needs you right now.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NeedsItem({ task, agents, agentById, onChange }: {
  task: MissionTask; agents: Agent[]; agentById: Map<string, Agent>; onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const isFailed = task.status === 'failed';

  async function autoAssign() {
    setBusy('auto');
    try {
      const res = await apiPost<{ assigned_agent?: string }>(`/api/mission/tasks/${task.id}/auto-assign`);
      onChange();
      pushToast({ tone: 'success', title: 'Routed', description: res.assigned_agent ? `Sent to ${res.assigned_agent}.` : 'Sent.' });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not route', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(null); }
  }

  async function manualAssign(agentId: string) {
    setBusy('manual');
    try {
      await apiPatch(`/api/mission/tasks/${task.id}`, { assigned_agent: agentId });
      onChange();
      pushToast({ tone: 'success', title: 'Assigned', description: `Sent to ${agentById.get(agentId)?.name || agentId}.` });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Assign failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(null); }
  }

  async function remove() {
    if (!confirm('Dismiss this?')) return;
    setBusy('delete');
    try { await apiDelete(`/api/mission/tasks/${task.id}`); onChange(); }
    catch (err: any) { pushToast({ tone: 'error', title: 'Delete failed', description: err?.message || String(err), durationMs: 6000 }); }
    finally { setBusy(null); }
  }

  async function rerun() {
    setBusy('rerun');
    try {
      await apiPost(`/api/mission/tasks/${task.id}/requeue`);
      onChange();
      pushToast({ tone: 'success', title: 'Re-running', description: 'Back in the queue.' });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not re-run', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(null); }
  }

  return (
    <div class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-2.5">
      <div class="flex items-center gap-1.5 mb-1">
        {isFailed ? <Pill tone="failed">needs a look</Pill> : <Pill tone="neutral">unrouted</Pill>}
        <span class="ml-auto text-[10px] text-[var(--color-text-faint)] tabular-nums">{formatRelativeTime(task.created_at)}</span>
      </div>
      <div class="text-[12.5px] text-[var(--color-text)] leading-snug mb-2 line-clamp-2">{task.title}</div>
      {isFailed && task.error && (
        <div class="text-[10.5px] text-[var(--color-status-failed)] font-mono line-clamp-2 mb-2">{task.error}</div>
      )}
      <div class="flex items-center gap-1">
        {!isFailed && (
          <>
            <button
              type="button"
              onClick={autoAssign}
              disabled={busy !== null}
              class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-medium bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-40"
            >
              <Wand2 size={11} /> {busy === 'auto' ? '…' : 'Route for me'}
            </button>
            <select
              value=""
              onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) manualAssign(v); }}
              disabled={busy !== null}
              class="flex-1 bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[10.5px] text-[var(--color-text-muted)] px-1 py-0.5 outline-none"
            >
              <option value="">Assign to…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            </select>
          </>
        )}
        {isFailed && (
          <button
            type="button"
            onClick={rerun}
            disabled={busy !== null}
            class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors disabled:opacity-40"
            title="Re-run this task"
          >
            <RotateCcw size={11} /> {busy === 'rerun' ? '…' : 'Re-run'}
          </button>
        )}
        {isFailed && <div class="flex-1" />}
        <button
          type="button"
          onClick={remove}
          disabled={busy !== null}
          class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] transition-colors disabled:opacity-40"
          title="Dismiss"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

// ── Three zones ─────────────────────────────────────────────────────

/** On my plate · Waiting on others · Shipped this week — the loop's spine. */
export function LoopZones({ onPlate, waiting, shipped, agentById, onChange }: {
  onPlate: MissionTask[];
  waiting: MissionTask[];
  shipped: MissionTask[];
  agentById: Map<string, Agent>;
  onChange: () => void;
}) {
  return (
    <div class="grid gap-3 md:grid-cols-3">
      <Zone title="On my plate" hint="Active work, and who's on it." icon={Inbox} count={onPlate.length} empty="Nothing in flight.">
        {onPlate.map((t) => (
          <PlateItem key={t.id} task={t} agent={t.assigned_agent ? agentById.get(t.assigned_agent) : undefined} onChange={onChange} />
        ))}
      </Zone>
      <Zone title="Waiting on others" hint="Work blocked on someone else." icon={Hourglass} count={waiting.length} empty="Nothing waiting on anyone right now.">
        {waiting.map((t) => (
          <WaitingItem key={t.id} task={t} agent={t.assigned_agent ? agentById.get(t.assigned_agent) : undefined} onChange={onChange} />
        ))}
      </Zone>
      <Zone title="Shipped this week" hint="Done in the last 7 days." icon={CheckCircle2} count={shipped.length} empty="Nothing shipped yet this week.">
        {shipped.map((t) => (
          <ShippedItem key={t.id} task={t} agent={t.assigned_agent ? agentById.get(t.assigned_agent) : undefined} onChange={onChange} />
        ))}
      </Zone>
    </div>
  );
}

function Zone({ title, hint, icon: Icon, count, empty, children }: {
  title: string; hint: string; icon: typeof Inbox; count: number; empty: string;
  children: any;
}) {
  return (
    <div class="flex flex-col bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden min-h-[160px]">
      <div class="px-3 py-2.5 border-b border-[var(--color-border)] flex items-center gap-2">
        <Icon size={14} class="text-[var(--color-text-muted)]" />
        <div class="flex-1 min-w-0">
          <div class="text-[12.5px] font-medium text-[var(--color-text)]">{title}</div>
          <div class="text-[10px] text-[var(--color-text-faint)]">{hint}</div>
        </div>
        <span class="text-[11.5px] text-[var(--color-text-muted)] tabular-nums">{count}</span>
      </div>
      <div class="flex-1 p-2 space-y-1.5">
        {count === 0
          ? <div class="text-[11.5px] text-[var(--color-text-faint)] text-center py-6">{empty}</div>
          : children}
      </div>
    </div>
  );
}

export function TeammatePill({ agent, fallback }: { agent?: Agent; fallback: string | null }) {
  const label = agent?.name || fallback;
  if (!label) return null;
  return (
    <Pill tone="accent">
      {agent && <AgentAvatar agentId={agent.id} name={agent.name} running={agent.running} size={14} />}
      <span class="max-w-[100px] truncate">{label}</span>
    </Pill>
  );
}

function PlateItem({ task, agent, onChange }: { task: MissionTask; agent?: Agent; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function cancel() {
    setBusy('cancel');
    try { await apiPost(`/api/mission/tasks/${task.id}/cancel`); onChange(); }
    catch (err: any) { pushToast({ tone: 'error', title: 'Cancel failed', description: err?.message || String(err), durationMs: 6000 }); }
    finally { setBusy(null); }
  }

  async function markWaiting() {
    const who = prompt('Waiting on who or what? (e.g. "Sarah, legal" or "client payment")');
    if (who === null) return;
    const trimmed = who.trim();
    if (!trimmed) return;
    setBusy('block');
    try {
      await apiPost(`/api/mission/tasks/${task.id}/block`, { blocked_on: trimmed });
      onChange();
      pushToast({ tone: 'success', title: 'Moved to waiting', description: `Blocked on ${trimmed}.` });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not park', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(null); }
  }

  return (
    <div class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-2.5">
      <div class="flex items-center gap-1.5 mb-1.5">
        <StatusDot tone={task.status === 'running' ? 'running' : 'queued'} />
        <span class="text-[10px] text-[var(--color-text-faint)] uppercase tracking-wider">
          {task.status === 'running' ? 'Working' : 'Queued'}
        </span>
        <span class="ml-auto text-[10px] text-[var(--color-text-faint)] tabular-nums">
          {formatRelativeTime(task.started_at || task.created_at)}
        </span>
      </div>
      <div class="text-[12.5px] text-[var(--color-text)] leading-snug mb-1.5 line-clamp-2">{task.title}</div>
      <div class="flex items-center gap-1.5">
        <TeammatePill agent={agent} fallback={task.assigned_agent} />
        <div class="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={markWaiting}
            disabled={busy !== null}
            class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
            title="Mark waiting on others"
          >
            <PauseCircle size={12} />
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy !== null}
            class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] transition-colors disabled:opacity-40"
            title="Cancel"
          >
            <X size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

function WaitingItem({ task, agent, onChange }: { task: MissionTask; agent?: Agent; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  async function unblock() {
    setBusy(true);
    try {
      await apiPost(`/api/mission/tasks/${task.id}/unblock`);
      onChange();
      pushToast({ tone: 'success', title: 'Back in the queue', description: 'No longer waiting.' });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not unblock', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }

  return (
    <div class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-2.5">
      <div class="flex items-center gap-1.5 mb-1.5">
        <Hourglass size={11} class="text-[var(--color-text-muted)]" />
        <span class="text-[10px] text-[var(--color-text-faint)] uppercase tracking-wider">Waiting</span>
        {task.blocked_since && (
          <span class="ml-auto text-[10px] text-[var(--color-text-faint)] tabular-nums">{formatRelativeTime(task.blocked_since)}</span>
        )}
      </div>
      <div class="text-[12.5px] text-[var(--color-text)] leading-snug mb-1.5 line-clamp-2">{task.title}</div>
      {task.blocked_on && (
        <div class="text-[11px] text-[var(--color-text-muted)] mb-1.5">
          On <span class="text-[var(--color-text)]">{task.blocked_on}</span>
        </div>
      )}
      <div class="flex items-center gap-1.5">
        <TeammatePill agent={agent} fallback={task.assigned_agent} />
        <button
          type="button"
          onClick={unblock}
          disabled={busy}
          class="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors disabled:opacity-40"
          title="Unblock — return to the queue"
        >
          <Undo2 size={11} /> {busy ? '…' : 'Unblock'}
        </button>
      </div>
    </div>
  );
}

function ShippedItem({ task, agent, onChange }: { task: MissionTask; agent?: Agent; onChange: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  async function rerun(e: MouseEvent) {
    e.stopPropagation(); // don't toggle the card's expand on a Re-run click
    setBusy(true);
    try {
      await apiPost(`/api/mission/tasks/${task.id}/requeue`);
      onChange();
      pushToast({ tone: 'success', title: 'Re-running', description: 'Back in the queue.' });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not re-run', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-2.5 cursor-pointer hover:border-[var(--color-border-strong)] transition-colors"
    >
      <div class="flex items-center gap-1.5 mb-1.5">
        <StatusDot tone="done" />
        <span class="text-[10px] text-[var(--color-text-faint)] uppercase tracking-wider">Shipped</span>
        <span class="ml-auto text-[10px] text-[var(--color-text-faint)] tabular-nums">
          {formatRelativeTime(task.completed_at || task.created_at)}
        </span>
      </div>
      <div class={'text-[12.5px] text-[var(--color-text)] leading-snug mb-1.5 ' + (expanded ? '' : 'line-clamp-2')}>{task.title}</div>
      <div class="flex items-center gap-1.5">
        <TeammatePill agent={agent} fallback={task.assigned_agent} />
        <button
          type="button"
          onClick={rerun}
          disabled={busy}
          class="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors disabled:opacity-40"
          title="Re-run this task"
        >
          <RotateCcw size={11} /> {busy ? '…' : 'Re-run'}
        </button>
      </div>
      {expanded && task.result && (
        <div class="mt-2 text-[11px] text-[var(--color-text)] whitespace-pre-wrap leading-relaxed border-t border-[var(--color-border)] pt-2">
          {task.result}
        </div>
      )}
    </div>
  );
}
