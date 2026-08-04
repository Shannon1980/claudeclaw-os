// Loading + error + empty states shared across data pages.

import { Logo } from './Logo';

interface Props {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function PageState({ loading, error, empty, emptyTitle, emptyDescription }: Props) {
  if (loading) {
    return (
      <div class="flex flex-col items-center justify-center gap-3 py-16 text-[var(--color-text-faint)] text-[12px]">
        <Logo size={22} class="animate-pulse" />
        <span>Loading…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div class="px-6 py-8">
        <div class="border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-failed)_8%,transparent)] rounded-lg px-4 py-3">
          <div class="text-[var(--color-status-failed)] text-[12px] font-medium mb-1 flex items-center gap-1.5">
            <Logo size={12} class="shrink-0" />
            Failed to load
          </div>
          <div class="text-[var(--color-text-muted)] text-[12px] font-mono">{error}</div>
        </div>
      </div>
    );
  }
  if (empty) {
    return (
      <div class="flex flex-col items-center justify-center py-16 px-6 text-center">
        <Logo size={28} class="mb-3 text-[var(--color-text-faint)] opacity-60" />
        <div class="text-[var(--color-text)] text-[14px] font-medium mb-1.5">{emptyTitle || 'Nothing here yet'}</div>
        {emptyDescription && (
          <div class="text-[var(--color-text-muted)] text-[12px] max-w-md">{emptyDescription}</div>
        )}
      </div>
    );
  }
  return null;
}
