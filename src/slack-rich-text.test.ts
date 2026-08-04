import { describe, it, expect, vi } from 'vitest';

import {
  markdownToBlocks,
  markdownToRichTextElements,
  parseInline,
  postRichText,
} from './slack-rich-text.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const els = (md: string): any[] => markdownToRichTextElements(md);
const first = (md: string): any => els(md)[0];
/** Flatten every text element's literal text, for "nothing leaked" assertions. */
const allText = (md: string): string =>
  JSON.stringify(els(md))
    .match(/"text":"(?:[^"\\]|\\.)*"/g)!
    .join(' ');

describe('parseInline', () => {
  it('carries emphasis as style flags, not markup characters', () => {
    expect(parseInline('a **bold** b')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'bold', style: { bold: true } },
      { type: 'text', text: ' b' },
    ]);
    expect(parseInline('*it*')).toEqual([{ type: 'text', text: 'it', style: { italic: true } }]);
    expect(parseInline('_it_')).toEqual([{ type: 'text', text: 'it', style: { italic: true } }]);
    expect(parseInline('~~no~~')).toEqual([{ type: 'text', text: 'no', style: { strike: true } }]);
    expect(parseInline('`x = 1`')).toEqual([{ type: 'text', text: 'x = 1', style: { code: true } }]);
  });

  it('nests styles instead of dropping the outer one', () => {
    expect(parseInline('**bold _and_ italic**')).toEqual([
      { type: 'text', text: 'bold ', style: { bold: true } },
      { type: 'text', text: 'and', style: { bold: true, italic: true } },
      { type: 'text', text: ' italic', style: { bold: true } },
    ]);
  });

  it('leaves literal text alone — no HTML entities to escape', () => {
    expect(parseInline('1 < 2 && 3 > 2')).toEqual([{ type: 'text', text: '1 < 2 && 3 > 2' }]);
  });

  it('does not italicise snake_case identifiers or bare asterisks', () => {
    expect(parseInline('call some_long_name(x)')).toEqual([
      { type: 'text', text: 'call some_long_name(x)' },
    ]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }]);
  });

  it('builds link elements from markdown, angle, and bare URLs', () => {
    expect(parseInline('[click](https://example.com)')).toEqual([
      { type: 'link', url: 'https://example.com', text: 'click' },
    ]);
    expect(parseInline('<https://example.com|click>')).toEqual([
      { type: 'link', url: 'https://example.com', text: 'click' },
    ]);
    expect(parseInline('see https://example.com/a.')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', url: 'https://example.com/a' },
      { type: 'text', text: '.' },
    ]);
  });

  it('keeps mentions and emoji as their own element types', () => {
    expect(parseInline('hi <@U123ABC>')).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'user', user_id: 'U123ABC' },
    ]);
    expect(parseInline('ship it :rocket:')).toEqual([
      { type: 'text', text: 'ship it ' },
      { type: 'emoji', name: 'rocket' },
    ]);
  });

  it('does not read clock times as emoji shortcodes', () => {
    expect(parseInline('at 12:30:45 today')).toEqual([{ type: 'text', text: 'at 12:30:45 today' }]);
  });
});

