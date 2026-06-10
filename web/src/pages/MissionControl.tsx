import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { Plus, Wand2, Trash2, X, History, Clock, PlayCircle, CheckCircle2, Paperclip, FileText, Image as ImageIcon, FolderKanban } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { Pill, StatusDot } from '@/components/Pill';
import { PageState } from '@/components/PageState';
import { Modal, Drawer } from '@/components/Modal';
import { AgentAvatar } from '@/components/AgentAvatar';
import { ProjectAttachSelect, type ProjectLite } from '@/components/ProjectTaskAttach';
import { useFetch } from '@/lib/useFetch';
import { apiPost, apiPatch, apiDelete, apiGet, apiUpload } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { pushToast } from '@/lib/toasts';
import { workspaceName } from '@/lib/personalization';

interface MissionTask {
  id: string;
  title: string;
  prompt: string;
  assigned_agent: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  created_by: string;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  error: string | null;
  project_id: string | null;
}

interface Agent { id: string; name: string; description: string; running: boolean; delegationOnly?: boolean; }

const TERMINAL: MissionTask['status'][] = ['completed', 'failed', 'cancelled'];
const DONE_VISIBLE_SECS = 30 * 60;

type KanbanLane = 'pending' | 'in_progress' | 'done';

const KANBAN_COLUMNS: {
  id: KanbanLane;
  title: string;
  subtitle: string;
  icon: typeof Clock;
  tone: 'queued' | 'running' | 'done';
}[] = [
  { id: 'pending', title: 'Pending', subtitle: 'Queued', icon: Clock, tone: 'queued' },
  { id: 'in_progress', title: 'In progress', subtitle: 'Running now', icon: PlayCircle, tone: 'running' },
  { id: 'done', title: 'Done', subtitle: 'Last 30 min', icon: CheckCircle2, tone: 'done' },
];

