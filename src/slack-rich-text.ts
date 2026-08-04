// ── Markdown → Slack rich_text blocks ─────────────────────────────────
//
// `formatForSlack` (format.ts) rewrites Markdown into Slack's mrkdwn *markup*:
// the message body is still a string of `*bold*` / `_italic_` / `&amp;` that
// Slack re-parses on render. That round trip is lossy — bullets stay literal
// "- " hyphens, nested lists lose their indent, tables collapse, and any stray
// `*`, `_` or `&` in the agent's output either italicises half a paragraph or
// leaks an HTML entity into the chat.
//
// Block Kit's `rich_text` block is the structured alternative: lists are real
// list elements with indent levels, code is a real preformatted element, and
// text inside a `text` element is literal — Slack applies the `style` flags we
// set and parses nothing, so there is no escaping and nothing to mis-parse.
//
// This module converts the Markdown Claude emits into those blocks. mrkdwn is
// kept around as the notification-preview `text` and as the fallback if Slack
// ever rejects the blocks.

import type { WebClient } from '@slack/web-api';

import { formatForSlack } from './format.js';
import { logger } from './logger.js';

// ── Types (the subset of the rich_text schema we emit) ────────────────

export interface RichTextStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

export type RichTextInline =
  | { type: 'text'; text: string; style?: RichTextStyle }
  | { type: 'link'; url: string; text?: string; style?: RichTextStyle }
  | { type: 'emoji'; name: string }
  | { type: 'user'; user_id: string }
  | { type: 'channel'; channel_id: string };

export interface RichTextSection {
  type: 'rich_text_section';
  elements: RichTextInline[];
}

export type RichTextElement =
  | RichTextSection
  | { type: 'rich_text_quote'; elements: RichTextInline[] }
  | { type: 'rich_text_preformatted'; elements: RichTextInline[] }
  | {
      type: 'rich_text_list';
      style: 'bullet' | 'ordered';
      indent: number;
      offset?: number;
      elements: RichTextSection[];
    };

export interface RichTextBlock {
  type: 'rich_text';
  elements: RichTextElement[];
}

/** Slack truncates very long `text` elements; split them well below the ceiling. */
const MAX_TEXT_ELEMENT = 2800;
/** Slack's rich_text_list indent ceiling. */
const MAX_INDENT = 7;

// ── Inline parsing ────────────────────────────────────────────────────

function cleanStyle(style: RichTextStyle): RichTextStyle | undefined {
  const s: RichTextStyle = {};
  if (style.bold) s.bold = true;
  if (style.italic) s.italic = true;
  if (style.strike) s.strike = true;
  if (style.code) s.code = true;
  return Object.keys(s).length ? s : undefined;
}

function textEl(text: string, style: RichTextStyle): RichTextInline {
  const s = cleanStyle(style);
  return s ? { type: 'text', text, style: s } : { type: 'text', text };
}

/** Append text, merging into the previous element when the styling matches. */
function pushText(out: RichTextInline[], text: string, style: RichTextStyle = {}): void {
  if (!text) return;
  const last = out[out.length - 1];
  const s = cleanStyle(style);
  if (last && last.type === 'text' && JSON.stringify(last.style) === JSON.stringify(s)) {
    last.text += text;
    return;
  }
  out.push(textEl(text, style));
}

function linkEl(url: string, label: string | undefined, style: RichTextStyle): RichTextInline {
  const s = cleanStyle(style);
  return {
    type: 'link',
    url,
    ...(label && label !== url ? { text: label } : {}),
    ...(s ? { style: s } : {}),
  };
}

interface InlineRule {
  re: RegExp;
  make: (m: RegExpExecArray, style: RichTextStyle) => RichTextInline[];
}

