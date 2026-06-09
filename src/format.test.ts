import { describe, it, expect } from 'vitest';

import { formatForSlack, splitMessage, extractFileMarkers } from './format.js';

describe('formatForSlack', () => {
  it('converts bold to single asterisks', () => {
    expect(formatForSlack('**bold**')).toBe('*bold*');
    expect(formatForSlack('__also bold__')).toBe('*also bold*');
  });

  it('converts italic to underscores', () => {
    expect(formatForSlack('*italic*')).toBe('_italic_');
    expect(formatForSlack('_italic_')).toBe('_italic_');
  });

  it('does not let the italic pass clobber converted bold', () => {
    // **b** must stay *b*, not become _b_
    expect(formatForSlack('**b** and *i*')).toBe('*b* and _i_');
  });

  it('preserves inline code and escapes inside it', () => {
    expect(formatForSlack('`a < b & c`')).toBe('`a &lt; b &amp; c`');
  });

  it('preserves fenced code blocks (stripping the language hint)', () => {
    const out = formatForSlack('```js\nconst x = 1 < 2;\n```');
    expect(out).toBe('```\nconst x = 1 &lt; 2;\n```');
  });

  it('converts markdown links to Slack link syntax', () => {
    expect(formatForSlack('[click](https://example.com)')).toBe('<https://example.com|click>');
  });

  it('converts headings to bold and strips the hashes', () => {
    expect(formatForSlack('# Title')).toBe('*Title*');
    expect(formatForSlack('### Sub')).toBe('*Sub*');
  });

  it('converts checkboxes', () => {
    expect(formatForSlack('- [x] done')).toBe('✓ done');
    expect(formatForSlack('- [ ] todo')).toBe('☐ todo');
  });

  it('converts strikethrough', () => {
    expect(formatForSlack('~~gone~~')).toBe('~gone~');
  });

  it('escapes Slack-significant entities in plain text', () => {
    expect(formatForSlack('1 < 2 && 3 > 2')).toBe('1 &lt; 2 &amp;&amp; 3 &gt; 2');
  });

  it('collapses excess blank lines', () => {
    expect(formatForSlack('a\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('splitMessage', () => {
  it('returns a single chunk when under the limit', () => {
    expect(splitMessage('hello')).toEqual(['hello']);
  });

  it('respects a custom maxLen (Slack)', () => {
    const text = 'a'.repeat(50);
    const parts = splitMessage(text, 20);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(20);
    expect(parts.join('')).toBe(text);
  });

  it('prefers splitting on newlines within the window', () => {
    const a = 'x'.repeat(15);
    const b = 'y'.repeat(15);
    const parts = splitMessage(`${a}\n${b}`, 20);
    expect(parts[0]).toBe(a);
    expect(parts[1]).toBe(b);
  });

  it('handles empty string', () => {
    expect(splitMessage('')).toEqual(['']);
  });
});

describe('extractFileMarkers', () => {
  it('extracts a bracketed SEND_FILE marker with caption', () => {
    const { text, files } = extractFileMarkers('Here you go [SEND_FILE:/tmp/a.pdf|the report]');
    expect(files).toEqual([{ type: 'document', filePath: '/tmp/a.pdf', caption: 'the report' }]);
    expect(text).toBe('Here you go');
  });

  it('extracts a SEND_PHOTO marker', () => {
    const { files } = extractFileMarkers('[SEND_PHOTO:/tmp/pic.png]');
    expect(files).toEqual([{ type: 'photo', filePath: '/tmp/pic.png', caption: undefined }]);
  });
});
