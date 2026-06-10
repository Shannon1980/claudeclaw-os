import { describe, it, expect } from 'vitest';

import { slackChatId, slackChannelChatId, resolveSlackCommandTarget, isAuthorisedSlack, classifyFile, type SlackFile } from './slack-bot.js';

describe('slackChatId', () => {
  it('namespaces the user id to avoid colliding with Telegram chat ids', () => {
    expect(slackChatId('U12345')).toBe('slack:U12345');
  });
});

describe('slackChannelChatId', () => {
  it('keys routed agent channels by channel id under a distinct prefix', () => {
    expect(slackChannelChatId('C0RESEARCH')).toBe('slack:channel:C0RESEARCH');
  });

  it('does not collide with a DM session key', () => {
    expect(slackChannelChatId('U12345')).not.toBe(slackChatId('U12345'));
  });
});

describe('resolveSlackCommandTarget', () => {
  const map = new Map<string, string>([['C0RESEARCH', 'research']]);

  it('routes a command in a mapped channel to that agent and its per-channel session', () => {
    expect(resolveSlackCommandTarget(map, 'C0RESEARCH', 'U123', 'main')).toEqual({
      chatId: 'slack:channel:C0RESEARCH',
      agentId: 'research',
    });
  });

  it('routes a command in a DM/unmapped channel to the main agent and the user session', () => {
    // A DM channel id (D...) is never in the channel map.
    expect(resolveSlackCommandTarget(map, 'D0DM', 'U123', 'main')).toEqual({
      chatId: 'slack:U123',
      agentId: 'main',
    });
    // An unmapped public channel falls through the same way.
    expect(resolveSlackCommandTarget(map, 'C0OTHER', 'U123', 'main')).toEqual({
      chatId: 'slack:U123',
      agentId: 'main',
    });
  });

  it('uses the routed session key, not the user key, inside an agent channel', () => {
    const t = resolveSlackCommandTarget(map, 'C0RESEARCH', 'U123', 'main');
    expect(t.chatId).not.toBe(slackChatId('U123'));
  });
});

describe('isAuthorisedSlack', () => {
  it('fails closed when ALLOWED_SLACK_USER_ID is not configured', () => {
    // The test env sets no ALLOWED_SLACK_USER_ID, so every user is rejected.
    expect(isAuthorisedSlack('U12345')).toBe(false);
    expect(isAuthorisedSlack(undefined)).toBe(false);
  });
});

describe('classifyFile', () => {
  const f = (o: Partial<SlackFile>): SlackFile => o;

  it('classifies by mimetype first', () => {
    expect(classifyFile(f({ mimetype: 'audio/mp4' }))).toBe('audio');
    expect(classifyFile(f({ mimetype: 'image/png' }))).toBe('image');
    expect(classifyFile(f({ mimetype: 'video/quicktime' }))).toBe('video');
  });

  it('falls back to filetype', () => {
    expect(classifyFile(f({ filetype: 'm4a' }))).toBe('audio');
    expect(classifyFile(f({ filetype: 'jpg' }))).toBe('image');
    expect(classifyFile(f({ filetype: 'mov' }))).toBe('video');
  });

  it('defaults unknown files to document', () => {
    expect(classifyFile(f({ filetype: 'pdf' }))).toBe('document');
    expect(classifyFile(f({}))).toBe('document');
  });
});
