// Calendar — month view of scheduled action items (routines + cron tasks).
//
// One GET /api/schedule/calendar?from=&to= per visible month. The first
// occurrence of each task is its persisted next_run (which may be overdue —
// it renders on the day it was due, flagged red); later occurrences are
// projected from the cron and render dimmer since they only fire if nothing
// changes. Selecting a day lists its items with the same move-to-date and
// delete actions the Home "Today" list has.

import { useMemo, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, ArrowRight, Trash2, CalendarDays } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Pill } from '@/components/Pill';
import { useFetch } from '@/lib/useFetch';
import { apiPatch, apiDelete } from '@/lib/api';
import { pushToast } from '@/lib/toasts';

interface CalendarItem {
  id: string;
  occurs_at: number;
  title: string;
  agent_id: string;
  source: string;
  status: string;
  schedule: string;
  overdue: boolean;
  projected: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalInput(epoch: number): string {
  const d = new Date(epoch * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Calendar() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based
  const [selected, setSelected] = useState<string>(ymd(now));

  const monthStart = new Date(year, month, 1);
  const nextMonthStart = new Date(year, month + 1, 1);
  const from = Math.floor(monthStart.getTime() / 1000);
  const to = Math.floor(nextMonthStart.getTime() / 1000);

  const feed = useFetch<{ items: CalendarItem[] }>(`/api/schedule/calendar?from=${from}&to=${to}`, 30_000);
  const items = feed.data?.items ?? [];

  // Bucket occurrences by local day for the grid and the selected-day panel.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const it of items) {
      const key = ymd(new Date(it.occurs_at * 1000));
      const list = map.get(key);
      if (list) list.push(it); else map.set(key, [it]);
    }
    return map;
  }, [items]);

  function shiftMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function goToday() {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelected(ymd(d));
  }

  // Grid cells: leading blanks to align the 1st on its weekday, then the days.
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = monthStart.getDay();
  const todayKey = ymd(new Date());
  const monthLabel = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const selectedItems = byDay.get(selected) ?? [];
  const selectedLabel = new Date(selected + 'T00:00:00')
    .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Calendar"
        actions={
          <>
            <button
              type="button"
              onClick={goToday}
              class="px-2.5 py-1.5 rounded text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              class="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft size={15} />
            </button>
            <span class="text-[13px] font-medium text-[var(--color-text)] min-w-[140px] text-center tabular-nums">{monthLabel}</span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              class="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors"
              aria-label="Next month"
            >
              <ChevronRight size={15} />
            </button>
          </>
        }
      />

      {feed.error && <PageState error={feed.error} />}
      {feed.loading && !feed.data && <PageState loading />}

      {feed.data && (
        <div class="flex-1 min-h-0 overflow-y-auto">
          <div class="max-w-[1100px] mx-auto px-6 py-5 space-y-4">
            <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden">
              <div class="grid grid-cols-7 border-b border-[var(--color-border)]">
                {WEEKDAYS.map((d) => (
                  <div key={d} class="px-2 py-1.5 text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] text-center">{d}</div>
                ))}
              </div>
              <div class="grid grid-cols-7">
                {Array.from({ length: leadingBlanks }, (_, i) => (
                  <div key={`blank-${i}`} class="min-h-[84px] border-b border-r border-[var(--color-border)] bg-[var(--color-bg)] opacity-40" />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const key = ymd(new Date(year, month, day));
                  const dayItems = byDay.get(key) ?? [];
                  const isToday = key === todayKey;
                  const isSelected = key === selected;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelected(key)}
                      class={[
                        'min-h-[84px] p-1.5 border-b border-r border-[var(--color-border)] text-left align-top transition-colors',
                        isSelected ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-elevated)]',
                      ].join(' ')}
                    >
                      <div class={[
                        'inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] tabular-nums mb-1',
                        isToday ? 'bg-[var(--color-accent)] text-white font-semibold' : 'text-[var(--color-text-muted)]',
                      ].join(' ')}>
                        {day}
                      </div>
                      <div class="space-y-0.5">
                        {dayItems.slice(0, 3).map((it, idx) => (
                          <div
                            key={`${it.id}-${it.occurs_at}-${idx}`}
                            class={[
                              'text-[9.5px] leading-tight truncate rounded px-1 py-0.5',
                              it.overdue
                                ? 'bg-[color-mix(in_srgb,var(--color-status-failed)_18%,transparent)] text-[var(--color-status-failed)]'
                                : it.projected || it.status !== 'active'
                                  ? 'bg-[var(--color-elevated)] text-[var(--color-text-faint)]'
                                  : 'bg-[var(--color-elevated)] text-[var(--color-text-muted)]',
                            ].join(' ')}
                          >
                            {it.title}
                          </div>
                        ))}
                        {dayItems.length > 3 && (
                          <div class="text-[9px] text-[var(--color-text-faint)] px-1">+{dayItems.length - 3} more</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected day detail: full titles + the same move/delete actions
                the Home Today list has. */}
            <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden">
              <div class="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center gap-2">
                <CalendarDays size={13} class="text-[var(--color-text-muted)]" />
                <span class="text-[13px] font-semibold text-[var(--color-text)]">{selectedLabel}</span>
                <span class="ml-auto text-[11px] text-[var(--color-text-faint)] tabular-nums">
                  {selectedItems.length} item{selectedItems.length === 1 ? '' : 's'}
                </span>
              </div>
              <div class="p-2.5 space-y-1.5">
                {selectedItems.length === 0 && (
                  <div class="text-[11.5px] text-[var(--color-text-faint)] text-center py-4">Nothing scheduled this day.</div>
                )}
                {selectedItems.map((it, idx) => (
                  <DayItem key={`${it.id}-${it.occurs_at}-${idx}`} item={it} onChange={feed.refresh} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DayItem({ item, onChange }: { item: CalendarItem; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [moveTo, setMoveTo] = useState(() => toLocalInput(item.occurs_at));

  const time = new Date(item.occurs_at * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  async function move() {
    const at = Math.floor(new Date(moveTo).getTime() / 1000);
    if (!Number.isFinite(at)) return;
    setBusy(true);
    try {
      await apiPatch(`/api/tasks/${item.id}`, { next_run: at });
      setPicking(false);
      onChange();
      pushToast({ tone: 'success', title: 'Moved', description: `Next run ${new Date(at * 1000).toLocaleString()}.` });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not move', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('Delete this scheduled item? Its schedule and history go with it.')) return;
    setBusy(true);
    try {
      await apiDelete(`/api/tasks/${item.id}`);
      onChange();
      pushToast({ tone: 'success', title: 'Deleted', description: 'Removed from the schedule.' });
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Delete failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }

  return (
    <div class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-2.5">
      <div class="flex items-center gap-1.5 mb-1">
        <span class="text-[10px] text-[var(--color-text-faint)] tabular-nums">{time}</span>
        {item.overdue && <Pill tone="failed">overdue</Pill>}
        {item.projected && <Pill tone="neutral">recurring</Pill>}
        {item.status === 'paused' && <Pill tone="medium">paused</Pill>}
        <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">{item.agent_id}</span>
      </div>
      <div class="text-[12.5px] text-[var(--color-text)] leading-snug mb-2">{item.title}</div>
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-[var(--color-text-faint)] font-mono">{item.schedule}</span>
        <div class="ml-auto flex items-center gap-1">
          {/* A projected occurrence has no row of its own — moving only makes
              sense for the task's actual next fire, so it's hidden there. */}
          {!item.projected && (
            <button
              type="button"
              onClick={() => setPicking(!picking)}
              disabled={busy}
              class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-colors disabled:opacity-40"
            >
              <CalendarDays size={11} /> Move
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] transition-colors disabled:opacity-40"
            title="Delete this scheduled item"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {picking && (
        <div class="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--color-border)]">
          <input
            type="datetime-local"
            value={moveTo}
            onInput={(e) => setMoveTo((e.target as HTMLInputElement).value)}
            disabled={busy}
            class="bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[11px] text-[var(--color-text)] px-2 py-1 outline-none focus:border-[var(--color-accent)] disabled:opacity-40"
          />
          <button
            type="button"
            onClick={move}
            disabled={busy || !moveTo}
            class="inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-medium bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-40"
          >
            <ArrowRight size={11} /> {busy ? '…' : 'Move'}
          </button>
          <button
            type="button"
            onClick={() => setPicking(false)}
            disabled={busy}
            class="px-2 py-1 rounded text-[10.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
