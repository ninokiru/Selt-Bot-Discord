import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice';
import ffmpegStatic from 'ffmpeg-static';

if (ffmpegStatic) {
  process.env.FFMPEG_PATH = ffmpegStatic;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SELF_ROOT = path.resolve(__dirname, '..');

let ctx = { config: null, logger: null, stats: null };
let _voiceStateGetter = null;

export function initMusic(context) {
  ctx = { ...ctx, ...context };
}

export function registerVoiceStateGetter(fn) {
  _voiceStateGetter = fn;
}

function getVoiceState() {
  if (_voiceStateGetter) return _voiceStateGetter();
  return { connected: false, guildId: null, channelId: null, connection: null };
}

function log(level, msg) {
  const l = ctx.logger;
  if (l && typeof l[level] === 'function') l[level](msg);
}

function getYtDlpPath() {
  const configured = ctx.config?.music?.ytDlpPath || 'bin/yt-dlp.exe';
  const abs = path.isAbsolute(configured)
    ? configured
    : path.join(SELF_ROOT, configured);

  if (!fs.existsSync(abs)) {
    throw new Error(`yt-dlp không tồn tại: ${abs}`);
  }
  return abs;
}

const guildStates = new Map();

function ensureState(guildId) {
  if (guildStates.has(guildId)) return guildStates.get(guildId);

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });

  const state = {
    guildId,
    player,
    queue: [],
    current: null,
    resource: null,
    proc: null,
    volume: ctx.config?.music?.defaultVolume ?? 50,
    subscribed: false,
    playing: false,
  };

  player.on('error', (err) => {
    log('error', `Player error: ${err.message}`);
    ctx.stats?.bump?.('musicFailed');
    cleanupProcess(state);
  });

  player.on(AudioPlayerStatus.Idle, () => {
    state.current = null;
    state.resource = null;
    state.playing = false;
    cleanupProcess(state);
    setTimeout(() => tryPlayNext(state), 250);
  });

  player.on(AudioPlayerStatus.Playing, () => {
    state.playing = true;
  });

  guildStates.set(guildId, state);
  return state;
}

function cleanupProcess(state) {
  if (state.proc) {
    try { state.proc.kill('SIGTERM'); } catch {}
    state.proc = null;
  }
}

function isPlayerActive(state) {
  const s = state.player.state.status;
  return (
    s === AudioPlayerStatus.Playing ||
    s === AudioPlayerStatus.Paused ||
    s === AudioPlayerStatus.AutoPaused ||
    s === AudioPlayerStatus.Buffering
  );
}

function isUrl(str) {
  if (!str || typeof str !== 'string') return false;
  return /^https?:\/\//i.test(str.trim());
}

