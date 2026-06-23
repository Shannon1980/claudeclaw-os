import { AgentAvatar } from '@/components/AgentAvatar';
import { teammateColor } from '@/lib/teammate';

// A teammate identity chip used on routine steps: the teammate's fixed accent
// color (from teammateColor) as a soft color-mix background + the AgentAvatar.
// Matches the Pill tone construction (18% color-mix bg + solid color text) so
// it reads as part of the same system. Color comes from teammateColor(id) in
// lib/teammate (extracted from Team.tsx so both surfaces share one source).

interface Props {
  agentId: string;
  name?: string;
  /** A paused teammate runs no routines; surface that honestly on the step. */
  paused?: boolean;
}

export function TeammateTag({ agentId, name, paused }: Props) {
  const color = teammateColor(agentId);
  const label = name || agentId;
  return (
    <span class="inline-flex items-center gap-1.5">
      <span
        class="inline-flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 rounded-full text-[10.5px] font-medium"
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
          color,
        }}
      >
        <AgentAvatar agentId={agentId} name={name} size={16} />
        {label}
      </span>
      {paused && (
        <span class="text-[10px] text-[var(--color-text-faint)]">teammate paused</span>
      )}
    </span>
  );
}
