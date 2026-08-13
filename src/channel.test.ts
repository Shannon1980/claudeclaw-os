import { describe, it, expect, beforeEach } from 'vitest';

import {
  registerChannel,
  unregisterChannel,
  getChannel,
  listChannels,
  startChannels,
  stopChannels,
  _resetChannels,
  type ChannelPlugin,
} from './channel.js';

function stub(id: ChannelPlugin['id'], calls: string[]): ChannelPlugin {
  return {
    id,
    capabilities: () => ({
      threading: false,
      reactions: false,
      attachments: true,
      voice: false,
      groups: false,
    }),
    start: async () => {
      calls.push(`start:${id}`);
    },
    stop: async () => {
      calls.push(`stop:${id}`);
    },
  };
}

describe('channel registry', () => {
  beforeEach(() => {
    _resetChannels();
  });

  it('registers, lists, and looks up plugins', () => {
    registerChannel(stub('slack', []));
    registerChannel(stub('telegram', []));
    expect(listChannels().map((p) => p.id).sort()).toEqual(['slack', 'telegram']);
    expect(getChannel('slack')?.id).toBe('slack');
    expect(getChannel('discord')).toBeUndefined();
  });

  it('replaces a plugin registered under the same id', () => {
    const first = stub('slack', []);
    const second = stub('slack', []);
    registerChannel(first);
    registerChannel(second);
    expect(getChannel('slack')).toBe(second);
    expect(listChannels()).toHaveLength(1);
  });

  it('starts in registration order and stops in reverse', async () => {
    const calls: string[] = [];
    registerChannel(stub('slack', calls));
    registerChannel(stub('telegram', calls));
    await startChannels();
    await stopChannels();
    expect(calls).toEqual(['start:slack', 'start:telegram', 'stop:telegram', 'stop:slack']);
  });

  it('unregister drops a plugin', () => {
    registerChannel(stub('whatsapp', []));
    unregisterChannel('whatsapp');
    expect(getChannel('whatsapp')).toBeUndefined();
  });
});
