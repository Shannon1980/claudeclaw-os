import type { ProjectLite } from '@/components/ProjectTaskAttach';

// Controlled project picker for routines (06-routines.md "Routines scope to
// Projects"). Unlike ProjectAttachSelect (which PATCHes a mission task on
// change), this is a plain controlled select: the parent owns the value and
// decides when to persist. Empty value = unscoped. Only active projects are
// offered, but if a routine is already scoped to a now-inactive project we keep
// that option visible so the current scope never silently disappears.

interface Props {
  projects: ProjectLite[];
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}

export function ProjectSelect({ projects, value, onChange, disabled }: Props) {
  const active = projects.filter((p) => p.status === 'active');
  const current = value ? projects.find((p) => p.id === value) : undefined;
  // Keep the current scope selectable even if it's no longer active.
  const options = current && current.status !== 'active' ? [current, ...active] : active;

  return (
    <select
      value={value ?? ''}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        onChange(v === '' ? null : v);
      }}
      disabled={disabled}
      class="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] disabled:opacity-40"
    >
      <option value="">No project</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}{p.status !== 'active' ? ` (${p.status})` : ''}
        </option>
      ))}
    </select>
  );
}
