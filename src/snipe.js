import { getCachedMessage, deleteCached, updateCachedMessage } from './messageCache.js';

const MAX_PER_CHANNEL = 10;
const MAX_CHANNELS = 400;
const MAX_AGE_MS = 60 * 60 * 1000;          // TTL 60 phút
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const EDIT_DEDUPE_MS = 10 * 1000;
const MAX_CONTENT_LEN = 4000;
const MAX_TAG_LEN = 100;
const MAX_ATTACHMENTS = 10;
const MAX_MENTIONS = 10;
const MAX_STICKERS = 5;
const MAX_RECENT_EDITS = 1000;

const snipes = new Map();       // channelId → [deleted messages]
const editSnipes = new Map();   // channelId → [edited messages]
const channelActivity = new Map(); // channelId → last touch (LRU)
const recentEdits = new Map();  // "messageId\0newContent" → timestamp

let cleanupTimer = null;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

function capStr(value, limit) {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.length > limit ? str.slice(0, limit) : str;
}

function listOf(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input.values === 'function') return [...input.values()];
  return [];
}

function pushCapped(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  const arr = map.get(key);
  arr.unshift(value);
  if (arr.length > MAX_PER_CHANNEL) arr.length = MAX_PER_CHANNEL;
}

function touchChannel(channelId) {
  channelActivity.delete(channelId);
  channelActivity.set(channelId, Date.now());

  while (channelActivity.size > MAX_CHANNELS) {
    const oldest = channelActivity.keys().next().value;
    if (oldest === undefined) break;
    channelActivity.delete(oldest);
    snipes.delete(oldest);
    editSnipes.delete(oldest);
  }
}

function pruneByAge(map, tsField, now) {
  for (const [channelId, arr] of map) {
    const kept = arr.filter((e) => {
      const t = Number(e?.[tsField]);
      return Number.isFinite(t) && now - t <= MAX_AGE_MS;
    });
    if (kept.length) map.set(channelId, kept);
    else map.delete(channelId);
  }
}

function cleanup() {
  const now = Date.now();

  pruneByAge(snipes, 'deletedAt', now);
  pruneByAge(editSnipes, 'editedAt', now);

  for (const channelId of channelActivity.keys()) {
    if (!snipes.has(channelId) && !editSnipes.has(channelId)) {
      channelActivity.delete(channelId);
    }
  }

  for (const [key, at] of recentEdits) {
    if (now - at > EDIT_DEDUPE_MS) recentEdits.delete(key);
  }
}

function isDuplicateEdit(messageId, newContent) {
  const key = `${messageId}\u0000${newContent}`;
  const now = Date.now();
  const last = recentEdits.get(key);

  if (last !== undefined && now - last < EDIT_DEDUPE_MS) return true;

  recentEdits.delete(key);
  recentEdits.set(key, now);
  if (recentEdits.size > MAX_RECENT_EDITS) {
    const oldest = recentEdits.keys().next().value;
    if (oldest !== undefined) recentEdits.delete(oldest);
  }
  return false;
}

function getAt(map, key, index = 0) {
  const arr = map.get(key);
  if (!arr || !arr.length) return null;
  const i = Math.max(0, index | 0);
  return arr[i] || null;
}

// ── Deleted message ──────────────────────────────────────
export function recordDelete(msg) {
  const channelId = msg?.channel?.id;
  if (!channelId) return;

  // Bỏ qua event trùng cho cùng messageId trong channel
  const existing = snipes.get(channelId);
  if (msg.id && existing?.some((e) => e.messageId === msg.id)) return;

  // Ưu tiên lấy từ message cache (có content đầy đủ)
  const cached = getCachedMessage(msg.id);

  const author = msg.author || {};
  const cachedAuthor = cached
    ? { id: cached.authorId, tag: cached.authorTag, bot: cached.authorBot }
    : null;

  const entry = {
    messageId: msg.id,
    channelId,
    guildId: msg.guild?.id || null,

    authorId: author.id || cachedAuthor?.id || null,
    authorTag: capStr(author.tag || author.username || cachedAuthor?.tag || 'unknown', MAX_TAG_LEN),
    authorBot: !!author.bot || !!cachedAuthor?.bot,

    content: capStr(msg.content || cached?.content || '', MAX_CONTENT_LEN),
    attachments: cached?.attachments
      ? cached.attachments.slice(0, MAX_ATTACHMENTS)
      : listOf(msg.attachments).slice(0, MAX_ATTACHMENTS).map((a) => ({
        name: a?.name,
        url: a?.url,
        size: a?.size,
        contentType: a?.contentType,
      })),
    embeds: cached?.embeds ?? (msg.embeds || []).length,
    stickers: (cached?.stickers || listOf(msg.stickers).map((s) => s?.name))
      .filter(Boolean)
      .slice(0, MAX_STICKERS),
    mentionedUsers: (cached?.mentionedUsers || listOf(msg.mentions?.users).map((u) => ({
      id: u?.id,
      tag: capStr(u?.tag || u?.username || 'unknown', MAX_TAG_LEN),
    })))
      .slice(0, MAX_MENTIONS),

    deletedAt: Date.now(),
    createdAt: msg.createdTimestamp || cached?.createdAt || null,
    fromCache: !!cached?.content,
  };

  pushCapped(snipes, channelId, entry);
  touchChannel(channelId);
  ensureCleanup();

  // Cleanup cache sau khi đã dùng
  if (cached) deleteCached(msg.id);
}

