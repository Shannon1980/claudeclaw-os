// The operator-facing Memory surface (MEM-01 / MEM-02 / D-01..D-09). "What I
// know about you": facts grouped by category, each carrying a provenance pill
// as the hero signal, editable and deletable in place. Modeled on Activity.tsx
// (the closest operator-page analog: PageHeader + PageState + Pill + grouped
// useMemo + per-row mutation + ConfirmModal).
//
// Provenance is the focal point of every row (UI-SPEC Visual Hierarchy). The
// "Learned from email" pill renders only when an email-sourced fact exists
// (D-05 honest coverage). Unconfirmed (machine-inferred) facts carry a "Needs
// review" amber marker and a Confirm action (D-04). Everything stays on this
// machine — the assurance line says so (success criterion 4).

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Pill } from '@/components/Pill';
import { Modal } from '@/components/Modal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { term } from '@/lib/vocabulary';
import { pushToast } from '@/lib/toasts';

// Provenance tags the server derives (src/memory-provenance.ts Provenance).
type Provenance = 'told' | 'work' | 'email';

// The three operator categories (src/db.ts OPERATOR_FACT_CATEGORIES). The
// server returns them so the UI never hard-codes the enum out of sync.
type Category = 'your-business' | 'your-clients' | 'how-you-work';

// Mirror of a row the GET /api/memory endpoint returns. Carries only the
// surface-level fields, no embeddings or raw text.
interface MemoryFact {
  id: number;
  summary: string;
  category: Category | null;
  confirmed: boolean;
  provenance: Provenance;
  importance: number;
  created_at: number;
}

interface MemoryResponse {
  memories: MemoryFact[];
  categories: Category[];
  provenanceLabels: Provenance[];
}

// Ordered category display labels (UI-SPEC Copywriting Contract). Order is
// fixed so groups always render business -> clients -> how-you-work.
const CATEGORY_ORDER: Category[] = ['your-business', 'your-clients', 'how-you-work'];
const CATEGORY_LABEL: Record<Category, string> = {
  'your-business': 'Your business',
  'your-clients': 'Your clients',
  'how-you-work': 'How you like to work',
};

// Provenance pill copy + tone (UI-SPEC Color). "You told me" borrows the
// accent tone (the single trust-defining signal); inferred tags stay quiet.
const PROVENANCE_LABEL: Record<Provenance, string> = {
  told: 'You told me',
  work: 'Learned from your work',
  email: 'Learned from email',
};
function provenanceTone(p: Provenance): 'accent' | 'neutral' {
  return p === 'told' ? 'accent' : 'neutral';
}

