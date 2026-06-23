// Fixed teammate accent colors (operator-product spec): Research purple, Comms
// teal, Content coral, Ops amber. Matched on id substring so renamed teammates
// keep their color; anything unmatched falls back to the app accent.
//
// Extracted from Team.tsx so the Routines surface (TeammateTag) and the Team
// roster share one source of truth rather than forking the palette.

export function teammateColor(id: string): string {
  const k = id.toLowerCase();
  if (k.includes('research')) return '#a78bfa';
  if (k.includes('comms')) return '#2dd4bf';
  if (k.includes('content')) return '#fb7185';
  if (k.includes('ops')) return '#f59e0b';
  return 'var(--color-accent)';
}
