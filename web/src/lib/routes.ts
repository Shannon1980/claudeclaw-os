import {
  LayoutGrid, FolderKanban, Repeat, Users, MessageSquare,
  Network, Activity, ListChecks, BookOpen,
  Swords,
  Settings,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { term, type TermKey } from './vocabulary';

export type RouteSection = 'workspace' | 'intelligence' | 'collaborate' | 'configure';

export interface RouteDef {
  path: string;
  // `label` is the builder/internal name and the fallback. Operator-facing
  // labels resolve through `vocabKey` at render time so a vocab-mode flip
  // re-labels nav without forking the route table. See lib/vocabulary.ts.
  label: string;
  vocabKey: TermKey;
  section: RouteSection;
  icon: typeof LayoutGrid;
  shortcut?: string;
}

// Single source of truth for the sidebar, command palette, and router.
// Voices used to be a top-level item; it now lives under War Room as the
// "Voice config" sub-tab and is reachable via /warroom?mode=voices.
export const ROUTES: RouteDef[] = [
  { path: '/mission',    label: 'Mission Control', vocabKey: 'nav.home',      section: 'workspace',    icon: LayoutGrid,    shortcut: 'g m' },
  { path: '/projects',   label: 'Projects',        vocabKey: 'nav.projects',  section: 'workspace',    icon: FolderKanban,  shortcut: 'g p' },
  { path: '/routines',   label: 'Routines',        vocabKey: 'nav.routines',  section: 'workspace',    icon: Repeat,        shortcut: 'g s' },
  { path: '/agents',     label: 'Agents',          vocabKey: 'nav.team',      section: 'workspace',    icon: Users,         shortcut: 'g a' },
  { path: '/chat',       label: 'Chat',            vocabKey: 'nav.chat',      section: 'workspace',    icon: MessageSquare, shortcut: 'g c' },

  { path: '/memory',     label: 'Memory',          vocabKey: 'nav.memory',    section: 'intelligence', icon: BookOpen,      shortcut: 'g e' },
  // Memories (D-02): the developer Brain Graph view is demoted OUT of the daily
  // intelligence nav. The route still exists in App.tsx for deep-linking and the
  // command palette; it is no longer a primary sidebar item. The operator-facing
  // Memory surface above (/memory) is now the daily entry point. vocabKey
  // nav.knowledge / page.knowledge are kept for the demoted view — only the
  // placement changed (mirrors the Audit D-13 demotion precedent below).
  { path: '/hive',       label: 'Hive Mind',       vocabKey: 'nav.pulse',     section: 'intelligence', icon: Network,       shortcut: 'g h' },
  { path: '/usage',      label: 'Usage',           vocabKey: 'nav.usage',     section: 'intelligence', icon: Activity,      shortcut: 'g u' },
  { path: '/activity',   label: 'Activity',        vocabKey: 'nav.activity',  section: 'intelligence', icon: ListChecks                    },
  // Audit (D-13): demoted OUT of the daily intelligence nav and into
  // Settings > Security. The route still exists in App.tsx for deep-linking
  // and the command palette; it is no longer a primary sidebar item. vocabKey
  // nav.audit / page.audit are kept — only the placement changed.

  { path: '/warroom',    label: 'War Room',        vocabKey: 'nav.warroom',   section: 'collaborate',  icon: Swords,        shortcut: 'g w' },

  { path: '/settings',   label: 'Settings',        vocabKey: 'nav.settings',  section: 'configure',    icon: Settings                  },
];

const SECTION_VOCAB: Record<RouteSection, TermKey> = {
  workspace:    'section.workspace',
  intelligence: 'section.intelligence',
  collaborate:  'section.collaborate',
  configure:    'section.configure',
};

/** Operator/builder-aware label for a route (sidebar, command palette). */
export function routeLabel(r: RouteDef): string {
  return term(r.vocabKey);
}

/** Operator/builder-aware label for a sidebar section group. */
export function sectionLabel(section: RouteSection): string {
  return term(SECTION_VOCAB[section]);
}

export const DEFAULT_ROUTE = '/mission';

// Lightly typed children helper for placeholder pages.
export type PageProps = { children?: ComponentChildren };
