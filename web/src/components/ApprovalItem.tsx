// A gated-action approval row (PERM-04, D-07/D-08) rendered INSIDE the existing
// NeedsYouCard (DailyLoop) — a sibling to NeedsItem, never a parallel card.
//
// "Ask first is cheap": the action is already prepared. Approve replays the
// captured tool call (the server runs it, D-08) and reports the result; on
// replay failure the row shows the honest verbatim reason, never a generic
// error. Deny discards it. Tier 4 deny goes through a destructive ConfirmModal;
// Tier 3 deny is one tap.

import { useState } from 'preact/hooks';
import { CheckCircle2, X } from 'lucide-preact';
import { Pill } from '@/components/Pill';
import { AgentAvatar } from '@/components/AgentAvatar';
import { ConfirmModal } from '@/components/ConfirmModal';
import { type Agent } from '@/components/TaskModals';
import { apiPost } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { pushToast } from '@/lib/toasts';

export interface Approval {
  id: number;
  agent_id: string;
  tool_name: string;
  tier: number;
  mode_at_decision: string;
  summary: string;
  // Scrubbed, length-capped preview of the action (e.g. the Bash command, the
  // file a Write touches). Server-side secret-safe; null when nothing safe to show.
  target: string | null;
  status: string;
  run_id: string | null;
  routine_id: string | null;
  created_at: number;
}

export function ApprovalItem({ approval, agent, onChange }: {
  approval: Approval;
  agent?: Agent;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmDeny, setConfirmDeny] = useState(false);
  const isTier4 = approval.tier >= 4;
  const teammate = agent?.name || approval.agent_id;

  async function approveNow() {
    setBusy('approve');
    setFailure(null);
    try {
      const res = await apiPost<{ ok: boolean; replayed?: boolean; result?: string }>(
        `/api/approvals/${approval.id}/approve`,
      );
      if (res.ok && res.replayed !== false) {
        pushToast({ tone: 'success', title: 'Sent', description: res.result || 'Done.' });
        onChange();
      } else {
        // The transition happened but the replay itself failed — show the
        // honest verbatim reason, do not silently claim success.
        const reason = res.result || 'Could not complete this action.';
        setFailure(reason);
        pushToast({ tone: 'error', title: 'Could not send', description: reason, durationMs: 6000 });
        onChange();
      }
    } catch (err: any) {
      const reason = err?.body?.error || err?.message || String(err);
      setFailure(reason);
      pushToast({ tone: 'error', title: 'Could not send', description: reason, durationMs: 6000 });
    } finally {
      setBusy(null);
    }
  }

  async function denyNow() {
    setBusy('deny');
    try {
      await apiPost(`/api/approvals/${approval.id}/deny`);
      pushToast({ tone: 'success', title: 'Discarded', description: 'Nothing was sent.' });
      onChange();
    } catch (err: any) {
      pushToast({ tone: 'error', title: 'Could not discard', description: err?.message || String(err), durationMs: 6000 });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-md p-3">
      <div class="flex items-center gap-1.5 mb-1">
        <Pill tone={isTier4 ? 'medium' : 'neutral'}>{isTier4 ? 'High stakes' : 'Needs ok'}</Pill>
        <span class="ml-auto text-[10px] text-[var(--color-text-faint)] tabular-nums">
          {formatRelativeTime(approval.created_at)}
        </span>
      </div>

      <div class="text-[12.5px] text-[var(--color-text)] leading-snug mb-1 line-clamp-2">
        {approval.summary || 'A prepared action needs your ok.'}
      </div>

      {approval.target && (
        <div class="text-[10.5px] text-[var(--color-text-muted)] font-mono leading-snug bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-1.5 py-1 mb-2 whitespace-pre-wrap break-all line-clamp-4">
          {approval.target}
        </div>
      )}

      <div class="flex items-center gap-1.5 mb-2 text-[11px] text-[var(--color-text-muted)]">
        <AgentAvatar agentId={approval.agent_id} name={teammate} size={16} />
        <span class="truncate">{teammate} prepared this</span>
      </div>

      {failure && (
        <div class="text-[10.5px] text-[var(--color-status-failed)] font-mono line-clamp-2 mb-2">{failure}</div>
      )}

      <div class="flex items-center gap-1.5">
        <button
          type="button"
          onClick={approveNow}
          disabled={busy !== null}
          class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
        >
          <CheckCircle2 size={13} /> {busy === 'approve' ? '…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => { if (isTier4) setConfirmDeny(true); else void denyNow(); }}
          disabled={busy !== null}
          class="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-status-failed)] transition-colors disabled:opacity-40"
        >
          <X size={13} /> {busy === 'deny' ? '…' : 'Deny'}
        </button>
      </div>

      <ConfirmModal
        open={confirmDeny}
        onClose={() => setConfirmDeny(false)}
        onConfirm={() => void denyNow()}
        title="Deny this?"
        body="Nothing will be sent."
        confirmLabel="Deny"
        destructive
      />
    </div>
  );
}
