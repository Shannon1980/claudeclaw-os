// Projects — the container the daily loop hangs off (operator-product 04-projects.md).
//
// A project is "the same daily loop scoped down": the list shows operator cards
// (type, derived health, scoped on-plate/waiting/shipped counts, assigned
// teammates, a next-item line) and the detail view renders the Home skeleton
// scoped to one project via GET /api/home/summary?project=<id> — reusing the
// shared DailyLoop components rather than a parallel layout.

import { useMemo, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'wouter-preact';
import {
  Plus, FolderKanban, CheckCircle2, Archive, RotateCcw, Trash2, Link2,
  Download, FileText, Image as ImageIcon, ExternalLink, ArrowLeft,
} from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { PageState } from '@/components/PageState';
import { Modal } from '@/components/Modal';
import { AgentAvatar } from '@/components/AgentAvatar';
import { AddExistingTasksModal } from '@/components/ProjectTaskAttach';
import { LoopZones, NeedsYouCard, type HomeSummary } from '@/components/DailyLoop';
import { type Agent } from '@/components/TaskModals';
import { useFetch } from '@/lib/useFetch';
import { apiPost, apiPatch, apiDelete, dashboardToken } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { pushToast } from '@/lib/toasts';

type ProjectType = 'client' | 'internal' | 'hiring' | 'other';

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'completed' | 'closed';
  type: ProjectType;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  task_total: number;
  task_completed: number;
  task_running: number;
  task_queued: number;
  task_failed: number;
  task_plate: number;
  task_waiting: number;
  task_needs: number;
  oldest_blocked: number | null;
  teammates: string[];
  last_activity: number | null;
}

interface MissionTaskFile {
  path: string;
  name: string;
  kind: string;
  direction: 'input' | 'output';
  caption?: string;
  exists: boolean;
  is_url: boolean;
  task_id: string;
  task_title: string;
}

function projectFileHref(projectId: string, file: MissionTaskFile): string {
  if (file.is_url) return file.path;
  return `/api/projects/${projectId}/files/download?path=${encodeURIComponent(file.path)}&token=${encodeURIComponent(dashboardToken)}`;
}

const TYPE_LABEL: Record<ProjectType, string> = {
  client: 'Client', internal: 'Internal', hiring: 'Hiring', other: 'Other',
};

const LIFECYCLE_TONE: Record<Project['status'], 'done' | 'accent' | 'cancelled'> = {
  active: 'accent', completed: 'done', closed: 'cancelled',
};

// Health is derived, not stored (04-projects.md): Needs you if the operator
// owes a decision; At risk if a blocked item has been aging; otherwise On
// track. Manual override and "Paused" are not wired yet (no data source).
const AGING_BLOCK_SECS = 3 * 24 * 60 * 60;
function deriveHealth(p: Project): { label: string; tone: 'accent' | 'high' | 'done' } {
  if (p.task_needs > 0) return { label: 'Needs you', tone: 'accent' };
  const now = Date.now() / 1000;
  if (p.task_waiting > 0 && p.oldest_blocked != null && now - p.oldest_blocked > AGING_BLOCK_SECS) {
    return { label: 'At risk', tone: 'high' };
  }
  return { label: 'On track', tone: 'done' };
}

function nextItem(p: Project): string {
  if (p.task_needs > 0) return `Your input on ${p.task_needs} item${p.task_needs === 1 ? '' : 's'}`;
  if (p.task_waiting > 0) return `Waiting on others (${p.task_waiting})`;
  if (p.task_plate > 0) return `${p.task_plate} in progress`;
  if (p.task_completed > 0) return 'All shipped';
  return 'No work yet — add a task';
}

export function Projects() {
  const [, params] = useRoute<{ id: string }>('/projects/:id');
  if (params?.id) return <ProjectDetailPage projectId={params.id} />;
  return <ProjectsList />;
}