export function Memory() {
  const [rows, setRows] = useState<MemoryFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Read load with a cancel-guard (Activity.tsx pattern). On failure the
  // verbatim server reason flows into PageState's error (never a generic line).
  const load = useCallback((signal?: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    return apiGet<MemoryResponse>('/api/memory')
      .then((data) => {
        if (signal?.cancelled) return;
        setRows(data.memories);
      })
      .catch((err: any) => {
        if (!signal?.cancelled) setError(err?.message || String(err));
      })
      .finally(() => {
        if (!signal?.cancelled) setLoading(false);
      });
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  // Group rows by category in the fixed display order. A category section is
  // emitted ONLY when it has at least one row (D-07: empty categories hidden).
  // Uncategorized rows (category null) collect under their own quiet group so
  // a fact is never silently dropped.
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; rows: MemoryFact[] }> = [];
    for (const cat of CATEGORY_ORDER) {
      const inCat = rows.filter((r) => r.category === cat);
      if (inCat.length > 0) out.push({ key: cat, label: CATEGORY_LABEL[cat], rows: inCat });
    }
    const uncategorized = rows.filter((r) => r.category === null);
    if (uncategorized.length > 0) {
      out.push({ key: 'uncategorized', label: 'Other', rows: uncategorized });
    }
    return out;
  }, [rows]);

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={term('page.memory')}
        actions={
          <>
            <span class="text-[11px] text-[var(--color-text-muted)]">
              Stored on this machine. Edit or delete anything.
            </span>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              Add a fact
            </button>
          </>
        }
      />

      {error && <PageState error={error} />}
      {loading && rows.length === 0 && <PageState loading />}
      {!loading && !error && rows.length === 0 && (
        <PageState
          empty
          emptyTitle="Nothing here yet"
          emptyDescription="As you work together, what the assistant learns about you will show up here, grouped by topic. You can also add a fact yourself. Everything stays on this machine."
        />
      )}

      {rows.length > 0 && (
        <div class="flex-1 overflow-y-auto px-6 py-4">
          {groups.map((g) => (
            <div key={g.key} class="mb-8">
              <div class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-faint)] mb-2">
                {g.label}
              </div>
              <div class="flex flex-col gap-4">
                {g.rows.map((r) => (
                  <MemoryFactCard key={r.id} fact={r} onChanged={() => void load()} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddFactModal
        open={addOpen}
        categories={CATEGORY_ORDER}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false);
          void load();
        }}
      />
    </div>
  );
}

// One fact row, echoing the ActivityRowCard anatomy (card on --color-elevated,
// border, rounded-md, p-3). Fact text + provenance pill on the top row (pill
// right-aligned as the hero). Unconfirmed rows carry the amber "Needs review"
// marker and a Confirm action; confirmed rows show Edit / Delete only. Buttons
// that cannot act are ABSENT, never disabled-dead (UI-SPEC affordance rule).
function MemoryFactCard({ fact, onChanged }: { fact: MemoryFact; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function confirmFact() {
    setBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>(`/api/memory/${fact.id}/confirm`);
      if (res.ok) {
        pushToast({
          tone: 'success',
          title: 'Confirmed. This fact can now inform what the team does on its own.',
        });
        onChanged();
      } else {
        const reason = res.error || 'Could not confirm this fact.';
        pushToast({ tone: 'error', title: 'Could not confirm', description: reason, durationMs: 6000 });
        onChanged();
      }
    } catch (err: any) {
      const reason = err?.body?.error || err?.message || String(err);
      pushToast({ tone: 'error', title: 'Could not confirm', description: reason, durationMs: 6000 });
    } finally {
      setBusy(false);
    }
  }

  async function deleteFact() {
    setBusy(true);
    try {
      const res = await apiDelete<{ ok: boolean; error?: string }>(`/api/memory/${fact.id}`);
      if (res.ok) {
        pushToast({ tone: 'success', title: 'Deleted. It will not come back.' });
        onChanged();
      } else {
        const reason = res.error || 'Could not delete this fact.';
        pushToast({ tone: 'error', title: 'Could not delete', description: reason, durationMs: 6000 });
        onChanged();
      }
    } catch (err: any) {
      const reason = err?.body?.error || err?.message || String(err);
      pushToast({ tone: 'error', title: 'Could not delete', description: reason, durationMs: 6000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-3">
      <div class="flex items-start gap-2">
        <div class="text-[12.5px] text-[var(--color-text)] leading-snug flex-1">
          {fact.summary}
        </div>
        <Pill tone={provenanceTone(fact.provenance)}>{PROVENANCE_LABEL[fact.provenance]}</Pill>
      </div>
      <div class="flex items-center gap-2 mt-2 text-[11px] text-[var(--color-text-muted)]">
        {!fact.confirmed && <Pill tone="medium">Needs review</Pill>}
        <div class="ml-auto flex items-center gap-3">
          {/* Confirm appears ONLY on unconfirmed rows (affordance rule). */}
          {!fact.confirmed && (
            <button
              type="button"
              onClick={() => void confirmFact()}
              disabled={busy}
              class="text-[11px] font-medium text-[var(--color-accent)] hover:opacity-80 transition-opacity disabled:opacity-40"
            >
              Confirm
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            disabled={busy}
            class="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            class="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] transition-colors disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </div>

      <EditFactModal
        open={editOpen}
        fact={fact}
        categories={CATEGORY_ORDER}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          onChanged();
        }}
      />

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void deleteFact()}
        title="Delete this fact?"
        body="The assistant will forget this, and it will not be learned again from your work or email."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
      />
    </div>
  );
}

// A small labeled category picker shared by Add and Edit. The operator chooses
// one of the three areas (UI-SPEC: "Which area?").
function CategoryPicker({
  value,
  categories,
  onChange,
}: {
  value: Category | '';
  categories: Category[];
  onChange: (c: Category) => void;
}) {
  return (
    <div class="flex flex-col gap-1">
      <label class="text-[11px] font-medium text-[var(--color-text-muted)]">Which area?</label>
      <select
        value={value}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value as Category)}
        class="w-full px-2.5 py-1.5 rounded text-[12.5px] bg-[var(--color-elevated)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
      >
        <option value="" disabled>
          Pick an area
        </option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABEL[c]}
          </option>
        ))}
      </select>
    </div>
  );
}

