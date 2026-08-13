import { describe, it, expect, vi } from 'vitest';

import { slackChatId, slackChannelChatId, resolveSlackCommandTarget, isAuthorisedSlack, classifyFile, createSlackSender, buildTaskResultBlocks, type SlackFile } from './slack-bot.js';

describe('createSlackSender (send-only Slack poster for sub-agents)', () => {
  function fakeClient() {
    const open = vi.fn().mockResolvedValue({ channel: { id: 'D0DM' } });
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    return {
      client: { conversations: { open }, chat: { postMessage } } as any,
      open,
      postMessage,
    };
  }

  it('opens a DM to the configured user and posts the message there', async () => {
    const { client, open, postMessage } = fakeClient();
    const sender = createSlackSender(client, 'U123');
    await sender.postToUser('hello from aos cron');
    expect(open).toHaveBeenCalledWith({ users: 'U123' });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toMatchObject({ channel: 'D0DM' });
    expect(postMessage.mock.calls[0][0].text).toContain('hello from aos cron');
  });

  it('posts the body as rich_text blocks, keeping mrkdwn as the preview text', async () => {
    const { client, postMessage } = fakeClient();
    const sender = createSlackSender(client, 'U123');
    await sender.postToUser('Status: **green**\n\n- ship it');
    const arg = postMessage.mock.calls[0][0];
    expect(arg.blocks[0].type).toBe('rich_text');
    expect(arg.blocks[0].elements.some((e: any) => e.type === 'rich_text_list')).toBe(true);
    // text is the notification fallback only — still mrkdwn.
    expect(arg.text).toContain('*green*');
  });

  it('falls back to a plain mrkdwn post when Slack rejects the blocks', async () => {
    const { client, postMessage } = fakeClient();
    postMessage.mockRejectedValueOnce(new Error('invalid_blocks'));
    const sender = createSlackSender(client, 'U123');
    await sender.postToUser('**important**');
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[1][0].blocks).toBeUndefined();
    expect(postMessage.mock.calls[1][0].text).toBe('*important*');
  });

  it('caches the resolved DM channel across calls (opens once)', async () => {
    const { client, open, postMessage } = fakeClient();
    const sender = createSlackSender(client, 'U123');
    await sender.postToUser('one');
    await sender.postToUser('two');
    expect(open).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it('does not post when no user id is configured', async () => {
    const { client, open, postMessage } = fakeClient();
    const sender = createSlackSender(client, '');
    await sender.postToUser('nope');
    expect(open).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});

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
  it('fails closed when no env lock and no approved pairing', () => {
    // The test env sets no ALLOWED_SLACK_USER_ID and this file does not
    // open a pairing DB, so every user is rejected.
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

describe('buildTaskResultBlocks (rich task output)', () => {
  it('renders a header (status + title), a rich_text body, and a reply-in-thread footer', () => {
    const { blocks, overflow } = buildTaskResultBlocks({
      title: 'Draft the Q3 board update',
      body: 'Here is the **draft** with three sections.',
      status: 'completed',
      taskId: 'm-abc12345-tail',
    });
    expect(overflow).toEqual([]);
    expect(blocks[0]).toMatchObject({ type: 'header' });
    expect(blocks[0].text.text).toContain('✅');
    expect(blocks[0].text.text).toContain('Draft the Q3 board update');
    // Body becomes a rich_text block: emphasis is a style flag, not markup.
    const body = blocks.find((b: any) => b.type === 'rich_text');
    const bold = body.elements[0].elements.find((e: any) => e.style?.bold);
    expect(bold.text).toBe('draft');
    // Footer is a context block telling the operator how to send feedback.
    const context = blocks[blocks.length - 1];
    expect(context.type).toBe('context');
    expect(context.elements[0].text).toContain('reply in this thread');
    expect(context.elements[0].text).toContain('m-abc123'); // short id
  });

  it('uses the needs-you glyph and names the delegate agent', () => {
    const { blocks } = buildTaskResultBlocks({
      title: 'Chase the vendor',
      body: 'stuck, need the contract',
      status: 'needs_you',
      taskId: 'm-xyz',
      agentId: 'comms',
    });
    expect(blocks[0].text.text).toContain('⏳');
    expect(blocks[blocks.length - 1].elements[0].text).toContain('via comms');
  });

  it('overflows a very long body into threaded follow-ups, keeping the anchor within block limits', () => {
    const body = 'x'.repeat(2900 * 12); // 12 sections' worth
    const { blocks, overflow } = buildTaskResultBlocks({
      title: 'Big report',
      body,
      status: 'completed',
      taskId: 'm-big',
    });
    // header + up to 8 body blocks + context, never exceeding Slack's 50-block cap.
    expect(blocks.length).toBeLessThanOrEqual(50);
    const sections = blocks.filter((b: any) => b.type === 'rich_text');
    expect(sections.length).toBe(8);
    expect(overflow.length).toBeGreaterThan(0);
  });
});
