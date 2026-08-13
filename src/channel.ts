/**
 * Channel plugin seam.
 *
 * Slack and Telegram already speak TransportCallbacks into the message
 * pipeline. This module is the *lifecycle* half of that split: a channel
 * adapter registers start/stop/capabilities so a later Discord or Baileys
 * WhatsApp transport can plug in without touching message-core.
 *
 * Adding a channel: implement ChannelPlugin, call registerChannel() from
 * the adapter's factory, then start it from index.ts (or startChannels()).
 */

export type ChannelId = 'slack' | 'telegram' | 'discord' | 'whatsapp';

export interface ChannelCapabilities {
  threading: boolean;
  reactions: boolean;
  attachments: boolean;
  voice: boolean;
  groups: boolean;
}

export interface ChannelPlugin {
  id: ChannelId;
  capabilities(): ChannelCapabilities;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const plugins = new Map<ChannelId, ChannelPlugin>();

export function registerChannel(plugin: ChannelPlugin): void {
  plugins.set(plugin.id, plugin);
}

export function unregisterChannel(id: ChannelId): void {
  plugins.delete(id);
}

export function getChannel(id: ChannelId): ChannelPlugin | undefined {
  return plugins.get(id);
}

export function listChannels(): ChannelPlugin[] {
  return [...plugins.values()];
}

export async function startChannels(): Promise<void> {
  for (const plugin of plugins.values()) {
    await plugin.start();
  }
}

export async function stopChannels(): Promise<void> {
  for (const plugin of [...plugins.values()].reverse()) {
    await plugin.stop();
  }
}

/** Test-only: wipe the registry between cases. */
export function _resetChannels(): void {
  plugins.clear();
}
