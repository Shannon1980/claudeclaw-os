import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase, getDb } from './db.js';
import {
  admitSender,
  approvePairing,
  approvePairingByCode,
  denyPairing,
  denyPairingByCode,
  formatPairingList,
  getPairing,
  handlePairCommand,
  hasApprovedPairing,
  isApprovedSender,
  isChannelOwnerConfigured,
  listPairings,
  parsePairCommand,
  seedBootstrapPairings,
} from './pairing.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('channel_pairings schema', () => {
  it('exists after _initTestDatabase (createSchema dual-write)', () => {
    const cols = getDb()
      .prepare(`PRAGMA table_info(channel_pairings)`)
      .all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'channel',
        'sender_id',
        'display_name',
        'status',
        'pairing_code',
        'created_at',
        'decided_at',
        'last_seen_at',
      ]),
    );
  });
});

describe('admitSender', () => {
  it('bootstraps the first sender on an unowned channel', () => {
    const result = admitSender({
      channel: 'discord',
      senderId: 'U-first',
      displayName: 'Ada',
    });
    expect(result.decision).toBe('bootstrap');
    expect(result.pairing?.status).toBe('approved');
    expect(isApprovedSender('discord', 'U-first')).toBe(true);
    expect(isChannelOwnerConfigured('discord')).toBe(true);
  });

  it('issues a pairing code for a second sender and reuses it', () => {
    admitSender({ channel: 'discord', senderId: 'U-owner' });
    const first = admitSender({
      channel: 'discord',
      senderId: 'U-guest',
      displayName: 'Guest',
    });
    expect(first.decision).toBe('pending');
    expect(first.pairing?.pairing_code).toMatch(/^[A-Z2-9]{6}$/);
    expect(first.senderMessage).toContain(first.pairing!.pairing_code);

    const second = admitSender({ channel: 'discord', senderId: 'U-guest' });
    expect(second.decision).toBe('pending');
    expect(second.pairing?.pairing_code).toBe(first.pairing?.pairing_code);
    expect(listPairings('pending')).toHaveLength(1);
  });

  it('allows an approved sender and silently denies a denied one', () => {
    admitSender({ channel: 'discord', senderId: 'U-owner' });
    const pending = admitSender({ channel: 'discord', senderId: 'U-guest' });
    expect(approvePairing(pending.pairing!.id)).toBe(true);
    expect(admitSender({ channel: 'discord', senderId: 'U-guest' }).decision).toBe('allow');

    const other = admitSender({ channel: 'discord', senderId: 'U-nope' });
    expect(denyPairing(other.pairing!.id)).toBe(true);
    const again = admitSender({ channel: 'discord', senderId: 'U-nope' });
    expect(again.decision).toBe('deny');
    expect(again.senderMessage).toBe('');
  });

  it('rejects an empty sender id', () => {
    expect(admitSender({ channel: 'slack', senderId: '' }).decision).toBe('deny');
  });
});

describe('approve / deny are status-guarded', () => {
  it('approve then approve again is a no-op', () => {
    admitSender({ channel: 'discord', senderId: 'U-owner' });
    const pending = admitSender({ channel: 'discord', senderId: 'U-guest' });
    expect(approvePairing(pending.pairing!.id)).toBe(true);
    expect(approvePairing(pending.pairing!.id)).toBe(false);
  });

  it('deny then deny again is a no-op', () => {
    admitSender({ channel: 'discord', senderId: 'U-owner' });
    const pending = admitSender({ channel: 'discord', senderId: 'U-guest' });
    expect(denyPairing(pending.pairing!.id)).toBe(true);
    expect(denyPairing(pending.pairing!.id)).toBe(false);
  });

  it('approvePairingByCode / denyPairingByCode resolve the code', () => {
    admitSender({ channel: 'discord', senderId: 'U-owner' });
    const pending = admitSender({ channel: 'discord', senderId: 'U-guest' });
    const approved = approvePairingByCode(pending.pairing!.pairing_code.toLowerCase());
    expect(approved?.status).toBe('approved');

    const other = admitSender({ channel: 'discord', senderId: 'U-other' });
    const denied = denyPairingByCode(other.pairing!.pairing_code);
    expect(denied?.status).toBe('denied');
    expect(approvePairingByCode('NOCODE')).toBeUndefined();
  });
});

describe('parsePairCommand', () => {
  it('parses approve, deny, list, and help', () => {
    expect(parsePairCommand('/pair AB12CD')).toEqual({ action: 'approve', code: 'AB12CD' });
    expect(parsePairCommand('pair deny xy34zt')).toEqual({ action: 'deny', code: 'XY34ZT' });
    expect(parsePairCommand('/pair list')).toEqual({ action: 'list' });
    expect(parsePairCommand('/pair')).toEqual({ action: 'help' });
  });

  it('handlePairCommand approves by code', () => {
    admitSender({ channel: 'discord', senderId: 'U-owner' });
    const pending = admitSender({ channel: 'discord', senderId: 'U-guest' });
    const reply = handlePairCommand(`/pair ${pending.pairing!.pairing_code}`);
    expect(reply).toContain('Approved');
    expect(isApprovedSender('discord', 'U-guest')).toBe(true);
  });
});

describe('list + format', () => {
  it('formats pending rows for the operator', () => {
    admitSender({ channel: 'discord', senderId: 'U-owner', displayName: 'Ada' });
    admitSender({ channel: 'discord', senderId: 'U-guest', displayName: 'Guest' });
    const text = formatPairingList(listPairings('pending'));
    expect(text).toContain('pending');
    expect(text).toContain('Guest');
    expect(formatPairingList([])).toBe('No pairing requests.');
  });
});

describe('seedBootstrapPairings', () => {
  it('is a no-op when env allowlists are empty (test env)', () => {
    seedBootstrapPairings();
    // Test env does not set ALLOWED_SLACK_USER_ID / ALLOWED_CHAT_ID.
    expect(hasApprovedPairing('slack')).toBe(false);
    expect(hasApprovedPairing('telegram')).toBe(false);
    expect(getPairing('slack', 'U-nobody')).toBeUndefined();
  });
});

describe('isApprovedSender without a database', () => {
  it('fails closed for a sender when no env lock and no row', () => {
    expect(isApprovedSender('slack', 'U12345')).toBe(false);
    expect(isApprovedSender('slack', undefined)).toBe(false);
  });
});
