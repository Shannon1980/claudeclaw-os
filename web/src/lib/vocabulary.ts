// Shared vocabulary string-map (operator-product foundations, 01-foundations.md).
//
// "Every screen uses the right column, never the left." The operator product and
// the builder/advanced mode swap labels through this one map so screens never
// fork. Operator mode is the default; builder mode shows the internal terms.
//
// Per-browser preference, backed by localStorage like theme.ts (this is a
// display choice, not shared state). Reading `term(...)` inside a component's
// render subscribes it to vocabMode, so a mode flip re-labels the UI live.

import { signal, effect } from '@preact/signals';

export type VocabMode = 'operator' | 'builder';

const STORAGE_KEY = 'claudeclaw.vocabMode';

function loadInitial(): VocabMode {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === 'operator' || s === 'builder') return s;
  } catch {}
  return 'operator';
}

export const vocabMode = signal<VocabMode>(loadInitial());

effect(() => {
  try {
    localStorage.setItem(STORAGE_KEY, vocabMode.value);
  } catch {}
});

export function setVocabMode(next: VocabMode): void {
  vocabMode.value = next;
}

export function toggleVocabMode(): void {
  vocabMode.value = vocabMode.value === 'operator' ? 'builder' : 'operator';
}

// The map. Left = builder/internal term, surfaced verbatim in builder mode;
// right = operator-facing term. Keys are grouped: nav.* (sidebar + palette),
// section.* (sidebar groups), page.* (screen headers), noun.* (reusable words).
type Pair = { operator: string; builder: string };

export const TERMS = {
  // Navigation (paths stay stable; only labels change).
  'nav.home':      { operator: 'Home',        builder: 'Mission Control' },
  'nav.projects':  { operator: 'Projects',    builder: 'Projects' },
  'nav.routines':  { operator: 'Routines',    builder: 'Scheduled' },
  'nav.team':      { operator: 'Team',        builder: 'Agents' },
  'nav.chat':      { operator: 'Chat',        builder: 'Chat' },
  'nav.knowledge': { operator: 'Knowledge',   builder: 'Memories' },
  'nav.pulse':     { operator: 'Team pulse',  builder: 'Hive Mind' },
  'nav.usage':     { operator: 'Usage',       builder: 'Usage' },
  'nav.activity':  { operator: 'Activity',    builder: 'Activity' },
  'nav.audit':     { operator: 'Audit',       builder: 'Audit' },
  'nav.warroom':   { operator: 'War room',    builder: 'War Room' },
  'nav.settings':  { operator: 'Settings',    builder: 'Settings' },

  // Sidebar section groups (kept distinct from their child item labels).
  'section.workspace':    { operator: 'Your work',  builder: 'Workspace' },
  'section.intelligence': { operator: 'Oversight',  builder: 'Intelligence' },
  'section.collaborate':  { operator: 'Together',   builder: 'Collaborate' },
  'section.configure':    { operator: 'Manage',     builder: 'Configure' },

  // Screen headers (can differ from the short nav label).
  'page.home':      { operator: 'Home',                        builder: 'Mission Control' },
  'page.team':      { operator: 'Your team',                   builder: 'Agents' },
  'page.routines':  { operator: 'Routines',                    builder: 'Scheduled' },
  'page.activity':  { operator: 'Activity',                    builder: 'Activity' },
  'page.audit':     { operator: 'Audit',                       builder: 'Audit' },
  'page.pulse':     { operator: 'Team pulse',                  builder: 'Hive Mind' },
  'page.knowledge': { operator: 'What your assistant knows',   builder: 'Memories' },
  'page.permissions': { operator: 'Permissions',               builder: 'Permissions' },

  // Reusable nouns for in-screen copy and palette actions.
  'noun.teammate':       { operator: 'teammate',        builder: 'agent' },
  'noun.team':           { operator: 'team',            builder: 'agents' },
  'noun.brain':          { operator: 'brain',           builder: 'model' },
  'noun.instructions':   { operator: 'instructions',    builder: 'CLAUDE.md' },
  'noun.connectedTools': { operator: 'connected tools', builder: 'MCP servers' },
  'noun.workspace':      { operator: 'workspace',       builder: 'project directory' },
  'noun.routine':        { operator: 'routine',         builder: 'scheduled task' },

  // Palette action labels.
  'action.newTask':     { operator: 'New task',     builder: 'New mission task' },
  'action.addTeammate': { operator: 'Add teammate', builder: 'Create new agent' },
} as const satisfies Record<string, Pair>;

export type TermKey = keyof typeof TERMS;

/** Resolve a term in the active vocabulary mode. Call inside render for live
 *  re-labeling on mode change. */
export function term(key: TermKey): string {
  return TERMS[key][vocabMode.value];
}
