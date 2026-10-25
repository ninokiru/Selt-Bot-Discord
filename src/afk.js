import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtDur } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SELF_ROOT = path.resolve(__dirname, '..');
const AFK_FILE = path.join(SELF_ROOT, '.afk.json');

// ── Code-sent message tracking ───────────────────────────
const codeSentIds = new Map();   // messageId → timeout handle
const CODE_SENT_TTL_MS = 60 * 1000;

export function markCodeSent(messageId) {
  if (!messageId) return;
  // Clear timeout cũ nếu có
  const old = codeSentIds.get(messageId);
  if (old) clearTimeout(old);

  const t = setTimeout(() => {
    codeSentIds.delete(messageId);
  }, CODE_SENT_TTL_MS);
  if (t.unref) t.unref();

  codeSentIds.set(messageId, t);
}

export function isCodeSent(messageId) {
  if (!messageId) return false;
  return codeSentIds.has(messageId);
}

// ── Config defaults ──────────────────────────────────────
let cfg = {
  cooldownMs: 60000,
  cooldownMode: 'per_user',
  maxReasonLen: 200,
  replyTemplate: 'Đang AFK: {reason} ({duration})',
  noReasonTemplate: 'Đang AFK — sẽ trả lời sau ({duration})',
  backTemplate: 'Đã trở lại — cảm ơn đã ping',
  reactEmoji: '💤',
  autoDisableOnActivity: true,
  dmReply: false,
  ignoreBots: true,
  ignoreUsers: [],
  ignoreChannels: [],
  silentMode: false,
  persist: true,
  announceBack: true,
};

// ── State ────────────────────────────────────────────────
const state = {
  enabled: false,
  reason: '',
  setAt: null,
  userId: null,
  lastPingChannelId: null,
  lastPingMessageId: null,
  lastPingGuildId: null,
  cooldowns: new Map(),
  globalCooldownAt: 0,
  totalReplies: 0,
  totalPings: 0,
  perUser: new Map(),
};

export function initAfk(config) {
  const userCfg = config?.afk || {};

  for (const k of Object.keys(cfg)) {
    if (userCfg[k] !== undefined) cfg[k] = userCfg[k];
  }

  if (!['per_user', 'global', 'none'].includes(cfg.cooldownMode)) {
    cfg.cooldownMode = 'per_user';
  }
  if (!Array.isArray(cfg.ignoreUsers)) cfg.ignoreUsers = [];
  if (!Array.isArray(cfg.ignoreChannels)) cfg.ignoreChannels = [];

  if (cfg.persist) loadState();
}

// ── Persist ──────────────────────────────────────────────
function loadState() {
  try {
    if (!fs.existsSync(AFK_FILE)) return;
    const raw = fs.readFileSync(AFK_FILE, 'utf8').replace(/^\uFEFF/, '');
    if (!raw.trim()) return;
    const data = JSON.parse(raw);

    const setAt = data.setAt || 0;
    const age = Date.now() - setAt;
    if (age > 24 * 60 * 60 * 1000) return;

    state.enabled = !!data.enabled;
    state.reason = String(data.reason || '').slice(0, cfg.maxReasonLen);
    state.setAt = setAt || null;
    state.userId = data.userId || null;
    state.totalReplies = data.totalReplies | 0;
    state.totalPings = data.totalPings | 0;
    state.lastPingChannelId = data.lastPingChannelId || null;
    state.lastPingMessageId = data.lastPingMessageId || null;
    state.lastPingGuildId = data.lastPingGuildId || null;

    if (Array.isArray(data.perUser)) {
      for (const [uid, info] of data.perUser) {
        state.perUser.set(uid, info);
      }
    }
  } catch {}
}

