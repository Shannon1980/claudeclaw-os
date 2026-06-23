import { useState } from 'preact/hooks';
import { Check, Pipette, RotateCcw, ChevronDown, ChevronRight, Lock } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { Toggle } from '@/components/Toggle';
import { AutonomyModeSelector, type Mode } from '@/components/AutonomyModeSelector';
import { ActionOverrideRow, type OverrideValue } from '@/components/ActionOverrideRow';
import { LockedActionRow } from '@/components/LockedActionRow';
import { useFetch } from '@/lib/useFetch';
import { apiPost, apiPut } from '@/lib/api';
import { pushToast } from '@/lib/toasts';
import { term } from '@/lib/vocabulary';
import {
  theme, themeMeta, setTheme, type ThemeName,
  customAccent, setCustomAccent,
  uiScale, setUiScale,
  showCosts, setShowCosts,
} from '@/lib/theme';
import { vocabMode, toggleVocabMode } from '@/lib/vocabulary';
import {
  workspaceName,
  setWorkspaceName,
  hotkeyMod,
  setHotkeyMod,
  type HotkeyMod,
} from '@/lib/personalization';

interface Health {
  killSwitches: Record<string, boolean>;
  killSwitchRefusals: Record<string, number>;
  model: string;
  contextPct: number;
}

interface SecurityStatus { [key: string]: any; }

const KILL_SWITCH_LABELS: Record<string, { label: string; description: string }> = {
  WARROOM_TEXT_ENABLED: {
    label: 'Text War Room',
    description: 'Allow multi-agent text meetings via /api/warroom/text/*',
  },
  WARROOM_VOICE_ENABLED: {
    label: 'Voice War Room',
    description: 'Allow voice meetings via Pipecat',
  },
  LLM_SPAWN_ENABLED: {
    label: 'LLM spawn',
    description: 'Allow Claude SDK calls (master switch)',
  },
  DASHBOARD_MUTATIONS_ENABLED: {
    label: 'Dashboard mutations',
    description: 'Allow non-GET requests (set to false to lock dashboard read-only)',
  },
  MISSION_AUTO_ASSIGN_ENABLED: {
    label: 'Mission auto-assign',
    description: 'Allow Haiku/Gemini classifier on /api/mission/tasks/auto-assign',
  },
  SCHEDULER_ENABLED: {
    label: 'Scheduler',
    description: 'Allow scheduled cron tasks to fire',
  },
};

const THEME_ORDER: ThemeName[] = ['graphite', 'midnight', 'crimson'];

