// Memory surface provenance derivation (Phase 6, D-03 / D-05).
//
// Pure, server-side. Maps a memory's stored `source` to one of three
// operator-facing provenance tags. The API DTO and the tests share this
// helper; the Preact/web layer never imports it (it consumes the derived
// tag over the wire). Pitfall 4: "You told me" is FORWARD-stamped by the Add
// route (source='you-told-me'), never back-derived from confirmed/agent_id.

export type Provenance = 'told' | 'work' | 'email';

/**
 * Derive the operator-facing provenance tag from a memory's `source` (D-03).
 *
 * - 'you-told-me' | 'checkpoint' -> 'told'  (operator-authored)
 * - 'email'                      -> 'email' (email-sourced)
 * - everything else (default 'conversation') -> 'work' (machine-inferred)
 */
export function deriveProvenance(memory: { source: string }): Provenance {
  switch (memory.source) {
    case 'you-told-me':
    case 'checkpoint':
      return 'told';
    case 'email':
      return 'email';
    default:
      // 'conversation' and any other code-ingested source land here.
      return 'work';
  }
}

/**
 * Honest email coverage (D-05). Given the rows actually present on the
 * surface, return the set of provenance tags that may be advertised. The
 * 'email' tag is emitted ONLY when at least one email-sourced row exists —
 * there is no email ingestion pipeline this phase, so the tag must never
 * appear unless a real email row sources it. Returns [] for no rows.
 */
export function provenanceLabelsForSurface(
  rows: Array<{ source: string }>,
): Provenance[] {
  const labels = new Set<Provenance>();
  for (const row of rows) {
    labels.add(deriveProvenance(row));
  }
  // The set already excludes 'email' unless a row derived to it, so honest
  // coverage holds without a separate guard. Return in a stable order.
  const order: Provenance[] = ['told', 'work', 'email'];
  return order.filter((l) => labels.has(l));
}
