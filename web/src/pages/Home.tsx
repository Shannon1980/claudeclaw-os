// Home -- the operator's daily loop (operator-product spec 03-home.md).
//
// One skeleton, two states. Day-one and steady-state share this layout; the
// slots fill in as work accumulates, nothing rearranges. Top to bottom:
//   1. Greeting + one-line status
//   2. Activation strip (large day-one, thin steady -- D3: persists)
//   3. "Needs you" / "Today" card
//   4. Three zones: On my plate · Waiting on others · Shipped this week
//   5. Capture bar (always present)
//
// Grouping is computed server-side by GET /api/home/summary so this page makes
// one call and holds no grouping logic. The zone/card pieces live in
// components/DailyLoop so the project detail can render the same loop scoped
// to one project. Degraded slots (no permission feed, no calendar) fail
// honestly -- see DailyLoop and the summary endpoint for the specifics.

import { useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { Plus, History, Send, Sparkles, Plug, FileText, ArrowRight } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Drawer } from '@/components/Modal';
import { type ProjectLite } from '@/components/ProjectTaskAttach';
import { CreateTaskModal, HistoryList, type MissionTask, type Agent } from '@/components/TaskModals';
import { LoopZones, NeedsYouCard, type HomeSummary } from '@/components/DailyLoop';
import { type Approval } from '@/components/ApprovalItem';
import { useFetch } from '@/lib/useFetch';
import { apiPost } from '@/lib/api';
import { term } from '@/lib/vocabulary';
import { pushToast } from '@/lib/toasts';
import { workspaceName } from '@/lib/personalization';

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
  const approvals = useFetch<{ approvals: Approval[] }>('/api/approvals', 15_000);

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
  const pendingApprovals = approvals.data?.approvals ?? [];
  const hasAnyWork = (data?.status.hasAnyWork ?? false) || pendingApprovals.length > 0;
  const refresh = () => { summary.refresh(); approvals.refresh(); };

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
              variant="home"
              needsYou={needsYou}
              approvals={pendingApprovals}
              today={today}
              starters={STARTER_SUGGESTIONS}
              agents={agents.data?.agents ?? []}
              agentById={agentById}
              onChange={refresh}
              onSuggest={(text) => focusCapture(text)}
            />

            {/* Quiet one-click shortcut into the Activity feed (D-03). Not a
             *  second loud card; a daily-glance link beneath Needs you. */}
            <button
              type="button"
              onClick={() => navigate('/activity')}
              class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
            >
              What your team did
              <ArrowRight size={12} />
            </button>

            {/* 4. Three zones */}
            <LoopZones onPlate={onPlate} waiting={waiting} shipped={shipped} agentById={agentById} onChange={refresh} />
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
              placeholder="Tell me anything. Forward an email, drop a note, hand me a task. (⌘↵ to send)"
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
            I'm set up and running. I don't know much about your work yet. Point me at something below and I'll get going.
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
    { icon: Plug, title: 'Finish connecting your tools', body: 'Calendar, email, and the rest, so I can act.', onClick: onConnect },
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
