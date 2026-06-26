# Phase 06 — Deferred / Out-of-Scope Items

Items discovered during execution that are NOT caused by this phase's tasks and
were intentionally left alone (scope boundary).

## Pre-existing `web` TypeScript errors (06-03, Task 2)

`cd web && npx tsc --noEmit` reports errors in files this plan never touched.
They predate plan 06-03 and are unrelated to the Memory surface. My four edited
files (Memory.tsx, App.tsx, routes.ts, vocabulary.ts) compile clean.

- `src/components/AgentSuggestions.tsx` — possibly-null `suggestion` (TS18047/TS2345)
- `src/components/BrainGraph3D.tsx` — unused locals + `ImportMeta.env` typing (TS6133/TS2339)
- `src/pages/Activity.tsx` — unused `formatRelativeTime` import (TS6133)
- `src/pages/HiveMind.tsx` — unused `useEffect`; `boolean | undefined` props (TS6133/TS2322)
- `src/pages/Scheduled.tsx` — unused `Pencil`; `boolean | undefined` props (TS6133/TS2322/TS2345)
- `src/pages/StandupConfig.tsx` — unused `willRun` (TS6133)

Disposition: left untouched (not caused by 06-03). The plan acceptance criterion
is scoped to "no errors in Memory.tsx / App.tsx / routes.ts", which holds.
