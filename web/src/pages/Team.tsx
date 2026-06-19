// Team — the operator's staff roster (operator-product spec 05-team.md).
//
// Two depths via progressive disclosure (spec):
//   - Roster (operator depth): who's on the team, what each is doing now,
//     workload, pause/resume. This page.
//   - Settings drawer (builder depth): brain, instructions, connected tools,
//     workspace, remove — tucked behind the per-teammate expander (AgentDetail).
//
// Live activity + workload come from GET /api/team/roster (a view over the same
// mission_tasks / scheduled_tasks the engine already produces). Pause/resume is
// non-destructive: a paused teammate is assigned no new work and runs no
// routines (the scheduler honors the flag), but its standalone service, if any,
// keeps running — that start/stop lives in the builder drawer.

import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { Plus, Copy, Check, Lightbulb, RefreshCw, Upload, Pause, Play, ChevronRight, Hourglass } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { Pill, StatusDot } from '@/components/Pill';
import { PageState } from '@/components/PageState';
import { Modal } from '@/components/Modal';
import { ModelPicker } from '@/components/ModelPicker';
import { claudeModelLabel } from '@claudeclaw/models';
import { AgentAvatar } from '@/components/AgentAvatar';
import { AgentDetail } from '@/components/AgentDetail';
import { AgentSuggestionBadge, AgentSuggestionModal, useAgentSuggestions, type AgentSuggestion } from '@/components/AgentSuggestions';
import { useFetch } from '@/lib/useFetch';
import { useDebouncedValue } from '@/lib/useDebounce';
import { apiPost } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { term, vocabMode } from '@/lib/vocabulary';
import { pushToast } from '@/lib/toasts';

export interface Agent {
  id: string;
  name: string;
  description: string;
  model: string;
  running: boolean;
  delegationOnly?: boolean;
  paused?: boolean;
  todayTurns: number;
  todayCost: number;
}

interface TeammateRollup {
  activeTask: string | null;
  activeTaskCount: number;
  routineCount: number;
  nextRoutineAt: number | null;
  paused: boolean;
}

interface Template { id: string; name: string; description: string; }

// Fixed teammate accent colors (spec): Research purple, Comms teal, Content
// coral, Ops amber. Matched on id substring so renamed teammates keep their
// color; anything unmatched falls back to the app accent.
function teammateColor(id: string): string {
  const k = id.toLowerCase();
  if (k.includes('research')) return '#a78bfa';
  if (k.includes('comms')) return '#2dd4bf';
  if (k.includes('content')) return '#fb7185';
  if (k.includes('ops')) return '#f59e0b';
  return 'var(--color-accent)';
}

