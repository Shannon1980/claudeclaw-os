// A locked Tier 4 row (PERM-03, D-01). Non-interactive: a Lock icon (muted, NOT
// red — a calm permanent guardrail), the capability label, a static "Always ask"
// Pill, and a one-line faint reason. No control in any mode — the lock is the
// trust signal. Cursor stays default.

import { Lock } from 'lucide-preact';
import { Pill } from '@/components/Pill';

export function LockedActionRow({ label, reason }: { label: string; reason: string }) {
  return (
    <div class="flex items-center gap-3 py-1.5 cursor-default">
      <Lock size={13} class="text-[var(--color-text-muted)] shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="text-[13px] text-[var(--color-text)] truncate">{label}</div>
        <div class="text-[11px] text-[var(--color-text-faint)] leading-snug mt-0.5">{reason}</div>
      </div>
      <Pill tone="neutral">Always ask</Pill>
    </div>
  );
}
