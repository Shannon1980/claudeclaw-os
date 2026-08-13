/**
 * Discord front-end. Additive: starts when DISCORD_BOT_TOKEN is set, next to
 * Slack or Telegram. DMs only. Pairing uses the shared channel_pairings table.
 *
 * Requires the Message Content Intent on the Discord application.
 */

import fs from 'fs';
import path from 'path';

import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type TextBasedChannel,
} from 'discord.js';

import { AGENT_ID, ALLOWED_DISCORD_USER_ID, DISCORD_MAX_LEN, STORE_DIR } from './config.js';
import { registerChannel } from './channel.js';
import { clearSession, getSession } from './db.js';
import { splitMessage } from './format.js';
import { logger } from './logger.js';
import { messageQueue } from './message-queue.js';
import {
  clearSessionBaseline,
  processUserMessage,
  type TransportCallbacks,
} from './message-core.js';
import {
  admitSender,
  handlePairCommand,
  isApprovedSender,
  listPairings,
  persistChannelOwner,
} from './pairing.js';
import { abortActiveQuery } from './state.js';

export const DISCORD_HELP_TEXT =
  'ClaudeClaw — Commands\n\n' +
  '/newchat — Start a new Claude session\n' +
  '/stop — Stop current processing\n' +
  '/whoami — Show your Discord user ID\n' +
  '/pair — Approve a pairing code (CODE, deny CODE, list)\n' +
  '/help — This list\n\n' +
  'DM only. First sender on Discord is the operator; later senders get a pairing code.';

export function discordChatId(userId: string): string {
  return `discord:${userId}`;
}

export function isAuthorisedDiscord(userId: string | undefined): boolean {
  return isApprovedSender('discord', userId);
}

export type DiscordCommand =
  | { type: 'pair'; rest: string }
  | { type: 'whoami' }
  | { type: 'help' }
  | { type: 'newchat' }
  | { type: 'stop' }
  | { type: 'message'; text: string };

/** Classify a DM body. Leading slash commands are stripped of a bot mention. */
export function classifyDiscordCommand(text: string): DiscordCommand {
  const trimmed = text.replace(/^\s*<@!?[0-9]+>\s*/, '').trim();
  const match = trimmed.match(/^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/);
  if (!match) return { type: 'message', text: trimmed };
  const cmd = match[1]!.toLowerCase();
  const rest = (match[2] ?? '').trim();
  if (cmd === 'pair') return { type: 'pair', rest };
  if (cmd === 'whoami') return { type: 'whoami' };
  if (cmd === 'help') return { type: 'help' };
  if (cmd === 'newchat') return { type: 'newchat' };
  if (cmd === 'stop') return { type: 'stop' };
  return { type: 'message', text: trimmed };
}

function buildDiscordCallbacks(
  channel: TextBasedChannel,
  chatId: string,
): TransportCallbacks {
  return {
    chatId,
    agentId: AGENT_ID,
    source: 'discord',
    format: (text) => text,
    maxLen: DISCORD_MAX_LEN,
    sendFormatted: async (text) => {
      if (!('send' in channel)) return {};
      const sent = await channel.send(text.slice(0, DISCORD_MAX_LEN));
      return { messageId: sent.id };
    },
    sendPlain: async (text) => {
      if (!('send' in channel)) return {};
      const sent = await channel.send(text.slice(0, DISCORD_MAX_LEN));
      return { messageId: sent.id };
    },
    editPlain: async (id, text) => {
      if (!('messages' in channel)) return;
      await channel.messages.edit(String(id), { content: text.slice(0, DISCORD_MAX_LEN) });
    },
    deleteMessage: async (id) => {
      if (!('messages' in channel)) return;
      await channel.messages.delete(String(id));
    },
    sendTyping: () => {
      if ('sendTyping' in channel) void channel.sendTyping();
    },
    sendFile: async (filePath, caption) => {
      if (!('send' in channel)) return;
      await channel.send({
        content: caption?.slice(0, DISCORD_MAX_LEN),
        files: [new AttachmentBuilder(filePath, { name: path.basename(filePath) })],
      });
    },
    sendPhoto: async (filePath, caption) => {
      if (!('send' in channel)) return;
      await channel.send({
        content: caption?.slice(0, DISCORD_MAX_LEN),
        files: [new AttachmentBuilder(filePath, { name: path.basename(filePath) })],
      });
    },
    sendVoice: async (audio) => {
      if (!('send' in channel)) return;
      const tmp = path.join(STORE_DIR, `discord-voice-${Date.now()}.ogg`);
      fs.writeFileSync(tmp, audio);
      try {
        await channel.send({ files: [new AttachmentBuilder(tmp, { name: 'response.ogg' })] });
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ok */
        }
      }
    },
  };
}

