// A single per-action override row (PERM-02). Capability label + tier badge +
// a two-segment Always / Ask first control (the AutonomySelector segmented
// pattern — NOT a boolean Toggle, the states are named). When the operator has
// departed from the mode default the row shows an "overridden" marker and a
// RotateCcw reset-to-default text-action (the Settings AccentPicker precedent).

import { RotateCcw } from 'lucide-preact';
import { Pill } from '@/components/Pill';

export type OverrideValue = 'always' | 'ask';

export function ActionOverrideRow({
  label, tierLabel, value, isOverridden, onChange, onReset, busy,
}: {
  label: string;
  tierLabel: string;
  value: OverrideValue;
  isOverridden: boolean;
  onChange: (next: OverrideValue) => void;
  onReset: () => void;
  busy?: boolean;
}) {
  return (
    <div class="flex items-center gap-3 py-1.5">
      <div class="flex-1 min-w-0 flex items-center gap-1.5">
        <span class="text-[13px] text-[var(--color-text)] truncate">{label}</span>
        <Pill tone="neutral">{tierLabel}</Pill>
        {isOverridden && <Pill tone="neutral">overridden</Pill>}
      </div>
      {isOverridden && (
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          class="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
          title="Reset to the mode default"
        >
          <RotateCcw size={11} /> Reset
        </button>
      )}
      <Segmented value={value} onChange={onChange} busy={busy} />
    </div>
  );
}

function Segmented({ value, onChange, busy }: {
  value: OverrideValue; onChange: (next: OverrideValue) => void; busy?: boolean;
}) {
  const opts: { value: OverrideValue; label: string }[] = [
    { value: 'always', label: 'Always' },
    { value: 'ask', label: 'Ask first' },
  ];
  return (
    <div class="inline-flex bg-[var(--color-elevated)] border border-[var(--color-border)] rounded p-0.5 shrink-0">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={busy}
          onClick={() => { if (o.value !== value) onChange(o.value); }}
          class={[
            'px-2.5 py-1 rounded text-[11.5px] transition-colors disabled:opacity-50',
            o.value === value
              ? 'bg-[var(--color-accent)] text-white'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