export function MissionControl() {
  const [location, navigate] = useLocation();
  const tasks = useFetch<{ tasks: MissionTask[] }>('/api/mission/tasks', 15_000);
  const agents = useFetch<{ agents: Agent[] }>('/api/agents', 60_000);
  const projects = useFetch<{ projects: ProjectLite[] }>('/api/projects', 60_000);

  const [createOpen, setCreateOpen] = useState(false);
  const [createProjectId, setCreateProjectId] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);

  const projectNames = useMemo(
    () => new Map((projects.data?.projects ?? []).map((p) => [p.id, p.name])),
    [projects.data],
  );

  // ?new=1 from the command palette opens the create modal. An optional
  // ?project=<id> (from a project's "Add task" button) preselects it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') === '1') {
      setCreateProjectId(url.searchParams.get('project') || '');
      setCreateOpen(true);
      url.searchParams.delete('new');
      url.searchParams.delete('project');
      navigate(url.pathname);
    }
  }, [location]);

  const { lanes, unassignedPending, totalActive } = useMemo(() => {
    const all = tasks.data?.tasks ?? [];
    const now = Date.now() / 1000;
    const visible = all.filter((t) => {
      if (!TERMINAL.includes(t.status)) return true;
      if (!t.completed_at) return true;
      return now - t.completed_at < DONE_VISIBLE_SECS;
    });
    const sortTasks = (list: MissionTask[]) =>
      [...list].sort((a, b) => b.priority - a.priority || b.created_at - a.created_at);
    const pending = sortTasks(visible.filter((t) => t.status === 'queued'));
    const inProgress = sortTasks(visible.filter((t) => t.status === 'running'));
    const done = sortTasks(visible.filter((t) => TERMINAL.includes(t.status)));
    return {
      lanes: { pending, in_progress: inProgress, done } as Record<KanbanLane, MissionTask[]>,
      unassignedPending: pending.filter((t) => !t.assigned_agent).length,
      totalActive: visible.filter((t) => !TERMINAL.includes(t.status)).length,
    };
  }, [tasks.data]);

  const agentById = useMemo(
    () => new Map((agents.data?.agents ?? []).map((a) => [a.id, a])),
    [agents.data],
  );

  async function autoAssignAll() {
    setBulkAssigning(true);
    try {
      const res = await apiPost<{ assigned: number }>('/api/mission/tasks/auto-assign-all');
      tasks.refresh();
      if (typeof res?.assigned === 'number') {
        // Tiny inline feedback; toast system is a follow-up.
        console.info(`Auto-assigned ${res.assigned} task${res.assigned === 1 ? '' : 's'}`);
      }
    } catch (err: any) {
      alert('Auto-assign failed: ' + (err?.message || err));
    } finally { setBulkAssigning(false); }
  }

  const loading = (tasks.loading || agents.loading) && !tasks.data;
  const error = tasks.error || agents.error;
  const wsName = workspaceName.value;
  const headerTitle = wsName && wsName !== 'ClaudeClaw' ? `${wsName} · Tasks` : 'Mission Control';

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={headerTitle}
        actions={
          <>
            <span class="text-[11px] text-[var(--color-text-muted)] tabular-nums mr-2">
              {totalActive} active · {unassignedPending} unassigned · {tasks.data?.tasks?.length ?? 0} total
            </span>
            {unassignedPending > 0 && (
              <button
                type="button"
                onClick={autoAssignAll}
                disabled={bulkAssigning}
                class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] border border-[var(--color-border)] transition-colors disabled:opacity-40"
              >
                <Wand2 size={13} /> {bulkAssigning ? 'Assigning…' : `Auto-assign all (${unassignedPending})`}
              </button>
            )}
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
              <Plus size={14} /> New Task
            </button>
          </>
        }
      />

      {error && <PageState error={error} />}
      {loading && <PageState loading />}

      {!loading && !error && (
        <div class="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
          <div class="flex gap-3 p-4 h-full min-w-[960px]">
            {KANBAN_COLUMNS.map((col) => (
              <StatusColumn
                key={col.id}
                column={col}
                tasks={lanes[col.id]}
                agents={agents.data?.agents ?? []}
                agentById={agentById}
                projects={(projects.data?.projects ?? []).filter((p) => p.status === 'active')}
                projectNames={projectNames}
                onChange={tasks.refresh}
              />
            ))}
          </div>
        </div>
      )}

      <CreateTaskModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateProjectId(''); }}
        agents={agents.data?.agents ?? []}
        projects={(projects.data?.projects ?? []).filter((p) => p.status === 'active')}
        defaultProjectId={createProjectId}
        onCreated={tasks.refresh}
      />

      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="Task history">
        {/* Remount on each open so the fetch fires fresh and a previous
            error doesn't leave the drawer stuck on an empty state. */}
        {historyOpen && (
          <HistoryList
            projects={(projects.data?.projects ?? []).filter((p) => p.status === 'active')}
            onChanged={tasks.refresh}
          />
        )}
      </Drawer>
    </div>
  );
}

// ── Kanban columns ──────────────────────────────────────────────────

