import { MAX_MESSAGE_LENGTH } from './config.js';

// ── Message formatting & chunking ─────────────────────────────────────
//
// Transport-agnostic helpers shared by every front-end (Telegram, Slack).
// `formatForTelegram` lives in bot.ts (Telegram HTML); `formatForSlack`
// lives here next to the shared `splitMessage`/`extractFileMarkers` so the
// Slack transport and the message core can import them without pulling in
// the grammY-coupled bot.ts (which would create an import cycle).

/**
 * Split a long response into transport-safe chunks.
 * Splits on newlines where possible to avoid breaking mid-sentence.
 *
 * @param text   The text to split.
 * @param maxLen Max chunk length (default Telegram's 4096). Pass a smaller
 *               value for Slack.
 */
export function splitMessage(text: string, maxLen: number = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Try to split on a newline within the limit
    const chunk = remaining.slice(0, maxLen);
    const lastNewline = chunk.lastIndexOf('\n');
    const splitAt = lastNewline > maxLen / 2 ? lastNewline : maxLen;
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

// ── File marker types ─────────────────────────────────────────────────
export interface FileMarker {
  type: 'document' | 'photo';
  filePath: string;
  caption?: string;
}

export interface ExtractResult {
  text: string;
  files: FileMarker[];
}

/**
 * Extract [SEND_FILE:path] and [SEND_PHOTO:path] markers from Claude's response.
 * Supports optional captions via pipe: [SEND_FILE:/path/to/file.pdf|Here's your report]
 *
 * Tolerant of common malformed variants observed in the wild:
 *   - Pipe used as the primary separator instead of colon
 *     ([SEND_PHOTO|https://...] or SEND_PHOTO|https://...)
 *   - Missing surrounding brackets entirely
 *   - http(s) URLs in addition to filesystem paths
 *
 * Returns the cleaned text (markers stripped) and an array of file descriptors.
 */
export function extractFileMarkers(text: string): ExtractResult {
  const files: FileMarker[] = [];

  // Canonical bracketed form: [SEND_FILE:/abs/path|caption]
  // Tolerant variants: pipe instead of colon, optional brackets, URL paths.
  // The bracketed form is preferred (it's documented in CLAUDE.md), but the
  // bare/pipe forms are recognized so a malformed agent reply still gets
  // its image rendered instead of leaking the raw command string into chat.
  const patterns: RegExp[] = [
    /\[SEND_(FILE|PHOTO)[:|]\s*([^\]|]+?)(?:\s*\|\s*([^\]]*))?\]/g,
    /(?:^|\s)SEND_(FILE|PHOTO)\s*[:|]\s*((?:https?:\/\/|\/)[^\s|\]]+)(?:\s*\|\s*([^\n]+))?/g,
  ];

  let cleaned = text;
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, (_match: string, kind: string, filePath: string, caption?: string) => {
      files.push({
        type: kind === 'PHOTO' ? 'photo' : 'document',
        filePath: filePath.trim(),
        caption: caption?.trim() || undefined,
      });
      return '';
    });
  }

  // Collapse extra blank lines left by stripped markers
  const trimmed = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return { text: trimmed, files };
}

/**
 * Convert Markdown to Slack mrkdwn.
 *
 * Slack uses its own lightweight markup, NOT standard Markdown:
 *   *bold*  _italic_  ~strike~  `code`  ```block```  <url|text>
 * and requires `&`, `<`, `>` to be escaped as HTML entities in body text.
 * Claude emits standard Markdown, so this bridges the gap the same way
 * formatForTelegram does for Telegram HTML.
 */
export function formatForSlack(text: string): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 1. Extract and protect fenced code blocks before anything else.
  const codeBlocks: string[] = [];
  let result = text.replace(/```(?:\w*\n)?([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push('```\n' + esc(String(code).trim()) + '\n```');
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });

  // 2. Extract inline code BEFORE the global escape so its contents are
  //    escaped exactly once (not twice).
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`]+)`/g, (_, code) => {
    inlineCodes.push('`' + esc(String(code)) + '`');
    return `\x00INLINE${inlineCodes.length - 1}\x00`;
  });

  // 3. Escape Slack-significant entities in the remaining text.
  result = esc(result);

  // Bold placeholder so the italic pass below doesn't clobber the single
  // asterisks that bold/headings produce.
  const bolds: string[] = [];
  const stashBold = (inner: string): string => {
    bolds.push('*' + inner + '*');
    return `\x00BOLD${bolds.length - 1}\x00`;
  };

  // 4. Headings → bold (strip the # prefix, keep the text).
  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_, t) => stashBold(t));

  // 5. Horizontal rules → remove entirely (including surrounding blank lines).
  result = result.replace(/\n*^[-*_]{3,}$\n*/gm, '\n');

  // 6. Checkboxes — handle both `- [ ]` and `- [x]` variants.
  result = result.replace(/^(\s*)-\s+\[x\]\s*/gim, '$1✓ ');
  result = result.replace(/^(\s*)-\s+\[\s\]\s*/gm, '$1☐ ');

  // 7. Bold **text** / __text__ → Slack *text*.
  result = result.replace(/\*\*([^*\n]+)\*\*/g, (_, t) => stashBold(t));
  result = result.replace(/__([^_\n]+)__/g, (_, t) => stashBold(t));

  // 8. Italic *text* / _text_ → Slack _text_.
  result = result.replace(/\*([^*\n]+)\*/g, '_$1_');
  result = result.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '_$1_');

  // 9. Strikethrough ~~text~~ → Slack ~text~.
  result = result.replace(/~~([^~\n]+)~~/g, '~$1~');

  // 10. Links [text](url) → Slack <url|text>.
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<$2|$1>');

  // 11. Restore bold, inline code, and code blocks.
  result = result.replace(/\x00BOLD(\d+)\x00/g, (_, i) => bolds[parseInt(i)]);
  result = result.replace(/\x00INLINE(\d+)\x00/g, (_, i) => inlineCodes[parseInt(i)]);
  result = result.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

  // 12. Collapse 3+ consecutive blank lines down to 2.
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}