// Add-fact modal (D-09). Inserts a confirmed, operator-authored "You told me"
// fact. Carries the on-this-machine assurance near the save button (crit 4).
function AddFactModal({
  open,
  categories,
  onClose,
  onAdded,
}: {
  open: boolean;
  categories: Category[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState<Category | ''>('');
  const [busy, setBusy] = useState(false);

  // Reset the form each time the modal opens so a prior draft never leaks in.
  useEffect(() => {
    if (open) {
      setText('');
      setCategory('');
      setBusy(false);
    }
  }, [open]);

  async function save() {
    if (!text.trim() || !category) return;
    setBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/memory', {
        summary: text.trim(),
        category,
      });
      if (res.ok) {
        pushToast({ tone: 'success', title: 'Saved. Stored on this machine.' });
        onAdded();
      } else {
        const reason = res.error || 'Could not save this fact.';
        pushToast({ tone: 'error', title: 'Could not save', description: reason, durationMs: 6000 });
      }
    } catch (err: any) {
      const reason = err?.body?.error || err?.message || String(err);
      pushToast({ tone: 'error', title: 'Could not save', description: reason, durationMs: 6000 });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a fact"
      footer={
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !text.trim() || !category}
          class="ml-auto px-3 py-1.5 rounded text-[12.5px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
        >
          Save fact
        </button>
      }
    >
      <div class="flex flex-col gap-4">
        <textarea
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          rows={3}
          placeholder="What should the assistant know about you?"
          class="w-full px-2.5 py-2 rounded text-[12.5px] leading-snug bg-[var(--color-elevated)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] resize-none"
        />
        <CategoryPicker value={category} categories={categories} onChange={setCategory} />
        <div class="text-[11px] text-[var(--color-text-muted)] leading-snug">
          Stored on this machine. You can edit or delete it anytime.
        </div>
      </div>
    </Modal>
  );
}

// Edit-fact modal. Edits the fact text and/or its category in place.
function EditFactModal({
  open,
  fact,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  fact: MemoryFact;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(fact.summary);
  const [category, setCategory] = useState<Category | ''>(fact.category ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setText(fact.summary);
      setCategory(fact.category ?? '');
      setBusy(false);
    }
  }, [open, fact.summary, fact.category]);

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const body: { summary: string; category?: Category } = { summary: text.trim() };
      if (category) body.category = category;
      const res = await apiPatch<{ ok: boolean; error?: string }>(`/api/memory/${fact.id}`, body);
      if (res.ok) {
        pushToast({ tone: 'success', title: 'Saved.' });
        onSaved();
      } else {
        const reason = res.error || 'Could not save this fact.';
        pushToast({ tone: 'error', title: 'Could not save', description: reason, durationMs: 6000 });
      }
    } catch (err: any) {
      const reason = err?.body?.error || err?.message || String(err);
      pushToast({ tone: 'error', title: 'Could not save', description: reason, durationMs: 6000 });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit fact"
      footer={
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !text.trim()}
          class="ml-auto px-3 py-1.5 rounded text-[12.5px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
        >
          Save fact
        </button>
      }
    >
      <div class="flex flex-col gap-4">
        <textarea
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          rows={3}
          class="w-full px-2.5 py-2 rounded text-[12.5px] leading-snug bg-[var(--color-elevated)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] resize-none"
        />
        <CategoryPicker value={category} categories={categories} onChange={setCategory} />
      </div>
    </Modal>
  );
}
