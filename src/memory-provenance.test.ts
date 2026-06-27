// Phase 6 Memory Surface (Wave 0 RED — MEM-02 / D-03 / D-05).
//
// Pins the EXACT provenance derivation contract before any implementation
// exists. deriveProvenance is a pure server-side function mapping a memory's
// stored `source` (+ confirmed/agent_id where relevant) to one of three
// operator-facing tags: 'told' | 'work' | 'email'. The surface label set is
// gated by honest coverage (D-05): the 'email' tag is emitted ONLY when at
// least one email-sourced row actually exists.
//
// RED on purpose: ./memory-provenance.js does not exist yet, so the import
// itself fails to resolve. Plan 02 authors src/memory-provenance.ts and turns
// these GREEN.

import { describe, it, expect } from 'vitest';

import {
  deriveProvenance,
  provenanceLabelsForSurface,
} from './memory-provenance.js';

// Minimal row shape the derivation reads. The real Memory row carries more,
// but provenance is derived only from source (+ confirmed for the operator
// rule). Keep the fixture tight so the contract is unambiguous.
function row(overrides: Record<string, unknown> = {}) {
  return {
    source: 'conversation',
    confirmed: 0,
    agent_id: 'main',
    ...overrides,
  };
}

describe('deriveProvenance (D-03 source -> operator tag)', () => {
  it("maps source 'you-told-me' -> 'told' (operator-authored, forward-stamped by the Add route)", () => {
    expect(deriveProvenance(row({ source: 'you-told-me', confirmed: 1 }))).toBe('told');
  });

  it("maps source 'checkpoint' -> 'told' (operator ran checkpoint, operator-authored by nature)", () => {
    expect(deriveProvenance(row({ source: 'checkpoint' }))).toBe('told');
  });

  it("maps source 'conversation' -> 'work' (machine-inferred from a turn, the default)", () => {
    expect(deriveProvenance(row({ source: 'conversation' }))).toBe('work');
  });

  it("maps source 'email' -> 'email'", () => {
    expect(deriveProvenance(row({ source: 'email' }))).toBe('email');
  });
});

describe('provenanceLabelsForSurface (D-05 honest email coverage)', () => {
  it("omits 'email' from the surface label set when NO email-sourced row exists", () => {
    const rows = [
      row({ source: 'conversation' }),
      row({ source: 'you-told-me', confirmed: 1 }),
      row({ source: 'checkpoint' }),
    ];
    const labels = provenanceLabelsForSurface(rows);
    expect(labels).toContain('told');
    expect(labels).toContain('work');
    // No email pipeline this phase: the tag must not appear when no row sources it.
    expect(labels).not.toContain('email');
  });

  it("includes 'email' ONLY when at least one email-sourced row is present", () => {
    const rows = [
      row({ source: 'conversation' }),
      row({ source: 'email' }),
    ];
    const labels = provenanceLabelsForSurface(rows);
    expect(labels).toContain('email');
    expect(labels).toContain('work');
  });

  it('returns an empty label set for no rows (nothing to advertise)', () => {
    expect(provenanceLabelsForSurface([])).toEqual([]);
  });
});
