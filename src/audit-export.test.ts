// Unit tests for the audit-log export serializers (Phase 5, AUD-02 — Wave 0 RED).
//
// Why this exists: `/api/audit/export` streams the complete filtered audit set
// as a downloadable file in CSV and JSON. The CSV path is the one genuinely
// net-new piece of logic in this phase (no CSV library is installed), and it is
// security-sensitive: audit_log.detail is free-text and WILL contain commas,
// quotes, and newlines, and a leading `= + - @` cell executes as a formula when
// the file is opened in Excel (CSV injection, Pitfall 3 / ASVS V8).
//
// These cases are RED on purpose: `toCsv` is not yet exported from dashboard.ts.
// Plan 03 exports it there and turns these GREEN. The serializer MUST be:
//   - RFC-4180 compliant: quote any field containing `, " \n \r`; escape an
//     embedded `"` by doubling it (`""`); leave plain fields unquoted.
//   - Formula-injection safe: prefix any cell whose value starts with
//     `= + - @` with a single quote `'`, AND still RFC-4180-quote it if needed.

import { describe, it, expect } from 'vitest';
// RED: toCsv is not exported yet. Plan 03 adds it to src/dashboard.ts.
import { toCsv } from './dashboard.js';

// Parse a single-line CSV record into its decoded fields, honoring RFC-4180
// quoting/escaping. Kept deliberately small — just enough to assert the
// serializer's output round-trips back to the intended field values.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    let field = '';
    if (line[i] === '"') {
      i++; // opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // closing quote
          break;
        } else {
          field += line[i++];
        }
      }
    } else {
      while (i < line.length && line[i] !== ',') field += line[i++];
    }
    fields.push(field);
    if (line[i] === ',') i++;
  }
  return fields;
}

describe('toCsv serializer (RFC-4180 + formula-injection safe)', () => {
  it('emits a normal field unquoted', () => {
    const csv = toCsv([{ action: 'message' }]);
    const lines = csv.replace(/\r\n/g, '\n').trim().split('\n');
    // line 0 is the header row, line 1 the data row
    const dataLine = lines[lines.length - 1];
    expect(dataLine).toBe('message');
  });

  it('quotes a field containing a comma', () => {
    const csv = toCsv([{ detail: 'sent to a, b, c' }]);
    const dataLine = csv.replace(/\r\n/g, '\n').trim().split('\n').pop() as string;
    expect(dataLine.startsWith('"')).toBe(true);
    expect(parseCsvLine(dataLine)[0]).toBe('sent to a, b, c');
  });

  it('doubles an embedded double-quote and quotes the field', () => {
    const csv = toCsv([{ detail: 'he said "hi"' }]);
    const dataLine = csv.replace(/\r\n/g, '\n').trim().split('\n').pop() as string;
    expect(dataLine).toContain('""'); // doubled quote escaping
    expect(parseCsvLine(dataLine)[0]).toBe('he said "hi"');
  });

  it('quotes a field containing a newline or carriage return', () => {
    const csvN = toCsv([{ detail: 'line1\nline2' }]);
    expect(csvN).toContain('"line1\nline2"');

    const csvR = toCsv([{ detail: 'line1\rline2' }]);
    expect(csvR).toContain('"line1\rline2"');
  });

  it('prefixes a leading =, +, -, or @ cell with a single quote (formula-injection neutralization)', () => {
    for (const lead of ['=', '+', '-', '@']) {
      const csv = toCsv([{ detail: `${lead}CMD()` }]);
      const dataLine = csv.replace(/\r\n/g, '\n').trim().split('\n').pop() as string;
      const decoded = parseCsvLine(dataLine)[0];
      expect(decoded.startsWith("'"), `cell starting with "${lead}" must be neutralized`).toBe(true);
      expect(decoded).toBe(`'${lead}CMD()`);
    }
  });

  it('handles one cell containing comma AND quote AND newline AND a leading "=" — both RFC-4180 quoted and injection-prefixed', () => {
    const nasty = '=cmd("a", "b")\nrow2';
    const csv = toCsv([{ detail: nasty }]);
    const body = csv.replace(/^[^\n\r]*\r?\n/, ''); // drop header row
    const decoded = parseCsvLine(body)[0];
    // The serialized field must be wrapped in quotes (contains comma/quote/newline)…
    expect(body.trimStart().startsWith('"')).toBe(true);
    // …and the decoded value must be the original prefixed with a single quote.
    expect(decoded).toBe(`'${nasty}`);
  });
});

describe('audit export JSON envelope shape', () => {
  it('is an object with exported_at, count, and rows (array)', async () => {
    // RED: the JSON envelope builder is not exported yet. Plan 03 exports a
    // helper (toJsonEnvelope) returning { exported_at, count, rows }. Until
    // then this import is undefined and the assertions fail.
    const { toJsonEnvelope } = await import('./dashboard.js');
    const rows = [{ action: 'message', detail: 'hi' }];
    const env = toJsonEnvelope(rows);

    expect(env).toHaveProperty('exported_at');
    expect(env).toHaveProperty('count', rows.length);
    expect(Array.isArray(env.rows)).toBe(true);
    expect(env.rows).toHaveLength(rows.length);
  });
});