export function Settings() {
  const health = useFetch<Health>('/api/health', 30_000);
  const security = useFetch<SecurityStatus>('/api/security/status', 60_000);

  const error = health.error || security.error;

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Settings" />

      {error && <PageState error={error} />}
      {(health.loading || security.loading) && !health.data && <PageState loading />}

      {health.data && (
        <div class="flex-1 overflow-y-auto p-6 space-y-5 max-w-3xl">

          <PermissionsSection />

          <Section
            title="Workspace"
            subtitle="Identity for this dashboard. Stored in the database so it shows up in any browser pointed at this server."
          >
            <Card>
              <Row label="Name" hint="Up to 32 characters. Empty resets to ClaudeClaw.">
                <WorkspaceNameField />
              </Row>
              <Divider />
              <Row label="Theme" hint="Switches CSS variables across the app.">
                <ThemePicker />
              </Row>
              <Divider />
              <Row label="Custom accent" hint="Override the theme's accent with any hex. Reset clears it.">
                <AccentPicker />
              </Row>
            </Card>
          </Section>

          <Section
            title="Display"
            subtitle="Per-browser display preferences. Stored in localStorage, not per-workspace."
          >
            <Card>
              <Row label="UI scale" hint="Zooms the whole app proportionally so layout stays correct.">
                <ScalePicker />
              </Row>
              <Divider />
              <Row label="Show costs" hint="Hide if you're on a Claude Code subscription — costs only matter on the API path.">
                <Toggle
                  on={showCosts.value}
                  onChange={() => setShowCosts(!showCosts.value)}
                  ariaLabel="Show costs"
                />
              </Row>
              <Divider />
              <Row label="Advanced labels" hint="Show builder terms (agents, models, scheduled tasks) instead of the plain operator labels (teammates, brains, routines).">
                <Toggle
                  on={vocabMode.value === 'builder'}
                  onChange={toggleVocabMode}
                  ariaLabel="Advanced labels"
                />
              </Row>
            </Card>
          </Section>

          <Section
            title="Keyboard"
            subtitle="Pick which modifier opens the command palette and quick-jump search."
          >
            <Card>
              <Row label="Search shortcut" hint="Auto matches your platform — pick a value to override.">
                <HotkeyPicker />
              </Row>
            </Card>
          </Section>

          <Section
            title="Kill switches"
            subtitle="Runtime feature gates. Toggling writes the flag to .env atomically; the runtime re-reads it within 1.5s so changes take effect without a restart."
          >
            <div class="space-y-2">
              {Object.entries(health.data.killSwitches).map(([key, on]) => {
                const meta = KILL_SWITCH_LABELS[key] || { label: key, description: '' };
                const refusals = health.data!.killSwitchRefusals[key] || 0;
                return (
                  <KillSwitchRow
                    key={key}
                    switchKey={key}
                    label={meta.label}
                    description={meta.description}
                    on={on}
                    refusals={refusals}
                    onChange={() => health.refresh()}
                  />
                );
              })}
            </div>
          </Section>

          <Section title="Read-only" subtitle="Settings that need an .env edit + restart to change.">
            <Card>
              <ReadOnlyRow label="Default model" value={health.data.model || '—'} />
              <Divider />
              <ReadOnlyRow label="Context window" value={health.data.contextPct + '%'} />
              <div class="text-[11px] text-[var(--color-text-faint)] pt-3 mt-1 border-t border-[var(--color-border)] leading-snug">
                To toggle a kill switch, edit <code class="font-mono text-[var(--color-text-muted)]">.env</code> and set the relevant flag to <code class="font-mono text-[var(--color-text-muted)]">true</code> or <code class="font-mono text-[var(--color-text-muted)]">false</code>. The change takes effect within 1.5 seconds without a process restart.
              </div>
            </Card>
          </Section>

          <Section title="Acknowledgements">
            <Card>
              <ReadOnlyRow label="3D brain model" value="Detailed Human Brain Model, NIH 3D 3DPX-021161, CC-BY" />
            </Card>
          </Section>

        </div>
      )}
    </div>
  );
}

// ── Workspace name field ──────────────────────────────────────────────

function WorkspaceNameField() {
  const [savedTick, setSavedTick] = useState(false);
  const value = workspaceName.value;
  function onInput(e: Event) {
    const next = (e.target as HTMLInputElement).value;
    setWorkspaceName(next);
    setSavedTick(true);
    // Brief checkmark cue. The signal updates instantly; the PATCH is
    // debounced 600ms inside personalization.ts.
    window.setTimeout(() => setSavedTick(false), 1500);
  }
  return (
    <div class="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onInput={onInput}
        maxLength={32}
        placeholder="ClaudeClaw"
        class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] w-[200px]"
      />
      {savedTick && <Check size={14} class="text-[var(--color-status-done)] shrink-0" />}
    </div>
  );
}

// ── Theme picker ──────────────────────────────────────────────────────

function ThemePicker() {
  return (
    <div class="flex items-center gap-1.5">
      {THEME_ORDER.map((name) => {
        const active = theme.value === name;
        const meta = themeMeta[name];
        return (
          <button
            key={name}
            type="button"
            onClick={() => setTheme(name)}
            class={[
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] border transition-colors',
              active
                ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-text)]'
                : 'bg-[var(--color-card)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]',
            ].join(' ')}
          >
            <div
              class="w-3.5 h-3.5 rounded-sm shrink-0"
              style={{ background: meta.swatch, border: '1px solid var(--color-border)' }}
            />
            {meta.label}
            {active && <Check size={12} class="text-[var(--color-accent)]" />}
          </button>
        );
      })}
    </div>
  );
}

// ── Accent picker ─────────────────────────────────────────────────────

