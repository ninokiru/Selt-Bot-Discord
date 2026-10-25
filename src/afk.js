import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtDur } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SELF_ROOT = path.resolve(__dirname, '..');
const AFK_FILE = path.join(SELF_ROOT, '.afk.json');

const SAVE_DEBOUNCE_MS = 1000;
const MAX_PER_USER = 500;
const MAX_REASON_LEN = 500;
const MAX_TAG_LEN = 100;
const COOLDOWN_MIN_TTL_MS = 10 * 60 * 1000;
const COOLDOWN_PRUNE_EVERY_MS = 60 * 1000;

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

let saveTimer = null;
let saveDirty = false;
let lastCooldownPrune = 0;

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
  if (!Number.isFinite(cfg.cooldownMs) || cfg.cooldownMs < 0) cfg.cooldownMs = 60000;
  if (!Number.isFinite(cfg.maxReasonLen) || cfg.maxReasonLen <= 0) cfg.maxReasonLen = 200;

  if (cfg.persist) loadState();
}

// ── Persist ──────────────────────────────────────────────
function reasonLimit() {
  const n = Number(cfg.maxReasonLen);
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.min(Math.floor(n), MAX_REASON_LEN);
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function normalizePerUser(uid, info) {
  if (typeof uid !== 'string' || !uid) return null;
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null;

  const count = Number(info.count);
  const lastAt = Number(info.lastAt);
  if (!Number.isFinite(count) || !Number.isFinite(lastAt)) return null;

  return {
    tag: String(info.tag || uid).slice(0, MAX_TAG_LEN),
    count: Math.max(0, Math.floor(count)),
    lastAt: Math.max(0, Math.floor(lastAt)),
  };
}

function capPerUser() {
  while (state.perUser.size > MAX_PER_USER) {
    let oldestKey = null;
    let oldestAt = Infinity;

    for (const [uid, info] of state.perUser) {
      const t = Number(info?.lastAt);
      const at = Number.isFinite(t) ? t : 0;
      if (at < oldestAt) {
        oldestAt = at;
        oldestKey = uid;
      }
    }

    if (oldestKey === null) break;
    state.perUser.delete(oldestKey);
  }
}

function loadState() {
  try {
    if (!fs.existsSync(AFK_FILE)) return;
    const raw = fs.readFileSync(AFK_FILE, 'utf8').replace(/^\uFEFF/, '');
    if (!raw.trim()) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;

    const setAt = Number(data.setAt);
    if (!Number.isFinite(setAt) || setAt <= 0) return;
    const age = Date.now() - setAt;
    if (age > 24 * 60 * 60 * 1000) return;

    state.enabled = data.enabled === true;
    state.reason = String(data.reason ?? '').slice(0, reasonLimit());
    state.setAt = setAt;
    state.userId = typeof data.userId === 'string' ? data.userId : null;
    state.totalReplies = toCount(data.totalReplies);
    state.totalPings = toCount(data.totalPings);
    state.lastPingChannelId = typeof data.lastPingChannelId === 'string' ? data.lastPingChannelId : null;
    state.lastPingMessageId = typeof data.lastPingMessageId === 'string' ? data.lastPingMessageId : null;
    state.lastPingGuildId = typeof data.lastPingGuildId === 'string' ? data.lastPingGuildId : null;

    state.perUser.clear();
    if (Array.isArray(data.perUser)) {
      for (const item of data.perUser) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const info = normalizePerUser(item[0], item[1]);
        if (info) state.perUser.set(item[0], info);
      }
    }
    capPerUser();
  } catch {}
}

function writeState() {
  saveDirty = false;
  if (!cfg.persist) return;
  try {
    capPerUser();

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

// Ghi trễ tối đa 1 lần/giây cho các event không critical
function scheduleSave() {
  if (!cfg.persist) return;
  saveDirty = true;
  if (saveTimer) return;

  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (saveDirty) writeState();
  }, SAVE_DEBOUNCE_MS);
  if (saveTimer.unref) saveTimer.unref();
}

function saveStateNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeState();
}

// Force ghi state đang chờ (dùng khi shutdown)
export function flushAfk() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!saveDirty) return false;
  writeState();
  return true;
}

// ── Public API ───────────────────────────────────────────
export function enableAfk(reason, userId) {
  state.enabled = true;
  state.reason = String(reason || '').trim().slice(0, reasonLimit());
  state.setAt = Date.now();
  state.userId = userId;
  state.lastPingChannelId = null;
  state.lastPingMessageId = null;
  state.lastPingGuildId = null;
  state.cooldowns.clear();
  state.globalCooldownAt = 0;
  lastCooldownPrune = 0;
  saveStateNow();
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
  lastCooldownPrune = 0;
  saveStateNow();

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

// Dọn cooldown cũ — ngưỡng luôn lớn hơn cooldownMs nên không đổi semantics
function pruneCooldowns(now) {
  if (now - lastCooldownPrune < COOLDOWN_PRUNE_EVERY_MS) return;
  lastCooldownPrune = now;

  const cooldownMs = Number.isFinite(cfg.cooldownMs) ? Math.max(0, cfg.cooldownMs) : 0;
  const ttl = Math.max(cooldownMs * 2, COOLDOWN_MIN_TTL_MS);
  for (const [uid, ts] of state.cooldowns) {
    if (!Number.isFinite(ts) || now - ts > ttl) state.cooldowns.delete(uid);
  }
}

export function checkCooldown(userId) {
  if (!state.enabled) return false;

  const now = Date.now();
  pruneCooldowns(now);

  if (cfg.cooldownMode === 'none') return true;

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

  if (userId) {
    const info = state.perUser.get(userId) || {
      tag: String(tag || userId).slice(0, MAX_TAG_LEN),
      count: 0,
      lastAt: 0,
    };
    info.count++;
    info.lastAt = Date.now();
    info.tag = String(tag || info.tag).slice(0, MAX_TAG_LEN);
    state.perUser.set(userId, info);
    capPerUser();
  }

  scheduleSave();
}

export function bumpReplyCount() {
  state.totalReplies++;
  scheduleSave();
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
