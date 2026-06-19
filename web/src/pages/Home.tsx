// Home — the operator's daily loop (operator-product spec 03-home.md).
//
// One skeleton, two states. Day-one and steady-state share this layout; the
// slots fill in as work accumulates, nothing rearranges. Top to bottom:
//   1. Greeting + one-line status
//   2. Activation strip (large day-one, thin steady — D3: persists)
//   3. "Needs you" / "Today" card
//   4. Three zones: On my plate · Waiting on others · Shipped this week
//   5. Capture bar (always present)
//
// Grouping is computed server-side by GET /api/home/summary so this page makes
// one call and holds no grouping logic. Slots whose engine isn't built yet
// degrade honestly rather than faking data:
//   - "Needs you"  = unassigned-queued tasks (route them) + recent failed
//                    (handle them). Permission approvals fold in here once the
//                    trust system (spec step 4) lands.
//   - "Today"      = routines due in the next 24h (the only schedule data the
//                    backend can derive honestly) + static starter prompts.
//                    D2: conservative, no unprompted inbox scan.
//   - "Waiting on others" = tasks parked in the 'blocked' status with a note of
//                    who/what they wait on; set via "Mark waiting", cleared via
//                    "Unblock".

import { useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import {
  Plus, History, Inbox, Hourglass, CheckCircle2, Send, X, Wand2,
  Sparkles, Plug, FileText, Trash2, ArrowRight, Clock, Undo2, PauseCircle,
} from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { Pill, StatusDot } from '@/components/Pill';
import { PageState } from '@/components/PageState';
import { Drawer } from '@/components/Modal';
import { AgentAvatar } from '@/components/AgentAvatar';
import { type ProjectLite } from '@/components/ProjectTaskAttach';
import { CreateTaskModal, HistoryList, type MissionTask, type Agent } from '@/components/TaskModals';
import { useFetch } from '@/lib/useFetch';
import { apiPost, apiPatch, apiDelete } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { term } from '@/lib/vocabulary';
import { pushToast } from '@/lib/toasts';
import { workspaceName } from '@/lib/personalization';

interface TodaySuggestion { id: string; kind: 'routine'; text: string; when: number | null }
interface HomeSummary {
  needsYou: MissionTask[];
  onPlate: MissionTask[];
  waiting: MissionTask[];
  shipped: MissionTask[];
  today: TodaySuggestion[];
  status: { needsYou: number; waiting: number; shipped: number; hasAnyWork: boolean };
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Starter prompts for the "Today" card and activation. D2 conservative:
// these wait to be asked rather than scanning connected sources unprompted.
const STARTER_SUGGESTIONS: string[] = [
  'Tell me what you are working on this week.',
  'Draft a reply to a client and let me review it before it sends.',
  'Research a company or person and give me the highlights.',
  'Go through my inbox and tell me what needs a decision.',
];

const BRIEF_TEMPLATE =
  'Here is a one-paragraph brief on my business so you have context: ';

export function Home() {
  const [, navigate] = useLocation();
  const summary = useFetch<HomeSummary>('/api/home/summary', 15_000);
  const agents = useFetch<{ agents: Agent[] }>('/api/agents', 60_000);
  const projects = useFetch<{ projects: ProjectLite[] }>('/api/projects', 60_000);

  const [createOpen, setCreateOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [capture, setCapture] = useState('');
  const captureRef = useRef<HTMLTextAreaElement>(null);

  const activeProjects = useMemo(
    () => (projects.data?.projects ?? []).filter((p) => p.status === 'active'),
    [projects.data],
  );
  const agentById = useMemo(
    () => new Map((agents.data?.agents ?? []).map((a) => [a.id, a])),
    [agents.data],
  );

  const data = summary.data;
  const needsYou = data?.needsYou ?? [];
  const onPlate = data?.onPlate ?? [];
  const waiting = data?.waiting ?? [];
  const shipped = data?.shipped ?? [];
  const today = data?.today ?? [];
  const hasAnyWork = data?.status.hasAnyWork ?? false;
  const refresh = () => summary.refresh();

  function focusCapture(prefill?: string) {
    if (prefill !== undefined) setCapture(prefill);
    requestAnimationFrame(() => {
      const el = captureRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  }

  async function submitCapture() {
    const text = capture.trim();
    if (!text) return;
    setCapture('');
    try {
      const title = text.length > 120 ? text.slice(0, 117) + '…' : text;
      const created = await apiPost<{ task: MissionTask }>('/api/mission/tasks', {
        title,
        prompt: text,
        priority: 5,
      });
      apiPost(`/api/mission/tasks/${created.task.id}/auto-assign`).catch(() => {});
      refresh();
      pushToast({ tone: 'success', title: 'Captured', description: 'Routing it to the right teammate.' });
    } catch (err: any) {
      setCapture(text);
      pushToast({ tone: 'error', title: 'Could not capture', description: err?.message || String(err), durationMs: 6000 });
    }
  }

  const loading = (summary.loading || agents.loading) && !summary.data;
  const error = summary.error || agents.error;
  const wsName = workspaceName.value;
  const headerTitle = wsName && wsName !== 'ClaudeClaw' ? wsName : term('page.home');

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={headerTitle}
        actions={
          <>
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors"
            >
              <History size={13} /> History
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              <Plus size={14} /> {term('action.newTask')}
            </button>
          </>
        }
      />

      {error && <PageState error={error} />}
      {loading && <PageState loading />}

      {!loading && !error && (
        <div class="flex-1 min-h-0 overflow-y-auto">
          <div class="max-w-[1100px] mx-auto px-6 py-5 space-y-5">
            {/* 1. Greeting + one-line status */}
            <GreetingBlock
              dayOne={!hasAnyWork}
              needs={needsYou.length}
              waiting={waiting.length}
              shipped={shipped.length}
            />

            {/* 2. Activation strip */}
            <ActivationStrip
              dayOne={!hasAnyWork}
              onTellWork={() => focusCapture()}
              onConnect={() => navigate('/settings')}
              onBrief={() => focusCapture(BRIEF_TEMPLATE)}
            />

            {/* 3. Needs you / Today */}
            <NeedsYouCard
              needsYou={needsYou}
              today={today}
              agents={agents.data?.agents ?? []}
              agentById={agentById}
              onChange={refresh}
              onSuggest={(text) => focusCapture(text)}
            />

            {/* 4. Three zones */}
            <div class="grid gap-3 md:grid-cols-3">
              <Zone
                title="On my plate"
                hint="Active work, and who's on it."
                icon={Inbox}
                count={onPlate.length}
                empty="Nothing in flight."
              >
                {onPlate.map((t) => (
                  <PlateItem key={t.id} task={t} agent={t.assigned_agent ? agentById.get(t.assigned_agent) : undefined} onChange={refresh} />
                ))}
              </Zone>

              <Zone
                title="Waiting on others"
                hint="Work blocked on someone else."
                icon={Hourglass}
                count={waiting.length}
                empty="Nothing waiting on anyone right now."
              >
                {waiting.map((t) => (
                  <WaitingItem key={t.id} task={t} agent={t.assigned_agent ? agentById.get(t.assigned_agent) : undefined} onChange={refresh} />
                ))}
              </Zone>

              <Zone
                title="Shipped this week"
                hint="Done in the last 7 days."
                icon={CheckCircle2}
                count={shipped.length}
                empty="Nothing shipped yet this week."
              >
                {shipped.map((t) => (
                  <ShippedItem key={t.id} task={t} agent={t.assigned_agent ? agentById.get(t.assigned_agent) : undefined} />
                ))}
              </Zone>
            </div>
          </div>
        </div>
      )}

      {/* 5. Capture bar */}
      {!loading && !error && (
        <div class="border-t border-[var(--color-border)] bg-[var(--color-bg)] px-6 py-3">
          <div class="max-w-[1100px] mx-auto flex items-end gap-2">
            <textarea
              ref={captureRef}
              value={capture}
              onInput={(e) => setCapture((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submitCapture(); }
              }}
              rows={1}
              placeholder="Tell me anything — forward an email, drop a note, hand me a task. (⌘↵ to send)"
              class="flex-1 resize-none bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[12.5px] outline-none focus:border-[var(--color-accent)] leading-relaxed max-h-32"
            />
            <button
              type="button"
              onClick={() => void submitCapture()}
              disabled={!capture.trim()}
              class="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              <Send size={13} /> Send
            </button>
          </div>
        </div>
      )}

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        agents={agents.data?.agents ?? []}
        projects={activeProjects}
        onCreated={refresh}
      />

      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="Task history">
        {historyOpen && <HistoryList projects={activeProjects} onChanged={refresh} />}
      </Drawer>
    </div>
  );
}

// ── Greeting + status ───────────────────────────────────────────────

function GreetingBlock({ dayOne, needs, waiting, shipped }: {
  dayOne: boolean; needs: number; waiting: number; shipped: number;
}) {
  return (
    <div class="flex items-start gap-3">
      <div class="flex-1 min-w-0">
        <h2 class="text-[20px] font-semibold text-[var(--color-text)] leading-tight">{greeting()}.</h2>
        {dayOne ? (
          <p class="text-[13px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
            I'm set up and running. I don't know much about your work yet — point me at something below and I'll get going.
          </p>
        ) : (
          <p class="text-[13px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
            <span class="text-[var(--color-text)] font-medium tabular-nums">{needs}</span> {needs === 1 ? 'thing needs' : 'things need'} you,{' '}
            <span class="tabular-nums">{waiting}</span> waiting on others,{' '}
            <span class="tabular-nums">{shipped}</span> shipped this week.
          </p>
        )}
      </div>
      <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium bg-[color-mix(in_srgb,var(--color-status-running)_15%,transparent)] text-[var(--color-status-running)] shrink-0 mt-1">
        <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-status-running)] animate-pulse" /> Running
      </span>
    </div>
  );
}

// ── Activation strip ────────────────────────────────────────────────

function ActivationStrip({ dayOne, onTellWork, onConnect, onBrief }: {
  dayOne: boolean; onTellWork: () => void; onConnect: () => void; onBrief: () => void;
}) {
  if (!dayOne) {
    // Steady-state: a thin "teach me more" strip that persists (D3) so the
    // assistant keeps getting smarter without the operator hunting in settings.
    return (
      <div class="flex items-center gap-2 flex-wrap text-[12px] text-[var(--color-text-muted)] bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-3 py-2">
        <Sparkles size={13} class="text-[var(--color-accent)]" />
        <span>Teach me more:</span>
        <button type="button" onClick={onConnect} class="text-[var(--color-accent)] hover:underline">connect a tool</button>
        <span class="text-[var(--color-text-faint)]">·</span>
        <button type="button" onClick={onBrief} class="text-[var(--color-accent)] hover:underline">add a business brief</button>
      </div>
    );
  }

  const actions = [
    { icon: FileText, title: 'Tell me what you are working on', body: 'A sentence is enough to get started.', onClick: onTellWork },
    { icon: Plug, title: 'Finish connecting your tools', body: 'Calendar, email, and the rest — so I can act.', onClick: onConnect },
    { icon: Sparkles, title: 'Give me a one-paragraph brief', body: 'Who you are and what you do, in your words.', onClick: onBrief },
  ];

  return (
    <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
      <div class="text-[12px] font-medium text-[var(--color-text)] mb-3">Two minutes to make me useful</div>
      <div class="grid gap-2 sm:grid-cols-3">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <button
              type="button"
              onClick={a.onClick}
              class="text-left bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-3 hover:border-[var(--color-accent)] transition-colors group"
            >
              <Icon size={16} class="text-[var(--color-accent)] mb-1.5" />
              <div class="text-[12.5px] font-medium text-[var(--color-text)] leading-snug mb-0.5 flex items-center gap-1">
                {a.title}
                <ArrowRight size={12} class="opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div class="text-[11px] text-[var(--color-text-muted)] leading-snug">{a.body}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Needs you / Today ───────────────────────────────────────────────

function NeedsYouCard({ needsYou, today, agents, agentById, onChange, onSuggest }: {
  needsYou: MissionTask[];
  today: TodaySuggestion[];
  agents: Agent[];
  agentById: Map<string, Agent>;
  onChange: () => void;
  onSuggest: (text: string) => void;
}) {
  const hasNeeds = needsYou.length > 0;
  return (
    <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div class="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center gap-2">
        <span class="text-[13px] font-semibold text-[var(--color-text)]">{hasNeeds ? 'Needs you' : 'Today'}</span>
        {hasNeeds && <span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">{needsYou.length}</span>}
        <span class="ml-auto text-[11px] text-[var(--color-text-faint)]">
          {hasNeeds ? 'Decisions only you can make' : 'A few ways to get me going'}
        </span>
      </div>
      <div class="p-2.5 space-y-1.5">
        {hasNeeds ? (
          <>
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
            {today.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSuggest(`Help me get ready for: ${s.text}`)}
                class="w-full text-left flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)] transition-colors group"
              >
                <Clock size={12} class="text-[var(--color-accent)] shrink-0" />
                <span class="flex-1 truncate">Coming up — {s.text}</span>
                {s.when && <span class="text-[10px] text-[var(--color-text-faint)] tabular-nums shrink-0">{formatRelativeTime(s.when)}</span>}
              </button>
            ))}
            {STARTER_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSuggest(s)}
                class="w-full text-left flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--color-elevated)] border border-[var(--color-border)] text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)] transition-colors group"
              >
                <Sparkles size={12} class="text-[var(--color-accent)] shrink-0" />
                <span class="flex-1">{s}</span>
                <ArrowRight size={12} class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            ))}
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

// ── Zones ───────────────────────────────────────────────────────────

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

function TeammatePill({ agent, fallback }: { agent?: Agent; fallback: string | null }) {
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

function ShippedItem({ task, agent }: { task: MissionTask; agent?: Agent }) {
  const [expanded, setExpanded] = useState(false);
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
      <TeammatePill agent={agent} fallback={task.assigned_agent} />
      {expanded && task.result && (
        <div class="mt-2 text-[11px] text-[var(--color-text)] whitespace-pre-wrap leading-relaxed border-t border-[var(--color-border)] pt-2">
          {task.result}
        </div>
      )}
    </div>
  );
}
