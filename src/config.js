import fs from 'node:fs';

const DEFAULTS = {
  sessionMaxMinutes: 360,
  sessionWarnMinutes: 300,
  sessionAutoStop: true,
  sessionLogFile: 'session.log',
  dashboard: true,
  tokenEnv: 'DISCORD_TOKEN',

  status: {
    type: 'PLAYING',
    text: '',
  },

  commands: {
    prefix: '.',
    dmSelfEnabled: true,
    channelEnabled: true,
    consoleEnabled: true,
    rateLimit: {
      enabled: true,
      windowMs: 60000,
      maxCommands: 10,
      cooldownMs: 1500,
      ignoreDuplicateMs: 3000,
      silentOnLimit: true,
    },
  },

  typingDelay: {
    baseMinMs: 500,
    baseMaxMs: 1200,
    perCharMs: 15,
    maxMs: 3500,
    jitterMinMs: 0,
    jitterMaxMs: 800,
  },

  antiDetection: {
    reactDelayMinMs: 200,
    reactDelayMaxMs: 800,
  },

  voice: {
    autoReconnect: true,
    reconnectMaxAttempts: 3,
    selfDeaf: true,
    selfMute: false,
  },

  stream: {
    enabled: true,
    width: 1280,
    height: 720,
    fps: 30,
    bitrateKbps: 2500,
    preset: 'faster',
    captureSource: '',
    captureCursor: true,
    restoreVoice: true,
  },

  afk: {
    cooldownMs: 60000,
    cooldownMode: 'per_user',
    maxReasonLen: 200,
    replyTemplate: 'Đang AFK: {reason} ({duration})',
    noReasonTemplate: 'Đang AFK — sẽ trả lời sau ({duration})',
    backTemplate: 'Đã trở lại — cảm ơn đã ping',
    reactEmoji: '💤',
    autoDisableOnActivity: true,
    announceBack: true,
    dmReply: false,
    ignoreBots: true,
    ignoreUsers: [],
    ignoreChannels: [],
    silentMode: false,
    persist: true,
  },

  debug: false,
};

const STREAM_PRESETS = new Set([
  'ultrafast', 'superfast', 'veryfast', 'faster',
  'fast', 'medium', 'slow', 'slower', 'veryslow',
]);

const STATUS_TYPES = new Set(['PLAYING', 'STREAMING', 'LISTENING', 'WATCHING', 'CUSTOM', 'COMPETING']);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}

function merge(base, override) {
  if (!isPlainObject(override)) return clone(base);
  const out = clone(base);
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? merge(out[k], v) : clone(v);
  }
  return out;
}

