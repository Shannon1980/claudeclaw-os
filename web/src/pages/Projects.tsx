import { useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { Plus, FolderKanban, CheckCircle2, Archive, RotateCcw, Trash2, ChevronDown, ChevronRight, Link2, X } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { Pill, StatusDot } from '@/components/Pill';
import { PageState } from '@/components/PageState';
import { Modal, Drawer } from '@/components/Modal';
import { AgentAvatar } from '@/components/AgentAvatar';
import { AddExistingTasksModal } from '@/components/ProjectTaskAttach';
import { useFetch } from '@/lib/useFetch';
import { apiPost, apiPatch, apiDelete } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { pushToast } from '@/lib/toasts';

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'completed' | 'closed';
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  task_total: number;
  task_completed: number;
  task_running: number;
  task_queued: number;
  task_failed: number;
  last_activity: number | null;
}

interface ProjectTask {
  id: string;
  title: string;
  prompt: string;
  assigned_agent: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  error: string | null;
}

const STATUS_TONE: Record<Project['status'], 'done' | 'accent' | 'cancelled'> = {
  active: 'accent',
  completed: 'done',
  closed: 'cancelled',
};

export function Projects() {
  const { data, loading, error, refresh } = useFetch<{ projects: Project[] }>('/api/projects', 30_000);
  const projects = data?.projects ?? [];
  const [createOpen, setCreateOpen] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);

  const active = projects.filter((p) => p.status === 'active');
  const finished = projects.filter((p) => p.status !== 'active');
  const opened = projects.find((p) => p.id === openedId) ?? null;

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Projects"
        actions={
          <>
            <span class="text-[11px] text-[var(--color-text-muted)] tabular-nums mr-2">
              {active.length} active · {projects.length} total
            </span>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              <Plus size={14} /> New Project
            </button>
          </>
        }
      />

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}
      {!loading && !error && projects.length === 0 && (
        <PageState
          empty
          emptyTitle="No projects yet"
          emptyDescription="Group mission tasks into a project to track inputs and outputs together until the work is completed or closed."
        />
      )}

      {!error && projects.length > 0 && (
        <div class="flex-1 overflow-y-auto p-4 space-y-6">
          <ProjectGrid projects={active} onOpen={setOpenedId} />
          {finished.length > 0 && (
            <div>
              <div class="section-label px-1 mb-2">Completed & closed</div>
              <ProjectGrid projects={finished} onOpen={setOpenedId} />
            </div>
          )}
        </div>
      )}

      <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => { refresh(); setOpenedId(id); }} />

      <Drawer open={opened !== null} onClose={() => setOpenedId(null)} title={opened?.name ?? 'Project'}>
        {opened && <ProjectDetail project={opened} onChange={refresh} onDeleted={() => { setOpenedId(null); refresh(); }} />}
      </Drawer>
    </div>
  );
}

function ProjectGrid({ projects, onOpen }: { projects: Project[]; onOpen: (id: string) => void }) {
  if (projects.length === 0) return null;
  return (
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {projects.map((p) => <ProjectCard key={p.id} project={p} onOpen={() => onOpen(p.id)} />)}
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const pct = project.task_total > 0 ? Math.round((project.task_completed / project.task_total) * 100) : 0;
  return (
    <div
      class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-strong)] transition-colors cursor-pointer"
      onClick={onOpen}
    >
      <div class="flex items-start gap-2.5 mb-2">
        <FolderKanban size={16} class="text-[var(--color-accent)] mt-0.5 shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-medium text-[var(--color-text)] truncate">{project.name}</div>
          <div class="text-[10px] text-[var(--color-text-faint)] uppercase tracking-wider">{project.id}</div>
        </div>
        <Pill tone={STATUS_TONE[project.status]}>{project.status}</Pill>
      </div>

      {project.description && (
        <div class="text-[12px] text-[var(--color-text-muted)] leading-snug mb-3 line-clamp-2">{project.description}</div>
      )}

      <div class="mb-2">
        <div class="flex items-center justify-between text-[10.5px] text-[var(--color-text-faint)] mb-1">
          <span>{project.task_completed} / {project.task_total} tasks done</span>
          <span class="tabular-nums">{pct}%</span>
        </div>
        <div class="h-1.5 rounded-full bg-[var(--color-elevated)] overflow-hidden">
          <div
            class="h-full rounded-full bg-[var(--color-accent)] transition-all"
            style={{ width: pct + '%' }}
          />
        </div>
      </div>

      <div class="flex items-center gap-1.5 flex-wrap text-[10.5px] text-[var(--color-text-faint)]">
        {project.task_running > 0 && <Pill tone="running">{project.task_running} running</Pill>}
        {project.task_queued > 0 && <Pill tone="queued">{project.task_queued} queued</Pill>}
        {project.task_failed > 0 && <Pill tone="failed">{project.task_failed} failed</Pill>}
        <span class="ml-auto">
          {project.last_activity ? 'active ' + formatRelativeTime(project.last_activity) : 'created ' + formatRelativeTime(project.created_at)}
        </span>
      </div>
    </div>
  );
}

