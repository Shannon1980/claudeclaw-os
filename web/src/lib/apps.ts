// Quick-launch apps: pinned external tools (GitHub, Railway, Jenkins, a
// local desktop app, …) reachable from the sidebar and the command
// palette. The list is stored server-side in dashboard_settings under
// `quick_apps` so it follows the workspace, not the browser.
//
// Two kinds:
//   'url' — opened client-side via window.open. Inside the Electron
//           shell, setWindowOpenHandler routes this to shell.openExternal
//           so it lands in the real default browser.
//   'app' — a local macOS application, launched server-side via
//           POST /api/apps/launch (`open -a <name>`).

import { signal } from '@preact/signals';
import {
  Globe, AppWindow, GitBranch, TrainFront, Wrench,
  Terminal, Rocket, Server, Database,
} from 'lucide-preact';
import { apiPatch, apiPost, ApiError } from './api';
import { pushToast } from './toasts';

export type QuickAppKind = 'url' | 'app';

export interface QuickApp {
  id: string;
  name: string;
  kind: QuickAppKind;
  // URL for 'url' kind, application name (or .app path) for 'app' kind.
  // An empty target means "not configured yet" — hidden from the sidebar
  // and palette, shown in Settings with a fill-me-in hint.
  target: string;
}

// Seed list for a fresh workspace. Jenkins ships without a URL on
// purpose — instances are self-hosted, so Settings prompts for it.
export const DEFAULT_QUICK_APPS: QuickApp[] = [
  { id: 'github',         name: 'GitHub',         kind: 'url', target: 'https://github.com' },
  { id: 'railway',        name: 'Railway',        kind: 'url', target: 'https://railway.app/dashboard' },
  { id: 'jenkins',        name: 'Jenkins',        kind: 'url', target: '' },
  { id: 'repo-commander', name: 'Repo Commander', kind: 'app', target: 'Repo Commander' },
];

export const quickApps = signal<QuickApp[]>(DEFAULT_QUICK_APPS);

/** Apps that are actually launchable (configured target). */
export function launchableApps(): QuickApp[] {
  return quickApps.value.filter((a) => a.target.trim().length > 0);
}

export function hydrateQuickApps(raw: string): void {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const cleaned: QuickApp[] = [];
    for (const a of parsed) {
      if (!a || typeof a !== 'object') continue;
      if (typeof a.id !== 'string' || typeof a.name !== 'string' || typeof a.target !== 'string') continue;
      if (a.kind !== 'url' && a.kind !== 'app') continue;
      cleaned.push({ id: a.id, name: a.name, kind: a.kind, target: a.target });
    }
    quickApps.value = cleaned;
  } catch {
    // Corrupt value: keep defaults; the next save overwrites it.
  }
}

// Saves are debounced so per-keystroke edits in Settings don't fire a
// PATCH each. The signal updates immediately (optimistic).
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function setQuickApps(next: QuickApp[]): void {
  quickApps.value = next;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    apiPatch('/api/dashboard/settings', {
      key: 'quick_apps',
      value: JSON.stringify(quickApps.value),
    }).catch(() => {
      pushToast({ tone: 'error', title: 'Could not save apps', description: 'The launcher list did not persist. Try editing again.' });
    });
  }, 600);
}

export async function launchApp(app: QuickApp): Promise<void> {
  const target = app.target.trim();
  if (!target) return;
  if (app.kind === 'url') {
    // http(s) only — anything else (javascript:, file:) is refused rather
    // than handed to the OS opener.
    if (!/^https?:\/\//i.test(target)) {
      pushToast({ tone: 'warn', title: 'Invalid URL', description: `${app.name}: URL must start with http:// or https://` });
      return;
    }
    window.open(target, '_blank', 'noopener');
    return;
  }
  try {
    await apiPost('/api/apps/launch', { name: target });
  } catch (err) {
    const serverMsg = err instanceof ApiError && (err.body as { error?: string })?.error;
    pushToast({
      tone: 'error',
      title: `Could not open ${app.name}`,
      description: serverMsg || 'Is it installed on this Mac?',
    });
  }
}

/** Best-guess icon for an app by name, falling back on kind. */
export function appIcon(app: QuickApp): typeof Globe {
  const n = app.name.toLowerCase();
  if (/git(hub|lab)?|bitbucket/.test(n)) return GitBranch;
  if (n.includes('railway')) return TrainFront;
  if (/jenkins|circle|\bci\b/.test(n)) return Wrench;
  if (/term|warp|shell/.test(n)) return Terminal;
  if (/vercel|deploy|fly\b/.test(n)) return Rocket;
  if (/supabase|postgres|sql|mongo/.test(n)) return Database;
  if (/server|aws|cloud/.test(n)) return Server;
  return app.kind === 'app' ? AppWindow : Globe;
}