export function Team() {
  const { data, loading, error, refresh } = useFetch<{ agents: Agent[] }>('/api/agents', 30_000);
  const rosterFetch = useFetch<{ roster: Record<string, TeammateRollup> }>('/api/team/roster', 15_000);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [bulkModel, setBulkModel] = useState<string>('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);
  const [openedSuggestion, setOpenedSuggestion] = useState<AgentSuggestion | null>(null);
  const [suggestionPrefill, setSuggestionPrefill] = useState<AgentSuggestion | null>(null);
  const [refreshingSuggestions, setRefreshingSuggestions] = useState(false);
  const suggestionsFetch = useAgentSuggestions();
  const suggestions = suggestionsFetch.data?.suggestions ?? [];
  const agents = data?.agents ?? [];
  const roster = rosterFetch.data?.roster ?? {};

  const pausedCount = useMemo(() => agents.filter((a) => a.paused).length, [agents]);

  function refreshAll() {
    refresh();
    rosterFetch.refresh();
  }

  async function refreshSuggestions() {
    setRefreshingSuggestions(true);
    try {
      const res = await apiPost<{ inserted: number; skipped: number; reason?: string }>('/api/agents/suggestions/refresh');
      suggestionsFetch.refresh();
      if (res.reason) {
        pushToast({ tone: 'warn', title: 'Not enough activity yet', description: res.reason, durationMs: 6000 });
      } else if (res.inserted === 0) {
        pushToast({ tone: 'success', title: 'No new suggestions', description: 'Your team looks well-scoped.' });
      } else {
        pushToast({
          tone: 'success',
          title: `${res.inserted} suggestion${res.inserted === 1 ? '' : 's'}`,
          description: 'Look for the lightbulb icon on each teammate.',
        });
      }
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Refresh failed', description: err?.message || String(err), durationMs: 7000 });
    } finally { setRefreshingSuggestions(false); }
  }

  function actOnSuggestion(s: AgentSuggestion) {
    setOpenedSuggestion(null);
    setSuggestionPrefill(s);
    setWizardOpen(true);
  }

  // Builder-only fleet tool: set the brain for every teammate at once. Operators
  // never see this; per-teammate brain lives in the settings drawer.
  async function setAllModels(model: string) {
    setBulkBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; updated: string[]; restartRequired: string[] }>('/api/agents/model', { model });
      setBulkModel(model);
      const restartCount = res.restartRequired?.length || 0;
      if (restartCount > 0) {
        pushToast({
          tone: 'warn',
          title: `${restartCount} teammate${restartCount === 1 ? '' : 's'} need restart`,
          description: 'Yaml updated, but running processes still use the old brain: ' + res.restartRequired.join(', '),
          durationMs: 0,
          action: {
            label: 'Restart all',
            run: async () => {
              await Promise.all(res.restartRequired.map((id) => apiPost(`/api/agents/${id}/restart`).catch(() => null)));
              pushToast({ tone: 'success', title: 'Restarting', description: restartCount + ' processes bouncing.' });
              setTimeout(refreshAll, 3000);
            },
          },
        });
      } else {
        pushToast({ tone: 'success', title: 'Brain set for everyone', description: 'Now running on ' + claudeModelLabel(model) });
      }
      refreshAll();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Bulk brain change failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBulkBusy(false); }
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={term('page.team')}
        actions={
          <>
            <span class="text-[11px] text-[var(--color-text-muted)] tabular-nums mr-2">
              {agents.length} {agents.length === 1 ? 'teammate' : 'teammates'} · {agents.length - pausedCount} active{pausedCount > 0 ? `, ${pausedCount} paused` : ''}
            </span>
            {vocabMode.value === 'builder' && (
              <ModelPicker size="md" value={bulkModel} onSelect={setAllModels} disabled={bulkBusy} />
            )}
            {suggestions.length > 0 ? (
              // Cached on mount via useAgentSuggestions — clicking is INSTANT,
              // not a scan. The refresh icon is the only path that triggers Haiku.
              <div class="inline-flex">
                <button
                  type="button"
                  onClick={() => setOpenedSuggestion(suggestions[0])}
                  title={`View ${suggestions.length} active suggestion${suggestions.length === 1 ? '' : 's'}`}
                  class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-l text-[12px] border border-r-0 transition-colors bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent-soft)] hover:bg-[var(--color-accent)] hover:text-white"
                >
                  <Lightbulb size={13} />
                  {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'}
                </button>
                <button
                  type="button"
                  onClick={refreshSuggestions}
                  disabled={refreshingSuggestions}
                  title="Re-scan for teammates that should be split (~30–90s)"
                  class="inline-flex items-center justify-center px-2 py-1.5 rounded-r text-[12px] border bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent-soft)] hover:bg-[var(--color-accent)] hover:text-white disabled:opacity-40 transition-colors"
                >
                  <RefreshCw size={12} class={refreshingSuggestions ? 'animate-spin' : ''} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={refreshSuggestions}
                disabled={refreshingSuggestions}
                title="Scan for teammates that should be split (~30–90s)"
                class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] border border-[var(--color-border)] transition-colors disabled:opacity-40"
              >
                <Lightbulb size={13} />
                {refreshingSuggestions ? 'Scanning…' : 'Scan for suggestions'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              <Plus size={14} /> {term('action.addTeammate')}
            </button>
          </>
        }
      />

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}
      {!loading && !error && agents.length === 0 && (
        <PageState empty emptyTitle="No teammates yet" emptyDescription="Click Add teammate to build your team." />
      )}

      {agents.length > 0 && (
        <div class="flex-1 overflow-y-auto">
          <div class="max-w-[900px] mx-auto px-6 py-5 space-y-2">
            {agents.map((a) => (
              <TeammateRow
                key={a.id}
                agent={a}
                rollup={roster[a.id]}
                onChange={refreshAll}
                onOpen={() => setDetailAgent(a)}
                suggestions={suggestions}
                onOpenSuggestion={(s) => setOpenedSuggestion(s)}
              />
            ))}
          </div>
        </div>
      )}

      <CreateAgentWizard
        open={wizardOpen}
        onClose={() => { setWizardOpen(false); setSuggestionPrefill(null); }}
        onCreated={refreshAll}
        prefill={suggestionPrefill ? {
          id: suggestionPrefill.suggested_id,
          name: suggestionPrefill.suggested_name,
          description: suggestionPrefill.suggested_description,
        } : undefined}
      />
      <AgentDetail
        agent={detailAgent}
        onClose={() => setDetailAgent(null)}
        onUpdated={(updated) => { setDetailAgent(updated); refreshAll(); }}
        onRemoved={() => { setDetailAgent(null); refreshAll(); }}
      />
      <AgentSuggestionModal
        suggestion={openedSuggestion}
        onClose={() => setOpenedSuggestion(null)}
        onActed={actOnSuggestion}
        onChange={suggestionsFetch.refresh}
      />
    </div>
  );
}