function intIn(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function stringOr(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function ensureEven(n) {
  return n % 2 === 0 ? n : n - 1;
}

function validate(config, warnings) {
  const warn = (msg) => warnings.push(msg);

  for (const key of ['status', 'commands', 'typingDelay', 'antiDetection', 'voice', 'stream', 'afk']) {
    if (!isPlainObject(config[key])) {
      config[key] = clone(DEFAULTS[key]);
      warn(`${key} phải là object — dùng mặc định`);
    }
  }
  if (!isPlainObject(config.commands.rateLimit)) {
    config.commands.rateLimit = clone(DEFAULTS.commands.rateLimit);
    warn('commands.rateLimit phải là object — dùng mặc định');
  }

  const maxMin = intIn(config.sessionMaxMinutes, DEFAULTS.sessionMaxMinutes, 1, 24 * 60);
  if (maxMin !== config.sessionMaxMinutes) warn(`sessionMaxMinutes không hợp lệ — dùng ${maxMin}`);
  config.sessionMaxMinutes = maxMin;

  let warnMin = intIn(config.sessionWarnMinutes, DEFAULTS.sessionWarnMinutes, 0, 24 * 60);
  if (warnMin >= maxMin) warnMin = Math.max(0, maxMin - 1);
  if (warnMin !== config.sessionWarnMinutes) warn(`sessionWarnMinutes không hợp lệ — dùng ${warnMin}`);
  config.sessionWarnMinutes = warnMin;

  config.sessionAutoStop = boolOr(config.sessionAutoStop, DEFAULTS.sessionAutoStop);
  config.sessionLogFile = stringOr(config.sessionLogFile, DEFAULTS.sessionLogFile).trim() || DEFAULTS.sessionLogFile;
  config.dashboard = boolOr(config.dashboard, DEFAULTS.dashboard);
  config.tokenEnv = stringOr(config.tokenEnv, DEFAULTS.tokenEnv).trim();
  config.debug = boolOr(config.debug, DEFAULTS.debug);

  const status = config.status;
  status.type = String(status.type || 'PLAYING').toUpperCase();
  if (!STATUS_TYPES.has(status.type)) {
    warn(`status.type "${status.type}" không hợp lệ — dùng PLAYING`);
    status.type = 'PLAYING';
  }
  status.text = String(status.text ?? '').slice(0, 128);

  const cmd = config.commands;
  cmd.prefix = stringOr(cmd.prefix, DEFAULTS.commands.prefix);
  if (!cmd.prefix) {
    warn('commands.prefix rỗng — dùng "."');
    cmd.prefix = '.';
  }
  cmd.dmSelfEnabled = boolOr(cmd.dmSelfEnabled, true);
  cmd.channelEnabled = boolOr(cmd.channelEnabled, true);
  cmd.consoleEnabled = boolOr(cmd.consoleEnabled, true);

  const rl = cmd.rateLimit;
  rl.enabled = boolOr(rl.enabled, true);
  rl.windowMs = intIn(rl.windowMs, 60000, 1000, 60 * 60 * 1000);
  rl.maxCommands = intIn(rl.maxCommands, 10, 1, 1000);
  rl.cooldownMs = intIn(rl.cooldownMs, 1500, 0, 60 * 60 * 1000);
  rl.ignoreDuplicateMs = intIn(rl.ignoreDuplicateMs, 3000, 0, 60 * 60 * 1000);
  rl.silentOnLimit = boolOr(rl.silentOnLimit, true);

  const td = config.typingDelay;
  td.baseMinMs = intIn(td.baseMinMs, 500, 0, 60000);
  td.baseMaxMs = intIn(td.baseMaxMs, 1200, td.baseMinMs, 60000);
  td.perCharMs = intIn(td.perCharMs, 15, 0, 1000);
  td.maxMs = intIn(td.maxMs, 3500, 0, 60000);
  td.jitterMinMs = intIn(td.jitterMinMs, 0, 0, 60000);
  td.jitterMaxMs = intIn(td.jitterMaxMs, 800, td.jitterMinMs, 60000);

  const anti = config.antiDetection;
  anti.reactDelayMinMs = intIn(anti.reactDelayMinMs, 200, 0, 60000);
  anti.reactDelayMaxMs = intIn(anti.reactDelayMaxMs, 800, anti.reactDelayMinMs, 60000);

  const voice = config.voice;
  voice.autoReconnect = boolOr(voice.autoReconnect, true);
  voice.reconnectMaxAttempts = intIn(voice.reconnectMaxAttempts, 3, 0, 20);
  voice.selfDeaf = boolOr(voice.selfDeaf, true);
  voice.selfMute = boolOr(voice.selfMute, false);

  const stream = config.stream;
  stream.enabled = boolOr(stream.enabled, true);
  stream.width = ensureEven(intIn(stream.width, 1280, 320, 2560));
  stream.height = ensureEven(intIn(stream.height, 720, 240, 1440));
  stream.fps = intIn(stream.fps, 30, 5, 60);
  stream.bitrateKbps = intIn(stream.bitrateKbps, 2500, 500, 8000);
  stream.preset = String(stream.preset || 'faster').toLowerCase();
  if (!STREAM_PRESETS.has(stream.preset)) {
    warn(`stream.preset "${stream.preset}" không hợp lệ — dùng faster`);
    stream.preset = 'faster';
  }
  stream.captureSource = stringOr(stream.captureSource, '');
  stream.captureCursor = boolOr(stream.captureCursor, true);
  stream.restoreVoice = boolOr(stream.restoreVoice, true);

  const afk = config.afk;
  afk.cooldownMs = intIn(afk.cooldownMs, 60000, 0, 24 * 60 * 60 * 1000);
  afk.cooldownMode = ['per_user', 'global', 'none'].includes(afk.cooldownMode)
    ? afk.cooldownMode
    : 'per_user';
  afk.maxReasonLen = intIn(afk.maxReasonLen, 200, 1, 1000);
  afk.replyTemplate = stringOr(afk.replyTemplate, DEFAULTS.afk.replyTemplate);
  afk.noReasonTemplate = stringOr(afk.noReasonTemplate, DEFAULTS.afk.noReasonTemplate);
  afk.backTemplate = stringOr(afk.backTemplate, DEFAULTS.afk.backTemplate);
  afk.reactEmoji = String(afk.reactEmoji ?? '');
  afk.autoDisableOnActivity = boolOr(afk.autoDisableOnActivity, true);
  afk.announceBack = boolOr(afk.announceBack, true);
  afk.dmReply = boolOr(afk.dmReply, false);
  afk.ignoreBots = boolOr(afk.ignoreBots, true);
  afk.ignoreUsers = Array.isArray(afk.ignoreUsers) ? afk.ignoreUsers.map(String) : [];
  afk.ignoreChannels = Array.isArray(afk.ignoreChannels) ? afk.ignoreChannels.map(String) : [];
  afk.silentMode = boolOr(afk.silentMode, false);
  afk.persist = boolOr(afk.persist, true);

  return config;
}

export function loadConfig(file) {
  let rawText;
  try {
    rawText = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    throw new Error(e.code === 'ENOENT' ? `Không tìm thấy ${file}` : `Đọc ${file} fail: ${e.message}`);
  }

  let raw;
  try {
    raw = JSON.parse(rawText || '{}');
  } catch (e) {
    throw new Error(`${file} sai JSON: ${e.message}`);
  }

  if (!isPlainObject(raw)) throw new Error(`${file} phải là object`);

  const warnings = [];
  const config = validate(merge(DEFAULTS, raw), warnings);
  return { config, warnings };
}

export { DEFAULTS };