// ── Edited message ───────────────────────────────────────
export function recordEdit(oldMsg, newMsg) {
  const channelId = newMsg?.channel?.id || oldMsg?.channel?.id;
  const messageId = newMsg?.id || oldMsg?.id;
  if (!channelId || !messageId) return;

  // Lấy content cũ — ưu tiên cached (nếu message đã bị edit nhiều lần)
  const cached = getCachedMessage(messageId);
  const oldContent = capStr(cached?.content ?? oldMsg?.content ?? '', MAX_CONTENT_LEN);

  // messageUpdate có thể là partial/thiếu content → lấy từ cache nếu có
  const rawNew = newMsg?.content;
  let newContent;
  if (typeof rawNew === 'string') {
    newContent = capStr(rawNew, MAX_CONTENT_LEN);
  } else if (typeof cached?.content === 'string') {
    newContent = capStr(cached.content, MAX_CONTENT_LEN);
  } else {
    return;
  }

  if (oldContent === newContent) return;
  if (isDuplicateEdit(messageId, newContent)) return;

  const author = newMsg?.author || oldMsg?.author || {};
  const entry = {
    messageId,
    channelId,
    guildId: newMsg?.guild?.id || oldMsg?.guild?.id || null,

    authorId: author.id || null,
    authorTag: capStr(author.tag || author.username || 'unknown', MAX_TAG_LEN),

    oldContent,
    newContent,

    editedAt: Date.now(),
    createdAt: newMsg?.createdTimestamp || oldMsg?.createdTimestamp || null,
  };

  pushCapped(editSnipes, channelId, entry);
  touchChannel(channelId);
  ensureCleanup();

  // Update cache với content mới
  updateCachedMessage(messageId, { content: newContent });
}

// ── Getters ──────────────────────────────────────────────
export function getSnipe(channelId, index = 0) {
  return getAt(snipes, channelId, index);
}

export function getEditSnipe(channelId, index = 0) {
  return getAt(editSnipes, channelId, index);
}

export function getAllSnipes(channelId) {
  return [...(snipes.get(channelId) || [])];
}

export function getAllEditSnipes(channelId) {
  return [...(editSnipes.get(channelId) || [])];
}

// Tìm snipe của 1 user cụ thể
export function findSnipeByUser(channelId, userId) {
  const arr = snipes.get(channelId) || [];
  return arr.find((e) => e.authorId === userId) || null;
}

export function findEditSnipeByUser(channelId, userId) {
  const arr = editSnipes.get(channelId) || [];
  return arr.find((e) => e.authorId === userId) || null;
}

// ── Cleanup ──────────────────────────────────────────────
export function clearSnipes(channelId) {
  if (channelId) {
    snipes.delete(channelId);
    editSnipes.delete(channelId);
    channelActivity.delete(channelId);
  } else {
    snipes.clear();
    editSnipes.clear();
    channelActivity.clear();
    recentEdits.clear();
  }
}

export function getStats() {
  let totalDeletes = 0;
  let totalEdits = 0;
  let fromCacheCount = 0;

  for (const arr of snipes.values()) {
    totalDeletes += arr.length;
    fromCacheCount += arr.filter((e) => e.fromCache).length;
  }
  for (const arr of editSnipes.values()) totalEdits += arr.length;

  return {
    totalDeletes,
    totalEdits,
    fromCacheCount,
    channels: snipes.size,
    maxPerChannel: MAX_PER_CHANNEL,
  };
}