function StatusColumn({
  column, tasks, agents, agentById, projects, projectNames, onChange,
}: {
  column: typeof KANBAN_COLUMNS[number];
  tasks: MissionTask[];
  agents: Agent[];
  agentById: Map<string, Agent>;
  projects: ProjectLite[];
  projectNames: Map<string, string>;
  onChange: () => void;
}) {
  const Icon = column.icon;
  const emptyCopy =
    column.id === 'pending' ? 'No queued tasks'
    : column.id === 'in_progress' ? 'Nothing running'
    : 'No recent completions';

  return (
    <div class="flex-1 min-w-[280px] flex flex-col bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div class="px-3 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
        <Icon size={15} class="text-[var(--color-text-muted)]" />
        <div class="flex-1 min-w-0">
          <div class="text-[13.5px] font-medium text-[var(--color-text)]">{column.title}</div>
          <div class="text-[10.5px] text-[var(--color-text-faint)] uppercase tracking-wider flex items-center gap-1">
            <StatusDot tone={column.tone} />
            {column.subtitle}
          </div>
        </div>
        <span class="text-[11.5px] text-[var(--color-text-muted)] tabular-nums">{tasks.length}</span>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        {tasks.length === 0 && (
          <div class="text-[11.5px] text-[var(--color-text-faint)] text-center py-6">{emptyCopy}</div>
        )}
        {tasks.map((t) => {
          if (column.id === 'pending' && !t.assigned_agent) {
            return (
              <InboxCard
                key={t.id}
                task={t}
                agents={agents}
                projects={projects}
                onChange={onChange}
              />
            );
          }
          const agent = t.assigned_agent ? agentById.get(t.assigned_agent) : undefined;
          return (
            <TaskCard
              key={t.id}
              task={t}
              onChange={onChange}
              projectName={t.project_id ? projectNames.get(t.project_id) : undefined}
              projects={projects}
              agent={agent}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Cards ──────────────────────────────────────────────────────────

function InboxCard({
  task, agents, projects, onChange,
}: {
  task: MissionTask; agents: Agent[]; projects: ProjectLite[]; onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  async function autoAssign() {
    setBusy('assign');
    try {
      const res = await apiPost<{ ok: boolean; assigned_agent?: string }>(`/api/mission/tasks/${task.id}/auto-assign`);
      onChange();
      pushToast({
        tone: 'success',
        title: 'Auto-assigned',
        description: res.assigned_agent ? `Routed to @${res.assigned_agent}.` : 'Routed.',
      });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Auto-assign failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(null); }
  }

  async function manualAssign(agentId: string) {
    setBusy('manual');
    try {
      await apiPatch(`/api/mission/tasks/${task.id}`, { assigned_agent: agentId });
      onChange();
      pushToast({ tone: 'success', title: 'Assigned', description: `Routed to @${agentId}.` });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Assign failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(null); }
  }

  async function remove() {
    if (!confirm('Delete this task?')) return;
    setBusy('delete');
    try {
      await apiDelete(`/api/mission/tasks/${task.id}`);
      onChange();
      pushToast({ tone: 'warn', title: 'Task deleted' });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Delete failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(null); }
  }

  return (
    <>
    <div
      class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-2.5 transition-all hover:border-[var(--color-border-strong)]"
    >
      <div
        class="cursor-pointer"
        onClick={() => setDetailsOpen(true)}
        title="Open task details"
      >
        <div class="flex items-center gap-1.5 mb-1">
          <Pill tone="neutral">unassigned</Pill>
          <span class="ml-auto text-[10px] text-[var(--color-text-faint)] tabular-nums">
            {formatRelativeTime(task.created_at)}
          </span>
        </div>
        <div class="text-[12.5px] text-[var(--color-text)] leading-snug mb-1.5 line-clamp-2">
          {task.title}
        </div>
      </div>
      {/* draggable=false on the action row stops mousedown from bubbling
          into the card click handler. */}
      <div
        class="flex items-center gap-1"
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={autoAssign}
          disabled={busy !== null}
          class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-medium bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-40"
        >
          <Wand2 size={11} /> {busy === 'assign' ? '…' : 'Auto'}
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
        <button
          type="button"
          onClick={remove}
          disabled={busy !== null}
          class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] transition-colors disabled:opacity-40"
          title="Delete"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>

    <TaskDetailsModal
      open={detailsOpen}
      onClose={() => setDetailsOpen(false)}
      task={task}
      agents={agents}
      projects={projects}
      busy={busy}
      onAutoAssign={async () => { await autoAssign(); setDetailsOpen(false); }}
      onManualAssign={async (agentId) => { await manualAssign(agentId); setDetailsOpen(false); }}
      onDelete={async () => { await remove(); setDetailsOpen(false); }}
      onProjectChange={onChange}
    />
    </>
  );
}

// Modal preview for an unassigned inbox task. Opened when the user
// clicks the card body. Lets them see the full prompt + assign or
// delete in a focused view rather than fighting the cramped action
// row in the card.
function TaskDetailsModal({
  open, onClose, task, agents, projects, busy, onAutoAssign, onManualAssign, onDelete, onProjectChange,
}: {
  open: boolean;
  onClose: () => void;
  task: MissionTask;
  agents: Agent[];
  projects: ProjectLite[];
  busy: string | null;
  onAutoAssign: () => Promise<void> | void;
  onManualAssign: (agentId: string) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  onProjectChange: () => void;
}) {
  const [pickerAgent, setPickerAgent] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={'Task · ' + task.id.slice(0, 8)}
      width={560}
      footer={
        <>
          <button
            type="button"
            onClick={() => onDelete()}
            disabled={busy !== null}
            class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] border border-[var(--color-border)] hover:border-[var(--color-status-failed)] transition-colors disabled:opacity-40"
          >
            <Trash2 size={12} /> {busy === 'delete' ? 'Deleting…' : 'Delete'}
          </button>
          <div class="ml-auto flex items-center gap-2">
            <select
              value={pickerAgent}
              onChange={(e) => setPickerAgent((e.target as HTMLSelectElement).value)}
              disabled={busy !== null}
              class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">Assign to…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            </select>
            <button
              type="button"
              onClick={() => pickerAgent && onManualAssign(pickerAgent)}
              disabled={!pickerAgent || busy !== null}
              class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[12px] bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'manual' ? 'Assigning…' : 'Assign'}
            </button>
            <button
              type="button"
              onClick={() => onAutoAssign()}
              disabled={busy !== null}
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-colors"
            >
              <Wand2 size={12} /> {busy === 'assign' ? 'Classifying…' : 'Auto-assign'}
            </button>
          </div>
        </>
      }
    >
      <div class="space-y-3">
        <div>
          <div class="text-[10.5px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Title</div>
          <div class="text-[14px] text-[var(--color-text)] leading-snug">{task.title}</div>
        </div>
        {task.prompt && task.prompt !== task.title && (
          <div>
            <div class="text-[10.5px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Prompt</div>
            <div class="text-[12.5px] text-[var(--color-text-muted)] whitespace-pre-wrap font-mono leading-relaxed bg-[var(--color-elevated)] border border-[var(--color-border)] rounded p-3">
              {task.prompt}
            </div>
          </div>
        )}
        <div class="grid grid-cols-3 gap-3 pt-1">
          <Stat label="Created" value={formatRelativeTime(task.created_at)} />
          <Stat label="Priority" value={task.priority > 0 ? 'P' + task.priority : '—'} />
          <Stat label="Created by" value={task.created_by || 'dashboard'} />
        </div>
        {projects.length > 0 && (
          <div>
            <div class="text-[10.5px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Project</div>
            <ProjectAttachSelect
              taskId={task.id}
              currentProjectId={task.project_id}
              projects={projects}
              onChanged={onProjectChange}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">{label}</div>
      <div class="text-[12.5px] text-[var(--color-text)] tabular-nums">{value}</div>
    </div>
  );
}

function TaskCard({ task, onChange, projectName, projects, agent }: {
  task: MissionTask; onChange: () => void; projectName?: string; projects: ProjectLite[];
  agent?: Agent;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const priorityTone = task.priority >= 7 ? 'high' : task.priority >= 4 ? 'medium' : 'low';
  const agentLabel = agent?.name || task.assigned_agent;

  async function cancel() {
    setBusy('cancel');
    try { await apiPost(`/api/mission/tasks/${task.id}/cancel`); onChange(); }
    catch (err: any) { alert('Cancel failed: ' + (err?.message || err)); }
    finally { setBusy(null); }
  }

  async function remove() {
    if (!confirm('Delete this task?')) return;
    setBusy('delete');
    try { await apiDelete(`/api/mission/tasks/${task.id}`); onChange(); }
    catch (err: any) { alert('Delete failed: ' + (err?.message || err)); }
    finally { setBusy(null); }
  }

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-2.5 transition-colors cursor-pointer hover:border-[var(--color-border-strong)]"
    >
      <div class="flex items-center gap-1.5 mb-1">
        <StatusDot tone={task.status as any} />
        <span class="text-[10px] text-[var(--color-text-faint)] tabular-nums uppercase tracking-wider">
          {task.id.slice(0, 6)}
        </span>
        <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">
          {formatRelativeTime(task.completed_at || task.started_at || task.created_at)}
        </span>
      </div>
      <div class={'text-[12.5px] text-[var(--color-text)] leading-snug mb-1.5 ' + (expanded ? '' : 'line-clamp-2')}>
        {task.title}
      </div>
      <div class="flex items-center gap-1.5 flex-wrap">
        {task.priority > 0 && <Pill tone={priorityTone}>P{task.priority}</Pill>}
        {agentLabel && (
          <Pill tone="accent">
            {agent && (
              <AgentAvatar
                agentId={agent.id}
                name={agent.name}
                running={agent.running}
                size={14}
              />
            )}
            <span class="max-w-[100px] truncate">{agentLabel}</span>
          </Pill>
        )}
        {task.status === 'failed' && <Pill tone="failed">{task.status}</Pill>}
        {task.status === 'cancelled' && <Pill tone="cancelled">{task.status}</Pill>}
        {projectName && (
          <Pill tone="accent">
            <FolderKanban size={9} /> <span class="max-w-[90px] truncate">{projectName}</span>
          </Pill>
        )}
        <div class="ml-auto flex items-center gap-1">
          {projects.length > 0 && (
            <ProjectAttachSelect
              taskId={task.id}
              currentProjectId={task.project_id}
              projects={projects}
              compact
              onChanged={onChange}
            />
          )}
          {(task.status === 'queued' || task.status === 'running') && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); cancel(); }}
              disabled={busy !== null}
              class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] transition-colors disabled:opacity-40"
              title="Cancel"
            >
              <X size={11} />
            </button>
          )}
          {TERMINAL.includes(task.status) && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); remove(); }}
              disabled={busy !== null}
              class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] transition-colors disabled:opacity-40"
              title="Delete"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
      {expanded && task.prompt && task.prompt !== task.title && (
        <div class="mt-2 text-[11px] text-[var(--color-text-muted)] whitespace-pre-wrap font-mono leading-relaxed">
          {task.prompt}
        </div>
      )}
      {expanded && task.result && (
        <div class="mt-2 text-[11px] text-[var(--color-text)] whitespace-pre-wrap leading-relaxed border-t border-[var(--color-border)] pt-2">
          {task.result}
        </div>
      )}
      {task.error && (
        <div class="mt-1.5 text-[10.5px] text-[var(--color-status-failed)] line-clamp-2 font-mono">
          {task.error}
        </div>
      )}
    </div>
  );
}

