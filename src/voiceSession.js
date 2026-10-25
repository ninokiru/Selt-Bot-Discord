import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { isShuttingDown } from './shutdown.js';

const state = {
  connection: null,
  pending: null,
  channelId: null,
  guildId: null,
  connecting: false,
  reconnectAttempts: 0,
  lastError: null,
};

const VOICE_TYPES = new Set([2, 13, 'GUILD_VOICE', 'GUILD_STAGE_VOICE', 'voice', 'stage']);

export function isVoiceChannel(channel) {
  if (!channel) return false;
  return VOICE_TYPES.has(channel.type);
}

function clearState() {
  state.connection = null;
  state.pending = null;
  state.channelId = null;
  state.guildId = null;
  state.connecting = false;
  state.reconnectAttempts = 0;
}

export async function joinVoice({ client, guildId, channelId, config, logger, stats }) {
  if (isShuttingDown()) throw new Error('Đang dừng selfbot');
  if (state.connecting) throw new Error('Đang kết nối voice — thử lại sau');
  if (state.connection || state.pending) await leaveVoice({ logger, stats });

  state.lastError = null;

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

    state.pending = conn;

    // Không có listener 'error' = EventEmitter throw = crash cả process
    conn.on('error', (e) => {
      try {
        state.lastError = e?.message || String(e);
        logger?.error(`Voice error: ${state.lastError}`);
        stats?.bump?.('errors');
      } catch {}
    });

    conn.on('stateChange', (oldState, newState) => {
      try {
        logger?.debug(`Voice state: ${oldState?.status ?? '?'} → ${newState?.status ?? '?'}`);
      } catch {}
    });

    await entersState(conn, VoiceConnectionStatus.Ready, 30000);
  } catch (e) {
    state.connecting = false;
    state.lastError = e?.message || String(e);
    if (state.pending === conn) state.pending = null;
    try { conn?.destroy(); } catch {}
    throw new Error(`Voice timeout: ${state.lastError}`);
  }

  if (state.pending === conn) state.pending = null;
  state.connection = conn;
  state.channelId = channelId;
  state.guildId = guildId;
  state.connecting = false;

  stats?.bump?.('voiceJoins');
  logger?.voice(`✓ Voice ready: ${channel.name}`);

  const vcCfg = config?.voice || {};
  const autoReconnect = vcCfg.autoReconnect !== false;
  const maxAttempts = Math.max(0, vcCfg.reconnectMaxAttempts ?? 3);

  conn.on(VoiceConnectionStatus.Disconnected, () => {
    void handleDisconnected().catch((e) => {
      try {
        logger?.debug(`Voice disconnect unhandled (${state.reconnectAttempts}/${maxAttempts}): ${e?.message ?? e}`);
      } catch {}
    });
  });

  async function handleDisconnected() {
    try {
      if (isShuttingDown()) return;
      if (state.connection !== conn) return;

      // Chỉ destroy + clear khi conn vẫn là connection hiện tại
      const failAndClear = () => {
        if (state.connection !== conn) return;
        try { conn.destroy(); } catch {}
        clearState();
      };

      if (!autoReconnect) {
        state.lastError = 'disconnected (autoReconnect = false)';
        logger?.warn(`Voice disconnect — autoReconnect = false, không retry (${state.reconnectAttempts}/${maxAttempts})`);
        failAndClear();
        return;
      }

      if (state.reconnectAttempts >= maxAttempts) {
        state.lastError = `disconnect — vượt ${maxAttempts} lần retry`;
        logger?.warn(`Voice disconnect — vượt ${maxAttempts} lần retry (${state.reconnectAttempts}/${maxAttempts}), destroy`);
        failAndClear();
        return;
      }

      state.reconnectAttempts++;
      const attempt = state.reconnectAttempts;

      try {
        await Promise.race([
          entersState(conn, VoiceConnectionStatus.Signalling, 5000),
          entersState(conn, VoiceConnectionStatus.Connecting, 5000),
        ]);
        logger?.voice(`Voice reconnecting... (${attempt}/${maxAttempts})`);
        try { stats?.bump?.('voiceReconnects'); } catch {}
      } catch (e) {
        state.lastError = `reconnect fail: ${e?.message ?? e}`;
        logger?.warn(`Voice reconnect fail (${attempt}/${maxAttempts}): ${e?.message ?? e}`);
        failAndClear();
      }
    } catch (e) {
      state.lastError = e?.message ?? String(e);
      logger?.warn(`Voice disconnect handler (${state.reconnectAttempts}/${maxAttempts}): ${e?.message ?? e}`);
      if (state.connection === conn) {
        try { conn.destroy(); } catch {}
        clearState();
      }
    }
  }

  conn.on(VoiceConnectionStatus.Ready, () => {
    if (state.connection !== conn) return;
    if (state.reconnectAttempts > 0) {
      logger?.voice('Voice reconnect thành công — reset counter');
      state.reconnectAttempts = 0;
    }
  });

  conn.on(VoiceConnectionStatus.Destroyed, () => {
    if (state.connection === conn) clearState();
  });

  return conn;
}

export async function leaveVoice({ logger, stats } = {}) {
  const targets = [state.connection, state.pending].filter(Boolean);
  if (!targets.length) return false;

  clearState();
  state.lastError = null;

  logger?.voice('Leave voice...');
  for (const conn of targets) {
    try { conn.destroy(); } catch (e) { logger?.error(`leaveVoice: ${e.message}`); }
  }

  stats?.bump?.('voiceLeaves');
  logger?.voice('✓ Đã rời voice');
  return true;
}

export function getVoiceState() {
  return {
    connected: !!state.connection,
    connecting: state.connecting,
    guildId: state.guildId,
    channelId: state.channelId,
    status: state.connection?.state?.status ?? null,
    connection: state.connection,
    reconnectAttempts: state.reconnectAttempts,
    lastError: state.lastError,
  };
}

export function getCurrentConnection() {
  return state.connection;
}