// ── Detail drawer ────────────────────────────────────────────────────

function ProjectDetail({ project, onChange, onDeleted }: { project: Project; onChange: () => void; onDeleted: () => void }) {
  const [, navigate] = useLocation();
  const tasksFetch = useFetch<{ project: Project; tasks: ProjectTask[] }>(`/api/projects/${project.id}`, 15_000);
  const tasks = tasksFetch.data?.tasks ?? [];
  const [busy, setBusy] = useState(false);
  const [addExistingOpen, setAddExistingOpen] = useState(false);

  async function setStatus(status: Project['status']) {
    setBusy(true);
    try {
      await apiPatch(`/api/projects/${project.id}`, { status });
      pushToast({ tone: 'success', title: `Project ${status === 'active' ? 'reopened' : status}` });
      onChange();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Update failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Delete project "${project.name}"? Its tasks are kept but detached from the project.`)) return;
    setBusy(true);
    try {
      await apiDelete(`/api/projects/${project.id}`);
      pushToast({ tone: 'warn', title: 'Project deleted' });
      onDeleted();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Delete failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }

  const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] border border-[var(--color-border)] transition-colors disabled:opacity-40';

  return (
    <div class="space-y-4">
      <div class="flex items-center gap-2 flex-wrap">
        <Pill tone={STATUS_TONE[project.status]}>{project.status}</Pill>
        <span class="text-[11px] text-[var(--color-text-faint)]">
          created {formatRelativeTime(project.created_at)}
          {project.closed_at ? ' · ' + project.status + ' ' + formatRelativeTime(project.closed_at) : ''}
        </span>
      </div>

      {project.description && (
        <div class="text-[12.5px] text-[var(--color-text-muted)] leading-relaxed whitespace-pre-wrap">{project.description}</div>
      )}

      <div class="flex items-center gap-1.5 flex-wrap">
        {project.status === 'active' ? (
          <>
            <button type="button" disabled={busy} onClick={() => setStatus('completed')} class={btn}>
              <CheckCircle2 size={12} /> Mark completed
            </button>
            <button type="button" disabled={busy} onClick={() => setStatus('closed')} class={btn}>
              <Archive size={12} /> Close
            </button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => setStatus('active')} class={btn}>
            <RotateCcw size={12} /> Reopen
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate(`/mission?new=1&project=${project.id}`)}
          disabled={project.status !== 'active'}
          title={project.status !== 'active' ? 'Reopen the project to add tasks' : 'Create a mission task in this project'}
          class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={12} /> Add task
        </button>
        <button
          type="button"
          onClick={() => setAddExistingOpen(true)}
          disabled={project.status !== 'active'}
          title={project.status !== 'active' ? 'Reopen the project to add tasks' : 'Attach current or completed mission tasks'}
          class={btn}
        >
          <Link2 size={12} /> Add existing
        </button>
        <button type="button" disabled={busy} onClick={remove} class={btn + ' ml-auto hover:!text-[var(--color-status-failed)]'}>
          <Trash2 size={12} />
        </button>
      </div>

      <div>
        <div class="section-label mb-2">Tasks ({tasks.length})</div>
        {tasksFetch.loading && !tasksFetch.data && <PageState loading />}
        {tasks.length === 0 && !tasksFetch.loading && (
          <div class="text-[12px] text-[var(--color-text-faint)] py-4 text-center border border-dashed border-[var(--color-border)] rounded-md">
            No tasks yet. Use "Add task" to queue work into this project.
          </div>
        )}
        <div class="space-y-1.5">
          {tasks.map((t) => (
            <ProjectTaskRow
              key={t.id}
              task={t}
              onDetached={() => { tasksFetch.refresh(); onChange(); }}
            />
          ))}
        </div>
      </div>

      <AddExistingTasksModal
        open={addExistingOpen}
        onClose={() => setAddExistingOpen(false)}
        projectId={project.id}
        projectName={project.name}
        excludeTaskIds={new Set(tasks.map((t) => t.id))}
        onAdded={() => { tasksFetch.refresh(); onChange(); }}
      />
    </div>
  );
}

function ProjectTaskRow({ task, onDetached }: { task: ProjectTask; onDetached: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  async function detach() {
    setBusy(true);
    try {
      await apiPatch(`/api/mission/tasks/${task.id}`, { project_id: null });
      pushToast({ tone: 'success', title: 'Removed from project' });
      onDetached();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Remove failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }
  return (
    <div class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        class="w-full flex items-center gap-2 px-2.5 py-2 text-left"
      >
        {expanded ? <ChevronDown size={12} class="text-[var(--color-text-faint)] shrink-0" /> : <ChevronRight size={12} class="text-[var(--color-text-faint)] shrink-0" />}
        <StatusDot tone={task.status as any} />
        <span class="flex-1 min-w-0 text-[12.5px] text-[var(--color-text)] truncate">{task.title}</span>
        {task.assigned_agent && (
          <span class="inline-flex items-center gap-1 text-[10.5px] text-[var(--color-text-muted)]">
            <AgentAvatar agentId={task.assigned_agent} name={task.assigned_agent} running={false} size={14} />
            {task.assigned_agent}
          </span>
        )}
        <Pill tone={task.status as any}>{task.status}</Pill>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void detach(); }}
          disabled={busy}
          title="Remove from project"
          class="p-1 rounded text-[var(--color-text-faint)] hover:text-[var(--color-status-failed)] transition-colors disabled:opacity-40 shrink-0"
        >
          <X size={11} />
        </button>
        <span class="text-[10px] text-[var(--color-text-faint)] tabular-nums shrink-0">
          {formatRelativeTime(task.completed_at || task.started_at || task.created_at)}
        </span>
      </button>
      {expanded && (
        <div class="px-3 pb-2.5 space-y-2 border-t border-[var(--color-border)] pt-2">
          <div>
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Input</div>
            <div class="text-[11px] text-[var(--color-text-muted)] whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">{task.prompt}</div>
          </div>
          {task.result && (
            <div>
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Output</div>
              <div class="text-[11.5px] text-[var(--color-text)] whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">{task.result}</div>
            </div>
          )}
          {task.error && (
            <div class="text-[10.5px] text-[var(--color-status-failed)] font-mono">{task.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Create modal ─────────────────────────────────────────────────────

function CreateProjectModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function close() {
    setName(''); setDescription(''); setErr(null);
    onClose();
  }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await apiPost<{ project: Project }>('/api/projects', {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onCreated(res.project.id);
      close();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally { setBusy(false); }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="New project"
      width={460}
      footer={
        <>
          <button type="button" onClick={close} class="px-3 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !name.trim()}
            class="ml-auto px-3 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div class="space-y-3">
        <div>
          <label class="block text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Name</label>
          <input
            type="text"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="e.g. CMMI proposal response"
            maxLength={120}
            autoFocus
            class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <div>
          <label class="block text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Description (optional)</label>
          <textarea
            value={description}
            onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
            placeholder="What is this project trying to accomplish? Shown on the project card."
            rows={4}
            class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)] resize-none"
          />
        </div>
        {err && <div class="text-[var(--color-status-failed)] text-[11px]">{err}</div>}
      </div>
    </Modal>
  );
}
