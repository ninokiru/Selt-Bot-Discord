import fs from 'node:fs';
import { Client } from 'discord.js-selfbot-v13';
import { sleep, computeTypingDelay } from './utils.js';
import {
  isAfk,
  disableAfk,
  shouldIgnore,
  checkCooldown,
  recordPing,
  bumpReplyCount,
  renderReply,
  renderBackMessage,
  isCodeSent,
  markCodeSent,
  getConfig as getAfkConfig,
} from './afk.js';
import { leaveVoice, getVoiceState } from './voiceSession.js';
import { isPending, cancel } from './voiceConfirm.js';
import { recordDelete, recordEdit } from './snipe.js';
import { cacheMessage } from './messageCache.js';

export function createSelfbotClient({ config, logger, stats, dispatcher }) {
  const log = logger;

  const client = new Client({
    checkUpdate: false,
    patchVoice: true,
    autoRedeemNitro: false,
    sweepers: {
      messages: { interval: 0, lifetime: 0 },
      users: { interval: 0, filter: () => false },
      guildMembers: { interval: 0, filter: () => false },
      presences: { interval: 0, filter: () => false },
      voiceStates: { interval: 0, filter: () => false },
    },
  });

  client.on('ready', () => {
    const u = client.user;
    log.ok(`Ready: ${u.tag} (${u.id})`);
    applyPresence(client, config, { logger, stats });
  });

  client.on('error', (err) => {
    log.error(`Client error: ${err.message}`);
    stats?.bump('errors');
  });

  client.on('warn', (m) => {
    log.debug(`Warn: ${m}`);
    stats?.bump('warns');
  });

  client.on('rateLimited', (info) => {
    const t = info?.timeToReset ?? 0;
    log.warn(`Rate limited: ${info?.route} · ${(t / 1000).toFixed(1)}s`);
  });

  client.on('shardDisconnect', (ev, id) => {
    log.warn(`Shard ${id} disconnected (code ${ev?.code ?? '?'})`);
  });

  client.on('shardReconnecting', (id) => log.ws(`Shard ${id} reconnecting`));
  client.on('shardResume', (id, n) => log.ws(`Shard ${id} resumed (${n} events)`));
  client.on('shardError', (e, id) => {
    log.error(`Shard ${id}: ${e.message}`);
    stats?.bump('errors');
  });

  // ── Snipe: message deleted ──────────────────────────────
  client.on('messageDelete', (msg) => {
    try {
      recordDelete(msg);
      stats?.bump?.('messagesDeleted');
    } catch (e) {
      log.debug(`snipe delete: ${e.message}`);
    }
  });

  // ── Snipe: message edited ───────────────────────────────
  client.on('messageUpdate', (oldMsg, newMsg) => {
    try {
      recordEdit(oldMsg, newMsg);
      stats?.bump?.('messagesEdited');
    } catch (e) {
      log.debug(`snipe edit: ${e.message}`);
    }
  });

  client.on('messageCreate', async (msg) => {
    stats?.bump('messagesReceived');

    // Cache message content — dùng cho snipe sau này
    try {
      if (msg?.author && !msg.system) cacheMessage(msg);
    } catch (e) {
      log.debug(`cache message: ${e.message}`);
    }

    // 0. Voice confirm handler (yes/no)
    try {
      const handled = await handleVoiceConfirm(client, msg, config, log, stats);
      if (handled) return;
    } catch (e) {
      log.debug(`Voice confirm: ${e.message}`);
    }

    // 1. Command handler
    try {
      await handleMessage(client, msg, config, log, dispatcher);
    } catch (e) {
      log.error(`messageCreate: ${e.message}`);
      stats?.bump('errors');
    }

    // 2. Auto-disable AFK
    try {
      await handleAutoDisable(client, msg, config, log);
    } catch (e) {
      log.debug(`AFK auto-disable: ${e.message}`);
    }

    // 3. AFK ping handler
    try {
      await handleAfkPing(client, msg, config, log, stats);
    } catch (e) {
      log.debug(`AFK ping: ${e.message}`);
    }
  });

  return client;
}