function fetchMetadata(query) {
  return new Promise((resolve, reject) => {
    let ytDlpPath;
    try {
      ytDlpPath = getYtDlpPath();
    } catch (e) {
      return reject(e);
    }

    const isURL = isUrl(query);
    const searchArg = isURL ? query : `ytsearch1:${query}`;

    const args = [
      '-j',
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      '--no-check-certificate',
      '-f', 'bestaudio/best',
      searchArg,
    ];

    const proc = spawn(ytDlpPath, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let out = '';
    let err = '';

    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });

    const killTimer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      reject(new Error('yt-dlp metadata timeout (30s)'));
    }, 30000);

    proc.on('error', (e) => {
      clearTimeout(killTimer);
      reject(new Error(`Không chạy được yt-dlp: ${e.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(killTimer);
      if (code !== 0) {
        return reject(new Error(`yt-dlp lỗi: ${err.trim().split('\n')[0] || `exit ${code}`}`));
      }
      if (!out.trim()) {
        return reject(new Error('Không có kết quả'));
      }
      try {
        const data = JSON.parse(out.trim().split('\n')[0]);
        resolve(data);
      } catch (e) {
        reject(new Error(`Parse metadata fail: ${e.message}`));
      }
    });
  });
}

function buildTrack(meta) {
  return {
    title: meta.title || 'Unknown',
    url: meta.webpage_url || meta.original_url || meta.url || null,
    directUrl: meta.url || null,
    durationInSec: Number.isFinite(meta.duration) ? Math.floor(meta.duration) : 0,
    thumbnail: meta.thumbnail || null,
    uploader: meta.uploader || meta.channel || null,
    extractor: meta.extractor_key || meta.extractor || 'unknown',
    isLive: !!meta.is_live,
  };
}

function spawnStream(directUrl) {
  const ytDlpPath = getYtDlpPath();

  const args = [
    '-f', 'bestaudio/best',
    '-o', '-',
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '--no-check-certificate',
    '--no-part',
    '--buffer-size', '1M',
    directUrl,
  ];

  return spawn(ytDlpPath, args, {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
}

async function tryPlayNext(state) {
  if (state.playing) return;
  if (state.player.state.status !== AudioPlayerStatus.Idle) return;
  if (state.queue.length === 0) return;

  const track = state.queue.shift();
  state.current = track;

  try {
    let directUrl = track.directUrl;
    if (!directUrl) {
      const meta = await fetchMetadata(track.url);
      directUrl = meta.url;
      if (!directUrl) throw new Error('Không lấy được direct URL');
      track.directUrl = directUrl;
    }

    if (state.current !== track) return;

    const proc = spawnStream(directUrl);
    state.proc = proc;

    proc.on('error', (e) => {
      log('error', `yt-dlp stream error: ${e.message}`);
    });

    proc.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line && ctx.config?.debug) {
        log('debug', `[yt-dlp] ${line}`);
      }
    });

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        log('warn', `yt-dlp exit ${code}`);
      }
    });

    const resource = createAudioResource(proc.stdout, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
    });

    if (resource.volume) {
      resource.volume.setVolume((state.volume ?? 50) / 100);
    }

    state.resource = resource;

    const vs = getVoiceState();
    if (!vs.connected || vs.guildId !== state.guildId) {
      log('warn', 'Voice chưa kết nối — dừng');
      cleanupProcess(state);
      return;
    }

    if (!state.subscribed) {
      vs.connection.subscribe(state.player);
      state.subscribed = true;
    }

    state.player.play(resource);
    ctx.stats?.bump?.('musicPlayed');
    log('music', `▶ ${track.title}`);
  } catch (e) {
    log('error', `Play "${track.title}" fail: ${e.message}`);
    ctx.stats?.bump?.('musicFailed');
    state.current = null;
    state.resource = null;
    cleanupProcess(state);

    if (state.queue.length > 0) {
      setTimeout(() => tryPlayNext(state), 500);
    }
  }
}

// ── Public API ────────────────────────────────────────────

export async function play({ query, config, logger, stats }) {
  if (config) ctx.config = config;
  if (logger) ctx.logger = logger;
  if (stats) ctx.stats = stats;

  const vs = getVoiceState();
  if (!vs.connected) {
    throw new Error('Chưa join voice — dùng .join <guild_id> <channel_id>');
  }

  const guildId = vs.guildId;
  const state = ensureState(guildId);

  const maxQueue = ctx.config?.music?.maxQueueSize ?? 30;
  if (state.queue.length >= maxQueue) {
    throw new Error(`Queue đầy (${maxQueue})`);
  }

  log('debug', `Resolve: ${query}`);
  const meta = await fetchMetadata(query);
  const track = buildTrack(meta);

  if (!track.url && !track.directUrl) {
    throw new Error('Không resolve được track');
  }

  if (track.isLive) {
    throw new Error('Live stream chưa hỗ trợ');
  }

  const maxDur = ctx.config?.music?.maxDurationSec ?? 1800;
  if (track.durationInSec > maxDur) {
    throw new Error(`Video quá dài: ${track.durationInSec}s > ${maxDur}s`);
  }

  state.queue.push(track);

  if (state.player.state.status === AudioPlayerStatus.Idle && !state.playing) {
    await tryPlayNext(state);
  }

  return track;
}

export function skip({ logger, stats } = {}) {
  const vs = getVoiceState();
  if (!vs.connected) return false;

  const state = guildStates.get(vs.guildId);
  if (!state) return false;
  if (!isPlayerActive(state) && state.queue.length === 0) return false;

  try {
    cleanupProcess(state);
    state.player.stop(true);
  } catch {
    return false;
  }

  ctx.stats?.bump?.('musicSkipped');
  return true;
}

export function pause({ logger } = {}) {
  const vs = getVoiceState();
  if (!vs.connected) return false;

  const state = guildStates.get(vs.guildId);
  if (!state) return false;
  if (state.player.state.status !== AudioPlayerStatus.Playing) return false;

  try {
    state.player.pause(true);
    return true;
  } catch {
    return false;
  }
}

export function resume({ logger } = {}) {
  const vs = getVoiceState();
  if (!vs.connected) return false;

  const state = guildStates.get(vs.guildId);
  if (!state) return false;

  const s = state.player.state.status;
  if (s !== AudioPlayerStatus.Paused && s !== AudioPlayerStatus.AutoPaused) return false;

  try {
    state.player.unpause();
    return true;
  } catch {
    return false;
  }
}

export function stopAll({ logger, stats } = {}) {
  const vs = getVoiceState();
  if (!vs.connected) return false;

  const state = guildStates.get(vs.guildId);
  if (!state) return false;

  state.queue = [];
  state.current = null;
  state.resource = null;

  try {
    cleanupProcess(state);
    if (isPlayerActive(state)) state.player.stop(true);
  } catch {}

  return true;
}

export function setVolume(volume) {
  const vs = getVoiceState();
  if (!vs.connected) return false;

  const state = guildStates.get(vs.guildId);
  if (!state) return false;

  state.volume = Math.max(0, Math.min(100, volume | 0));
  if (state.resource?.volume) {
    state.resource.volume.setVolume(state.volume / 100);
  }
  return true;
}

export function getQueueInfo() {
  const vs = getVoiceState();
  if (!vs.connected) return { current: null, queue: [] };

  const state = guildStates.get(vs.guildId);
  if (!state) return { current: null, queue: [] };

  return {
    current: state.current,
    queue: [...state.queue],
  };
}

export function getMusicState() {
  const vs = getVoiceState();
  if (!vs.connected) return null;
  return guildStates.get(vs.guildId) || null;
}

export function cleanupGuild(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return;

  try {
    state.queue = [];
    state.current = null;
    state.resource = null;
    cleanupProcess(state);
    if (isPlayerActive(state)) state.player.stop(true);
  } catch {}

  guildStates.delete(guildId);
}

export function destroyMusic() {
  for (const [, state] of guildStates) {
    try {
      state.queue = [];
      cleanupProcess(state);
      if (isPlayerActive(state)) state.player.stop(true);
    } catch {}
  }
  guildStates.clear();
}