// Order matters only for ties at the same index: the first rule wins, so the
// literal forms (code, links, mentions) come before the emphasis rules.
const INLINE_RULES: InlineRule[] = [
  { re: /`([^`\n]+)`/, make: (m, st) => [textEl(m[1], { ...st, code: true })] },
  {
    re: /\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/,
    make: (m, st) => [linkEl(m[2], m[1] || undefined, st)],
  },
  {
    re: /<(https?:\/\/[^>|\s]+)(?:\|([^>\n]*))?>/,
    make: (m, st) => [linkEl(m[1], m[2] || undefined, st)],
  },
  { re: /<@([UW][A-Z0-9]{2,})>/, make: (m) => [{ type: 'user', user_id: m[1] }] },
  { re: /<#(C[A-Z0-9]{2,})(?:\|[^>\n]*)?>/, make: (m) => [{ type: 'channel', channel_id: m[1] }] },
  { re: /(\*\*|__)(\S(?:[\s\S]*?\S)?)\1/, make: (m, st) => parseInline(m[2], { ...st, bold: true }) },
  { re: /~~(\S(?:[\s\S]*?\S)?)~~/, make: (m, st) => parseInline(m[1], { ...st, strike: true }) },
  {
    re: /(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/,
    make: (m, st) => parseInline(m[1], { ...st, italic: true }),
  },
  {
    re: /(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/,
    make: (m, st) => parseInline(m[1], { ...st, italic: true }),
  },
  {
    // Bare URL. Trailing sentence punctuation is handed back as plain text so
    // "see https://x.com." doesn't link the full stop.
    re: /(?<![\w<|([])(https?:\/\/[^\s<>()[\]]+)/,
    make: (m, st) => {
      const trail = /[.,;:!?'"]+$/.exec(m[1]);
      const url = trail ? m[1].slice(0, -trail[0].length) : m[1];
      const parts: RichTextInline[] = [linkEl(url, undefined, st)];
      if (trail) parts.push(textEl(trail[0], st));
      return parts;
    },
  },
  {
    // :shortcode: — must contain a letter so "12:30:" and "9:45:" stay text.
    re: /(?<![\w:]):(?=[a-z0-9_+-]*[a-z])([a-z0-9_+-]{1,60}):/i,
    make: (m) => [{ type: 'emoji', name: m[1].toLowerCase() }],
  },
];

/** Convert one run of Markdown inline text into rich_text inline elements. */
export function parseInline(text: string, style: RichTextStyle = {}): RichTextInline[] {
  const out: RichTextInline[] = [];
  let rest = text;

  while (rest) {
    let bestIndex = -1;
    let bestMatch: RegExpExecArray | null = null;
    let bestRule: InlineRule | null = null;

    for (const rule of INLINE_RULES) {
      const m = rule.re.exec(rest);
      if (m && (bestIndex === -1 || m.index < bestIndex)) {
        bestIndex = m.index;
        bestMatch = m;
        bestRule = rule;
      }
      if (bestIndex === 0) break;
    }

    if (!bestMatch || !bestRule) break;
    if (bestIndex > 0) pushText(out, rest.slice(0, bestIndex), style);
    for (const el of bestRule.make(bestMatch, style)) {
      if (el.type === 'text') pushText(out, el.text, (el.style ?? {}) as RichTextStyle);
      else out.push(el);
    }
    rest = rest.slice(bestIndex + bestMatch[0].length);
  }

  if (rest) pushText(out, rest, style);
  return out;
}

// ── Block parsing ─────────────────────────────────────────────────────

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const HR_RE = /^\s*([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const FENCE_RE = /^\s*(?:```|~~~)/;

function isTableSeparator(line: string): boolean {
  return /^[\s|:-]+$/.test(line) && line.includes('-') && line.includes('|');
}

