import { useState } from 'preact/hooks';
import { Play, Power } from 'lucide-preact';
import { Pill } from '@/components/Pill';
import { ScheduleBuilder } from '@/components/ScheduleBuilder';
import { StepList } from '@/components/StepList';
import { RunHistoryItem } from '@/components/RunHistoryItem';
import { autonomyLabel } from '@/components/AutonomySelector';
import { useFetch } from '@/lib/useFetch';
import { describeCron } from '@/lib/cron';
import type { Routine, RoutineRun, DraftStep } from '@/lib/routine';
import { stepToDraft } from '@/lib/routine';
import type { TeammateOption } from '@/components/StepRow';

// The expanded routine detail (UI-SPEC §2): four labelled blocks.
//   When:    plain-language schedule (describeCron) + a "Change" action that
//            opens ScheduleBuilder. Raw cron only lives behind ScheduleBuilder's
//            own "Advanced (cron)" toggle (D-06), never here.
//   Steps:   ordered StepList with teammate tags, editable in place.
//   Recent:  RunHistoryItem list, honest ok/degraded/failed.
//   Actions: Run now + Turn off (mirrors the row toggle).
//
// Edits to schedule/steps PUT to /api/routines/:id. The on/off toggle is on the
// row (non-destructive, no modal); "Turn off" here mirrors it.

interface Props {
  routine: Routine;
  teammates: TeammateOption[];
  busy: boolean;
  onRunNow: () => void;
  onTurnOff: () => void;
  onSaveSchedule: (cron: string) => void;
  onSaveSteps: (steps: DraftStep[]) => void;
}

export function RoutineDetail({
  routine, teammates, busy,
  onRunNow, onTurnOff, onSaveSchedule, onSaveSteps,
}: Props) {
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [draftCron, setDraftCron] = useState(routine.schedule);

  // Steps + run history come from the detail endpoint; the row already has steps
  // but the runs need their own fetch.
  const detail = useFetch<{ runs: RoutineRun[] }>(`/api/routines/${routine.id}`, 30_000);
  const runs = detail.data?.runs ?? [];

  const stepDrafts: DraftStep[] = routine.steps.map(stepToDraft);

  function saveSchedule() {
    onSaveSchedule(draftCron);
    setEditingSchedule(false);
  }

  return (
    <div class="border-t border-[var(--color-border)] px-3 py-3 space-y-4 bg-[var(--color-bg)]">
      {/* When */}
      <section>
        <div class="flex items-center justify-between mb-1.5">
          <div class="section-label">When</div>
          {!editingSchedule && (
            <button
              type="button"
              onClick={() => { setDraftCron(routine.schedule); setEditingSchedule(true); }}
              class="text-[10.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              Change
            </button>
          )}
        </div>
        {editingSchedule ? (
          <div class="space-y-2">
            <ScheduleBuilder cron={draftCron} onChange={setDraftCron} />
            <div class="flex items-center gap-2">
              <button
                type="button"
                onClick={saveSchedule}
                disabled={busy}
                class="px-2.5 py-1 rounded text-[11.5px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
              >
                Save schedule
              </button>
              <button
                type="button"
                onClick={() => setEditingSchedule(false)}
                class="px-2.5 py-1 rounded text-[11.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div class="text-[12.5px] text-[var(--color-text)]">{describeCron(routine.schedule).text}</div>
        )}
      </section>

      {/* Steps */}
      <section>
        <div class="section-label mb-1.5">Steps</div>
        <StepList steps={stepDrafts} teammates={teammates} onChange={onSaveSteps} />
      </section>

      {/* Recent runs */}
      <section>
        <div class="section-label mb-1.5">Recent runs</div>
        {runs.length === 0 ? (
          <div class="text-[11.5px] text-[var(--color-text-faint)]">No runs yet.</div>
        ) : (
          <div class="space-y-1.5">
            {runs.map((run) => (
              <RunHistoryItem key={run.id} run={run} />
            ))}
          </div>
        )}
      </section>

      {/* Actions */}
      <section>
        <div class="section-label mb-1.5">Actions</div>
        <div class="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onRunNow}
            disabled={busy || routine.status === 'running'}
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[12px] font-medium border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors disabled:opacity-40"
          >
            <Play size={13} /> Run now
          </button>
          {routine.status !== 'paused' && (
            <button
              type="button"
              onClick={onTurnOff}
              disabled={busy}
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors disabled:opacity-40"
            >
              <Power size={13} /> Turn off
            </button>
          )}
          <span class="ml-auto inline-flex items-center gap-1.5">
            <span class="text-[10.5px] text-[var(--color-text-faint)]">Autonomy</span>
            <Pill tone="neutral">{autonomyLabel(routine.autonomy)}</Pill>
          </span>
        </div>
      </section>
    </div>
  );
}
