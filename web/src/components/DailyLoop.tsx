// Shared daily-loop building blocks (operator-product 03-home.md / 04-projects.md).
//
// Home renders the all-projects loop; a project detail renders the SAME loop
// scoped to one project. Both compose these pieces so the two surfaces never
// fork — "reuse Home components, do not build a parallel layout."

import { useState } from 'preact/hooks';
import {
  Inbox, Hourglass, CheckCircle2, X, Wand2, Sparkles, Trash2, ArrowRight,
  Clock, Undo2, PauseCircle, RotateCcw, ChevronLeft, ChevronRight, History,
} from 'lucide-preact';
import { Pill, StatusDot } from '@/components/Pill';
import { AgentAvatar } from '@/components/AgentAvatar';
import { ApprovalItem, type Approval } from '@/components/ApprovalItem';
import { type MissionTask, type Agent } from '@/components/TaskModals';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { pushToast } from '@/lib/toasts';

/** One turn in a task's blocked-on-you thread (see src/db.ts task_messages). */
interface TaskMessage {
  id: number;
  task_id: string;
  role: 'agent' | 'operator';
  body: string;
  reason: string | null;
  created_at: number;
}

interface MissionTaskRun {
  id: number;
  task_id: string;
  version: number;
  result: string | null;
  status: string;
  error: string | null;
  feedback: string | null;
  created_at: number;
}

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
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState('');
  const [thread, setThread] = useState<TaskMessage[] | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const isFailed = task.status === 'failed';
  // 'needs_you': a teammate ran the task but kicked it back — it needs the
  // operator to unblock it (a missing path, a permission, a decision), not a
  // re-route. Distinct rendering: the reason up top, the full reply on expand.
  const isBlocked = task.status === 'needs_you';
  const settled = isFailed || isBlocked;
  const kicker = task.assigned_agent ? agentById.get(task.assigned_agent) : undefined;

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

  // `answer` folds the operator's reply into the resumed run (needs_you cards);
  // bare re-run just retries (e.g. after the operator granted a gated tool).
  async function rerun(answer?: string) {
    setBusy('rerun');
    try {
      await apiPost(`/api/mission/tasks/${task.id}/requeue`, answer ? { reply: answer } : undefined);
      onChange();
      pushToast({
        tone: 'success',
        title: answer ? 'Sent — resuming' : 'Re-running',
        description: answer ? `Back to ${kicker?.name || 'the agent'} with your answer.` : 'Back in the queue.',
      });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not re-run', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(null); }
  }

  // Lazy-load the thread the first time the operator opens the full context.
  async function toggleDetails() {
    const next = !expanded;
    setExpanded(next);
    if (next && thread === null && !loadingThread) {
      setLoadingThread(true);
      try {
        const res = await apiGet<{ messages: TaskMessage[] }>(`/api/mission/tasks/${task.id}/messages`);
        setThread(res.messages);
      } catch { setThread([]); }
      finally { setLoadingThread(false); }
    }
  }

  return (
    <div class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-2.5">
      <div class="flex items-center gap-1.5 mb-1">
        {isBlocked ? <Pill tone="medium">blocked on you</Pill>
          : isFailed ? <Pill tone="failed">needs a look</Pill>
          : <Pill tone="neutral">unrouted</Pill>}
        {isBlocked && <TeammatePill agent={kicker} fallback={task.assigned_agent} />}
        <span class="ml-auto text-[10px] text-[var(--color-text-faint)] tabular-nums">{formatRelativeTime(task.completed_at || task.created_at)}</span>
      </div>
      <div class="text-[12.5px] text-[var(--color-text)] leading-snug mb-2 line-clamp-2">{task.title}</div>
      {isFailed && task.error && (
        <div class="text-[10.5px] text-[var(--color-status-failed)] font-mono line-clamp-2 mb-2">{task.error}</div>
      )}
      {isBlocked && (
        <>
          {task.error && (
            <div class="text-[11px] text-[var(--color-priority-medium)] leading-snug mb-1.5">{task.error}</div>
          )}
          <button
            type="button"
            onClick={toggleDetails}
            class="text-[10.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors mb-2"
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>
          {/* Full context: the original ask, then the whole back-and-forth so
              the operator can answer with everything in view. */}
          {expanded && (
            <div class="border-t border-[var(--color-border)] pt-2 mb-2 space-y-2">
              <div>
                <div class="text-[9.5px] uppercase tracking-wider text-[var(--color-text-faint)] mb-0.5">Original task</div>
                <div class="text-[11px] text-[var(--color-text-muted)] whitespace-pre-wrap leading-relaxed">{task.prompt}</div>
              </div>
              {loadingThread && <div class="text-[10.5px] text-[var(--color-text-faint)]">Loading…</div>}
              {!loadingThread && thread && thread.length > 0 && thread.map((m) => (
                <div key={m.id}>
                  <div class="text-[9.5px] uppercase tracking-wider text-[var(--color-text-faint)] mb-0.5">
                    {m.role === 'operator' ? 'You' : (kicker?.name || task.assigned_agent || 'Agent')}
                    <span class="ml-1.5 normal-case tracking-normal text-[var(--color-text-faint)]">{formatRelativeTime(m.created_at)}</span>
                  </div>
                  <div class={'text-[11px] whitespace-pre-wrap leading-relaxed ' + (m.role === 'operator' ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]')}>{m.body}</div>
                </div>
              ))}
              {/* Legacy fallback: tasks blocked before the thread existed only
                  have the snapshot in task.result. */}
              {!loadingThread && (!thread || thread.length === 0) && task.result && (
                <div class="text-[11px] text-[var(--color-text)] whitespace-pre-wrap leading-relaxed">{task.result}</div>
              )}
            </div>
          )}
          {/* Answer the question the agent asked, inline. The reply is recorded
              as an operator turn and the same task resumes on the same teammate
              with the thread folded into its prompt — the loop closes here. */}
          <textarea
            value={reply}
            onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && reply.trim() && busy === null) rerun(reply.trim());
            }}
            placeholder={`Answer ${kicker?.name || 'them'}…`}
            rows={2}
            disabled={busy !== null}
            class="w-full bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[11px] text-[var(--color-text)] px-2 py-1.5 outline-none focus:border-[var(--color-accent)] resize-none placeholder:text-[var(--color-text-faint)] disabled:opacity-40"
          />
          <div class="flex items-center gap-1.5 mt-1.5 mb-2">
            <button
              type="button"
              onClick={() => { const r = reply.trim(); if (r) rerun(r); }}
              disabled={busy !== null || !reply.trim()}
              class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-medium bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-40"
            >
              <ArrowRight size={11} /> {busy === 'rerun' && reply.trim() ? '…' : 'Reply & resume'}
            </button>
            <button
              type="button"
              onClick={() => rerun()}
              disabled={busy !== null}
              class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors disabled:opacity-40"
              title="Re-run without a reply (e.g. after you granted access)"
            >
              <RotateCcw size={11} /> {busy === 'rerun' && !reply.trim() ? '…' : 'Re-run'}
            </button>
          </div>
        </>
      )}
      <div class="flex items-center gap-1">
        {!settled && (
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
            onClick={() => rerun()}
            disabled={busy !== null}
            class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors disabled:opacity-40"
            title="Re-run this task"
          >
            <RotateCcw size={11} /> {busy === 'rerun' ? '…' : 'Re-run'}
          </button>
        )}
        {settled && <div class="flex-1" />}
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
  const [feedback, setFeedback] = useState('');
  // Run history (output versioning). `viewIdx` is which version is on screen;
  // null tracks "latest" so the card follows new re-runs without a manual bump.
  const [runs, setRuns] = useState<MissionTaskRun[] | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [viewIdx, setViewIdx] = useState<number | null>(null);

  // Lazy-load the run history the first time the card is opened.
  async function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && runs === null && !loadingRuns) {
      setLoadingRuns(true);
      try {
        const res = await apiGet<{ runs: MissionTaskRun[] }>(`/api/mission/tasks/${task.id}/runs`);
        setRuns(res.runs);
      } catch { setRuns([]); }
      finally { setLoadingRuns(false); }
    }
  }

  // `changes` folds the operator's feedback into the resumed run — corrections
  // on a shipped result; a bare re-run just retries the same task as-is.
  async function rerun(changes?: string) {
    setBusy(true);
    try {
      await apiPost(`/api/mission/tasks/${task.id}/requeue`, changes ? { reply: changes } : undefined);
      onChange();
      pushToast({
        tone: 'success',
        title: changes ? 'Sent — reworking' : 'Re-running',
        description: changes ? `${agent?.name || 'The agent'} will rework it and post the update.` : 'Back in the queue.',
      });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not re-run', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }

  const stop = (e: MouseEvent) => e.stopPropagation();

  // Which version is on screen: an explicit pick, else the latest run, else the
  // task snapshot (pre-versioning tasks with no run rows yet).
  const total = runs?.length ?? 0;
  const idx = viewIdx ?? (total > 0 ? total - 1 : 0);
  const current = runs && total > 0 ? runs[Math.min(idx, total - 1)] : null;
  const shownResult = current ? current.result : task.result;

  return (
    <div
      onClick={toggle}
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
          onClick={(e) => { stop(e); rerun(); }}
          disabled={busy}
          class="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors disabled:opacity-40"
          title="Re-run this task as-is"
        >
          <RotateCcw size={11} /> {busy && !feedback.trim() ? '…' : 'Re-run'}
        </button>
      </div>
      {expanded && (
        <div class="mt-2 border-t border-[var(--color-border)] pt-2 space-y-2" onClick={stop}>
          {/* Version pager: only when a task has been re-run at least once. Steps
              through each shipped version and shows the feedback that drove it. */}
          {total > 1 && (
            <div class="flex items-center gap-1.5">
              <History size={11} class="text-[var(--color-text-faint)]" />
              <span class="text-[10px] text-[var(--color-text-muted)] tabular-nums">
                Version {current?.version ?? total} of {total}
              </span>
              <span class="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setViewIdx(Math.max(0, idx - 1))}
                  disabled={idx <= 0}
                  class="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
                  title="Older version"
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewIdx(Math.min(total - 1, idx + 1))}
                  disabled={idx >= total - 1}
                  class="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
                  title="Newer version"
                >
                  <ChevronRight size={13} />
                </button>
              </span>
            </div>
          )}
          {current && (
            <div class="flex items-center gap-1.5 text-[9.5px] text-[var(--color-text-faint)]">
              <span class="uppercase tracking-wider">{current.status === 'completed' ? 'Shipped' : current.status}</span>
              <span class="tabular-nums">{formatRelativeTime(current.created_at)}</span>
            </div>
          )}
          {current?.feedback && (
            <div class="text-[10.5px] text-[var(--color-accent)] leading-snug">
              <span class="text-[var(--color-text-faint)]">Reworked after: </span>{current.feedback}
            </div>
          )}
          {loadingRuns && <div class="text-[10.5px] text-[var(--color-text-faint)]">Loading history…</div>}
          {shownResult && (
            <div class="text-[11px] text-[var(--color-text)] whitespace-pre-wrap leading-relaxed">{shownResult}</div>
          )}
          {/* Request changes: the feedback is threaded into a re-run of the same
              task on the same teammate, and the reworked result ships back. This
              mirrors replying in the result's chat thread. */}
          <div>
            <div class="text-[9.5px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Request changes</div>
            <textarea
              value={feedback}
              onInput={(e) => setFeedback((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && feedback.trim() && !busy) rerun(feedback.trim());
              }}
              placeholder="What should change? e.g. tighten the intro, add the Q3 numbers…"
              rows={2}
              disabled={busy}
              class="w-full bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[11px] text-[var(--color-text)] px-2 py-1.5 outline-none focus:border-[var(--color-accent)] resize-none placeholder:text-[var(--color-text-faint)] disabled:opacity-40"
            />
            <button
              type="button"
              onClick={() => { const r = feedback.trim(); if (r) rerun(r); }}
              disabled={busy || !feedback.trim()}
              class="inline-flex items-center gap-1 mt-1.5 px-2 py-1 rounded text-[10.5px] font-medium bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-40"
            >
              <ArrowRight size={11} /> {busy && feedback.trim() ? '…' : 'Send changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