/** Render a Markdown table as aligned monospace text (rich_text has no table). */
function renderTable(rows: string[]): string {
  const grid = rows.map((r) =>
    r
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim().replace(/\*\*|`|\*/g, '')),
  );
  const cols = Math.max(...grid.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(...grid.map((r) => (r[c] ?? '').length)),
  );
  const line = (cells: string[]): string =>
    Array.from({ length: cols }, (_, c) => (cells[c] ?? '').padEnd(widths[c]))
      .join('  ')
      .trimEnd();

  return [line(grid[0]), widths.map((w) => '-'.repeat(w)).join('  '), ...grid.slice(1).map(line)].join('\n');
}

interface ListItem {
  width: number;
  ordered: boolean;
  num: number;
  text: string;
}

/**
 * Turn a run of list lines into rich_text_list elements. Indent widths are
 * ranked rather than divided, so 2-space and 4-space nesting both come out as
 * levels 0, 1, 2 — and a new list element starts whenever the level or the
 * bullet/ordered style changes (that's how rich_text expresses nesting).
 */
function buildLists(items: ListItem[]): RichTextElement[] {
  const widths = [...new Set(items.map((i) => i.width))].sort((a, b) => a - b);
  const out: RichTextElement[] = [];
  let run: Extract<RichTextElement, { type: 'rich_text_list' }> | null = null;

  for (const item of items) {
    const indent = Math.min(MAX_INDENT, widths.indexOf(item.width));
    const style = item.ordered ? 'ordered' : 'bullet';
    if (!run || run.style !== style || run.indent !== indent) {
      run = { type: 'rich_text_list', style, indent, elements: [] };
      if (item.ordered && item.num > 1) run.offset = item.num - 1;
      out.push(run);
    }

    // `- [x] done` / `- [ ] todo` — rich_text has no checkbox, so glyph it.
    const box = /^\[([ xX])\]\s*(.*)$/.exec(item.text);
    const text = box ? `${box[1].toLowerCase() === 'x' ? '✓' : '☐'} ${box[2]}` : item.text;
    const elements = parseInline(text);
    run.elements.push({
      type: 'rich_text_section',
      elements: elements.length ? elements : [{ type: 'text', text: ' ' }],
    });
  }

  return out;
}

/** Split oversized text elements so no single element trips Slack's limit. */
function splitLongText(elements: RichTextInline[]): RichTextInline[] {
  const out: RichTextInline[] = [];
  for (const el of elements) {
    if (el.type !== 'text' || el.text.length <= MAX_TEXT_ELEMENT) {
      out.push(el);
      continue;
    }
    let rest = el.text;
    while (rest.length > MAX_TEXT_ELEMENT) {
      const window = rest.slice(0, MAX_TEXT_ELEMENT);
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '));
      const at = cut > MAX_TEXT_ELEMENT / 2 ? cut + 1 : MAX_TEXT_ELEMENT;
      out.push({ ...el, text: rest.slice(0, at) });
      rest = rest.slice(at);
    }
    if (rest) out.push({ ...el, text: rest });
  }
  return out;
}

/**
 * Convert Markdown into the `elements` array of a rich_text block.
 *
 * Consecutive rich_text_sections are rendered as one continuous run by Slack,
 * so paragraph breaks have to be explicit `\n` inside the section — hence the
 * trailing-newline pass at the end.
 */
export function markdownToRichTextElements(md: string): RichTextElement[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: RichTextElement[] = [];
  let para: { text: string; style: RichTextStyle }[] = [];

  const flushPara = (): void => {
    while (para.length && !para[0].text.trim()) para.shift();
    while (para.length && !para[para.length - 1].text.trim()) para.pop();
    if (!para.length) return;
    const inline: RichTextInline[] = [];
    para.forEach((ln, i) => {
      for (const el of parseInline(ln.text, ln.style)) {
        if (el.type === 'text') pushText(inline, el.text, (el.style ?? {}) as RichTextStyle);
        else inline.push(el);
      }
      if (i < para.length - 1) pushText(inline, '\n');
    });
    para = [];
    if (inline.length) out.push({ type: 'rich_text_section', elements: inline });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code → preformatted (contents stay literal).
    if (FENCE_RE.test(line)) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      const code = body.join('\n').replace(/\s+$/, '');
      if (code) out.push({ type: 'rich_text_preformatted', elements: [{ type: 'text', text: code }] });
      continue;
    }

    // Horizontal rule → dropped (rich_text has no divider inside a block).
    if (HR_RE.test(line)) {
      flushPara();
      continue;
    }

    // Table → aligned monospace block.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      const rows = [line];
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim()) rows.push(lines[j++]);
      out.push({ type: 'rich_text_preformatted', elements: [{ type: 'text', text: renderTable(rows) }] });
      i = j - 1;
      continue;
    }

    // Blockquote run.
    const quote = QUOTE_RE.exec(line);
    if (quote) {
      flushPara();
      const quoted = [quote[1]];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = QUOTE_RE.exec(lines[j]);
        if (!next) break;
        quoted.push(next[1]);
      }
      i = j - 1;
      const inline: RichTextInline[] = [];
      quoted.forEach((t, k) => {
        for (const el of parseInline(t)) {
          if (el.type === 'text') pushText(inline, el.text, (el.style ?? {}) as RichTextStyle);
          else inline.push(el);
        }
        if (k < quoted.length - 1) pushText(inline, '\n');
      });
      if (inline.length) out.push({ type: 'rich_text_quote', elements: inline });
      continue;
    }

    // List run (bullets, ordered, checkboxes, nesting).
    if (LIST_RE.test(line)) {
      flushPara();
      const items: ListItem[] = [];
      let j = i;
      for (; j < lines.length; j++) {
        const m = LIST_RE.exec(lines[j]);
        if (!m) break;
        items.push({
          width: m[1].replace(/\t/g, '  ').length,
          ordered: /\d/.test(m[2]),
          num: parseInt(m[2], 10) || 1,
          text: m[3],
        });
      }
      i = j - 1;
      out.push(...buildLists(items));
      continue;
    }

    // Heading → bold line, with a blank line above it for breathing room.
    const heading = HEADING_RE.exec(line);
    if (heading) {
      if (para.length) para.push({ text: '', style: {} });
      para.push({ text: heading[2], style: { bold: true } });
      continue;
    }

    para.push({ text: line, style: {} });
  }
  flushPara();

  // Sections concatenate, so every section followed by more content needs an
  // explicit line break of its own.
  for (let k = 0; k < out.length - 1; k++) {
    const el = out[k];
    if (el.type !== 'rich_text_section') continue;
    const last = el.elements[el.elements.length - 1];
    if (last && last.type === 'text' && !last.text.endsWith('\n')) last.text += '\n';
    else if (!last || last.type !== 'text') el.elements.push({ type: 'text', text: '\n' });
  }

  // Keep every text element inside Slack's per-element ceiling.
  for (const el of out) {
    if (el.type === 'rich_text_list') {
      for (const item of el.elements) item.elements = splitLongText(item.elements);
    } else {
      el.elements = splitLongText(el.elements);
    }
  }

  return out;
}

/**
 * Convert Markdown into Block Kit blocks. Returns `[]` for empty input so
 * callers can fall back to a plain post rather than sending an invalid block.
 */
export function markdownToBlocks(md: string): RichTextBlock[] {
  const elements = markdownToRichTextElements(md ?? '');
  return elements.length ? [{ type: 'rich_text', elements }] : [];
}

// ── Posting ───────────────────────────────────────────────────────────

/** The Web API surface the rich-text poster needs (narrow, so it's mockable). */
export type RichTextPoster = Pick<WebClient, 'chat'>;

/**
 * Post Markdown to Slack as Block Kit rich_text.
 *
 * The `text` field still carries the mrkdwn rendering: with `blocks` present
 * Slack only uses it for the notification/preview line, and it doubles as the
 * fallback body if Slack ever rejects the blocks (never drop output).
 */
export async function postRichText(
  client: RichTextPoster,
  channel: string,
  markdown: string,
  extra: Record<string, unknown> = {},
): Promise<{ ts?: string }> {
  const fallback = formatForSlack(markdown);
  const blocks = markdownToBlocks(markdown);
  if (!blocks.length) {
    const res = await client.chat.postMessage({ channel, text: fallback || markdown, ...extra });
    return { ts: res.ts as string | undefined };
  }
  try {
    const res = await client.chat.postMessage({ channel, text: fallback, blocks, ...extra });
    return { ts: res.ts as string | undefined };
  } catch (err) {
    logger.warn({ err }, 'Slack rejected rich_text blocks — falling back to mrkdwn');
    const res = await client.chat.postMessage({ channel, text: fallback, ...extra });
    return { ts: res.ts as string | undefined };
  }
}
