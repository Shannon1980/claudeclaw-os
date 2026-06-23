import { Clock, ChevronDown, ChevronRight, Repeat, Trash2 } from 'lucide-preact';
import { Toggle } from '@/components/Toggle';
import { RunOutcomeBadge } from '@/components/RunOutcomeBadge';
import { RoutineDetail } from '@/components/RoutineDetail';
import { describeCron } from '@/lib/cron';
import { formatRelativeTime } from '@/lib/format';
import type { Routine, DraftStep } from '@/lib/routine';
import type { TeammateOption } from '@/components/StepRow';

// One routine in the list (UI-SPEC §1). Models the Scheduled.tsx card, restyled
// to the routine anatomy:
//   icon + name (12.5px medium) · plain-language schedule via describeCron with a
//   Clock icon (NEVER raw cron) · step count + last/next meta (accent countdown
//   when on) · RunOutcomeBadge for the latest run · a size="sm" Toggle as the
//   primary non-destructive on/off control (POST pause|resume, NO confirm modal)
//   · a chevron to expand RoutineDetail inline.
// Off routines dim their content (opacity-50) but the toggle stays full-opacity
// so it reads as clearly re-enableable.

function formatCountdown(unixSeconds: number): string {
  const diff = unixSeconds - Date.now() / 1000;
  if (diff < 0) return 'overdue';
  if (diff < 60) return 'in ' + Math.floor(diff) + 's';
  if (diff < 3600) return 'in ' + Math.floor(diff / 60) + 'm';
  if (diff < 86400) return 'in ' + Math.floor(diff / 3600) + 'h';
  return 'in ' + Math.floor(diff / 86400) + 'd';
}

interface Props {
  routine: Routine;
  teammates: TeammateOption[];
  expanded: boolean;
  busy: boolean;
  onToggleExpand: () => void;
  onToggleOnOff: () => void;
  onRunNow: () => void;
  onTurnOff: () => void;
  onDeleteRequest: () => void;
  onSaveSchedule: (cron: string) => void;
  onSaveSteps: (steps: DraftStep[]) => void;
}

export function RoutineRow({
  routine, teammates, expanded, busy,
  onToggleExpand, onToggleOnOff, onRunNow, onTurnOff,
  onDeleteRequest, onSaveSchedule, onSaveSteps,
}: Props) {
  const on = routine.status !== 'paused';
  const stepCount = routine.steps.length;
  const schedule = describeCron(routine.schedule).text;

  return (
    <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div class="flex items-center gap-3 px-3 py-3">
        <button
          type="button"
          onClick={onToggleExpand}
          class="shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div
          class={'flex-1 min-w-0 cursor-pointer ' + (on ? '' : 'opacity-50')}
          onClick={onToggleExpand}
        >
          <div class="flex items-center gap-1.5">
            <Repeat size={13} class="text-[var(--color-text-muted)] shrink-0" />
            <span class="text-[12.5px] font-medium text-[var(--color-text)] truncate">{routine.name}</span>
          </div>
          <div class="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-[var(--color-text-faint)]">
            <span class="inline-flex items-center gap-1">
              <Clock size={10} /> {schedule}
            </span>
            <span class="tabular-nums">{stepCount} {stepCount === 1 ? 'step' : 'steps'}</span>
            {routine.last_run && (
              <span class="tabular-nums">ran {formatRelativeTime(routine.last_run)}</span>
            )}
            {on && (
              <span class="text-[var(--color-accent)] tabular-nums">{formatCountdown(routine.next_run)}</span>
            )}
            <RunOutcomeBadge outcome={routine.last_outcome} />
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Toggle
            on={on}
            size="sm"
            disabled={busy}
            onChange={onToggleOnOff}
            ariaLabel={on ? 'Turn off routine' : 'Turn on routine'}
          />
          <button
            type="button"
            onClick={onDeleteRequest}
            class="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] hover:bg-[var(--color-elevated)] transition-colors"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {expanded && (
        <RoutineDetail
          routine={routine}
          teammates={teammates}
          busy={busy}
          onRunNow={onRunNow}
          onTurnOff={onTurnOff}
          onSaveSchedule={onSaveSchedule}
          onSaveSteps={onSaveSteps}
        />
      )}
    </div>
  );
}