// ── Voice confirm (yes/no) ────────────────────────────────
async function handleVoiceConfirm(client, msg, config, log, stats) {
  if (!msg?.author || !msg?.content) return false;
  if (msg.author.id !== client.user.id) return false;

  if (!isPending()) return false;

  const content = msg.content.trim().toLowerCase();
  if (content !== 'yes' && content !== 'no') return false;

  if (content === 'yes') {
    const vs = getVoiceState();

    if (!vs.connected) {
      cancel();
      const replyText = 'Không còn ở voice channel';
      await sleep(computeTypingDelay(replyText, config));
      const sent = await msg.reply(replyText).catch(() => null);
      if (sent) markCodeSent(sent.id);
      return true;
    }

    try {
      await leaveVoice({ logger: log, stats });
      cancel();
      const replyText = '✓ Đã rời voice';
      await sleep(computeTypingDelay(replyText, config));
      const sent = await msg.reply(replyText).catch(() => null);
      if (sent) markCodeSent(sent.id);
      log.cmd('Voice leave (confirmed by user)');
    } catch (e) {
      cancel();
      const replyText = `Lỗi khi rời: ${e.message}`;
      await sleep(computeTypingDelay(replyText, config));
      const sent = await msg.reply(replyText).catch(() => null);
      if (sent) markCodeSent(sent.id);
    }

    return true;
  }

  // "no"
  cancel();
  const replyText = 'OK, ở lại voice';
  await sleep(computeTypingDelay(replyText, config));
  const sent = await msg.reply(replyText).catch(() => null);
  if (sent) markCodeSent(sent.id);
  log.cmd('Voice leave cancelled (user said no)');
  return true;
}

// ── Command handler ───────────────────────────────────────
async function handleMessage(client, msg, config, log, dispatcher) {
  if (!msg?.author || !msg?.content) return;
  if (msg.author.id !== client.user.id) return;

  const prefix = config.commands?.prefix || '.';
  if (!msg.content.startsWith(prefix)) return;

  const dmEnabled = config.commands?.dmSelfEnabled !== false;
  const chEnabled = config.commands?.channelEnabled !== false;

  const chType = msg.channel?.type;
  const isDMType =
    chType === 1 || chType === 3 ||
    chType === 'DM' || chType === 'GROUP_DM' ||
    msg.channel?.isDMBased?.() === true;

  const isSelfDM = dmEnabled && isDMType;
  const isAllowedChannel = chEnabled && isChannelAllowed(msg.channel?.id);

  if (!isSelfDM && !isAllowedChannel) return;

  const content = msg.content.slice(prefix.length).trim();
  if (!content) return;

  const [name, ...args] = content.split(/\s+/);
  if (!name) return;

  try {
    if (typeof msg.channel.sendTyping === 'function') {
      await msg.channel.sendTyping().catch(() => {});
    }
  } catch {}

  await sleep(computeTypingDelay(msg.content, config));

  log.cmd(`Recv: ${name} ${args.join(' ')} (${isSelfDM ? 'DM' : 'channel'})`);

  if (dispatcher) {
    await dispatcher({
      name, args, msg, client,
      source: isSelfDM ? 'DM' : 'channel',
    });
  }
}

// ── Auto-disable AFK ──────────────────────────────────────
async function handleAutoDisable(client, msg, config, log) {
  if (!msg?.author) return;
  if (msg.author.id !== client.user.id) return;
  if (!isAfk()) return;
  if (isCodeSent(msg.id)) return;

  const afkCfg = getAfkConfig();
  if (!afkCfg.autoDisableOnActivity) return;

  const prefix = config.commands?.prefix || '.';

  if (msg.content?.startsWith(prefix)) {
    const [name] = msg.content.slice(prefix.length).trim().split(/\s+/);
    if (name === 'afk') return;
  }

  const { was, lastPing } = disableAfk();
  if (!was) return;

  log.cmd('AFK tự động tắt do He hoạt động');

  if (afkCfg.announceBack && lastPing?.channelId) {
    try {
      const channel = client.channels.cache.get(lastPing.channelId);
      if (channel?.send) {
        const backMsg = renderBackMessage();
        await sleep(computeTypingDelay(backMsg, config));
        const sent = await channel.send(backMsg).catch(() => null);
        if (sent) markCodeSent(sent.id);
      }
    } catch (e) {
      log.debug(`AFK back announce fail: ${e.message}`);
    }
  }
}

