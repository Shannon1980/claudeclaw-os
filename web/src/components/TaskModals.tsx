// Task create + history UI, shared by the Home daily loop.
//
// These were extracted from the former MissionControl kanban page so the
// daily-loop Home keeps the full task-management affordances (create with
// attachments, browse history) without forking the logic. Behavior is
// unchanged; only the create-modal title now resolves through the
// operator/builder vocabulary.

import { useEffect, useRef, useState } from 'preact/hooks';
import { X, Paperclip, FileText, Image as ImageIcon } from 'lucide-preact';
import { Pill } from '@/components/Pill';
import { Modal } from '@/components/Modal';
import { ProjectAttachSelect, type ProjectLite } from '@/components/ProjectTaskAttach';
import { apiPost, apiGet, apiUpload } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { term } from '@/lib/vocabulary';

export interface MissionTask {
  id: string;
  title: string;
  prompt: string;
  assigned_agent: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked' | 'needs_you';
  priority: number;
  created_by: string;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  error: string | null;
  project_id: string | null;
  blocked_on: string | null;
  blocked_since: number | null;
  slack_message_ts: string | null;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  running: boolean;
  delegationOnly?: boolean;
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

export function CreateTaskModal({
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
      title={term('action.newTask')}
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
            placeholder="Full instructions for the teammate. Max 10000 chars."
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

// ── History list ───────────────────────────────────────────────────

// Mounted fresh on every drawer open by the caller's open guard. That
// means the fetch always retries on open — fixes the "drawer empty
// forever" symptom where a transient backend hiccup at first paint left
// the list permanently blank with no error visible.
export function HistoryList({ projects, onChanged }: { projects: ProjectLite[]; onChanged: () => void }) {
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