function saveState() {
  if (!cfg.persist) return;
  try {
    const data = {
      enabled: state.enabled,
      reason: state.reason,
      setAt: state.setAt,
      userId: state.userId,
      totalReplies: state.totalReplies,
      totalPings: state.totalPings,
      lastPingChannelId: state.lastPingChannelId,
      lastPingMessageId: state.lastPingMessageId,
      lastPingGuildId: state.lastPingGuildId,
      perUser: [...state.perUser.entries()],
    };
    const tmp = `${AFK_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, AFK_FILE);
  } catch {}
}

// ── Public API ───────────────────────────────────────────
export function enableAfk(reason, userId) {
  state.enabled = true;
  state.reason = String(reason || '').trim().slice(0, cfg.maxReasonLen);
  state.setAt = Date.now();
  state.userId = userId;
  state.lastPingChannelId = null;
  state.lastPingMessageId = null;
  state.lastPingGuildId = null;
  state.cooldowns.clear();
  state.globalCooldownAt = 0;
  saveState();
}

export function disableAfk() {
  const was = state.enabled;
  const lastPing = {
    channelId: state.lastPingChannelId,
    guildId: state.lastPingGuildId,
    duration: state.setAt ? Date.now() - state.setAt : 0,
  };

  state.enabled = false;
  state.reason = '';
  state.setAt = null;
  state.cooldowns.clear();
  state.globalCooldownAt = 0;
  saveState();

  return { was, lastPing };
}

export function isAfk() {
  return state.enabled;
}

export function getAfk() {
  return {
    enabled: state.enabled,
    reason: state.reason,
    setAt: state.setAt,
    duration: state.setAt ? Date.now() - state.setAt : 0,
    totalReplies: state.totalReplies,
    totalPings: state.totalPings,
    topPingers: getTopPingers(5),
    cooldownMs: cfg.cooldownMs,
    cooldownMode: cfg.cooldownMode,
    silentMode: cfg.silentMode,
    reactEmoji: cfg.reactEmoji,
  };
}

export function getConfig() { return { ...cfg }; }
export function setConfig(partial) { Object.assign(cfg, partial); }

export function shouldIgnore(userId, channelId) {
  if (!userId) return true;
  if (cfg.ignoreUsers.includes(userId)) return true;
  if (channelId && cfg.ignoreChannels.includes(channelId)) return true;
  return false;
}

export function checkCooldown(userId) {
  if (!state.enabled) return false;
  if (cfg.cooldownMode === 'none') return true;

  const now = Date.now();

  if (cfg.cooldownMode === 'global') {
    if (now - state.globalCooldownAt < cfg.cooldownMs) return false;
    state.globalCooldownAt = now;
    return true;
  }

  const last = state.cooldowns.get(userId) || 0;
  if (now - last < cfg.cooldownMs) return false;
  state.cooldowns.set(userId, now);
  return true;
}

export function recordPing(userId, tag, channelId, messageId, guildId) {
  state.totalPings++;
  state.lastPingChannelId = channelId;
  state.lastPingMessageId = messageId;
  state.lastPingGuildId = guildId;

  const info = state.perUser.get(userId) || {
    tag: tag || userId,
    count: 0,
    lastAt: 0,
  };
  info.count++;
  info.lastAt = Date.now();
  info.tag = tag || info.tag;
  state.perUser.set(userId, info);

  saveState();
}

export function bumpReplyCount() {
  state.totalReplies++;
  saveState();
}

function getTopPingers(limit = 5) {
  return [...state.perUser.entries()]
    .map(([uid, info]) => ({ userId: uid, ...info }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ── Templates ────────────────────────────────────────────
export function renderReply({ userId, userTag }) {
  const duration = state.setAt ? fmtDur((Date.now() - state.setAt) / 1000) : '?';
  const mention = userId ? `<@${userId}>` : '';
  const pings = state.perUser.get(userId)?.count || 1;

  const vars = {
    user: mention,
    tag: userTag || 'ai đó',
    reason: state.reason || '',
    duration,
    pings,
  };

  const template = state.reason ? cfg.replyTemplate : cfg.noReasonTemplate;
  return interpolate(template, vars).trim();
}

function interpolate(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (m, key) => {
    return vars[key] !== undefined ? String(vars[key]) : m;
  });
}

export function renderBackMessage(afkDurationMs) {
  const dur = Number.isFinite(afkDurationMs)
    ? afkDurationMs
    : (state.setAt ? Date.now() - state.setAt : 0);
  return interpolate(cfg.backTemplate, {
    duration: fmtDur(dur / 1000),
  }).trim();
}

export function getLastPingChannel() {
  return {
    channelId: state.lastPingChannelId,
    messageId: state.lastPingMessageId,
    guildId: state.lastPingGuildId,
  };
}