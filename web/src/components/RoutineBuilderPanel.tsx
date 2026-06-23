import { useState } from 'preact/hooks';
import { Sparkles, X } from 'lucide-preact';
import { Pill } from '@/components/Pill';
import { ScheduleBuilder } from '@/components/ScheduleBuilder';
import { StepList } from '@/components/StepList';
import { AutonomySelector } from '@/components/AutonomySelector';
import { ConfirmModal } from '@/components/ConfirmModal';
import type { TeammateOption } from '@/components/StepRow';
import { apiPost } from '@/lib/api';
import { describeCron } from '@/lib/cron';
import { pushToast } from '@/lib/toasts';
import type { RoutineAutonomy, RoutineDraft, DraftStep } from '@/lib/routine';

// Embedded, draft-first conversational builder (D-04 / D-05). It lives ON the
// Routines page (NOT a hand-off to Chat). The operator describes a routine in
// plain language; we POST that to /api/routines/draft, which assembles a
// { schedule_text, cron, steps[] } draft server-side and PERSISTS NOTHING.
//
// The returned draft renders as an EDITABLE draft using the SAME StepList and
// ScheduleBuilder surfaces as the detail view, marked visually unsaved (a
// "Draft, not saved yet" Pill + dashed border) so nothing reads as live. The
// operator can edit step text, reassign teammates, reorder, add/remove steps,
// and adjust the schedule before anything saves.
//
// Only "Save routine" POSTs to /api/routines (the persist call, separate from
// the draft call). Cancelling a dirty draft routes through ConfirmModal so typed
// steps aren't lost on a stray click. The at-creation autonomy choice is captured
// as a forward-compatible machine value and sent in the persist body.

interface Props {
  teammates: TeammateOption[];
  onClose: () => void;
  onSaved: () => void;
}

export function RoutineBuilderPanel({ teammates, onClose, onSaved }: Props) {
  const [description, setDescription] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Draft state (populated after the /draft call). Null until a draft exists.
  const [name, setName] = useState('');
  const [cron, setCron] = useState<string | null>(null);
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [autonomy, setAutonomy] = useState<RoutineAutonomy>('unattended');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const hasDraft = cron !== null;

  async function generateDraft() {
    if (!description.trim()) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const draft = await apiPost<RoutineDraft>('/api/routines/draft', { description });
      const normSteps: DraftStep[] = (draft.steps ?? []).map((s) => ({
        action: s.action,
        agent_id: s.agent_id || 'main',
        on_error: s.on_error === 'stop' ? 'stop' : 'continue',
      }));
      setCron(draft.cron);
      setSteps(normSteps);
      // Seed a name from the description so Save has something; the operator can edit.
      setName(description.trim().slice(0, 80));
      setDirty(true);
    } catch (err: any) {
      setDraftError(err?.message || String(err));
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!cron || !name.trim() || steps.length === 0) return;
    setSaving(true);
    try {
      await apiPost('/api/routines', {
        name: name.trim(),
        schedule: cron,
        autonomy, // machine value: 'unattended' | 'queue_approval'
        steps,
      });
      pushToast({ tone: 'success', title: 'Routine saved' });
      onSaved();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not save routine', description: err?.message || String(err), durationMs: 6000 });
    } finally {
      setSaving(false);
    }
  }

  function requestClose() {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  return (
    <div class="border border-dashed border-[var(--color-accent)] rounded-lg p-4 bg-[var(--color-card)] space-y-3">
      <div class="flex items-center gap-2">
        <Sparkles size={14} class="text-[var(--color-accent)]" />
        <span class="text-[12.5px] font-medium text-[var(--color-text)]">New routine</span>
        {hasDraft && <Pill tone="accent">Draft, not saved yet</Pill>}
        <button
          type="button"
          onClick={requestClose}
          class="ml-auto p-1 rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      {!hasDraft ? (
        <div class="space-y-2">
          <p class="text-[11.5px] text-[var(--color-text-muted)] leading-snug">
            Describe what should happen and when, in plain language. Your team turns it into steps you can review before anything saves.
          </p>
          <textarea
            value={description}
            onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
            rows={3}
            placeholder="every weekday at 8, check my calendar and inbox and send me a brief, then chase overdue invoices"
            class="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2.5 py-2 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] resize-none"
          />
          {draftError && (
            <div class="text-[11px] text-[var(--color-status-failed)]">{draftError}</div>
          )}
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={generateDraft}
              disabled={drafting || !description.trim()}
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
            >
              <Sparkles size={13} /> {drafting ? 'Building draft…' : 'Build draft'}
            </button>
            <button
              type="button"
              onClick={requestClose}
              class="px-2.5 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div class="space-y-4">
          <section>
            <div class="section-label mb-1.5">Name</div>
            <input
              type="text"
              value={name}
              onInput={(e) => { setName((e.target as HTMLInputElement).value); setDirty(true); }}
              placeholder="Name this routine"
              class="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            />
          </section>

          <section>
            <div class="section-label mb-1.5">When</div>
            <div class="text-[12px] text-[var(--color-text-muted)] mb-1.5">{describeCron(cron!).text}</div>
            <ScheduleBuilder cron={cron!} onChange={(next) => { setCron(next); setDirty(true); }} />
          </section>

          <section>
            <div class="section-label mb-1.5">Steps</div>
            <StepList
              steps={steps}
              teammates={teammates}
              onChange={(next) => { setSteps(next); setDirty(true); }}
            />
          </section>

          {/* D-07: autonomy choice, visible above Save */}
          <AutonomySelector value={autonomy} onChange={(next) => { setAutonomy(next); setDirty(true); }} />

          <div class="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving || !name.trim() || steps.length === 0}
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save routine'}
            </button>
            <button
              type="button"
              onClick={requestClose}
              class="px-2.5 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => { setConfirmDiscard(false); onClose(); }}
        title="Discard this draft?"
        body="Your steps haven't been saved."
        confirmLabel="Discard"
        destructive
      />
    </div>
  );
}