async function replyChunks(channel: TextBasedChannel, text: string): Promise<void> {
  if (!('send' in channel)) return;
  for (const chunk of splitMessage(text, DISCORD_MAX_LEN)) {
    await channel.send(chunk);
  }
}

/** Pick the Discord operator for pairing alerts: env lock, else the oldest approved Discord pairing. */
export function resolveDiscordOperatorId(
  envOwnerId: string,
  approved: Array<{ channel: string; sender_id: string; created_at: number; id: number }>,
): string {
  if (envOwnerId) return envOwnerId;
  let oldest: (typeof approved)[number] | undefined;
  for (const row of approved) {
    if (row.channel !== 'discord') continue;
    if (
      !oldest ||
      row.created_at < oldest.created_at ||
      (row.created_at === oldest.created_at && row.id < oldest.id)
    ) {
      oldest = row;
    }
  }
  return oldest?.sender_id ?? '';
}

export function discordOperatorId(): string {
  return resolveDiscordOperatorId(ALLOWED_DISCORD_USER_ID, listPairings('approved'));
}

async function notifyDiscordOperator(
  client: Client,
  senderId: string,
  text: string,
): Promise<void> {
  const owner = discordOperatorId();
  if (!owner || owner === senderId) return;
  try {
    const user = await client.users.fetch(owner);
    await user.send(text);
  } catch (err) {
    logger.warn({ err }, 'Could not notify Discord operator of pairing request');
  }
}

export interface DiscordBot {
  start: () => Promise<{ botUserId: string; botName: string }>;
  stop: () => Promise<void>;
}

export function createDiscordBot(token: string): DiscordBot {
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is not set.');
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.Guilds,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.on(Events.MessageCreate, (message: Message) => {
    void handleDiscordMessage(client, message);
  });

  const start = async () => {
    await client.login(token);
    const botUserId = client.user?.id ?? '';
    const botName = client.user?.username ?? 'ClaudeClaw';
    return { botUserId, botName };
  };

  const stop = async () => {
    client.destroy();
  };

  registerChannel({
    id: 'discord',
    capabilities: () => ({
      threading: true,
      reactions: true,
      attachments: true,
      voice: false,
      groups: false,
    }),
    start: async () => {
      await start();
    },
    stop,
  });

  return { start, stop };
}

async function handleDiscordMessage(client: Client, message: Message): Promise<void> {
  if (message.author.bot) return;
  if (message.guild) return; // DMs only
  if (!message.channel.isTextBased()) return;

  const senderId = message.author.id;
  const displayName = message.author.displayName || message.author.username;
  const chatId = discordChatId(senderId);
  const classified = classifyDiscordCommand(message.content || '');

  if (classified.type === 'whoami') {
    const admit = admitSender({ channel: 'discord', senderId, displayName });
    let extra = `Your Discord user ID is ${senderId}.`;
    if (admit.decision === 'allow') extra += ' You are paired.';
    else if (admit.decision === 'bootstrap') {
      persistChannelOwner('discord', senderId);
      extra += ' You are the first operator on Discord.';
    } else if (admit.decision === 'pending' && admit.pairing) {
      extra += ` Waiting on approval. Your pairing code is ${admit.pairing.pairing_code}. Ask the operator to send /pair ${admit.pairing.pairing_code}.`;
    } else extra += ' You are not paired.';
    await replyChunks(message.channel, extra);
    return;
  }

  const admit = admitSender({ channel: 'discord', senderId, displayName });
  if (admit.decision === 'deny') {
    logger.warn({ senderId }, 'Rejected Discord DM from unauthorised user');
    return;
  }
  if (admit.decision === 'pending') {
    await replyChunks(message.channel, admit.senderMessage);
    if (admit.operatorMessage) {
      await notifyDiscordOperator(client, senderId, admit.operatorMessage);
    }
    return;
  }
  if (admit.decision === 'bootstrap') {
    persistChannelOwner('discord', senderId);
    await replyChunks(message.channel, admit.senderMessage);
    return;
  }

  if (classified.type === 'pair') {
    await replyChunks(message.channel, handlePairCommand(classified.rest));
    return;
  }
  if (classified.type === 'help') {
    await replyChunks(message.channel, DISCORD_HELP_TEXT);
    return;
  }
  if (classified.type === 'newchat') {
    const old = getSession(chatId, AGENT_ID);
    if (old) clearSessionBaseline(old);
    clearSession(chatId, AGENT_ID);
    clearSessionBaseline(chatId);
    await replyChunks(message.channel, 'Session cleared. Starting fresh.');
    return;
  }
  if (classified.type === 'stop') {
    const aborted = abortActiveQuery(chatId);
    await replyChunks(message.channel, aborted ? 'Stopped.' : 'Nothing running.');
    return;
  }

  const text = classified.text;
  if (!text) return;
  const cb = buildDiscordCallbacks(message.channel, chatId);
  messageQueue.enqueue(chatId, () => processUserMessage(text, cb));
}
