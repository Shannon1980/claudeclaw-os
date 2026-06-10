import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { collectTaskFiles, parseTaskInputFiles, parseTaskOutputFiles } from './mission-files.js';

describe('mission-files', () => {
  it('parses attached input files from prompt block', () => {
    const prompt = `Do the thing.

[Attached files]
- document: brief.docx — saved at /tmp/brief.docx
- image: chart.png — saved at /tmp/chart.png
Read and process the attached file(s) as appropriate.`;

    const files = parseTaskInputFiles({ id: 'abc', title: 'T', prompt });
    expect(files).toHaveLength(2);
    expect(files[0].direction).toBe('input');
    expect(files[0].name).toBe('brief.docx');
    expect(files[1].kind).toBe('image');
  });

  it('parses SEND_FILE markers from task result', () => {
    const tmp = path.join(os.tmpdir(), 'mission-out-test.pdf');
    fs.writeFileSync(tmp, 'pdf');
    try {
      const result = `Here is the deck.\n[SEND_FILE:${tmp}|CMMI slides]\nDone.`;
      const files = parseTaskOutputFiles({ id: 'x', title: 'Deck', result });
      expect(files).toHaveLength(1);
      expect(files[0].direction).toBe('output');
      expect(files[0].caption).toBe('CMMI slides');
      expect(files[0].exists).toBe(true);

      const collected = collectTaskFiles({ id: 'x', title: 'Deck', prompt: 'make slides', result });
      expect(collected.result_display).not.toContain('SEND_FILE');
      expect(collected.result_display).toContain('Here is the deck');
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
