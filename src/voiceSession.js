import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { isShuttingDown } from './shutdown.js';

const state = {
  connection: null,
  channelId: null,
  guildId: null,
  connecting: false,
  reconnectAttempts: 0,
};

const VOICE_TYPES = new Set([2, 13, 'GUILD_VOICE', 'GUILD_STAGE_VOICE', 'voice', 'stage']);

function isVoiceChannel(channel) {
  if (!channel) return false;
  return VOICE_TYPES.has(channel.type);
}

function resetState() {
  state.connection = null;
  state.channelId = null;
  state.guildId = null;
  state.connecting = false;
  state.reconnectAttempts = 0;
}

export async function joinVoice({ client, guildId, channelId, config, logger, stats }) {
  if (state.connecting) throw new Error('Đang kết nối — thử lại sau');
  if (state.connection) await leaveVoice({ logger, stats });

  const guild = client.guilds?.cache?.get(guildId);
  if (!guild) throw new Error(`Không tìm thấy guild ${guildId}`);

  const channel = guild.channels?.cache?.get(channelId);
  if (!channel) throw new Error(`Không tìm thấy channel ${channelId}`);

  if (!isVoiceChannel(channel)) {
    throw new Error(`"${channel.name}" không phải voice channel`);
  }

  state.connecting = true;
  state.reconnectAttempts = 0;
  logger?.voice(`Join ${guild.name}/${channel.name}...`);

  let conn;
  try {
    conn = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: config?.voice?.selfDeaf ?? true,
      selfMute: config?.voice?.selfMute ?? false,
    });

    await entersState(conn, VoiceConnectionStatus.Ready, 30000);
  } catch (e) {
    state.connecting = false;
    try { conn?.destroy(); } catch {}
    throw new Error(`Voice timeout: ${e.message}`);
  }

  state.connection = conn;
  state.channelId = channelId;
  state.guildId = guildId;
  state.connecting = false;

  stats?.bump?.('voiceJoins');
  logger?.voice(`✓ Voice ready: ${channel.name}`);

  // ── Disconnect handler ─────────────────────────────────
  const vcCfg = config?.voice || {};
  const autoReconnect = vcCfg.autoReconnect !== false;
  const maxAttempts = Math.max(0, vcCfg.reconnectMaxAttempts ?? 3);

  conn.on(VoiceConnectionStatus.Disconnected, async () => {
    if (isShuttingDown()) return;

    if (!autoReconnect) {
      logger?.warn('Voice disconnect — autoReconnect = false, không retry');
      try { conn.destroy(); } catch {}
      if (state.connection === conn) resetState();
      return;
    }

    if (state.reconnectAttempts >= maxAttempts) {
      logger?.warn(`Voice disconnect — vượt ${maxAttempts} lần retry, destroy`);
      try { conn.destroy(); } catch {}
      if (state.connection === conn) resetState();
      return;
    }

    state.reconnectAttempts++;

    try {
      await Promise.race([
        entersState(conn, VoiceConnectionStatus.Signalling, 5000),
        entersState(conn, VoiceConnectionStatus.Connecting, 5000),
      ]);
      logger?.voice(`Voice reconnecting... (${state.reconnectAttempts}/${maxAttempts})`);
      stats?.bump?.('voiceReconnects');
    } catch {
      logger?.warn(`Voice reconnect fail (${state.reconnectAttempts}/${maxAttempts})`);
      try { conn.destroy(); } catch {}
      if (state.connection === conn) resetState();
    }
  });

  // Reset counter khi thành công
  conn.on(VoiceConnectionStatus.Ready, () => {
    if (state.reconnectAttempts > 0) {
      logger?.voice('Voice reconnect thành công — reset counter');
      state.reconnectAttempts = 0;
    }
  });

  return conn;
}

export async function leaveVoice({ logger, stats } = {}) {
  if (!state.connection) return false;

  const gid = state.guildId;
  const conn = state.connection;

  resetState();

  try {
    logger?.voice('Leave voice...');
    conn.destroy();
    logger?.voice('✓ Đã rời voice');
    stats?.bump?.('voiceLeaves');
  } catch (e) {
    logger?.error(`leaveVoice: ${e.message}`);
  }

  // Cleanup music
  try {
    const music = await import('./music.js');
    if (typeof music.cleanupGuild === 'function') {
      music.cleanupGuild(gid);
    }
  } catch {}

  return true;
}

export function getVoiceState() {
  return {
    connected: !!state.connection,
    guildId: state.guildId,
    channelId: state.channelId,
    connection: state.connection,
  };
}

export function getCurrentConnection() {
  return state.connection;
}