describe('markdownToRichTextElements', () => {
  it('renders bullets as a real list, not literal hyphens', () => {
    const el = first('- one\n- two');
    expect(el).toMatchObject({ type: 'rich_text_list', style: 'bullet', indent: 0 });
    expect(el.elements).toHaveLength(2);
    expect(el.elements[0].elements[0].text).toBe('one');
    expect(allText('- one\n- two')).not.toContain('- one');
  });

  it('renders ordered lists with the source numbering offset', () => {
    expect(first('1. a\n2. b')).toMatchObject({ type: 'rich_text_list', style: 'ordered', indent: 0 });
    expect(first('3. c')).toMatchObject({ style: 'ordered', offset: 2 });
  });

  it('turns nesting into indent levels regardless of 2- or 4-space source', () => {
    for (const md of ['- a\n  - b\n- c', '- a\n    - b\n- c']) {
      const list = els(md);
      expect(list.map((e: any) => e.indent)).toEqual([0, 1, 0]);
      expect(list.every((e: any) => e.type === 'rich_text_list')).toBe(true);
    }
  });

  it('glyphs task checkboxes', () => {
    const [done, todo] = first('- [x] shipped\n- [ ] pending').elements;
    expect(done.elements[0].text).toBe('✓ shipped');
    expect(todo.elements[0].text).toBe('☐ pending');
  });

  it('renders fenced code as preformatted with the body untouched', () => {
    const el = first('```js\nconst x = 1 < 2;\n```');
    expect(el).toMatchObject({ type: 'rich_text_preformatted' });
    expect(el.elements[0].text).toBe('const x = 1 < 2;');
  });

  it('renders blockquotes as quote elements', () => {
    const el = first('> quoted line\n> second line');
    expect(el).toMatchObject({ type: 'rich_text_quote' });
    expect(el.elements[0].text).toBe('quoted line\nsecond line');
  });

  it('renders headings as bold text and drops horizontal rules', () => {
    const el = first('# Title\n\nbody');
    expect(el.type).toBe('rich_text_section');
    expect(el.elements[0]).toEqual({ type: 'text', text: 'Title', style: { bold: true } });
    expect(allText('---\n\nbody')).not.toContain('---');
  });

  it('aligns markdown tables into a monospace block', () => {
    const el = first('| Task | Owner |\n| --- | --- |\n| Ship | Sam |');
    expect(el.type).toBe('rich_text_preformatted');
    expect(el.elements[0].text).toBe('Task  Owner\n----  -----\nShip  Sam');
  });

  it('separates a section from the block that follows it with a newline', () => {
    const [section] = els('intro line\n\n- a');
    const last = section.elements[section.elements.length - 1];
    expect(last.text.endsWith('\n')).toBe(true);
  });

  it('splits oversized text so no element trips Slack limits', () => {
    const el = first('x'.repeat(9000));
    expect(el.elements.length).toBeGreaterThan(1);
    for (const e of el.elements) expect(e.text.length).toBeLessThanOrEqual(2800);
  });

  it('handles a mixed document without losing any block', () => {
    const types = els(
      '# Report\n\nHere is the **summary**.\n\n- one\n- two\n\n> note\n\n```\ncode\n```\n\nDone.',
    ).map((e: any) => e.type);
    expect(types).toEqual([
      'rich_text_section',
      'rich_text_list',
      'rich_text_quote',
      'rich_text_preformatted',
      'rich_text_section',
    ]);
  });
});

describe('markdownToBlocks', () => {
  it('wraps the elements in a single rich_text block', () => {
    const blocks = markdownToBlocks('hello **world**');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('rich_text');
    expect(blocks[0].elements[0].type).toBe('rich_text_section');
  });

  it('returns nothing for empty input so callers can post plain instead', () => {
    expect(markdownToBlocks('')).toEqual([]);
    expect(markdownToBlocks('   \n\n  ')).toEqual([]);
  });
});

describe('postRichText', () => {
  const poster = (postMessage: any) => ({ chat: { postMessage } }) as any;

  it('posts blocks with mrkdwn as the notification text', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '1.1' });
    const res = await postRichText(poster(postMessage), 'C1', '- one\n- two', { thread_ts: '9.9' });

    const args = postMessage.mock.calls[0][0];
    expect(args.channel).toBe('C1');
    expect(args.thread_ts).toBe('9.9');
    expect(args.blocks[0].type).toBe('rich_text');
    expect(args.text).toBeTruthy();
    expect(res.ts).toBe('1.1');
  });

  it('falls back to mrkdwn when Slack rejects the blocks', async () => {
    const postMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('invalid_blocks'))
      .mockResolvedValueOnce({ ts: '2.2' });
    const res = await postRichText(poster(postMessage), 'C1', 'hello **world**');

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[1][0].blocks).toBeUndefined();
    expect(postMessage.mock.calls[1][0].text).toContain('*world*');
    expect(res.ts).toBe('2.2');
  });

  it('posts plain text when there is nothing to render as blocks', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '3.3' });
    await postRichText(poster(postMessage), 'C1', '   ');

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].blocks).toBeUndefined();
  });
});
