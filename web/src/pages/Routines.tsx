import { useState } from 'preact/hooks';
import { Plus } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { ConfirmModal } from '@/components/ConfirmModal';
import { RoutineRow } from '@/components/RoutineRow';
import { RoutineBuilderPanel } from '@/components/RoutineBuilderPanel';
import type { TeammateOption } from '@/components/StepRow';
import { useFetch } from '@/lib/useFetch';
import { apiPost, apiPut, apiDelete } from '@/lib/api';
import { term } from '@/lib/vocabulary';
import { pushToast } from '@/lib/toasts';
import type { Routine, DraftStep } from '@/lib/routine';

// The operator-facing Routines surface (RTN-01..05). A thin client over the
// /api/routines* endpoints: list each routine's plain-language schedule, step
// count, latest outcome, and an on/off toggle; expand to review/edit steps,
// see honest run history, run now, and toggle off. The embedded draft-first
// builder (RoutineBuilderPanel) expands above the list; it never hands off to
// Chat (D-04).
//
// No raw cron appears anywhere here: schedules render through describeCron in
// the row/detail (D-06), and the only raw-cron surface is ScheduleBuilder's own
// "Advanced (cron)" toggle behind "Change".

interface Agent {
  id: string;
  name?: string;
  paused?: boolean;
}

export function Routines() {
  const { data, loading, error, refresh } = useFetch<{ routines: Routine[] }>('/api/routines', 30_000);
  const agentsFetch = useFetch<{ agents: Agent[] }>('/api/agents', 30_000);
  const routines = data?.routines ?? [];

  // Teammate options for step tags / pickers. "Main" is always available; the
  // rest come from the roster so we can show names + paused state on steps.
  const teammates: TeammateOption[] = [
    { id: 'main', name: 'Main' },
    ...((agentsFetch.data?.agents ?? []).map((a) => ({ id: a.id, name: a.name, paused: a.paused }))),
  ];

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Routine | null>(null);

  const onCount = routines.filter((r) => r.status !== 'paused').length;
  const offCount = routines.length - onCount;

  async function toggleOnOff(routine: Routine) {
    const turningOff = routine.status !== 'paused';
    setBusyId(routine.id);
    try {
      await apiPost(`/api/routines/${routine.id}/${turningOff ? 'pause' : 'resume'}`);
      refresh();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not update', description: err?.message || String(err), durationMs: 6000 });
    } finally {
      setBusyId(null);
    }
  }

  async function runNow(routine: Routine) {
    setBusyId(routine.id);
    try {
      await apiPost(`/api/routines/${routine.id}/run`);
      pushToast({ tone: 'success', title: 'Run started' });
      setTimeout(refresh, 1500);
    } catch (err: any) {
      const already = err?.status === 409;
      pushToast({
        tone: already ? 'warn' : 'error',
        title: already ? 'Already running' : 'Run failed',
        description: already ? 'This routine is mid-run. Give it a moment.' : (err?.message || String(err)),
        durationMs: 6000,
      });
    } finally {
      setBusyId(null);
    }
  }

  async function saveSchedule(routine: Routine, cron: string) {
    setBusyId(routine.id);
    try {
      await apiPut(`/api/routines/${routine.id}`, { schedule: cron });
      pushToast({ tone: 'success', title: 'Schedule updated' });
      refresh();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not save schedule', description: err?.message || String(err), durationMs: 6000 });
    } finally {
      setBusyId(null);
    }
  }

  async function saveSteps(routine: Routine, steps: DraftStep[]) {
    setBusyId(routine.id);
    try {
      await apiPut(`/api/routines/${routine.id}`, { steps });
      pushToast({ tone: 'success', title: 'Steps updated' });
      refresh();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not save steps', description: err?.message || String(err), durationMs: 6000 });
    } finally {
      setBusyId(null);
    }
  }

  async function performDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setBusyId(id);
    try {
      await apiDelete(`/api/routines/${id}`);
      pushToast({ tone: 'warn', title: 'Routine deleted' });
      if (expandedId === id) setExpandedId(null);
      refresh();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Delete failed', description: err?.message || String(err), durationMs: 6000 });
    } finally {
      setBusyId(null);
      setPendingDelete(null);
    }
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={term('page.routines')}
        actions={
          <>
            <span class="text-[11.5px] text-[var(--color-text-muted)] tabular-nums">
              {onCount} on, {offCount} off
            </span>
            <button
              type="button"
              onClick={() => setBuilderOpen((v) => !v)}
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              <Plus size={14} /> New routine
            </button>
          </>
        }
      />

      {error && <PageState error={error} />}
      {loading && !data && <PageState loading />}
      {!loading && !error && routines.length === 0 && !builderOpen && (
        <PageState
          empty
          emptyTitle="No routines yet"
          emptyDescription="Routines are work that runs on its own. Describe one in plain language, like 'every weekday at 8, check my calendar and send me a brief', and your team handles it. Tap New routine to start."
        />
      )}

      <div class="flex-1 overflow-y-auto">
        <div class="max-w-[900px] mx-auto px-6 py-5 space-y-2">
          {builderOpen && (
            <RoutineBuilderPanel
              teammates={teammates}
              onClose={() => setBuilderOpen(false)}
              onSaved={() => { setBuilderOpen(false); refresh(); }}
            />
          )}
          {routines.map((r) => (
            <RoutineRow
              key={r.id}
              routine={r}
              teammates={teammates}
              expanded={expandedId === r.id}
              busy={busyId === r.id}
              onToggleExpand={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
              onToggleOnOff={() => toggleOnOff(r)}
              onRunNow={() => runNow(r)}
              onTurnOff={() => toggleOnOff(r)}
              onDeleteRequest={() => setPendingDelete(r)}
              onSaveSchedule={(cron) => saveSchedule(r, cron)}
              onSaveSteps={(steps) => saveSteps(r, steps)}
            />
          ))}
        </div>
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={performDelete}
        title="Delete this routine?"
        body={pendingDelete ? pendingDelete.name : ''}
        detail="It won't run again. Past run history stays."
        confirmLabel="Delete"
        destructive
      />
    </div>
  );
}
