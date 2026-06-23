import type { RoutineAutonomy } from '@/lib/routine';

// At-creation autonomy choice (D-07). A deliberate, visible two-option segmented
// control rendered inside the builder ABOVE "Save routine", since routines run while
// the operator is away, so this is never buried.
//
// The selected value stored on the routine is the MACHINE value
// ('unattended' | 'queue_approval'), not the display label (forward-compat with
// the Phase 3 four-tier model). This phase PRESENTS + STORES only; it does not
// enforce anything (D-08); the copy states behavior intent, never a guarantee.

const OPTIONS: { value: RoutineAutonomy; label: string; explainer: string }[] = [
  {
    value: 'unattended',
    label: 'Run unattended',
    explainer: 'Drafts, prepares, and notifies you. Won’t send, pay, or commit on its own.',
  },
  {
    value: 'queue_approval',
    label: 'Queue for my approval',
    explainer: 'Actions that send, pay, or commit wait for you as a Needs-you item.',
  },
];

interface Props {
  value: RoutineAutonomy;
  onChange: (next: RoutineAutonomy) => void;
}

export function AutonomySelector({ value, onChange }: Props) {
  const active = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  return (
    <div>
      <div class="section-label mb-1.5">Autonomy</div>
      <div class="inline-flex bg-[var(--color-elevated)] border border-[var(--color-border)] rounded p-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            class={[
              'px-2.5 py-1 rounded text-[11.5px] transition-colors',
              o.value === value
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div class="mt-1.5 text-[11px] text-[var(--color-text-muted)] leading-snug max-w-md">
        {active.explainer}
      </div>
    </div>
  );
}

export function autonomyLabel(value: string): string {
  return value === 'queue_approval' ? 'Queue for approval' : 'Unattended';
}
