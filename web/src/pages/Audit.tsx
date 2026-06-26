import { useEffect, useRef, useState } from 'preact/hooks';
import { ShieldAlert, ShieldCheck, Clock, ChevronRight, ChevronDown, Download } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet, tokenizedSseUrl } from '@/lib/api';
import { formatCost, formatDuration } from '@/lib/format';
import { teammateColor } from '@/lib/teammate';
import { pushToast } from '@/lib/toasts';
import { term } from '@/lib/vocabulary';

// Enriched audit row (Phase 5, AUD-01). Every per-event field is nullable —
// the data spine writes honest NULLs for anything not captured for that event,
// and this surface renders the literal token "not captured" for them (never a
// blank cell that could be mistaken for "no value").
interface AuditEntry {
  id: number;
  agent_id: string;
  chat_id: string;
  action: string;
  detail: string;
  blocked: number;
  created_at: number;
  event_type: string | null;
  tool: string | null;
  target: string | null;
  project: string | null;
  decision: string | null;
  decided_by: string | null;
  decided_at: number | null;
  result: string | null;
  duration_ms: number | null;
  model: string | null;
  session_id: string | null;
  cost_usd: number | null;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  retention_days: number;
  types: string[];
}

const PAGE = 100;

// The full event-type vocabulary this log is DESIGNED to cover. A type is
// rendered as an active, selectable chip only when it has backing data (from
// the API `types` list); the rest are shown disabled with a "not yet captured"
// footnote so the surface never implies coverage it does not have (AUD-01).
const SPEC_TYPES = ['action', 'permission', 'auth', 'routine', 'config', 'message', 'error'];

// Absolute, to-the-second local timestamp in monospace (e.g. 2026-06-25 14:32:07).
// Audit uses absolute machine time, NOT the relative "5m ago" Activity uses —
// the precise timestamp IS part of the technical signal of this surface.
function absoluteTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

// Resolve the outcome icon + tone from a row. Type is not outcome: a permission
// event can be held; the icon reflects the outcome, the chip reflects the type.
function outcome(e: AuditEntry): { icon: typeof ShieldCheck; cls: string; label: string } {
  const r = (e.result || '').toLowerCase();
  if (e.blocked === 1 || r === 'deny' || r === 'denied' || r === 'blocked' || r === 'error') {
    return { icon: ShieldAlert, cls: 'text-[var(--color-status-failed)]', label: e.blocked === 1 ? 'blocked' : (e.result || 'error') };
  }
  if (r === 'held' || r === 'queued' || r === 'ask' || r === 'needs-approval' || r === 'pending') {
    return { icon: Clock, cls: 'text-[var(--color-priority-medium)]', label: e.result || 'held' };
  }
  return { icon: ShieldCheck, cls: 'text-[var(--color-status-done)]', label: e.result || 'ok' };
}

