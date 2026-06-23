import { Plus } from 'lucide-preact';
import { StepRow, type TeammateOption } from '@/components/StepRow';
import type { DraftStep } from '@/lib/routine';

// The ordered step list, shared by RoutineDetail (edit) and RoutineBuilderPanel
// (draft). Read-only when no onChange is supplied; editable when it is, so the
// builder reuses this exact surface so a draft and a saved routine look and edit
// identically (UI-SPEC §3).

interface Props {
  steps: DraftStep[];
  teammates?: TeammateOption[];
  /** When supplied, the list is editable (add / reorder / remove / edit). */
  onChange?: (next: DraftStep[]) => void;
}

function teammateFor(teammates: TeammateOption[] | undefined, agentId: string): TeammateOption | undefined {
  return teammates?.find((t) => t.id === agentId);
}

export function StepList({ steps, teammates, onChange }: Props) {
  const editable = typeof onChange === 'function';

  function update(idx: number, patch: Partial<DraftStep>) {
    onChange?.(steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    const next = steps.slice();
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    onChange?.(next);
  }

  function remove(idx: number) {
    onChange?.(steps.filter((_, i) => i !== idx));
  }

  function add() {
    const fallbackAgent = teammates?.[0]?.id ?? 'main';
    onChange?.([...steps, { action: '', agent_id: fallbackAgent, on_error: 'continue' }]);
  }

  if (steps.length === 0 && !editable) {
    return <div class="text-[11.5px] text-[var(--color-text-faint)]">No steps yet.</div>;
  }

  return (
    <div class="space-y-1.5">
      {steps.map((step, idx) => (
        <StepRow
          key={idx}
          index={idx}
          step={step}
          teammate={teammateFor(teammates, step.agent_id)}
          editable={editable}
          teammates={teammates}
          onActionChange={(action) => update(idx, { action })}
          onAgentChange={(agent_id) => update(idx, { agent_id })}
          onMoveUp={() => move(idx, -1)}
          onMoveDown={() => move(idx, 1)}
          onRemove={() => remove(idx)}
          canMoveUp={idx > 0}
          canMoveDown={idx < steps.length - 1}
        />
      ))}
      {editable && (
        <button
          type="button"
          onClick={add}
          class="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors mt-0.5"
        >
          <Plus size={12} /> Add step
        </button>
      )}
    </div>
  );
}
