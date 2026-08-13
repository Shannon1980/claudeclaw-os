/**
 * Channel pairing — OpenClaw-style sender admission.
 *
 * Env allowlists (ALLOWED_SLACK_USER_ID / ALLOWED_CHAT_ID) still bootstrap
 * the first operator. After that, an unknown sender gets a short pairing
 * code instead of a silent drop. An already-approved operator runs
 * `/pair CODE` (or the dashboard) to approve or deny.
 *
 * First sender on a channel with no owner is auto-approved (bootstrap).
 * Subsequent senders stay pending until an operator decides.
 *
 * Status-guarded transitions (same shape as approval_queue): approve/deny
 * only fire WHERE status='pending', so a double-click cannot flip twice.
 */

import crypto from 'crypto';

import { ALLOWED_CHAT_ID, ALLOWED_DISCORD_USER_ID, ALLOWED_SLACK_USER_ID, ENV_FILE } from './config.js';
import { getDb } from './db.js';
import { setEnvKey } from './env-write.js';
import { logger } from './logger.js';
import { audit } from './security.js';
import type { ChannelId } from './channel.js';

export type PairingStatus = 'pending' | 'approved' | 'denied';

export interface PairingRow {
  id: number;
  channel: ChannelId;
  sender_id: string;
  display_name: string;
  status: PairingStatus;
  pairing_code: string;
  created_at: number;
  decided_at: number | null;
  last_seen_at: number;
}

export type AdmitDecision = 'allow' | 'pending' | 'deny' | 'bootstrap';

export interface AdmitResult {
  decision: AdmitDecision;
  pairing?: PairingRow;
  /** What to tell the sender. Empty for silent deny. */
  senderMessage: string;
  /** What to tell the already-approved operator, if any. */
  operatorMessage: string;
}

const TEXT_CAP = 200;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;

const ENV_KEY: Record<ChannelId, string | undefined> = {
  slack: 'ALLOWED_SLACK_USER_ID',
  telegram: 'ALLOWED_CHAT_ID',
  discord: 'ALLOWED_DISCORD_USER_ID',
  whatsapp: undefined,
};

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function cap(value: string | undefined): string {
  return (value ?? '').slice(0, TEXT_CAP);
}

function envOwnerId(channel: ChannelId): string {
  if (channel === 'slack') return ALLOWED_SLACK_USER_ID;
  if (channel === 'telegram') return ALLOWED_CHAT_ID;
  if (channel === 'discord') return ALLOWED_DISCORD_USER_ID;
  return '';
}

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LEN);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

function uniqueCode(): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateCode();
    const hit = getDb()
      .prepare(`SELECT id FROM channel_pairings WHERE pairing_code = ?`)
      .get(code) as { id: number } | undefined;
    if (!hit) return code;
  }
  // Last resort: timestamp suffix keeps the UNIQUE(pairing_code) insert from colliding.
  return (generateCode().slice(0, 4) + nowSec().toString(36).slice(-2)).toUpperCase();
}

function rowFromRaw(raw: Record<string, unknown>): PairingRow {
  return {
    id: Number(raw.id),
    channel: raw.channel as ChannelId,
    sender_id: String(raw.sender_id),
    display_name: String(raw.display_name ?? ''),
    status: raw.status as PairingStatus,
    pairing_code: String(raw.pairing_code),
    created_at: Number(raw.created_at),
    decided_at: raw.decided_at == null ? null : Number(raw.decided_at),
    last_seen_at: Number(raw.last_seen_at),
  };
}

function safeDb<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function getPairing(channel: ChannelId, senderId: string): PairingRow | undefined {
  return safeDb(() => {
    const raw = getDb()
      .prepare(`SELECT * FROM channel_pairings WHERE channel = ? AND sender_id = ?`)
      .get(channel, senderId) as Record<string, unknown> | undefined;
    return raw ? rowFromRaw(raw) : undefined;
  }, undefined);
}