export function Audit() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters — all drive both the read AND the export scope.
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [openRow, setOpenRow] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Debounce the search box so each keystroke does not re-query the server.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  // Close the export popover on an outside click.
  useEffect(() => {
    if (!exportOpen) return;
    function onClick(ev: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(ev.target as Node)) setExportOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [exportOpen]);

  // Build the shared filter query string used by both the read and the export.
  function filterQuery(): string {
    const p = new URLSearchParams();
    if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim());
    if (typeFilter) p.set('type', typeFilter);
    if (from) p.set('from', from);
    // Include the whole "to" day by pushing the end to its last second.
    if (to) p.set('to', `${to}T23:59:59`);
    return p.toString();
  }

  useEffect(() => {
    setItems([]); setOffset(0); setOpenRow(null);
    void load(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, typeFilter, from, to]);

  async function load(off: number, reset: boolean) {
    try {
      setLoading(true); setError(null);
      const q = filterQuery();
      const path = `/api/audit?limit=${PAGE}&offset=${off}` + (q ? `&${q}` : '');
      const data = await apiGet<AuditResponse>(path);
      setTotal(data.total ?? data.entries.length);
      setRetentionDays(data.retention_days ?? null);
      setAvailableTypes(data.types ?? []);
      setItems((prev) => (reset ? data.entries : [...prev, ...data.entries]));
      setOffset(off + data.entries.length);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  // Trigger the complete-filtered-set download. token-in-URL GET (the only way
  // a browser file download can carry the dashboard token); the server streams
  // the FULL filtered set, never page-capped (D-21 / Pitfall 6).
  function doExport(format: 'csv' | 'json') {
    setExportOpen(false);
    setExporting(true);
    try {
      const q = filterQuery();
      const path = `/api/audit/export?format=${format}` + (q ? `&${q}` : '');
      // tokenizedSseUrl appends the dashboard token to the path.
      window.location.href = tokenizedSseUrl(path);
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not export', description: err?.message || String(err), durationMs: 6000 });
    } finally {
      // The navigation kicks off a download without unloading the SPA; clear
      // the busy state shortly after so the controls re-enable.
      window.setTimeout(() => setExporting(false), 1200);
    }
  }

  const notCaptured = SPEC_TYPES.filter((t) => !availableTypes.includes(t));

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title={term('page.audit')}
        actions={
          <div class="flex items-center gap-3">
            <span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">{total} events</span>
            <div ref={exportRef} class="relative">
              <button
                type="button"
                onClick={() => setExportOpen((v) => !v)}
                disabled={exporting}
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
              >
                <Download size={13} /> Export log
              </button>
              {exportOpen && (
                <div class="absolute right-0 mt-1 z-20 w-56 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg p-1">
                  <button
                    type="button"
                    onClick={() => doExport('csv')}
                    disabled={exporting}
                    class="w-full text-left px-3 py-1.5 rounded text-[12px] text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors disabled:opacity-50"
                  >
                    Export as CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => doExport('json')}
                    disabled={exporting}
                    class="w-full text-left px-3 py-1.5 rounded text-[12px] text-[var(--color-text)] hover:bg-[var(--color-elevated)] transition-colors disabled:opacity-50"
                  >
                    Export as JSON
                  </button>
                  <div class="px-3 py-1.5 text-[10px] text-[var(--color-text-faint)] leading-snug border-t border-[var(--color-border)] mt-1">
                    Exports every event matching your current filters, not just what is on screen.
                  </div>
                </div>
              )}
            </div>
          </div>
        }
        tabs={
          <>
            <Tab label="All types" active={typeFilter === null} onClick={() => setTypeFilter(null)} />
            {availableTypes.map((t) => (
              <Tab key={t} label={t} active={typeFilter === t} onClick={() => setTypeFilter(t)} />
            ))}
            {notCaptured.map((t) => (
              <span
                key={t}
                title="not yet captured"
                class="px-3 py-1 rounded-md text-[12px] text-[var(--color-text-faint)] opacity-50 cursor-not-allowed font-mono"
              >
                {t}
              </span>
            ))}
          </>
        }
      />

      {/* Subtitle + retention line. Subtitle is Inter prose; the day count is
          monospace and read from config (never hardcoded). */}
      <div class="px-6 py-2 border-b border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)] flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Complete, read-only record of every event</span>
        {retentionDays !== null && (
          <span class="text-[var(--color-text-faint)]">
            Retaining <span class="font-mono tabular-nums text-[var(--color-text-muted)]">{retentionDays}</span> days
          </span>
        )}
      </div>

      {/* Coverage-honesty banner: states what is NOT yet captured so "complete"
          never overstates coverage. */}
      {notCaptured.length > 0 && (
        <div class="mx-6 mt-3 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 text-[11px] text-[var(--color-text-muted)] leading-snug">
          Not yet captured: <span class="font-mono text-[var(--color-text-faint)]">{notCaptured.join(', ')}</span>. These events are not recorded yet, so this log does not claim to cover them.
        </div>
      )}

      {/* Filter bar: debounced search + date range. Type chips live in the
          header tabs slot above. All filters drive read AND export scope. */}
      <div class="px-6 py-3 flex flex-wrap items-center gap-2 border-b border-[var(--color-border)]">
        <input
          type="text"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          placeholder="Search description, tool, or target"
          class="flex-1 min-w-[220px] bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)]"
        />
        <label class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">From</label>
        <input
          type="date"
          value={from}
          onInput={(e) => setFrom((e.target as HTMLInputElement).value)}
          class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1.5 text-[11px] font-mono text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)]"
        />
        <label class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">To</label>
        <input
          type="date"
          value={to}
          onInput={(e) => setTo((e.target as HTMLInputElement).value)}
          class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1.5 text-[11px] font-mono text-[var(--color-text)] outline-none focus:border-[var(--color-border-strong)]"
        />
      </div>

      {error && (
        <PageState error={`Could not load the audit log. ${error}. The log itself is unaffected; this is a display problem.`} />
      )}
      {loading && items.length === 0 && <PageState loading />}
      {!loading && !error && items.length === 0 && (
        <PageState
          empty
          emptyTitle={search || typeFilter || from || to ? 'No events match these filters' : 'No events recorded yet'}
          emptyDescription={
            search || typeFilter || from || to
              ? 'Clear the search, type, or date range to see the full record.'
              : 'Every action, permission decision, auth event, routine run, and error will appear here as it happens. This log is append-only and is never edited or trimmed.'
          }
        />
      )}

      {items.length > 0 && (
        <div class="flex-1 overflow-y-auto">
          <table class="w-full text-[12px]">
            <thead class="sticky top-0 bg-[var(--color-bg)] border-b border-[var(--color-border)] z-10">
              <tr class="text-left">
                <th class="px-6 py-2 font-semibold text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[160px]">Time</th>
                <th class="px-3 py-2 font-semibold text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[120px]">Actor</th>
                <th class="px-3 py-2 font-semibold text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[110px]">Type</th>
                <th class="px-3 py-2 font-semibold text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Event</th>
                <th class="px-3 py-2 font-semibold text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] w-[40px] text-center">Detail</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                const out = outcome(e);
                const OutIcon = out.icon;
                const isOpen = openRow === e.id;
                const isTeammate = !['main', 'system', 'you'].includes((e.agent_id || '').toLowerCase());
                const actorColor = isTeammate ? teammateColor(e.agent_id) : 'var(--color-text-muted)';
                return (
                  <>
                    <tr
                      key={e.id}
                      onClick={() => setOpenRow(isOpen ? null : e.id)}
                      class="border-b border-[var(--color-border)] hover:bg-[var(--color-elevated)] transition-colors cursor-pointer"
                    >
                      <td class="px-6 py-2 font-mono text-[11px] text-[var(--color-text-muted)] tabular-nums whitespace-nowrap">
                        {absoluteTime(e.created_at)}
                      </td>
                      <td class="px-3 py-2">
                        <span class="inline-flex items-center gap-1.5">
                          <span class="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: actorColor }} />
                          <span class="text-[var(--color-text-muted)] truncate">{e.agent_id}</span>
                        </span>
                      </td>
                      <td class="px-3 py-2">
                        <span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-elevated)] text-[var(--color-text-muted)]">
                          {e.event_type ?? e.action}
                        </span>
                      </td>
                      <td class="px-3 py-2 text-[var(--color-text)]">
                        <span class="inline-flex items-center gap-1.5">
                          <OutIcon size={12} class={out.cls + ' shrink-0'} />
                          <span class="truncate">{e.detail || e.action}</span>
                        </span>
                      </td>
                      <td class="px-3 py-2 text-center text-[var(--color-text-faint)]">
                        {isOpen ? <ChevronDown size={13} class="inline" /> : <ChevronRight size={13} class="inline" />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={e.id + '-detail'} class="bg-[var(--color-elevated)] border-b border-[var(--color-border)]">
                        <td colSpan={5} class="px-6 py-4">
                          <DetailGrid e={e} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
          {offset < total && (
            <button
              type="button"
              onClick={() => load(offset, false)}
              disabled={loading}
              class="w-full px-6 py-3 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] border-t border-[var(--color-border)] transition-colors disabled:opacity-40"
            >
              {loading ? 'Loading…' : `Load more (${total - offset} remaining)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// The expanded technical key/value grid. EVERY field that was not captured for
// this event renders the literal token "not captured" in faint text — never a
// blank cell that could be read as "no value" rather than "not recorded"
// (AUD-01 honesty promise). Keys are 10px uppercase Inter; values 11px mono.
function DetailGrid({ e }: { e: AuditEntry }) {
  const rows: Array<{ k: string; v: string | null }> = [
    { k: 'tool', v: e.tool },
    { k: 'target', v: e.target },
    { k: 'project', v: e.project },
    { k: 'decision', v: e.decision },
    { k: 'decided by', v: e.decided_by },
    { k: 'decided at', v: e.decided_at !== null ? absoluteTime(e.decided_at) : null },
    { k: 'result', v: e.result },
    { k: 'duration', v: e.duration_ms !== null ? formatDuration(Math.round(e.duration_ms / 1000)) : null },
    { k: 'turn cost', v: e.cost_usd !== null && e.cost_usd !== undefined ? formatCost(e.cost_usd) : null },
    { k: 'session id', v: e.session_id },
    { k: 'model', v: e.model },
  ];
  return (
    <div class="grid grid-cols-2 gap-x-8 gap-y-2">
      {rows.map((r) => (
        <div key={r.k} class="flex flex-col gap-0.5">
          <span class="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)]">{r.k}</span>
          {r.v !== null && r.v !== '' ? (
            <span class="font-mono text-[11px] text-[var(--color-text)] break-all">{r.v}</span>
          ) : (
            <span class="font-mono text-[11px] text-[var(--color-text-faint)]">not captured</span>
          )}
        </div>
      ))}
    </div>
  );
}
