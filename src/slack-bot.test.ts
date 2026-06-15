import { describe, it, expect } from 'vitest';

import {
  slackChatId,
  isAuthorisedSlack,
  classifyFile,
  containsBotMention,
  decideChannelRoute,
  type SlackFile,
} from './slack-bot.js';

describe('slackChatId', () => {
  it('namespaces the user id to avoid colliding with Telegram chat ids', () => {
    expect(slackChatId('U12345')).toBe('slack:U12345');
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

describe('containsBotMention', () => {
  const BOT = 'U0BOT';

  it('matches the plain <@UID> form', () => {
    expect(containsBotMention('hey <@U0BOT> ping', BOT)).toBe(true);
  });

  it('matches the labelled <@UID|name> form (the C2 double-fire bug)', () => {
    expect(containsBotMention('hey <@U0BOT|claudeclaw> ping', BOT)).toBe(true);
  });

  it('does not match a mention of a different user', () => {
    expect(containsBotMention('hey <@U0OTHER> ping', BOT)).toBe(false);
    expect(containsBotMention('hey <@U0OTHER|alice> ping', BOT)).toBe(false);
  });

  it('does not match plain text', () => {
    expect(containsBotMention('just a normal message', BOT)).toBe(false);
  });

  it('treats any mention as the bot when botUserId is empty (degraded-auth fallback)', () => {
    // auth.test failed → we cannot single out the bot, so defer any mention
    // to app_mention rather than risk a double-fire.
    expect(containsBotMention('hey <@U0ANYONE> ping', '')).toBe(true);
    expect(containsBotMention('hey <@U0ANYONE|alice> ping', '')).toBe(true);
    expect(containsBotMention('no mention here', '')).toBe(false);
  });
});

describe('decideChannelRoute', () => {
  const BOT = 'U0BOT';
  const channelMap = new Map<string, string>([['C0RESEARCH', 'research']]);
  // Authorise everyone except a known stranger, so the auth gate is exercised
  // independently of the real ALLOWED_SLACK_USER_ID env.
  const isAuthorised = (u: string | undefined) => u !== 'U0STRANGER' && !!u;
  const base = {
    channelType: 'channel',
    channel: 'C0RESEARCH',
    userId: 'U0OWNER',
    botUserId: BOT,
    isAuthorised,
    channelMap,
  };

  it('routes a plain message in a mapped channel to its agent', () => {
    const d = decideChannelRoute({ ...base, text: '  look into X  ' });
    expect(d).toEqual({ action: 'route', agentId: 'research', text: 'look into X' });
  });

  it('treats a DM (im) as dm so the caller runs the normal DM path', () => {
    expect(decideChannelRoute({ ...base, channelType: 'im', text: 'hi' }).action).toBe('dm');
  });

  it('skips an unmapped channel', () => {
    expect(decideChannelRoute({ ...base, channel: 'C0UNMAPPED', text: 'hi' }).action).toBe('skip');
  });

  it('skips an unauthorised user (silent in channels)', () => {
    expect(decideChannelRoute({ ...base, userId: 'U0STRANGER', text: 'hi' }).action).toBe('skip');
  });

  it('skips empty / whitespace-only text', () => {
    expect(decideChannelRoute({ ...base, text: '' }).action).toBe('skip');
    expect(decideChannelRoute({ ...base, text: '   ' }).action).toBe('skip');
    expect(decideChannelRoute({ ...base, text: undefined }).action).toBe('skip');
  });

  it('skips a bot mention so app_mention is the sole handler (no double-fire)', () => {
    expect(decideChannelRoute({ ...base, text: '<@U0BOT> do it' }).action).toBe('skip');
    // C2: the labelled form must also defer — this is the regression that
    // double-billed every labelled @mention in a routed channel.
    expect(decideChannelRoute({ ...base, text: '<@U0BOT|claudeclaw> do it' }).action).toBe('skip');
  });

  it('C1: defers any mention when botUserId is empty (auth.test failed)', () => {
    expect(decideChannelRoute({ ...base, botUserId: '', text: '<@U0BOT> do it' }).action).toBe('skip');
  });

  it('still routes a non-mention message even when botUserId is known', () => {
    expect(decideChannelRoute({ ...base, text: 'no mention, just work' }).action).toBe('route');
  });
});