export function getPairingByCode(code: string): PairingRow | undefined {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return undefined;
  return safeDb(() => {
    const raw = getDb()
      .prepare(`SELECT * FROM channel_pairings WHERE pairing_code = ?`)
      .get(normalized) as Record<string, unknown> | undefined;
    return raw ? rowFromRaw(raw) : undefined;
  }, undefined);
}

export function getPairingById(id: number): PairingRow | undefined {
  return safeDb(() => {
    const raw = getDb()
      .prepare(`SELECT * FROM channel_pairings WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return raw ? rowFromRaw(raw) : undefined;
  }, undefined);
}

export function hasApprovedPairing(channel: ChannelId): boolean {
  return safeDb(() => {
    const row = getDb()
      .prepare(
        `SELECT id FROM channel_pairings WHERE channel = ? AND status = 'approved' LIMIT 1`,
      )
      .get(channel) as { id: number } | undefined;
    return !!row;
  }, false);
}

export function isApprovedSender(channel: ChannelId, senderId: string | undefined): boolean {
  if (!senderId) return false;
  if (envOwnerId(channel) && senderId === envOwnerId(channel)) return true;
  return getPairing(channel, senderId)?.status === 'approved';
}

export function isChannelOwnerConfigured(channel: ChannelId): boolean {
  return !!envOwnerId(channel) || hasApprovedPairing(channel);
}

export function listPairings(status?: PairingStatus): PairingRow[] {
  return safeDb(() => {
    const rows = status
      ? (getDb()
          .prepare(
            `SELECT * FROM channel_pairings WHERE status = ? ORDER BY created_at DESC, id DESC`,
          )
          .all(status) as Record<string, unknown>[])
      : (getDb()
          .prepare(`SELECT * FROM channel_pairings ORDER BY created_at DESC, id DESC`)
          .all() as Record<string, unknown>[]);
    return rows.map(rowFromRaw);
  }, []);
}

function touchLastSeen(id: number): void {
  try {
    getDb().prepare(`UPDATE channel_pairings SET last_seen_at = ? WHERE id = ?`).run(nowSec(), id);
  } catch {
    /* non-fatal */
  }
}

function upsertApproved(channel: ChannelId, senderId: string, displayName: string): PairingRow {
  const existing = getPairing(channel, senderId);
  const ts = nowSec();
  if (existing) {
    if (existing.status !== 'approved') {
      getDb()
        .prepare(
          `UPDATE channel_pairings
             SET status = 'approved', decided_at = ?, last_seen_at = ?, display_name = ?
           WHERE id = ?`,
        )
        .run(ts, ts, cap(displayName) || existing.display_name, existing.id);
    } else {
      touchLastSeen(existing.id);
    }
    return getPairingById(existing.id)!;
  }
  const code = uniqueCode();
  const result = getDb()
    .prepare(
      `INSERT INTO channel_pairings
         (channel, sender_id, display_name, status, pairing_code, created_at, decided_at, last_seen_at)
       VALUES (?, ?, ?, 'approved', ?, ?, ?, ?)`,
    )
    .run(channel, senderId, cap(displayName), code, ts, ts, ts);
  return getPairingById(Number(result.lastInsertRowid))!;
}

function insertPending(channel: ChannelId, senderId: string, displayName: string): PairingRow {
  const ts = nowSec();
  const code = uniqueCode();
  const result = getDb()
    .prepare(
      `INSERT INTO channel_pairings
         (channel, sender_id, display_name, status, pairing_code, created_at, last_seen_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(channel, senderId, cap(displayName), code, ts, ts);
  return getPairingById(Number(result.lastInsertRowid))!;
}

function pendingMessages(row: PairingRow): { senderMessage: string; operatorMessage: string } {
  const who = row.display_name ? `${row.display_name} (${row.sender_id})` : row.sender_id;
  return {
    senderMessage:
      `This assistant is locked to its operator. Your pairing code is ${row.pairing_code}. ` +
      `Ask them to send /pair ${row.pairing_code}.`,
    operatorMessage:
      `New pairing request on ${row.channel}: ${who}. Approve with /pair ${row.pairing_code} ` +
      `or deny with /pair deny ${row.pairing_code}.`,
  };
}

/**
 * Decide what to do with an inbound sender. Idempotent: a pending sender
 * keeps the same code; an approved sender is just allowed through.
 */
export function admitSender(input: {
  channel: ChannelId;
  senderId: string;
  displayName?: string;
}): AdmitResult {
  const senderId = (input.senderId || '').trim();
  if (!senderId) {
    return { decision: 'deny', senderMessage: '', operatorMessage: '' };
  }
  const displayName = cap(input.displayName);

  const envId = envOwnerId(input.channel);
  if (envId && senderId === envId) {
    const pairing = safeDb(
      () => upsertApproved(input.channel, senderId, displayName || 'env bootstrap'),
      undefined,
    );
    return { decision: 'allow', pairing, senderMessage: '', operatorMessage: '' };
  }

  const existing = getPairing(input.channel, senderId);
  if (existing?.status === 'approved') {
    touchLastSeen(existing.id);
    return { decision: 'allow', pairing: existing, senderMessage: '', operatorMessage: '' };
  }
  if (existing?.status === 'denied') {
    return { decision: 'deny', pairing: existing, senderMessage: '', operatorMessage: '' };
  }
  if (existing?.status === 'pending') {
    touchLastSeen(existing.id);
    const msgs = pendingMessages(existing);
    return { decision: 'pending', pairing: existing, ...msgs };
  }

  // No row yet. First operator on an unowned channel is auto-approved.
  if (!isChannelOwnerConfigured(input.channel)) {
    const pairing = safeDb(
      () => upsertApproved(input.channel, senderId, displayName || 'first operator'),
      undefined,
    );
    audit({
      agentId: 'main',
      chatId: `${input.channel}:${senderId}`,
      action: 'auth',
      detail: `bootstrap pairing on ${input.channel} for ${senderId}`,
      blocked: false,
      eventType: 'pairing_bootstrap',
      target: senderId,
      decision: 'approved',
    });
    return {
      decision: 'bootstrap',
      pairing,
      senderMessage: 'You are the operator for this channel. I saved the lock.',
      operatorMessage: '',
    };
  }

  const pairing = insertPending(input.channel, senderId, displayName);
  const msgs = pendingMessages(pairing);
  audit({
    agentId: 'main',
    chatId: `${input.channel}:${senderId}`,
    action: 'auth',
    detail: `pairing requested on ${input.channel} code=${pairing.pairing_code}`,
    blocked: true,
    eventType: 'pairing_requested',
    target: senderId,
    decision: 'pending',
  });
  logger.info(
    { channel: input.channel, senderId, code: pairing.pairing_code },
    'Pairing requested',
  );
  return { decision: 'pending', pairing, ...msgs };
}

/** Status-guarded approve. Pending or denied can be approved; already-approved is a no-op. */
export function approvePairing(id: number): boolean {
  const ts = nowSec();
  const result = getDb()
    .prepare(
      `UPDATE channel_pairings SET status = 'approved', decided_at = ?
        WHERE id = ? AND status IN ('pending', 'denied')`,
    )
    .run(ts, id);
  if (result.changes !== 1) return false;
  const row = getPairingById(id);
  audit({
    agentId: 'main',
    chatId: row ? `${row.channel}:${row.sender_id}` : String(id),
    action: 'auth',
    detail: `pairing approved id=${id}`,
    blocked: false,
    eventType: 'pairing_approved',
    target: row?.sender_id,
    decision: 'approved',
    decidedBy: 'operator',
    decidedAt: ts,
  });
  return true;
}

/** Status-guarded deny. Returns false if the row was not pending. */
export function denyPairing(id: number): boolean {
  const ts = nowSec();
  const result = getDb()
    .prepare(
      `UPDATE channel_pairings SET status = 'denied', decided_at = ? WHERE id = ? AND status = 'pending'`,
    )
    .run(ts, id);
  if (result.changes !== 1) return false;
  const row = getPairingById(id);
  audit({
    agentId: 'main',
    chatId: row ? `${row.channel}:${row.sender_id}` : String(id),
    action: 'auth',
    detail: `pairing denied id=${id}`,
    blocked: true,
    eventType: 'pairing_denied',
    target: row?.sender_id,
    decision: 'denied',
    decidedBy: 'operator',
    decidedAt: ts,
  });
  return true;
}

export function approvePairingByCode(code: string): PairingRow | undefined {
  const row = getPairingByCode(code);
  if (!row) return undefined;
  if (row.status === 'approved') return row;
  if (!approvePairing(row.id)) return undefined;
  return getPairingById(row.id);
}

export function denyPairingByCode(code: string): PairingRow | undefined {
  const row = getPairingByCode(code);
  if (!row) return undefined;
  if (row.status === 'denied') return row;
  if (!denyPairing(row.id)) return undefined;
  return getPairingById(row.id);
}

/**
 * Upsert the env allowlist IDs as approved pairings so a lock that was
 * set in .env before this table existed still counts as paired.
 */
export function seedBootstrapPairings(): void {
  if (ALLOWED_SLACK_USER_ID) {
    safeDb(
      () => upsertApproved('slack', ALLOWED_SLACK_USER_ID, 'env bootstrap'),
      undefined,
    );
  }
  if (ALLOWED_CHAT_ID) {
    safeDb(
      () => upsertApproved('telegram', ALLOWED_CHAT_ID, 'env bootstrap'),
      undefined,
    );
  }
  if (ALLOWED_DISCORD_USER_ID) {
    safeDb(
      () => upsertApproved('discord', ALLOWED_DISCORD_USER_ID, 'env bootstrap'),
      undefined,
    );
  }
}

/**
 * Persist the first operator into .env so scheduler / PRIMARY_CHAT_ID
 * keep working after restart. No-op when the channel has no env key.
 */
export function persistChannelOwner(channel: ChannelId, senderId: string): void {
  const key = ENV_KEY[channel];
  if (!key) return;
  try {
    setEnvKey(ENV_FILE, key, senderId);
    logger.info({ channel, key }, 'Wrote channel owner to .env');
  } catch (err) {
    logger.error({ err, channel, key }, 'Could not persist channel owner to .env');
  }
}

/** Parse `/pair CODE`, `/pair deny CODE`, `/pair list`. */
export function parsePairCommand(text: string):
  | { action: 'approve'; code: string }
  | { action: 'deny'; code: string }
  | { action: 'list' }
  | { action: 'help' } {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  // Drop a leading /pair if the caller passed the whole command line.
  if (parts[0]?.toLowerCase() === '/pair' || parts[0]?.toLowerCase() === 'pair') {
    parts.shift();
  }
  if (parts.length === 0) return { action: 'help' };
  if (parts[0]?.toLowerCase() === 'list') return { action: 'list' };
  if (parts[0]?.toLowerCase() === 'deny' && parts[1]) {
    return { action: 'deny', code: parts[1].toUpperCase() };
  }
  return { action: 'approve', code: parts[0]!.toUpperCase() };
}

export function formatPairingList(rows: PairingRow[]): string {
  if (rows.length === 0) return 'No pairing requests.';
  return rows
    .map((r) => {
      const who = r.display_name ? `${r.display_name} (${r.sender_id})` : r.sender_id;
      return `${r.status}  ${r.pairing_code}  ${r.channel}  ${who}`;
    })
    .join('\n');
}

const PAIR_USAGE = 'Usage: /pair CODE — approve. /pair deny CODE — deny. /pair list — show all.';

/** Shared /pair handler for Slack and Telegram. */
export function handlePairCommand(text: string): string {
  const parsed = parsePairCommand(text);
  if (parsed.action === 'help') return PAIR_USAGE;
  if (parsed.action === 'list') return formatPairingList(listPairings());
  if (parsed.action === 'approve') {
    const row = approvePairingByCode(parsed.code);
    return row
      ? `Approved ${row.channel} sender ${row.display_name || row.sender_id} (${row.sender_id}).`
      : `No pairing found for ${parsed.code}.`;
  }
  const row = denyPairingByCode(parsed.code);
  return row
    ? `Denied ${row.channel} sender ${row.display_name || row.sender_id} (${row.sender_id}).`
    : `No pending pairing for ${parsed.code}.`;
}
