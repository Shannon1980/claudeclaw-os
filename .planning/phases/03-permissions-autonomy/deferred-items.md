# Deferred Items — Phase 03 Permissions & Autonomy

Out-of-scope discoveries logged during execution. NOT fixed by this plan (they
predate it and live in files this plan did not author).

## Pre-existing web/tsconfig.json type errors (not in the build pipeline)

The official build is `vite build && tsc` where `tsc` uses the **root** tsconfig
(server). `web/tsconfig.json` is not invoked by any build/CI script, and Vite
(esbuild) transpiles the web app without full type-checking. Running
`tsc -p web/tsconfig.json` surfaces pre-existing errors in files untouched by
plan 03-04:

- `web/src/components/BrainGraph3D.tsx` — `import.meta.env` typing, unused `i`.
- `web/src/pages/HiveMind.tsx` — unused `useEffect`, `boolean | undefined` props.
- `web/src/pages/Scheduled.tsx` — unused `Pencil`, `boolean | undefined` args.
- `web/src/pages/StandupConfig.tsx` — unused `willRun`.

All Phase 3 web files (AutonomyModeSelector, ActionOverrideRow, LockedActionRow,
ApprovalItem, Settings, Home, DailyLoop, vocabulary) are type-clean under that
same tsconfig.

## Pre-existing flaky test (documented in 03-03-SUMMARY)

- `src/chat-task-tracker.test.ts` "returns null when the classifier fails" —
  the Claude/Gemini classifier fallback returns a task id in this environment
  instead of null. Does not import any module changed by 03-04.