function AccentPicker() {
  const current = customAccent.value;
  const [draft, setDraft] = useState(current ?? '#');
  function commit(next: string) {
    if (/^#[0-9a-fA-F]{6}$/.test(next)) setCustomAccent(next);
  }
  return (
    <div class="flex items-center gap-2">
      <label
        class="relative inline-flex items-center justify-center w-8 h-8 rounded border border-[var(--color-border)] cursor-pointer overflow-hidden"
        style={{ backgroundColor: current || 'var(--color-elevated)' }}
        title="Pick a color"
      >
        <Pipette size={13} class={current ? 'text-white mix-blend-difference' : 'text-[var(--color-text-faint)]'} />
        <input
          type="color"
          value={current || '#8b8af0'}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value.toLowerCase();
            setDraft(v); commit(v);
          }}
          class="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>
      <input
        type="text"
        value={draft}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setDraft(v);
          if (/^#[0-9a-fA-F]{6}$/.test(v)) setCustomAccent(v);
        }}
        placeholder="#8b8af0"
        maxLength={7}
        class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] font-mono text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] w-[110px]"
      />
      {current && (
        <button
          type="button"
          onClick={() => { setCustomAccent(null); setDraft('#'); }}
          class="inline-flex items-center gap-1 px-2 py-1.5 rounded text-[11.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)] border border-[var(--color-border)] transition-colors"
          title="Restore theme accent"
        >
          <RotateCcw size={11} /> Reset
        </button>
      )}
    </div>
  );
}

// ── UI scale picker ───────────────────────────────────────────────────

const SCALE_PRESETS: Array<{ value: number; label: string }> = [
  { value: 0.95, label: '95%' },
  { value: 1.00, label: '100%' },
  { value: 1.10, label: '110%' },
  { value: 1.25, label: '125%' },
  { value: 1.50, label: '150%' },
];

function ScalePicker() {
  const current = uiScale.value;
  return (
    <div class="flex flex-wrap items-center gap-1.5">
      {SCALE_PRESETS.map((p) => {
        const active = Math.abs(current - p.value) < 0.001;
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => setUiScale(p.value)}
            class={[
              'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12.5px] border transition-colors tabular-nums',
              active
                ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-text)]'
                : 'bg-[var(--color-card)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]',
            ].join(' ')}
          >
            {p.label}
            {active && <Check size={12} class="text-[var(--color-accent)]" />}
          </button>
        );
      })}
    </div>
  );
}

// ── Hotkey picker ─────────────────────────────────────────────────────

function HotkeyPicker() {
  const current = hotkeyMod.value;
  const opts: { v: HotkeyMod; label: string; hint: string }[] = [
    { v: 'auto', label: 'Auto', hint: '⌘ on Mac, Ctrl elsewhere' },
    { v: 'meta', label: '⌘ Cmd / Meta', hint: 'Mac standard' },
    { v: 'ctrl', label: 'Ctrl', hint: 'Windows / Linux standard' },
  ];
  return (
    <div class="flex flex-wrap items-center gap-1.5">
      {opts.map((o) => {
        const active = current === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => setHotkeyMod(o.v)}
            class={[
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] border transition-colors',
              active
                ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-text)]'
                : 'bg-[var(--color-card)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]',
            ].join(' ')}
            title={o.hint}
          >
            {o.label}
            {active && <Check size={12} class="text-[var(--color-accent)]" />}
          </button>
        );
      })}
    </div>
  );
}

// ── Kill switch row ──────────────────────────────────────────────────

interface KillSwitchRowProps {
  switchKey: string;
  label: string;
  description: string;
  on: boolean;
  refusals: number;
  onChange: () => void;
}

