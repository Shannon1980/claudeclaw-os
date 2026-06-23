import { Check, AlertTriangle, XCircle } from 'lucide-preact';
import { Pill } from '@/components/Pill';

// RTN-05 run-outcome contract (UI-SPEC §5 color table). Maps the stored
// run outcome to an honest Pill + icon. Degraded is amber and visible, never
// collapsed into "ok" or a generic "error".
//
//   ok       -> done   (green)  Check         "Ran clean"
//   degraded -> medium (amber)  AlertTriangle "Partial"
//   failed   -> failed (red)    XCircle       "Failed"
//
// `outcome` is the raw string from the API (RoutineRun.outcome / last_outcome);
// unknown / null values fall through to a neutral "Not run yet" chip.

export type RunOutcome = 'ok' | 'degraded' | 'failed';

const OUTCOME_MAP: Record<RunOutcome, { tone: 'done' | 'medium' | 'failed'; label: string }> = {
  ok: { tone: 'done', label: 'Ran clean' },
  degraded: { tone: 'medium', label: 'Partial' },
  failed: { tone: 'failed', label: 'Failed' },
};

function OutcomeIcon({ outcome }: { outcome: RunOutcome }) {
  if (outcome === 'ok') return <Check size={10} />;
  if (outcome === 'degraded') return <AlertTriangle size={10} />;
  return <XCircle size={10} />;
}

export function RunOutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  if (outcome !== 'ok' && outcome !== 'degraded' && outcome !== 'failed') {
    return <Pill tone="neutral">Not run yet</Pill>;
  }
  const { tone, label } = OUTCOME_MAP[outcome];
  return (
    <Pill tone={tone}>
      <OutcomeIcon outcome={outcome} />
      {label}
    </Pill>
  );
}