// ── AFK ping handler ──────────────────────────────────────
async function handleAfkPing(client, msg, config, log, stats) {
  if (!msg?.author) return;
  if (!isAfk()) return;

  const afkCfg = getAfkConfig();
  const selfbotId = client.user.id;

  if (afkCfg.ignoreBots !== false && msg.author.bot) return;
  if (msg.author.id === selfbotId) return;
  if (msg.system) return;
  if (shouldIgnore(msg.author.id, msg.channel?.id)) return;

  let pingType = null;

  if (msg.mentions?.users?.has?.(selfbotId) === true) {
    pingType = 'mention';
  } else if (
    msg.mentions?.repliedUser?.id === selfbotId ||
    msg.mentions?.replied_user?.id === selfbotId
  ) {
    pingType = 'reply';
  } else if (msg.mentions?.roles?.size > 0 && msg.guild) {
    const member = msg.guild.members?.cache?.get?.(selfbotId);
    if (member) {
      for (const role of msg.mentions.roles.values()) {
        if (member.roles?.cache?.has?.(role.id)) {
          pingType = 'role';
          break;
        }
      }
    }
  }

  if (!pingType && afkCfg.dmReply && !msg.guild) {
    pingType = 'dm';
  }

  if (!pingType) return;

  if (!checkCooldown(msg.author.id)) {
    log.debug(`AFK: skip ${pingType} from ${msg.author.id} (cooldown)`);
    return;
  }

  const authorTag = msg.author.tag || msg.author.username || msg.author.id;
  recordPing(msg.author.id, authorTag, msg.channel?.id, msg.id, msg.guild?.id);
  stats?.bump?.('afkPings');

  if (afkCfg.reactEmoji) {
    try {
      await msg.react(afkCfg.reactEmoji).catch(() => {});
    } catch {}
  }

  if (afkCfg.silentMode) {
    log.cmd(`AFK react ${afkCfg.reactEmoji} → ${authorTag} (${pingType})`);
    return;
  }

  const text = renderReply({ userId: msg.author.id, userTag: authorTag });

  await sleep(computeTypingDelay(text, config));

  try {
    let sent = null;
    if (msg.guild) {
      sent = await msg.reply(text).catch(() => null);
    } else {
      sent = await msg.channel.send(text).catch(() => null);
    }
    if (sent?.id) markCodeSent(sent.id);

    bumpReplyCount();
    stats?.bump?.('afkReplies');

    const guildName = msg.guild?.name || 'DM';
    log.cmd(`AFK reply (${pingType}) → ${authorTag} (${guildName})`);
  } catch (e) {
    log.debug(`AFK reply fail: ${e.message}`);
  }
}

// ── Channel whitelist ─────────────────────────────────────
let allowedChannels = null;

export function loadAllowedChannels(channelFile) {
  allowedChannels = new Set();
  try {
    if (fs.existsSync(channelFile)) {
      const raw = fs.readFileSync(channelFile, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const l = line.trim();
        if (l && !l.startsWith('#')) allowedChannels.add(l);
      }
    }
  } catch {}
  return allowedChannels;
}

function isChannelAllowed(id) {
  if (!allowedChannels || !id) return false;
  return allowedChannels.has(id);
}

// ── Presence ──────────────────────────────────────────────
const ACTIVITY_TYPE_MAP = {
  PLAYING: 0,
  STREAMING: 1,
  LISTENING: 2,
  WATCHING: 3,
  CUSTOM: 4,
  COMPETING: 5,
};

export function applyPresence(client, config, { logger, stats } = {}) {
  try {
    const st = config.status || {};
    if (!st.type || !st.text) return;

    const typeNum = ACTIVITY_TYPE_MAP[st.type] ?? 0;

    if (typeof client.user?.setPresence === 'function') {
      client.user.setPresence({
        activities: [{
          name: String(st.text).slice(0, 128),
          type: typeNum,
        }],
        status: 'online',
      });
      stats?.bump?.('presenceUpdates');
    }
  } catch {}
}