function KillSwitchRow({ switchKey, label, description, on, refusals, onChange }: KillSwitchRowProps) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    const newValue = !on;
    if (!newValue && switchKey === 'DASHBOARD_MUTATIONS_ENABLED') {
      if (!confirm('Disabling dashboard mutations will lock this dashboard read-only. Every non-GET request will return 503 until you re-enable it (which means you cannot use this UI to turn it back on — you have to edit .env directly). Continue?')) {
        return;
      }
    }
    if (!newValue && switchKey === 'LLM_SPAWN_ENABLED') {
      if (!confirm('Disabling LLM_SPAWN_ENABLED will stop every Claude SDK call across all agents. Mission tasks, scheduled tasks, and agent replies will all stop firing. Continue?')) {
        return;
      }
    }
    setBusy(true);
    try {
      await apiPost('/api/security/kill-switch', { key: switchKey, enabled: newValue });
      pushToast({
        tone: newValue ? 'success' : 'warn',
        title: label + ' ' + (newValue ? 'enabled' : 'disabled'),
        description: 'Takes effect within 1.5s.',
      });
      // Wait a tick for the kill-switches re-read window so the next
      // refresh shows the new state.
      setTimeout(onChange, 1700);
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Toggle failed', description: err?.message || String(err), durationMs: 6000 });
    } finally { setBusy(false); }
  }
  return (
    <div class="flex items-start gap-3 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-4 py-3.5">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-[13.5px] font-medium text-[var(--color-text)]">{label}</span>
          <code class="text-[10.5px] text-[var(--color-text-faint)] font-mono">{switchKey}</code>
        </div>
        <div class="text-[12px] text-[var(--color-text-muted)] leading-snug">{description}</div>
        {refusals > 0 && (
          <div class="text-[11px] text-[var(--color-status-failed)] mt-1 tabular-nums">
            {refusals} refusals since startup
          </div>
        )}
      </div>
      <Toggle on={on} onChange={toggle} disabled={busy} ariaLabel={label} />
    </div>
  );
}

