/**
 * Permissions config: the thin persistence layer for the autonomy mode and
 * the per-capability overrides that the gate (`gate.ts`) resolves against.
 *
 * Backed by `dashboard_settings` (the system's restart-safe k/v config store)
 * under two keys:
 *   - `permissions.mode`      → 'cautious' | 'balanced' | 'autonomous'
 *   - `permissions.overrides` → JSON object keyed by capability id, value
 *                               'always' | 'ask'
 *
 * Default mode is 'balanced' on first run (D-11). Every mutation is recorded
 * as a `permission` audit config event. Audit detail carries ONLY the config
 * change (event + value) — never env/secrets (L-4 / ASVS V8).
 */

import {
  getDashboardSetting,
  setDashboardSetting,
  getAuditRetentionDays,
  setAuditRetentionDays as setAuditRetentionDaysStored,
} from './db.js';
import { audit } from './security.js';

export type Mode = 'cautious' | 'balanced' | 'autonomous';

/** Per-capability override value. */
export type OverrideValue = 'always' | 'ask';

const MODE_KEY = 'permissions.mode';
const OVERRIDES_KEY = 'permissions.overrides';

/**
 * Current autonomy mode. Defaults to 'balanced' when `permissions.mode` is
 * unset (D-11). The stored value is trusted to be a valid Mode (writes go
 * through setMode / a validated API route).
 */
export function getMode(): Mode {
  const stored = getDashboardSetting(MODE_KEY);
  return (stored as Mode | null) ?? 'balanced';
}

/**
 * Persist the autonomy mode and record a config-change audit event (D-11).
 * Detail carries only the event name and mode — no secrets.
 */
export function setMode(mode: Mode, agentId = 'main'): void {
  setDashboardSetting(MODE_KEY, mode);
  audit({
    agentId,
    chatId: '',
    action: 'permission',
    detail: JSON.stringify({ event: 'mode_change', mode }),
    blocked: false,
  });
}

/**
 * Per-capability overrides as a plain object. Malformed stored JSON falls
 * back to `{}` without throwing (the gate must never brick on bad config).
 */
export function getOverrides(): Record<string, OverrideValue> {
  try {
    const parsed = JSON.parse(getDashboardSetting(OVERRIDES_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, OverrideValue>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Merge a single capability override into the stored object and record a
 * config-change audit event. Detail carries only the capability + value.
 */
export function setOverride(capability: string, value: OverrideValue, agentId = 'main'): void {
  const next = { ...getOverrides(), [capability]: value };
  setDashboardSetting(OVERRIDES_KEY, JSON.stringify(next));
  audit({
    agentId,
    chatId: '',
    action: 'permission',
    detail: JSON.stringify({ event: 'override_change', capability, value }),
    blocked: false,
  });
}

// ── Audit retention window (Phase 5, AUD-02 / D-31) ─────────────────────
//
// The storage primitives live in db.ts (validated, pure, no audit) so the data
// layer owns the dashboard_settings key. This module mirrors setMode/setOverride
// by wrapping the write with a config-change audit event for the dashboard's
// Security settings route. D-31: the window is STATED, never pruned — nothing
// here (or anywhere) deletes audit rows.

/** Current audit retention window in days. Defaults to 90 when unset. */
export { getAuditRetentionDays };

/**
 * Persist the audit retention window and record a config-change audit event,
 * mirroring setMode. Non-positive / non-integer input is rejected by the stored
 * setter (read falls back to the default 90); the audit event is only emitted
 * for an accepted value. Detail carries only the event name and day count.
 */
export function setAuditRetention(days: number, agentId = 'main'): void {
  if (!Number.isInteger(days) || days <= 0) return;
  setAuditRetentionDaysStored(days);
  audit({
    agentId,
    chatId: '',
    action: 'permission',
    detail: JSON.stringify({ event: 'retention_change', days }),
    blocked: false,
  });
}