// ── Roster row ───────────────────────────────────────────────────────

function TeammateRow({ agent, rollup, onChange, onOpen, suggestions, onOpenSuggestion }: {
  agent: Agent;
  rollup?: TeammateRollup;
  onChange: () => void;
  onOpen: () => void;
  suggestions: AgentSuggestion[];
  onOpenSuggestion: (s: AgentSuggestion) => void;
}) {
  const [busy, setBusy] = useState(false);
  const paused = agent.paused ?? rollup?.paused ?? false;
  const activeTask = rollup?.activeTask ?? null;
  const activeTaskCount = rollup?.activeTaskCount ?? 0;
  const routineCount = rollup?.routineCount ?? 0;
  const nextRoutineAt = rollup?.nextRoutineAt ?? null;
  const color = teammateColor(agent.id);

  async function togglePause() {
    setBusy(true);
    try {
      await apiPost(`/api/agents/${agent.id}/${paused ? 'resume' : 'pause'}`);
      onChange();
      pushToast({
        tone: 'success',
        title: paused ? `${agent.name || agent.id} resumed` : `${agent.name || agent.id} paused`,
        description: paused ? 'Back on new work and routines.' : 'No new work or routines until you resume.',
      });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not update', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }

  // Live activity line. Paused wins; then a running task; then watching routines;
  // then parked/queued work; otherwise idle.
  let dot: 'running' | 'accent' | 'queued' | 'cancelled' = 'cancelled';
  let activity = 'Idle';
  if (paused) {
    dot = 'cancelled'; activity = 'Paused';
  } else if (activeTask) {
    dot = 'running'; activity = `Running: ${activeTask}`;
  } else if (routineCount > 0) {
    dot = 'accent';
    activity = nextRoutineAt ? `Watching · next ${formatRelativeTime(nextRoutineAt)}` : `${routineCount} routine${routineCount === 1 ? '' : 's'} set`;
  } else if (activeTaskCount > 0) {
    dot = 'queued'; activity = `${activeTaskCount} task${activeTaskCount === 1 ? '' : 's'} queued`;
  }

  return (
    <div
      class={'flex items-center gap-3 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-3 py-3 hover:border-[var(--color-border-strong)] transition-colors cursor-pointer ' + (paused ? 'opacity-70' : '')}
      onClick={onOpen}
    >
      <div class="relative shrink-0" style={{ boxShadow: `0 0 0 2px ${color}`, borderRadius: '9999px' }}>
        <AgentAvatar agentId={agent.id} name={agent.name} running={!paused && !!activeTask} size={38} />
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          <span class="text-[13px] font-semibold text-[var(--color-text)] truncate">{agent.name || agent.id}</span>
          <AgentSuggestionBadge agentId={agent.id} suggestions={suggestions} onOpen={onOpenSuggestion} />
          {agent.delegationOnly && <Pill tone="neutral">delegation-only</Pill>}
        </div>
        {agent.description && (
          <div class="text-[11.5px] text-[var(--color-text-muted)] truncate leading-snug">{agent.description}</div>
        )}
        <div class="flex items-center gap-1.5 mt-1">
          <StatusDot tone={dot} />
          <span class="text-[11.5px] text-[var(--color-text-muted)] truncate">{activity}</span>
        </div>
      </div>

      {/* Workload */}
      <div class="hidden sm:flex flex-col items-end gap-1 shrink-0 text-right">
        {activeTaskCount > 0 && (
          <span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">
            {activeTaskCount} {activeTaskCount === 1 ? 'task' : 'tasks'}
          </span>
        )}
        {routineCount > 0 && (
          <span class="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-faint)] tabular-nums">
            <Hourglass size={10} /> {routineCount} {routineCount === 1 ? 'routine' : 'routines'}
          </span>
        )}
        {activeTaskCount === 0 && routineCount === 0 && (
          <span class="text-[11px] text-[var(--color-text-faint)]">no work</span>
        )}
      </div>

      {/* Controls */}
      <div class="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={togglePause}
          disabled={busy}
          class={'inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11.5px] font-medium border transition-colors disabled:opacity-40 ' + (paused
            ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent-soft)] hover:bg-[var(--color-accent)] hover:text-white'
            : 'bg-[var(--color-elevated)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-text)]')}
          title={paused ? 'Resume: take on new work and routines again' : 'Pause: no new work or routines until you resume'}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {busy ? '…' : paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={onOpen}
          class="inline-flex items-center justify-center p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors"
          title="Settings"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Wizard ───────────────────────────────────────────────────────────

interface CreateAgentWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Optional pre-fill from a suggestion ("spin off X" flow). When set,
   *  the wizard opens to step 1 with id/name/description already filled. */
  prefill?: { id: string; name: string; description: string };
}

function CreateAgentWizard({ open, onClose, onCreated, prefill }: CreateAgentWizardProps) {
  const [step, setStep] = useState(1);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [template, setTemplate] = useState('');
  const [botToken, setBotToken] = useState('');
  const [customClaudeMd, setCustomClaudeMd] = useState('');
  const [customAgentYaml, setCustomAgentYaml] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdSummary, setCreatedSummary] = useState<{ envKey: string | null; agentDir: string; hasToken: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<{ ok?: boolean; error?: string; username?: string } | null>(null);
  const idInputRef = useRef<HTMLInputElement>(null);

  const debouncedId = useDebouncedValue(id, 350);
  const debouncedToken = useDebouncedValue(botToken, 600);

  function resetFields(applyPrefill = false) {
    setStep(1);
    setId(applyPrefill && prefill ? prefill.id : '');
    setName(applyPrefill && prefill ? prefill.name : '');
    setNameTouched(applyPrefill && !!prefill);
    setDescription(applyPrefill && prefill ? prefill.description : '');
    setModel('claude-sonnet-4-6');
    setTemplate('');
    setBotToken('');
    setCustomClaudeMd('');
    setCustomAgentYaml('');
    setCreatedId(null);
    setCreatedSummary(null);
    setError(null);
    setTokenStatus(null);
  }

  // Fresh form every time the wizard opens (with optional suggestion prefill).
  useEffect(() => {
    if (open) resetFields(true);
  }, [open, prefill?.id]);

  // Focus the ID field when the wizard opens.
  useEffect(() => {
    if (!open || step !== 1) return;
    queueMicrotask(() => idInputRef.current?.focus());
  }, [open, step]);

  // Auto-generate display name from id until the user edits name manually.
  useEffect(() => {
    if (nameTouched || !id || name) return;
    const auto = id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    setName(auto);
  }, [id, name, nameTouched]);

  function close() {
    resetFields(false);
    onClose();
  }

  // Live ID validation.
  const idCheck = useFetch<{ ok: boolean; error?: string }>(
    debouncedId ? `/api/agents/validate-id?id=${encodeURIComponent(debouncedId)}` : null
  );

  // Live token validation.
  useEffect(() => {
    if (!debouncedToken || !debouncedToken.includes(':')) { setTokenStatus(null); return; }
    let cancelled = false;
    apiPost<{ ok: boolean; error?: string; botInfo?: { username?: string } }>('/api/agents/validate-token', { token: debouncedToken })
      .then((r) => { if (!cancelled) setTokenStatus({ ok: r.ok, error: r.error, username: r.botInfo?.username }); })
      .catch((e) => { if (!cancelled) setTokenStatus({ ok: false, error: e?.message || String(e) }); });
    return () => { cancelled = true; };
  }, [debouncedToken]);

  // Templates list.
  const templates = useFetch<{ templates: Template[] }>('/api/agents/templates');

  const idValid = !!debouncedId && idCheck.data?.ok === true;
  const tokenValid = tokenStatus?.ok === true;
  // Token is optional: empty = delegation-only teammate. If one IS entered,
  // it must validate before Create unlocks.
  const tokenOk = botToken.trim() === '' || tokenValid;
  const suggestedBotName = `ClaudeClaw ${name || 'Agent'}`;
  const suggestedBotUsername = `claudeclaw_${id || 'agent'}_bot`;

  async function create() {
    setCreating(true); setError(null);
    try {
      const res = await apiPost<any>('/api/agents/create', {
        id, name, description, model, template,
        botToken: botToken.trim() || undefined,
        claudeMd: customClaudeMd.trim() ? customClaudeMd : undefined,
        agentYaml: customAgentYaml.trim() ? customAgentYaml : undefined,
      });
      setCreatedId(res.agentId);
      setCreatedSummary({ envKey: res.envKey ?? null, agentDir: res.agentDir, hasToken: !!botToken.trim() });
      setStep(3);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally { setCreating(false); }
  }

  async function activate() {
    if (!createdId) return;
    setActivating(true); setError(null);
    try {
      const res = await apiPost<any>(`/api/agents/${createdId}/activate`);
      if (!res.ok) throw new Error(res.error || 'Activation failed');
      onCreated();
      setTimeout(close, 800);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally { setActivating(false); }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add teammate"
      width={520}
      footer={
        <>
          {step === 1 && (
            <>
              <button type="button" onClick={close} class="px-3 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">Cancel</button>
              <button
                type="button"
                onClick={() => { if (idValid && name && description) setStep(2); }}
                disabled={!idValid || !name || !description}
                class="ml-auto px-3 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next: Config →
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button type="button" onClick={() => setStep(1)} class="px-3 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">← Back</button>
              <button
                type="button"
                onClick={create}
                disabled={!tokenOk || creating}
                class="ml-auto px-3 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {creating ? 'Creating…' : 'Add teammate'}
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <button type="button" onClick={() => { onCreated(); close(); }} class="px-3 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">Done</button>
              {createdSummary?.hasToken && (
                <button
                  type="button"
                  onClick={activate}
                  disabled={activating}
                  class="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
                >
                  <Play size={12} /> {activating ? 'Activating…' : 'Activate (start service)'}
                </button>
              )}
            </>
          )}
        </>
      }
    >
      <div class="flex items-center gap-2 mb-4 text-[10px] uppercase tracking-wider">
        {[1, 2, 3].map((n) => (
          <div key={n} class="flex items-center gap-2">
            <div
              class="w-5 h-5 rounded-full flex items-center justify-center font-semibold"
              style={{
                backgroundColor: step >= n ? 'var(--color-accent-soft)' : 'var(--color-elevated)',
                color: step >= n ? 'var(--color-accent)' : 'var(--color-text-faint)',
                fontSize: '10px',
              }}
            >
              {step > n ? '✓' : n}
            </div>
            <span class={step === n ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)]'}>
              {n === 1 ? 'Basics' : n === 2 ? 'Config' : 'Done'}
            </span>
            {n < 3 && <span class="text-[var(--color-border)]">·</span>}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div class="space-y-3">
          <Field label="Teammate ID" hint="Lowercase letters, numbers, dash/underscore. 30 chars max.">
            <input
              ref={idInputRef}
              type="text"
              value={id}
              onInput={(e) => setId((e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              placeholder="research"
              class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            />
            {debouncedId && idCheck.data && !idCheck.data.ok && (
              <div class="text-[var(--color-status-failed)] text-[11px] mt-1">{idCheck.data.error}</div>
            )}
            {debouncedId && idCheck.data?.ok && (
              <div class="text-[var(--color-status-done)] text-[11px] mt-1">✓ Available</div>
            )}
          </Field>

          <Field label="Display name">
            <input
              type="text"
              value={name}
              onInput={(e) => { setNameTouched(true); setName((e.target as HTMLInputElement).value); }}
              placeholder="Research"
              class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            />
          </Field>

          <Field label="Role" hint="What this teammate is responsible for. Used to route work automatically.">
            <textarea
              value={description}
              onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
              rows={3}
              placeholder="Market intel, competitor scans, deep dives"
              class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] resize-none"
            />
          </Field>

          <div class="grid grid-cols-2 gap-3">
            <Field label="Brain">
              <ModelPicker value={model} onSelect={setModel} size="md" />
            </Field>
            <Field label="Template">
              <select
                value={template}
                onChange={(e) => setTemplate((e.target as HTMLSelectElement).value)}
                class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">Blank</option>
                {templates.data?.templates?.filter((t) => t.id !== '_template').map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      )}

      {step === 2 && (
        <div class="space-y-3">
          <div class="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2 text-[12px]">
            <span class="text-[var(--color-text-muted)]">Brain</span>
            <span class="font-medium text-[var(--color-text)]">{claudeModelLabel(model)}</span>
          </div>

          <Field
            label="Telegram bot token (optional)"
            hint="Leave empty for a delegation-only teammate: it runs through the main bot via @id: or /delegate, no Telegram bot needed. Add a token only if you want this teammate as its own standalone Telegram bot."
          >
            <input
              type="text"
              value={botToken}
              onInput={(e) => setBotToken((e.target as HTMLInputElement).value.trim())}
              placeholder="Empty = delegation-only (recommended)"
              class="w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] font-mono text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            />
            {tokenStatus?.error && (
              <div class="text-[var(--color-status-failed)] text-[11px] mt-1">{tokenStatus.error}</div>
            )}
            {tokenStatus?.ok && tokenStatus.username && (
              <div class="text-[var(--color-status-done)] text-[11px] mt-1">✓ Verified: @{tokenStatus.username}</div>
            )}
          </Field>

          {botToken.trim() !== '' && (
            <div class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded p-3 text-[12px] leading-relaxed">
              <div class="font-semibold text-[var(--color-text)] mb-2">Need a token? Create the bot in Telegram</div>
              <ol class="list-decimal list-inside space-y-1 text-[var(--color-text-muted)]">
                <li>Open <span class="font-mono text-[var(--color-accent)]">@BotFather</span> in Telegram</li>
                <li>Send <span class="font-mono text-[var(--color-accent)]">/newbot</span></li>
                <li>Name it: <CopyButton text={suggestedBotName} /></li>
                <li>Username: <CopyButton text={suggestedBotUsername} /></li>
                <li>Copy the token BotFather returns and paste it above</li>
              </ol>
            </div>
          )}

          <FileField
            label="Custom instructions (optional)"
            hint="The teammate's persona and instructions (CLAUDE.md). Leave empty to use the selected template."
            accept=".md,.txt,text/markdown,text/plain"
            value={customClaudeMd}
            onChange={setCustomClaudeMd}
            placeholder={'# You are ' + (name || 'this teammate') + '...\n\nPaste or upload your own instructions'}
          />

          <FileField
            label="Custom agent.yaml (optional)"
            hint="Advanced config: brain, connected tools (mcp_servers), workspace. Leave empty to auto-generate. Your name/role/brain from step 1 fill any missing fields."
            accept=".yaml,.yml,text/yaml"
            value={customAgentYaml}
            onChange={setCustomAgentYaml}
            placeholder={'name: ' + (name || 'Agent') + '\nmodel: claude-sonnet-4-6\n# mcp_servers: [...]'}
          />

          {error && <div class="text-[var(--color-status-failed)] text-[11px]">{error}</div>}
        </div>
      )}

      {step === 3 && createdId && (
        <div class="space-y-3 text-[12.5px]">
          <div class="text-[var(--color-status-done)] text-[14px] font-medium">✓ Teammate added</div>
          <div class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded p-3 space-y-1.5 font-mono text-[11px]">
            <div><span class="text-[var(--color-text-faint)]">id:</span> {createdId}</div>
            {createdSummary?.envKey && (
              <div><span class="text-[var(--color-text-faint)]">env:</span> {createdSummary.envKey}</div>
            )}
            <div><span class="text-[var(--color-text-faint)]">dir:</span> {createdSummary?.agentDir}</div>
            <div><span class="text-[var(--color-text-faint)]">mode:</span> {createdSummary?.hasToken ? 'standalone (Telegram bot)' : 'delegation-only'}</div>
          </div>
          {createdSummary?.hasToken ? (
            <div class="text-[var(--color-text-muted)]">
              Click activate to install the launchd service and start the teammate. Once activated,
              send it a message in Telegram and you're live.
            </div>
          ) : (
            <div class="text-[var(--color-text-muted)]">
              Ready to use now — no service needed. Message the main bot with{' '}
              <span class="font-mono text-[var(--color-accent)]">@{createdId}: your task</span> or{' '}
              <span class="font-mono text-[var(--color-accent)]">/delegate {createdId} your task</span>.
            </div>
          )}
          {error && <div class="text-[var(--color-status-failed)] text-[11px]">{error}</div>}
        </div>
      )}
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: any }) {
  return (
    <div>
      <label class="block text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">{label}</label>
      {children}
      {hint && <div class="text-[10.5px] text-[var(--color-text-faint)] mt-1">{hint}</div>}
    </div>
  );
}

/** Optional file content field: paste into the textarea, upload a file, or
 *  drag-and-drop one onto the textarea. */
function FileField({ label, hint, accept, value, onChange, placeholder }: {
  label: string;
  hint?: string;
  accept: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragDepth = useRef(0);

  const acceptExts = accept.split(',').map((s) => s.trim()).filter((s) => s.startsWith('.'));

  function readFile(file: File) {
    if (acceptExts.length && !acceptExts.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setDropError(`Expected a ${acceptExts.join(' or ')} file, got "${file.name}"`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onChange(String(reader.result ?? ''));
      setFileName(file.name);
      setDropError(null);
    };
    reader.readAsText(file);
  }

  function handleUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) readFile(file);
    input.value = '';
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) readFile(file);
  }

  return (
    <div>
      <div class="flex items-center justify-between mb-1">
        <label class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</label>
        <div class="flex items-center gap-2">
          {fileName && <span class="text-[10px] text-[var(--color-status-done)]">✓ {fileName}</span>}
          {value && (
            <button
              type="button"
              onClick={() => { onChange(''); setFileName(null); setDropError(null); }}
              class="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              Clear
            </button>
          )}
          <label class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] cursor-pointer bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] transition-colors">
            <Upload size={10} /> Upload
            <input type="file" accept={accept} onChange={handleUpload} class="hidden" />
          </label>
        </div>
      </div>
      <div
        class="relative"
        onDragEnter={handleDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <textarea
          value={value}
          onInput={(e) => { onChange((e.target as HTMLTextAreaElement).value); setFileName(null); }}
          rows={value ? 8 : 3}
          placeholder={placeholder}
          spellcheck={false}
          class={`w-full bg-[var(--color-elevated)] border rounded px-2.5 py-1.5 text-[11.5px] font-mono text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] resize-y transition-colors ${
            dragging ? 'border-[var(--color-accent)] border-dashed' : 'border-[var(--color-border)]'
          }`}
        />
        {dragging && (
          <div class="absolute inset-0 flex items-center justify-center rounded bg-[var(--color-elevated)]/85 pointer-events-none">
            <span class="flex items-center gap-1.5 text-[11px] text-[var(--color-accent)]">
              <Upload size={12} /> Drop {acceptExts.join(' / ') || 'file'} here
            </span>
          </div>
        )}
      </div>
      {dropError && <div class="text-[10.5px] text-[var(--color-status-failed)] mt-1">{dropError}</div>}
      {hint && <div class="text-[10.5px] text-[var(--color-text-faint)] mt-1">{hint}</div>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.preventDefault();
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
      }}
      class="inline-flex items-center gap-1 font-mono text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
    >
      <span>{text}</span>
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}
