import { useState } from 'preact/hooks';
import { RunOutcomeBadge } from '@/components/RunOutcomeBadge';
import { formatRelativeTime } from '@/lib/format';
import type { RoutineRun } from '@/lib/routine';

// One row in a routine's run history (RTN-05). Shows the honest outcome badge,
// when it ran, the human detail line, and a "View output" toggle that reveals
// the stored run output verbatim. Failures and degraded runs are shown as they
// happened, never collapsed into a generic "error"; the detail line carries the
// real reason (e.g. "Calendar not connected, sent partial brief.").
//
// Output is rendered as a text binding (Preact escapes it), never as raw HTML.

export function RunHistoryItem({ run }: { run: RoutineRun }) {
  const [showOutput, setShowOutput] = useState(false);
  const hasOutput = !!(run.output && run.output.trim());

  return (
    <div class="border border-[var(--color-border)] rounded-md px-2.5 py-2 bg-[var(--color-elevated)]">
      <div class="flex items-center gap-2 flex-wrap">
        <RunOutcomeBadge outcome={run.outcome} />
        <span class="text-[11px] text-[var(--color-text-faint)] tabular-nums">
          {formatRelativeTime(run.ran_at)}
        </span>
        {hasOutput && (
          <button
            type="button"
            onClick={() => setShowOutput((v) => !v)}
            class="ml-auto text-[10.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            {showOutput ? 'Hide output' : 'View output'}
          </button>
        )}
      </div>

      {run.detail && run.detail.trim() && (
        <div class="mt-1 text-[11.5px] text-[var(--color-text-muted)] leading-snug">
          {run.detail}
        </div>
      )}

      {showOutput && hasOutput && (
        <div class="mt-1.5 pt-1.5 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)] whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
          {run.output}
        </div>
      )}
    </div>
  );
}
