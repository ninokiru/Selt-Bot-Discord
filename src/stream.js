import { spawnSync } from 'node:child_process';
import { getVoiceState, joinVoice, leaveVoice, isVoiceChannel } from './voiceSession.js';
import { cancel as cancelVoiceConfirm } from './voiceConfirm.js';
import { isShuttingDown } from './shutdown.js';

const state = {
  active: false,
  starting: false,
  stopping: false,
  guildId: null,
  channelId: null,
  guildName: '',
  channelName: '',
  startedAt: 0,
  connection: null,
  streamConnection: null,
  dispatcher: null,
  previousVoice: null,
  viewerCount: 0,
  sawFrame: false,
  lastLog: '',
  startFrameTimer: null,
};

const PRESETS = new Set([
  'ultrafast', 'superfast', 'veryfast', 'faster',
  'fast', 'medium', 'slow', 'slower', 'veryslow',
]);

let ffmpegBin;

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function even(n) {
  return n % 2 === 0 ? n : n - 1;
}

function sanitizePreset(value) {
  const p = String(value || '').trim();
  return PRESETS.has(p) ? p : 'faster';
}

function probeFfmpeg(bin) {
  try {
    const r = spawnSync(bin, ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    if (r.error || r.status !== 0) return false;
    return /\blibx264\b/.test(r.stdout || '');
  } catch {
    return false;
  }
}

async function resolveFfmpeg(logger) {
  if (ffmpegBin) return ffmpegBin;

  const candidates = [];
  try {
    const mod = await import('ffmpeg-static');
    const p = mod?.default ?? mod;
    if (typeof p === 'string' && p) candidates.push(p);
    else if (typeof p?.path === 'string' && p.path) candidates.push(p.path);
  } catch {}

  candidates.push('ffmpeg');

  for (const bin of candidates) {
    if (probeFfmpeg(bin)) {
      ffmpegBin = bin;
      logger?.debug(`ffmpeg: ${bin}`);
      return bin;
    }
  }

  return null;
}

function buildCapture(cfg) {
  const fps = clampInt(cfg.fps, 5, 60, 30);
  const cursor = cfg.captureCursor !== false;
  const src = String(cfg.captureSource || '').trim();

  if (process.platform === 'win32') {
    return {
      input: src || 'desktop',
      args: ['-hide_banner', '-loglevel', 'warning', '-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', cursor ? '1' : '0'],
    };
  }

  if (process.platform === 'darwin') {
    return {
      input: src || '1:none',
      args: ['-hide_banner', '-loglevel', 'warning', '-f', 'avfoundation', '-framerate', String(fps), '-capture_cursor', cursor ? '1' : '0', '-capture_mouse_clicks', '0'],
    };
  }

  return {
    input: src || process.env.DISPLAY || ':0.0',
    args: ['-hide_banner', '-loglevel', 'warning', '-f', 'x11grab', '-thread_queue_size', '512', '-framerate', String(fps), '-draw_mouse', cursor ? '1' : '0'],
  };
}

function buildVideoFilter(width, height) {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    'format=yuv420p',
  ].join(',');
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    if (timer.unref) timer.unref();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function resolveTarget({ client, channelId }) {
  if (channelId) {
    for (const guild of client.guilds?.cache?.values?.() || []) {
      const channel = guild.channels?.cache?.get?.(channelId);
      if (channel) return { guild, channel };
    }
    return null;
  }

  const vs = getVoiceState();
  if (!vs.connected) return null;

  const guild = client.guilds?.cache?.get(vs.guildId);
  const channel = guild?.channels?.cache?.get(vs.channelId);
  if (!guild || !channel) return null;
  return { guild, channel };
}

function joinHint(message) {
  const hint = /timeout|closed|4014|4006|4015|dave/i.test(message)
    ? ' — Discord có thể đã chặn vì DAVE/E2EE (lib native chưa hỗ trợ stream)'
    : '';
  return `Stream join fail: ${message}${hint}`;
}

function clearStartTimer() {
  if (state.startFrameTimer) {
    clearTimeout(state.startFrameTimer);
    state.startFrameTimer = null;
  }
}

function resetRuntime() {
  clearStartTimer();
  state.active = false;
  state.starting = false;
  state.guildId = null;
  state.channelId = null;
  state.guildName = '';
  state.channelName = '';
  state.startedAt = 0;
  state.connection = null;
  state.streamConnection = null;
  state.dispatcher = null;
  state.previousVoice = null;
  state.viewerCount = 0;
  state.sawFrame = false;
  state.lastLog = '';
}

function bindNative(conn, ctx) {
  const { logger, stats } = ctx;

  conn.on('error', (e) => {
    const msg = e?.message || String(e);
    state.lastLog = msg.slice(0, 300);
    logger?.error(`Stream voice error: ${msg}`);
    stats?.bump?.('errors');
    if (state.active && !state.stopping) {
      void stopStream({ ...ctx, reason: `voice error: ${msg}` });
    }
  });

  conn.on('warn', (e) => {
    logger?.debug(`Stream voice warn: ${e?.message || e}`);
  });

  conn.on('disconnect', () => {
    if (state.active && !state.stopping) {
      void stopStream({ ...ctx, reason: 'voice disconnect' });
    }
  });

  conn.on('debug', (msg) => {
    const s = String(msg || '');
    const marker = '[ffmpeg-video_process]';
    if (!s.includes(marker)) return;
    const line = s.slice(s.indexOf(marker) + marker.length).trim();
    if (!line) return;
    state.lastLog = line.slice(0, 300);
    logger?.debug(`ffmpeg: ${state.lastLog}`);
  });
}

function bindStream(streamConn, ctx) {
  const { logger, stats } = ctx;

  streamConn.on('error', (e) => {
    const msg = e?.message || String(e);
    state.lastLog = msg.slice(0, 300);
    logger?.error(`Stream error: ${msg}`);
    stats?.bump?.('errors');
    if (state.active && !state.stopping) {
      void stopStream({ ...ctx, reason: `stream error: ${msg}` });
    }
  });

  streamConn.on('warn', (e) => {
    logger?.debug(`Stream warn: ${e?.message || e}`);
  });

  streamConn.on('disconnect', () => {
    if (state.active && !state.stopping) {
      void stopStream({ ...ctx, reason: 'stream disconnect' });
    }
  });

  streamConn.on('streamUpdate', (oldData, newData) => {
    state.viewerCount = newData?.viewerIds?.length ?? 0;
  });
}

function bindDispatcher(dispatcher, ctx) {
  const { logger } = ctx;

  dispatcher.on('start', () => {
    state.sawFrame = true;
    clearStartTimer();
    logger?.voice('Stream đã gửi frame đầu tiên');
  });

  dispatcher.on('error', (e) => {
    const msg = e?.message || String(e);
    state.lastLog = msg.slice(0, 300);
    logger?.error(`Stream ffmpeg: ${msg}`);
    if (state.active && !state.stopping) {
      void stopStream({ ...ctx, reason: `ffmpeg: ${msg}` });
    }
  });

  // Video dispatcher báo lỗi ffmpeg qua 'debug' (không phải 'error')
  dispatcher.on('debug', (m) => {
    const s = String(m?.message || m || '');
    if (!s) return;
    if (/ffmpeg stream:|input stream:|Failed to send a packet/i.test(s)) {
      state.lastLog = s.slice(0, 300);
      logger?.error(`Stream ffmpeg: ${s}`);
      if (state.active && !state.stopping) {
        void stopStream({ ...ctx, reason: s });
      }
    }
  });

  dispatcher.on('finish', () => {
    if (state.active && !state.stopping) {
      void stopStream({ ...ctx, reason: 'ffmpeg kết thúc' });
    }
  });
}

export function getStreamState() {
  return {
    active: state.active,
    starting: state.starting,
    stopping: state.stopping,
    guildId: state.guildId,
    channelId: state.channelId,
    guildName: state.guildName,
    channelName: state.channelName,
    startedAt: state.startedAt,
    viewerCount: state.viewerCount,
    lastError: state.lastLog,
  };
}

export function isStreaming() {
  return state.active || state.starting;
}

export async function startStream({ client, channelId, config, logger, stats }) {
  if (isShuttingDown()) throw new Error('Đang dừng selfbot');
  if (state.active) throw new Error('Đang stream — dùng .stream stop trước');
  if (state.starting) throw new Error('Đang khởi động stream — chờ chút');
  if (state.stopping) throw new Error('Đang dừng stream — chờ chút');

  const cfg = config?.stream || {};
  if (cfg.enabled === false) throw new Error('Stream đang tắt trong config (stream.enabled = false)');

  const target = resolveTarget({ client, channelId });
  if (!target) {
    if (channelId) throw new Error(`Không tìm thấy channel "${channelId}"`);
    throw new Error('Chưa ở voice channel nào — dùng .stream <channel_id>');
  }
  if (!isVoiceChannel(target.channel)) {
    throw new Error(`"${target.channel.name}" không phải voice channel`);
  }
  if (target.channel.joinable === false) {
    throw new Error(`Không thể join "${target.channel.name}" (thiếu quyền?)`);
  }

  const vs = getVoiceState();
  if (vs.connecting) throw new Error('Đang kết nối voice — thử lại sau');

  state.starting = true;

  const ffmpeg = await resolveFfmpeg(logger);
  if (!state.starting || isShuttingDown()) {
    state.starting = false;
    throw new Error('Đã huỷ stream');
  }
  if (!ffmpeg) {
    state.starting = false;
    throw new Error('Không tìm thấy ffmpeg có libx264 — chạy npm install (ffmpeg-static) hoặc cài ffmpeg vào PATH');
  }

  try { cancelVoiceConfirm(); } catch {}

  const ctx = { client, config, logger, stats };

  state.previousVoice = vs.connected ? { guildId: vs.guildId, channelId: vs.channelId } : null;
  state.guildId = target.guild.id;
  state.channelId = target.channel.id;
  state.guildName = target.guild.name || '';
  state.channelName = target.channel.name || '';
  state.viewerCount = 0;
  state.sawFrame = false;
  state.lastLog = '';

  try {
    // Native stack và @discordjs/voice không được cùng chiếm voice session
    if (state.previousVoice) await leaveVoice({ logger, stats });
    if (isShuttingDown() || state.stopping) throw new Error('Đã huỷ stream');

    try { client.voice.connection?.disconnect(); } catch {}

    const conn = await client.voice.joinChannel(target.channel, {
      selfMute: config?.voice?.selfMute ?? false,
      selfDeaf: config?.voice?.selfDeaf ?? true,
      selfVideo: false,
      videoCodec: 'H264',
    });
    state.connection = conn;
    bindNative(conn, ctx);
    if (isShuttingDown() || state.stopping) {
      try { conn.disconnect(); } catch {}
      throw new Error('Đã huỷ stream');
    }

    const streamConn = await withTimeout(
      conn.createStreamConnection(),
      20000,
      'Stream connection timeout',
    );
    state.streamConnection = streamConn;
    bindStream(streamConn, ctx);
    if (isShuttingDown() || state.stopping) {
      try { streamConn.disconnect(); } catch {}
      throw new Error('Đã huỷ stream');
    }

    const cap = buildCapture(cfg);
    const width = even(clampInt(cfg.width, 320, 2560, 1280));
    const height = even(clampInt(cfg.height, 240, 1440, 720));
    const fps = clampInt(cfg.fps, 5, 60, 30);
    const bitrate = clampInt(cfg.bitrateKbps, 500, 8000, 2500);

    logger?.voice(`Capture ${cap.input} → ${width}x${height}@${fps} · ${bitrate} kbps`);

    const dispatcher = streamConn.playVideo(cap.input, {
      fps,
      bitrate,
      presetH26x: sanitizePreset(cfg.preset),
      inputFFmpegArgs: cap.args,
      outputFFmpegArgs: [
        '-vf', buildVideoFilter(width, height),
        '-pix_fmt', 'yuv420p',
        '-g', String(fps * 2),
      ],
    });
    state.dispatcher = dispatcher;
    bindDispatcher(dispatcher, ctx);

    state.active = true;
    state.startedAt = Date.now();
    stats?.bump?.('streamStarts');
    logger?.ok(`Stream live: ${state.guildName}/${state.channelName}`);

    state.startFrameTimer = setTimeout(() => {
      if (!state.active || state.stopping || state.sawFrame) return;
      void stopStream({ ...ctx, reason: 'không nhận được frame sau 15s' });
    }, 15000);
    if (state.startFrameTimer.unref) state.startFrameTimer.unref();

    return { guildName: state.guildName, channelName: state.channelName };
  } catch (e) {
    const msg = e?.message || String(e);
    try {
      await stopStream({ ...ctx, restore: true, reason: `start fail: ${msg}` });
    } catch {}
    throw new Error(joinHint(msg));
  } finally {
    state.starting = false;
  }
}

export async function stopStream({
  client,
  config,
  logger,
  stats,
  restore = true,
  reason = '',
} = {}) {
  if (state.stopping) return false;
  if (!state.active && !state.starting && !state.connection && !state.streamConnection) return false;

  state.stopping = true;

  const snap = {
    active: state.active,
    connection: state.connection,
    streamConnection: state.streamConnection,
    dispatcher: state.dispatcher,
    previousVoice: state.previousVoice,
    lastLog: state.lastLog,
  };

  resetRuntime();

  try { snap.dispatcher?.destroy(); } catch {}
  try { snap.streamConnection?.disconnect(); } catch {}
  try { snap.connection?.disconnect(); } catch {}
  try {
    if (client?.voice?.connection && client.voice.connection !== snap.connection) {
      client.voice.connection.disconnect();
    }
  } catch {}

  if (snap.active) stats?.bump?.('streamStops');

  if (reason) {
    const detail = snap.lastLog ? ` (${snap.lastLog.slice(0, 160)})` : '';
    logger?.warn(`Stream dừng: ${reason}${detail}`);
  } else if (snap.active) {
    logger?.voice('Đã dừng stream');
  }

  if (
    restore &&
    snap.previousVoice &&
    config?.stream?.restoreVoice !== false &&
    !isShuttingDown() &&
    client?.user
  ) {
    try {
      await joinVoice({
        client,
        guildId: snap.previousVoice.guildId,
        channelId: snap.previousVoice.channelId,
        config,
        logger,
        stats,
      });
      logger?.voice('Đã khôi phục voice');
    } catch (e) {
      logger?.warn(`Khôi phục voice fail: ${e.message}`);
    }
  }

  state.stopping = false;
  return true;
}