function ProjectsList() {
  const [, navigate] = useLocation();
  const { data, loading, error, refresh } = useFetch<{ projects: Project[] }>('/api/projects', 30_000);
  const agents = useFetch<{ agents: Agent[] }>('/api/agents', 60_000);
  const agentById = useMemo(
    () => new Map((agents.data?.agents ?? []).map((a) => [a.id, a])),
    [agents.data],
  );
  const projects = data?.projects ?? [];
  const [createOpen, setCreateOpen] = useState(false);

  const active = projects.filter((p) => p.status === 'active');
  const finished = projects.filter((p) => p.status !== 'active');

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
              <Plus size={14} /> New project
            </button>
          </>
        }
      />

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}
      {!loading && !error && projects.length === 0 && (
        <PageState
          empty
          emptyTitle="Start your first project"
          emptyDescription="Projects give your work structure — a client engagement, an internal initiative, a hire. Everything the team does can hang off one."
        />
      )}

      {!error && projects.length > 0 && (
        <div class="flex-1 overflow-y-auto p-4 space-y-6">
          <ProjectGrid projects={active} agentById={agentById} onOpen={(id) => navigate(`/projects/${id}`)} />
          {finished.length > 0 && (
            <div>
              <div class="section-label px-1 mb-2">Completed & closed</div>
              <ProjectGrid projects={finished} agentById={agentById} onOpen={(id) => navigate(`/projects/${id}`)} />
            </div>
          )}
        </div>
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { refresh(); navigate(`/projects/${id}`); }}
      />
    </div>
  );
}

function ProjectGrid({ projects, agentById, onOpen }: {
  projects: Project[]; agentById: Map<string, Agent>; onOpen: (id: string) => void;
}) {
  if (projects.length === 0) return null;
  return (
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {projects.map((p) => <ProjectCard key={p.id} project={p} agentById={agentById} onOpen={() => onOpen(p.id)} />)}
    </div>
  );
}

function TeammateStack({ ids, agentById }: { ids: string[]; agentById: Map<string, Agent> }) {
  if (ids.length === 0) return null;
  const shown = ids.slice(0, 4);
  const extra = ids.length - shown.length;
  return (
    <div class="flex items-center">
      {shown.map((id, i) => (
        <span key={id} class={'rounded-full ring-2 ring-[var(--color-card)] ' + (i > 0 ? '-ml-1.5' : '')}>
          <AgentAvatar agentId={id} name={agentById.get(id)?.name || id} running={agentById.get(id)?.running} size={20} />
        </span>
      ))}
      {extra > 0 && <span class="-ml-1.5 text-[10px] text-[var(--color-text-faint)] tabular-nums pl-2">+{extra}</span>}
    </div>
  );
}

function ProjectCard({ project, agentById, onOpen }: {
  project: Project; agentById: Map<string, Agent>; onOpen: () => void;
}) {
  const isActive = project.status === 'active';
  const health = isActive ? deriveHealth(project) : null;
  return (
    <div
      class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-strong)] transition-colors cursor-pointer"
      onClick={onOpen}
    >
      <div class="flex items-start gap-2.5 mb-2">
        <FolderKanban size={16} class="text-[var(--color-accent)] mt-0.5 shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-medium text-[var(--color-text)] truncate">{project.name}</div>
          <div class="text-[10px] text-[var(--color-text-faint)] uppercase tracking-wider">{TYPE_LABEL[project.type] ?? 'Internal'}</div>
        </div>
        {health
          ? <Pill tone={health.tone}>{health.label}</Pill>
          : <Pill tone={LIFECYCLE_TONE[project.status]}>{project.status}</Pill>}
      </div>

      {project.description && (
        <div class="text-[12px] text-[var(--color-text-muted)] leading-snug mb-3 line-clamp-2">{project.description}</div>
      )}

      {/* Scoped daily-loop counts — the same three zones, as a glance. */}
      <div class="flex items-center gap-3 text-[11px] text-[var(--color-text-muted)] mb-3 tabular-nums">
        <span><span class="text-[var(--color-text)] font-medium">{project.task_plate}</span> on plate</span>
        <span><span class="text-[var(--color-text)] font-medium">{project.task_waiting}</span> waiting</span>
        <span><span class="text-[var(--color-text)] font-medium">{project.task_completed}</span> shipped</span>
      </div>

      <div class="flex items-center gap-2">
        <TeammateStack ids={project.teammates} agentById={agentById} />
        <span class="ml-auto text-[10.5px] text-[var(--color-text-faint)] truncate">
          Next: {nextItem(project)}
        </span>
      </div>
    </div>
  );
}

