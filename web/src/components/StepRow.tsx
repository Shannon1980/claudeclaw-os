import { ChevronUp, ChevronDown, X } from 'lucide-preact';
import { TeammateTag } from '@/components/TeammateTag';
import type { DraftStep } from '@/lib/routine';

// One ordered routine step: a number + the action text + the teammate tag.
// Two modes:
//   - read-only (detail view): plain text + tag, optional "teammate paused" note.
//   - editable (draft / detail edit): action becomes an input, teammate a select,
//     reorder up/down + remove affordances appear.
//
// A step assigned to a paused teammate surfaces the honest note (Team <-> Routines
// link) so the operator knows that step won't run until the teammate resumes.

export interface TeammateOption {
  id: string;
  name?: string;
  paused?: boolean;
}

interface Props {
  index: number;
  step: DraftStep;
  teammate?: TeammateOption;
  /** When set, the row is editable and these callbacks are wired. */
  editable?: boolean;
  teammates?: TeammateOption[];
  onActionChange?: (action: string) => void;
  onAgentChange?: (agentId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

export function StepRow({
  index, step, teammate, editable,
  teammates, onActionChange, onAgentChange,
  onMoveUp, onMoveDown, onRemove, canMoveUp, canMoveDown,
}: Props) {
  const paused = teammate?.paused ?? false;

  return (
    <div class="flex items-start gap-2.5 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md px-2.5 py-2">
      <span class="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-[var(--color-card)] border border-[var(--color-border)] flex items-center justify-center text-[10.5px] font-medium text-[var(--color-text-muted)] tabular-nums">
        {index + 1}
      </span>

      <div class="flex-1 min-w-0 space-y-1.5">
        {editable ? (
          <input
            type="text"
            value={step.action}
            onInput={(e) => onActionChange?.((e.target as HTMLInputElement).value)}
            placeholder="What this step does"
            class="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        ) : (
          <div class="text-[12.5px] text-[var(--color-text)] leading-snug">{step.action}</div>
        )}

        <div class="flex items-center gap-2 flex-wrap">
          {editable ? (
            <select
              value={step.agent_id}
              onChange={(e) => onAgentChange?.((e.target as HTMLSelectElement).value)}
              class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-1.5 py-1 text-[11px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            >
              {(teammates ?? [{ id: 'main', name: 'Main' }]).map((t) => (
                <option key={t.id} value={t.id}>{(t.name || t.id) + (t.paused ? ' (paused)' : '')}</option>
              ))}
            </select>
          ) : (
            <TeammateTag agentId={step.agent_id} name={teammate?.name} paused={paused} />
          )}
        </div>
      </div>

      {editable && (
        <div class="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            title="Move up"
            class="p-1 rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-card)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronUp size={13} />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            title="Move down"
            class="p-1 rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-card)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronDown size={13} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Remove step"
            class="p-1 rounded text-[var(--color-text-faint)] hover:text-[var(--color-status-failed)] hover:bg-[var(--color-card)] transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
