import { useState } from 'preact/hooks';
import { Copy, Check } from 'lucide-preact';

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path (e.g. non-secure context over http on a LAN IP)
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Icon-only copy button with a brief checkmark confirmation. */
export function CopyIconButton({
  text,
  title = 'Copy',
  size = 11,
}: {
  text: string;
  title?: string;
  size?: number;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (await writeClipboard(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
      title={copied ? 'Copied' : title}
      class="p-1 rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors shrink-0"
    >
      {copied ? <Check size={size} class="text-[var(--color-status-done)]" /> : <Copy size={size} />}
    </button>
  );
}
