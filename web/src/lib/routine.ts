// Shared types for the Routines surface. The list/detail/builder all speak the
// same shapes the /api/routines* endpoints return (src/dashboard.ts enrichRoutine,
// src/db.ts RoutineStep / RoutineRun).

export type RoutineAutonomy = 'unattended' | 'queue_approval';
export type RoutineStatus = 'active' | 'paused' | 'running';
export type StepOnError = 'continue' | 'stop';

// A routine row as enriched by GET /api/routines (never exposes raw cron as the
// operator-facing field; `schedule` is here only for the ScheduleBuilder hatch).
export interface Routine {
  id: string;
  name: string;
  schedule: string;
  next_run: number;
  last_run: number | null;
  last_status: 'success' | 'failed' | 'timeout' | null;
  status: RoutineStatus;
  autonomy: RoutineAutonomy;
  // Project scope (06-routines.md). null = unscoped. The builder/detail let the
  // operator set this; the row shows it as a pill and the list filters by it.
  project_id: string | null;
  created_at: number;
  steps: RoutineStep[];
  last_outcome: string | null;
}

export interface RoutineStep {
  id: number;
  routine_id: string;
  step_order: number;
  action: string;
  agent_id: string;
  on_error: string;
  created_at: number;
}

export interface RoutineRun {
  id: number;
  routine_id: string;
  outcome: string; // 'ok' | 'degraded' | 'failed'
  detail: string;
  output: string | null;
  step_results: string;
  ran_at: number;
}

// The editable shape used by the builder draft and the detail step editor. No
// id/routine_id/created_at, which are assigned server-side on save.
export interface DraftStep {
  action: string;
  agent_id: string;
  on_error: StepOnError;
}

// What POST /api/routines/draft returns (src/routine-draft.ts assembleRoutineDraft).
export interface RoutineDraft {
  cron: string;
  schedule_text: string;
  steps: DraftStep[];
}

export function stepToDraft(s: RoutineStep): DraftStep {
  return {
    action: s.action,
    agent_id: s.agent_id || 'main',
    on_error: s.on_error === 'stop' ? 'stop' : 'continue',
  };
}