// ── Detail view (scoped Home) ─────────────────────────────────────────

function ProjectDetailPage({ projectId }: { projectId: string }) {
  const [, navigate] = useLocation();
  const meta = useFetch<{ project: Project; files: MissionTaskFile[] }>(`/api/projects/${projectId}`, 30_000);
  const summary = useFetch<HomeSummary>(`/api/home/summary?project=${projectId}`, 15_000);
  const agents = useFetch<{ agents: Agent[] }>('/api/agents', 60_000);
  const agentById = useMemo(
    () => new Map((agents.data?.agents ?? []).map((a) => [a.id, a])),
    [agents.data],
  );

  const project = meta.data?.project;
  const files = meta.data?.files ?? [];
  const loading = meta.loading && !meta.data;
  const error = meta.error;
  const refresh = () => { meta.refresh(); summary.refresh(); };

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={project?.name ?? 'Project'}
        breadcrumb="Projects"
        tabs={
          <button
            type="button"
            onClick={() => navigate('/projects')}
            class="text-[12px] text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] inline-flex items-center gap-1"
          >
            <ArrowLeft size={12} /> Back to projects
          </button>
        }
      />

      {error && <PageState error={error} />}
      {loading && <PageState loading />}
      {!loading && !error && !project && (
        <PageState empty emptyTitle="Project not found" emptyDescription="It may have been deleted." />
      )}
      {project && (
        <div class="flex-1 overflow-y-auto px-6 py-4">
          <div class="max-w-[1100px] mx-auto">
            <ProjectDetail
              project={project}
              files={files}
              summary={summary.data}
              agentById={agentById}
              onRefresh={refresh}
              onDeleted={() => navigate('/projects')}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectDetail({ project, files, summary, agentById, onRefresh, onDeleted }: {
  project: Project;
  files: MissionTaskFile[];
  summary: HomeSummary | null;
  agentById: Map<string, Agent>;
  onRefresh: () => void;
  onDeleted: () => void;
}) {
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const [addExistingOpen, setAddExistingOpen] = useState(false);

  const health = project.status === 'active' ? deriveHealth(project) : null;

  async function setStatus(status: Project['status']) {
    setBusy(true);
    try {
      await apiPatch(`/api/projects/${project.id}`, { status });
      pushToast({ tone: 'success', title: `Project ${status === 'active' ? 'reopened' : status}` });
      onRefresh();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Update failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Delete project "${project.name}"? Its work is kept but detached from the project.`)) return;
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
        {health
          ? <Pill tone={health.tone}>{health.label}</Pill>
          : <Pill tone={LIFECYCLE_TONE[project.status]}>{project.status}</Pill>}
        <span class="text-[11px] text-[var(--color-text-faint)] uppercase tracking-wider">{TYPE_LABEL[project.type] ?? 'Internal'}</span>
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
          title={project.status !== 'active' ? 'Reopen the project to add work' : 'Hand a new task to this project'}
          class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={12} /> Add task
        </button>
        <button
          type="button"
          onClick={() => setAddExistingOpen(true)}
          disabled={project.status !== 'active'}
          title={project.status !== 'active' ? 'Reopen the project to add work' : 'Attach existing work'}
          class={btn}
        >
          <Link2 size={12} /> Add existing
        </button>
        <button type="button" disabled={busy} onClick={remove} class={btn + ' ml-auto hover:!text-[var(--color-status-failed)]'}>
          <Trash2 size={12} />
        </button>
      </div>

      {/* Needs you, scoped to this project. */}
      {summary && (
        <NeedsYouCard
          variant="project"
          needsYou={summary.needsYou}
          agents={agentById.size > 0 ? [...agentById.values()] : []}
          agentById={agentById}
          onChange={onRefresh}
        />
      )}

      {/* The same three zones as Home, scoped down. */}
      {summary && (
        <LoopZones
          onPlate={summary.onPlate}
          waiting={summary.waiting}
          shipped={summary.shipped}
          agentById={agentById}
          onChange={onRefresh}
        />
      )}

      {files.length > 0 && <ProjectFilesPanel projectId={project.id} files={files} />}

      <AddExistingTasksModal
        open={addExistingOpen}
        onClose={() => setAddExistingOpen(false)}
        projectId={project.id}
        projectName={project.name}
        excludeTaskIds={new Set()}
        onAdded={onRefresh}
      />
    </div>
  );
}

function ProjectFilesPanel({ projectId, files }: { projectId: string; files: MissionTaskFile[] }) {
  const inputs = files.filter((f) => f.direction === 'input');
  const outputs = files.filter((f) => f.direction === 'output');
  return (
    <div>
      <div class="section-label mb-2">Files ({files.length})</div>
      <div class="space-y-3 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
        {inputs.length > 0 && <FileGroup label="Inputs" projectId={projectId} files={inputs} />}
        {outputs.length > 0 && <FileGroup label="Generated outputs" projectId={projectId} files={outputs} />}
      </div>
    </div>
  );
}

function FileGroup({ label, projectId, files }: { label: string; projectId: string; files: MissionTaskFile[] }) {
  return (
    <div>
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1.5">{label}</div>
      <div class="space-y-1">
        {files.map((f) => (
          <FileRow key={`${f.direction}:${f.path}:${f.task_id}`} projectId={projectId} file={f} />
        ))}
      </div>
    </div>
  );
}

function FileRow({ projectId, file }: { projectId: string; file: MissionTaskFile }) {
  const isImage = file.kind === 'image' || file.kind === 'photo';
  const href = projectFileHref(projectId, file);
  const missing = !file.is_url && !file.exists;

  return (
    <div class="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5">
      {isImage
        ? <ImageIcon size={13} class="text-[var(--color-accent)] shrink-0" />
        : <FileText size={13} class="text-[var(--color-accent)] shrink-0" />}
      <div class="flex-1 min-w-0">
        <div class="text-[12px] text-[var(--color-text)] truncate">{file.name}</div>
        <div class="text-[10px] text-[var(--color-text-faint)] truncate">
          {file.caption || file.task_title}
          {missing ? ' · missing on disk' : ''}
        </div>
      </div>
      <Pill tone={file.direction === 'input' ? 'queued' : 'done'}>{file.direction}</Pill>
      {file.is_url ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] transition-colors shrink-0"
        >
          <ExternalLink size={11} /> Open
        </a>
      ) : missing ? (
        <span class="text-[10px] text-[var(--color-text-faint)] shrink-0">Unavailable</span>
      ) : (
        <a
          href={href}
          download={file.name}
          class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] border border-[var(--color-border)] transition-colors shrink-0"
        >
          <Download size={11} /> Download
        </a>
      )}
    </div>
  );
}

// ── Create modal ─────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: ProjectType; label: string }[] = [
  { value: 'client', label: 'Client' },
  { value: 'internal', label: 'Internal' },
  { value: 'hiring', label: 'Hiring' },
  { value: 'other', label: 'Other' },
];

function CreateProjectModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ProjectType>('client');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function close() {
    setName(''); setType('client'); setDescription(''); setErr(null);
    onClose();
  }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await apiPost<{ project: Project }>('/api/projects', {
        name: name.trim(),
        type,
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
          <label class="block text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Type</label>
          <div class="flex items-center gap-1.5">
            {TYPE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setType(o.value)}
                class={'px-2.5 py-1.5 rounded text-[12px] border transition-colors ' + (
                  type === o.value
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
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