// ── Layout primitives ─────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: any }) {
  return (
    <div>
      <div class="mb-2.5">
        <h2 class="text-[14px] font-semibold text-[var(--color-text)]">{title}</h2>
        {subtitle && <p class="text-[12px] text-[var(--color-text-muted)] leading-snug mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Card({ children }: { children: any }) {
  return (
    <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-1">{children}</div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: any }) {
  return (
    <div class="flex items-center gap-4 py-1.5">
      <div class="flex-1 min-w-0">
        <div class="text-[13px] text-[var(--color-text)]">{label}</div>
        {hint && <div class="text-[11px] text-[var(--color-text-faint)] mt-0.5">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Divider() {
  return <div class="border-t border-[var(--color-border)] my-1" />;
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex items-center justify-between py-1.5">
      <span class="text-[13px] text-[var(--color-text-muted)]">{label}</span>
      <span class="font-mono text-[12.5px] text-[var(--color-text)] tabular-nums">{value}</span>
    </div>
  );
}

// ── Permissions (Phase 3, PERM-01/02/03) ──────────────────────────────

interface Permissions { mode: Mode; overrides: Record<string, OverrideValue> }

// The editable (non-locked) override rows. Each maps a capability key to its
// label, tier badge, and the mode-derived default so an explicit override can
// be marked. The locked Tier 4 capability (send-money) is rendered separately
// as a LockedActionRow and never appears here.
const OVERRIDE_ROWS: { key: string; label: string; tier: number }[] = [
  { key: 'prepare', label: 'Research and prepare', tier: 1 },
  { key: 'draft', label: 'Draft messages and docs', tier: 1 },
  { key: 'send', label: 'Send emails and messages', tier: 3 },
  { key: 'book', label: 'Book or move meetings', tier: 3 },
  { key: 'post', label: 'Post publicly', tier: 3 },
];

const LOCKED_ROWS: { label: string; reason: string }[] = [
  { label: 'Send money or pay invoices', reason: 'Money movement cannot be undone. Always asks.' },
  { label: 'Sign or commit to contracts', reason: 'A signature is binding. Always asks.' },
  { label: 'Permanently delete data', reason: 'Deletion cannot be reversed. Always asks.' },
];

// The mode default (auto = "always" silent, ask = "ask first") for a tier,
// mirroring the gate's TIER_DEFAULT matrix so the UI shows the same behavior.
function modeDefault(mode: Mode, tier: number): OverrideValue {
  if (tier === 1) return 'always';
  if (tier === 2) return mode === 'cautious' ? 'ask' : 'always';
  if (tier === 3) return mode === 'autonomous' ? 'always' : 'ask';
  return 'ask'; // tier 4 — always asks
}

function PermissionsSection() {
  const perms = useFetch<Permissions>('/api/permissions', 0);
  const [busy, setBusy] = useState(false);

  const mode = perms.data?.mode ?? 'balanced';
  const overrides = perms.data?.overrides ?? {};

  async function save(nextMode: Mode, nextOverrides: Record<string, OverrideValue>) {
    setBusy(true);
    try {
      await apiPut('/api/permissions', { mode: nextMode, overrides: nextOverrides });
      perms.refresh();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not save', description: err?.message || String(err), durationMs: 6000 });
      perms.refresh();
    } finally {
      setBusy(false);
    }
  }

  function setModeValue(next: Mode) {
    const label = next.charAt(0).toUpperCase() + next.slice(1);
    pushToast({ tone: 'success', title: 'Mode set', description: `Mode set to ${label}.` });
    void save(next, overrides);
  }

  function setOverrideValue(key: string, value: OverrideValue) {
    void save(mode, { ...overrides, [key]: value });
  }

  function resetOverride(key: string) {
    const next = { ...overrides };
    delete next[key];
    void save(mode, next);
  }

  return (
    <Section title={term('page.permissions')} subtitle="What your team can do on its own.">
      {perms.error && <PageState error={perms.error} />}
      {perms.loading && !perms.data && <PageState loading />}
      {perms.data && (
        <div class="space-y-4">
          <Card>
            <AutonomyModeSelector value={mode} onChange={setModeValue} busy={busy} />
            <div class="mt-3 pt-3 border-t border-[var(--color-border)]">
              <TierLegend mode={mode} />
            </div>
          </Card>

          <Card>
            <div class="section-label mb-1">Fine-tune by action</div>
            <div class="text-[11px] text-[var(--color-text-faint)] mb-2">Most people never need this.</div>
            {OVERRIDE_ROWS.map((row, i) => {
              const value = overrides[row.key] ?? modeDefault(mode, row.tier);
              const isOverridden = overrides[row.key] !== undefined && overrides[row.key] !== modeDefault(mode, row.tier);
              return (
                <div key={row.key}>
                  {i > 0 && <Divider />}
                  <ActionOverrideRow
                    label={row.label}
                    tierLabel={row.tier === 1 ? 'Prepare' : 'Send'}
                    value={value}
                    isOverridden={isOverridden}
                    onChange={(v) => setOverrideValue(row.key, v)}
                    onReset={() => resetOverride(row.key)}
                    busy={busy}
                  />
                </div>
              );
            })}
          </Card>

          <Card>
            <div class="section-label mb-2 flex items-center gap-1">
              <Lock size={11} class="text-[var(--color-text-muted)]" /> Always asks
            </div>
            {LOCKED_ROWS.map((row, i) => (
              <div key={row.label}>
                {i > 0 && <Divider />}
                <LockedActionRow label={row.label} reason={row.reason} />
              </div>
            ))}
          </Card>
        </div>
      )}
    </Section>
  );
}

// A collapsed-by-default educational legend: what each tier means and how the
// current mode treats it. Body text only, no controls.
function TierLegend({ mode }: { mode: Mode }) {
  const [open, setOpen] = useState(false);
  const rows: { name: string; what: string; tier: number }[] = [
    { name: 'Read and prepare', what: 'Research, read, draft, summarize.', tier: 1 },
    { name: 'Low-stakes saves', what: 'Labels, save to drive, internal notes.', tier: 2 },
    { name: 'Send and post', what: 'Emails, messages, public posts, meetings.', tier: 3 },
    { name: 'Money, signing, deletion', what: 'Irreversible actions.', tier: 4 },
  ];
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="inline-flex items-center gap-1 text-[11.5px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} How modes work
      </button>
      {open && (
        <div class="mt-2 space-y-1.5">
          {rows.map((r) => {
            const behavior = r.tier === 4 ? 'asks' : modeDefault(mode, r.tier) === 'always' ? 'on its own' : 'asks';
            return (
              <div key={r.name} class="flex items-start gap-2 text-[11px] leading-snug">
                <div class="flex-1 min-w-0">
                  <span class="text-[var(--color-text-muted)]">{r.name}.</span>{' '}
                  <span class="text-[var(--color-text-faint)]">{r.what}</span>
                </div>
                <span class="shrink-0 text-[var(--color-text-faint)] inline-flex items-center gap-1">
                  {r.tier === 4 && <Lock size={10} />}{behavior}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