// ── Create modal ───────────────────────────────────────────────────

const MAX_TASK_ATTACHMENTS = 5;
const MAX_TASK_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const TASK_ATTACH_ACCEPT = [
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv',
  '.md', '.txt', '.json', '.yaml', '.yml',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.mp4', '.mov',
].join(',');
const TASK_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic'];

function taskFormatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function CreateTaskModal({
  open, onClose, agents, projects, defaultProjectId, onCreated,
}: {
  open: boolean; onClose: () => void; agents: Agent[];
  projects: ProjectLite[]; defaultProjectId?: string; onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agent, setAgent] = useState<string>('');
  const [priority, setPriority] = useState(5);
  const [autoAssign, setAutoAssign] = useState(true);
  const [projectId, setProjectId] = useState('');
  // Adopt the preselected project (from a project's "Add task" button)
  // whenever the modal opens with one.
  useEffect(() => {
    if (open) setProjectId(defaultProjectId || '');
  }, [open, defaultProjectId]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function close() {
    setTitle(''); setPrompt(''); setAgent(''); setPriority(5); setAutoAssign(true); setErr(null);
    setAttachments([]); setDragging(false); dragDepth.current = 0; setProjectId('');
    onClose();
  }

  function addFiles(files: FileList | File[] | null | undefined) {
    if (!files) return;
    setErr(null);
    const incoming = Array.from(files);
    const rejected = incoming.find((f) => f.size > MAX_TASK_ATTACHMENT_BYTES);
    if (rejected) {
      setErr(`"${rejected.name}" is too large (max 50MB)`);
      return;
    }
    setAttachments((prev) => {
      const merged = [...prev];
      for (const f of incoming) {
        if (merged.length >= MAX_TASK_ATTACHMENTS) {
          setErr(`Max ${MAX_TASK_ATTACHMENTS} files per task`);
          break;
        }
        if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f);
      }
      return merged;
    });
  }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      // Upload attachments first; the task references the saved paths.
      let uploaded: { name: string; path: string }[] = [];
      if (attachments.length > 0) {
        const form = new FormData();
        for (const f of attachments) form.append('files', f, f.name);
        const up = await apiUpload<{ files: { name: string; path: string }[] }>('/api/chat/upload', form);
        uploaded = up.files || [];
      }
      const body: any = { title: title.trim(), prompt: prompt.trim(), priority };
      if (!autoAssign && agent) body.assigned_agent = agent;
      if (uploaded.length > 0) body.attachments = uploaded;
      if (projectId) body.project_id = projectId;
      const created = await apiPost<{ task: MissionTask }>('/api/mission/tasks', body);
      if (autoAssign && !agent) {
        // Fire auto-assign in background; don't block the modal close.
        apiPost(`/api/mission/tasks/${created.task.id}/auto-assign`).catch(() => {});
      }
      onCreated();
      close();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally { setBusy(false); }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="New mission task"
      width={520}
      footer={
        <>
          <button type="button" onClick={close} class="px-3 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !title.trim() || !prompt.trim()}
            class="ml-auto px-3 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div class="space-y-3">
        <div>
          <label class="block text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Title</label>
          <input
            type="text"
            value={title}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
            placeholder="Short label (max 200 chars)"
            maxLength={200}
            autoFocus
            class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <div>
          <label class="block text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Prompt</label>
          <textarea
            value={prompt}
            onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
            placeholder="Full instructions for the agent. Max 10000 chars."
            maxLength={10000}
            rows={6}
            class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)] resize-none font-mono"
          />
          <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5 tabular-nums">{prompt.length} / 10000</div>
        </div>
        <div>
          <label class="block text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Files & pictures (optional)</label>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={TASK_ATTACH_ACCEPT}
            class="hidden"
            onChange={(e) => {
              const input = e.target as HTMLInputElement;
              addFiles(input.files);
              input.value = '';
            }}
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(e) => {
              if (!e.dataTransfer?.types?.includes('Files')) return;
              e.preventDefault();
              dragDepth.current++;
              setDragging(true);
            }}
            onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
            onDragLeave={(e) => {
              e.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              addFiles(e.dataTransfer?.files);
            }}
            class={`flex items-center justify-center gap-1.5 rounded border border-dashed px-3 py-2.5 text-[11px] cursor-pointer transition-colors ${
              dragging
                ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-elevated)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)]'
            }`}
          >
            <Paperclip size={12} />
            {dragging ? 'Drop to attach' : 'Click to browse or drag & drop (docs, spreadsheets, images, video — max 5 × 50MB)'}
          </div>
          {attachments.length > 0 && (
            <div class="flex items-center gap-1.5 mt-2 flex-wrap">
              {attachments.map((f, i) => {
                const ext = f.name.split('.').pop()?.toLowerCase() || '';
                const isImage = TASK_IMAGE_EXTS.includes(ext);
                return (
                  <span
                    key={`${f.name}-${f.size}-${i}`}
                    class="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md text-[11px] bg-[var(--color-elevated)] border border-[var(--color-border)] text-[var(--color-text)]"
                  >
                    {isImage ? <ImageIcon size={11} class="text-[var(--color-accent)]" /> : <FileText size={11} class="text-[var(--color-accent)]" />}
                    <span class="max-w-[180px] truncate">{f.name}</span>
                    <span class="text-[var(--color-text-faint)]">{taskFormatBytes(f.size)}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setAttachments((prev) => prev.filter((_, j) => j !== i)); }}
                      class="p-0.5 rounded hover:bg-[var(--color-card)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                      aria-label={`Remove ${f.name}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Assign</label>
            <select
              value={autoAssign ? '__auto' : agent}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value;
                if (v === '__auto') { setAutoAssign(true); setAgent(''); }
                else { setAutoAssign(false); setAgent(v); }
              }}
              class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
            >
              <option value="__auto">Auto (Gemini classifier)</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            </select>
          </div>
          <div>
            <label class="block text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Priority (0–10)</label>
            <input
              type="number"
              min={0}
              max={10}
              value={priority}
              onInput={(e) => setPriority(Math.max(0, Math.min(10, Number((e.target as HTMLInputElement).value) || 0)))}
              class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] tabular-nums outline-none focus:border-[var(--color-accent)]"
            />
          </div>
        </div>
        {projects.length > 0 && (
          <div>
            <label class="block text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Project (optional)</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId((e.target as HTMLSelectElement).value)}
              class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">None</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        {err && <div class="text-[var(--color-status-failed)] text-[11px]">{err}</div>}
      </div>
    </Modal>
  );
}

// ── History drawer ─────────────────────────────────────────────────

// Mounted fresh on every drawer open via the `historyOpen` guard in
// MissionControl. That means the fetch always retries on open — fixes
// the "drawer empty forever" symptom where a transient backend hiccup
// at first paint left the list permanently blank with no error visible.
function HistoryList({ projects, onChanged }: { projects: ProjectLite[]; onChanged: () => void }) {
  const [items, setItems] = useState<MissionTask[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const PAGE = 20;

  useEffect(() => { void load(0, true); }, []);

  async function load(off: number, reset = false) {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<{ tasks: MissionTask[]; total: number }>(`/api/mission/history?limit=${PAGE}&offset=${off}`);
      setTotal(data.total);
      setItems(reset ? data.tasks : [...items, ...data.tasks]);
      setOffset(off + data.tasks.length);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally { setLoading(false); }
  }

  return (
    <div class="px-6 py-4">
      <div class="flex items-center gap-3 mb-3">
        <div class="text-[12px] text-[var(--color-text-muted)] tabular-nums">{total} historical tasks</div>
        {!loading && (
          <button
            type="button"
            onClick={() => load(0, true)}
            class="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]"
          >
            ↻ Refresh
          </button>
        )}
      </div>
      {error && (
        <div class="bg-[var(--color-card)] border border-[var(--color-status-failed)] rounded p-3 mb-3">
          <div class="text-[12px] text-[var(--color-status-failed)] font-medium mb-1">Failed to load history</div>
          <div class="text-[11.5px] text-[var(--color-text-muted)] font-mono break-all">{error}</div>
          <button
            type="button"
            onClick={() => load(0, true)}
            class="mt-2 text-[11.5px] text-[var(--color-accent)] hover:underline"
          >
            Try again
          </button>
        </div>
      )}
      <div class="space-y-1.5">
        {items.map((t) => (
          <div key={t.id} class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded p-3">
            <div class="flex items-center gap-2 mb-1">
              <Pill tone={t.status as any}>{t.status}</Pill>
              <span class="text-[10.5px] text-[var(--color-text-faint)] tabular-nums uppercase tracking-wider">{t.id.slice(0, 6)}</span>
              {t.assigned_agent && <span class="text-[11px] text-[var(--color-text-muted)]">@{t.assigned_agent}</span>}
              <span class="ml-auto text-[10.5px] text-[var(--color-text-faint)]">
                {formatRelativeTime(t.completed_at || t.created_at)}
              </span>
            </div>
            <div class="text-[13px] text-[var(--color-text)] mb-1">{t.title}</div>
            {t.result && (
              <div class="text-[11.5px] text-[var(--color-text-muted)] whitespace-pre-wrap line-clamp-3 leading-relaxed">{t.result}</div>
            )}
            {t.error && (
              <div class="text-[11.5px] text-[var(--color-status-failed)] whitespace-pre-wrap line-clamp-2 font-mono">{t.error}</div>
            )}
            {projects.length > 0 && (
              <div class="mt-2 pt-2 border-t border-[var(--color-border)]" onClick={(e) => e.stopPropagation()}>
                <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Project</div>
                <ProjectAttachSelect
                  taskId={t.id}
                  currentProjectId={t.project_id}
                  projects={projects}
                  onChanged={() => { onChanged(); void load(0, true); }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      {offset < total && (
        <button
          type="button"
          onClick={() => load(offset)}
          disabled={loading}
          class="w-full mt-3 px-3 py-2 rounded border border-[var(--color-border)] text-[12.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors disabled:opacity-40"
        >
          {loading ? 'Loading…' : `Load more (${total - offset} remaining)`}
        </button>
      )}
      {items.length === 0 && !loading && !error && (
        <div class="text-center text-[11.5px] text-[var(--color-text-faint)] py-12">No completed tasks yet</div>
      )}
    </div>
  );
}
