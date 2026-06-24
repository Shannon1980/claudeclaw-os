// The autonomy dial (PERM-01) — three radio cards: Cautious / Balanced /
// Autonomous. "A dial, not a checkbox wall": this is the primary control, so
// the cards read prominent (larger touch target than override rows). Active-card
// treatment copies the Settings ThemePicker accent pattern. Balanced is the
// recommended default (D-11). Mode is team-wide — no teammate picker.

import { Check } from 'lucide-preact';
import { Pill } from '@/components/Pill';

export type Mode = 'cautious' | 'balanced' | 'autonomous';

const MODES: { value: Mode; name: string; blurb: string; recommended?: boolean }[] = [
  {
    value: 'cautious',
    name: 'Cautious',
    blurb: 'Prepares and drafts. Asks before anything leaves.',
  },
  {
    value: 'balanced',
    name: 'Balanced',
    blurb: 'Acts on low-risk things. Asks to send or commit.',
    recommended: true,
  },
  {
    value: 'autonomous',
    name: 'Autonomous',
    blurb: 'Acts on its own. Tells you after.',
  },
];

export function AutonomyModeSelector({ value, onChange, busy }: {
  value: Mode;
  onChange: (next: Mode) => void;
  busy?: boolean;
}) {
  return (
    <div class="grid gap-2 sm:grid-cols-3">
      {MODES.map((m) => {
        const active = m.value === value;
        return (
          <button
            key={m.value}
            type="button"
            disabled={busy}
            onClick={() => { if (!active) onChange(m.value); }}
            class={[
              'text-left rounded-md border p-3 min-h-[64px] transition-colors disabled:opacity-50',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]',
              active
                ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)]'
                : 'bg-[var(--color-elevated)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
            ].join(' ')}
          >
            <div class="flex items-center gap-1.5 mb-1">
              <span class="text-[12.5px] font-medium text-[var(--color-text)]">{m.name}</span>
              {m.recommended && <Pill tone="accent">Recommended</Pill>}
              {active && <Check size={12} class="ml-auto text-[var(--color-accent)] shrink-0" />}
            </div>
            <div class="text-[11px] text-[var(--color-text-muted)] leading-snug">{m.blurb}</div>
          </button>
        );
      })}
    </div>
  );
}
