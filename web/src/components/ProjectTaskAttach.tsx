import { useEffect, useMemo, useState } from 'preact/hooks';
import { Search } from 'lucide-preact';
import { Modal } from '@/components/Modal';
import { Pill } from '@/components/Pill';
import { PageState } from '@/components/PageState';
import { apiGet, apiPatch } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { pushToast } from '@/lib/toasts';

export interface ProjectLite {
  id: string;
  name: string;
  status: 'active' | 'completed' | 'closed';
}

interface AttachableTask {
  id: string;
  title: string;
  status: string;
  assigned_agent: string | null;
  project_id: string | null;
  created_at: number;
  completed_at: number | null;
}

/** Dropdown to attach or detach a mission task from a project. */
export function ProjectAttachSelect({
  taskId,
  currentProjectId,
  projects,
  disabled,
  compact,
  onChanged,
}: {
  taskId: string;
  currentProjectId: string | null;
  projects: ProjectLite[];
  disabled?: boolean;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const active = projects.filter((p) => p.status === 'active');

  async function change(projectId: string) {
    const next = projectId || null;
    if (next === (currentProjectId || null)) return;
    setBusy(true);
    try {
      await apiPatch(`/api/mission/tasks/${taskId}`, { project_id: next });
      const name = next ? active.find((p) => p.id === next)?.name : null;
      pushToast({
        tone: 'success',
        title: next ? 'Added to project' : 'Removed from project',
        description: name ?? undefined,
      });
      onChanged?.();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Project update failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }

  if (active.length === 0) return null;

  return (
    <select
      value={currentProjectId || ''}
      onChange={(e) => { void change((e.target as HTMLSelectElement).value); }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      disabled={disabled || busy}
      title="Add to project"
      class={
        (compact
          ? 'max-w-[130px] bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[10px] text-[var(--color-text-muted)] px-1 py-0.5 outline-none'
          : 'w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1 text-[11.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]')
        + ' disabled:opacity-40'
      }
    >
      <option value="">{busy ? 'Saving…' : currentProjectId ? '— Remove' : 'No project'}</option>
      {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

/** Pick one or more existing tasks and attach them to a project. */
export function AddExistingTasksModal({
  open,
  onClose,
  projectId,
  projectName,
  excludeTaskIds,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  excludeTaskIds?: Set<string>;
  onAdded: () => void;
}) {
  const [tasks, setTasks] = useState<AttachableTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(new Set());
    setErr(null);
    void loadTasks();
  }, [open, projectId]);

  async function loadTasks() {
    setLoading(true);
    setErr(null);
    try {
      const [live, history] = await Promise.all([
        apiGet<{ tasks: AttachableTask[] }>('/api/mission/tasks'),
        apiGet<{ tasks: AttachableTask[] }>('/api/mission/history?limit=100&offset=0'),
      ]);
      const byId = new Map<string, AttachableTask>();
      for (const t of [...(live.tasks ?? []), ...(history.tasks ?? [])]) {
        if (t.project_id === projectId) continue;
        if (excludeTaskIds?.has(t.id)) continue;
        byId.set(t.id, t);
      }
      setTasks(Array.from(byId.values()).sort((a, b) => {
        const ta = a.completed_at || a.created_at;
        const tb = b.completed_at || b.created_at;
        return tb - ta;
      }));
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally { setLoading(false); }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) =>
      t.title.toLowerCase().includes(q)
      || t.id.toLowerCase().includes(q)
      || (t.assigned_agent ?? '').toLowerCase().includes(q),
    );
  }, [tasks, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) return;
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const id of selected) {
      try {
        await apiPatch(`/api/mission/tasks/${id}`, { project_id: projectId });
        ok++;
      } catch { failed++; }
    }
    setBusy(false);
    if (failed === 0) {
      pushToast({ tone: 'success', title: `Added ${ok} task${ok === 1 ? '' : 's'}`, description: projectName });
    } else {
      pushToast({ tone: 'error', title: `Added ${ok}, failed ${failed}`, durationMs: 7000 });
    }
    onAdded();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add existing tasks"
      width={520}
      footer={
        <>
          <button type="button" onClick={onClose} class="px-3 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || selected.size === 0}
            class="ml-auto px-3 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Adding…' : `Add ${selected.size || ''} task${selected.size === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div class="space-y-3">
        <p class="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
          Attach current or completed mission tasks to <span class="text-[var(--color-text)]">{projectName}</span>. Tasks already in another project will move here.
        </p>
        <div class="relative">
          <Search size={13} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)]" />
          <input
            type="search"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            placeholder="Search by title, id, or agent…"
            class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded pl-8 pr-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        {err && <div class="text-[11px] text-[var(--color-status-failed)]">{err}</div>}
        {loading && <PageState loading />}
        {!loading && filtered.length === 0 && !err && (
          <div class="text-[12px] text-[var(--color-text-faint)] text-center py-8 border border-dashed border-[var(--color-border)] rounded-md">
            {tasks.length === 0 ? 'No other tasks available to add.' : 'No tasks match your search.'}
          </div>
        )}
        <div class="max-h-[320px] overflow-y-auto space-y-1">
          {filtered.map((t) => {
            const checked = selected.has(t.id);
            return (
              <label
                key={t.id}
                class={`flex items-start gap-2.5 px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                  checked
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)] bg-[var(--color-elevated)]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(t.id)}
                  class="mt-0.5 shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <div class="text-[12.5px] text-[var(--color-text)] leading-snug truncate">{t.title}</div>
                  <div class="flex items-center gap-1.5 flex-wrap mt-1">
                    <Pill tone={t.status as any}>{t.status}</Pill>
                    {t.assigned_agent && <span class="text-[10px] text-[var(--color-text-faint)]">@{t.assigned_agent}</span>}
                    <span class="text-[10px] text-[var(--color-text-faint)] tabular-nums">{t.id.slice(0, 6)}</span>
                    <span class="text-[10px] text-[var(--color-text-faint)] ml-auto">{formatRelativeTime(t.completed_at || t.created_at)}</span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
