import { describe, it, expect } from 'vitest';

import {
  classifyDiscordCommand,
  discordChatId,
  isAuthorisedDiscord,
} from './discord-bot.js';

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
