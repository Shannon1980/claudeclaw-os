import { describe, it, expect } from 'vitest';

import { slackChatId, isAuthorisedSlack, classifyFile, type SlackFile } from './slack-bot.js';

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
