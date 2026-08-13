import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase } from './db.js';
import {
  classifyDiscordCommand,
  discordChatId,
  discordOperatorId,
  isAuthorisedDiscord,
  resolveDiscordOperatorId,
} from './discord-bot.js';
import { admitSender, approvePairing, listPairings } from './pairing.js';

describe('discordChatId', () => {
  it('namespaces the user id so it cannot collide with Slack or Telegram', () => {
    expect(discordChatId('1234567890')).toBe('discord:1234567890');
  });
});

describe('isAuthorisedDiscord', () => {
  it('fails closed when no env lock and no approved pairing', () => {
    expect(isAuthorisedDiscord('1234567890')).toBe(false);
    expect(isAuthorisedDiscord(undefined)).toBe(false);
  });
});

describe('resolveDiscordOperatorId', () => {
  it('prefers the env lock over pairing rows', () => {
    expect(
      resolveDiscordOperatorId('env-owner', [
        { channel: 'discord', sender_id: 'newer', created_at: 20, id: 2 },
        { channel: 'discord', sender_id: 'older', created_at: 10, id: 1 },
      ]),
    ).toBe('env-owner');
  });

  it('picks the oldest approved Discord pairing, not the newest', () => {
    expect(
      resolveDiscordOperatorId('', [
        { channel: 'discord', sender_id: 'newer', created_at: 20, id: 2 },
        { channel: 'slack', sender_id: 'slack-owner', created_at: 1, id: 9 },
        { channel: 'discord', sender_id: 'older', created_at: 10, id: 1 },
      ]),
    ).toBe('older');
  });

  it('returns empty when there is no Discord owner', () => {
    expect(resolveDiscordOperatorId('', [])).toBe('');
    expect(
      resolveDiscordOperatorId('', [
        { channel: 'slack', sender_id: 'slack-owner', created_at: 1, id: 1 },
      ]),
    ).toBe('');
  });
});

describe('discordOperatorId', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('keeps notifying the original Discord operator after a later user is approved', () => {
    admitSender({ channel: 'discord', senderId: 'U-owner' });
    const pending = admitSender({ channel: 'discord', senderId: 'U-guest' });
    expect(approvePairing(pending.pairing!.id)).toBe(true);
    expect(listPairings('approved')[0]!.sender_id).toBe('U-guest');
    expect(discordOperatorId()).toBe('U-owner');
  });
});

describe('classifyDiscordCommand', () => {
  it('parses slash commands and strips a leading mention', () => {
    expect(classifyDiscordCommand('/pair AB12CD')).toEqual({ type: 'pair', rest: 'AB12CD' });
    expect(classifyDiscordCommand('/pair deny xy34zt')).toEqual({
      type: 'pair',
      rest: 'deny xy34zt',
    });
    expect(classifyDiscordCommand('/whoami')).toEqual({ type: 'whoami' });
    expect(classifyDiscordCommand('/help')).toEqual({ type: 'help' });
    expect(classifyDiscordCommand('/newchat')).toEqual({ type: 'newchat' });
    expect(classifyDiscordCommand('/stop')).toEqual({ type: 'stop' });
    expect(classifyDiscordCommand('<@999> /pair list')).toEqual({ type: 'pair', rest: 'list' });
  });

  it('treats unknown slashes and plain text as messages', () => {
    expect(classifyDiscordCommand('/delegate research look this up')).toEqual({
      type: 'message',
      text: '/delegate research look this up',
    });
    expect(classifyDiscordCommand('what is on my calendar')).toEqual({
      type: 'message',
      text: 'what is on my calendar',
    });
  });
});
