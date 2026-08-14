import { EventEmitter } from 'events';
import { describe, it, expect } from 'vitest';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';

import {
  attachDiscordClientGuards,
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

describe('attachDiscordClientGuards', () => {
  it('an unguarded emitter throws on error (the process-kill path)', () => {
    const client = new EventEmitter();
    expect(() => client.emit('error', new Error('ws down'))).toThrow('ws down');
  });

  it('does not throw when the client emits error after guards are attached', () => {
    const client = new EventEmitter();
    attachDiscordClientGuards(client);
    expect(() => client.emit('error', new Error('ws down'))).not.toThrow();
  });

  it('keeps a real discord.js Client alive when it emits error', () => {
    const client = new Client({
      intents: [GatewayIntentBits.DirectMessages],
      partials: [Partials.Channel],
    });
    attachDiscordClientGuards(client);
    expect(() => client.emit(Events.Error, new Error('ws down'))).not.toThrow();
    client.destroy();
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
