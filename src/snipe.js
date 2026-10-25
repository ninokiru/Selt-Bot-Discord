import { getCachedMessage, deleteCached } from './messageCache.js';

const MAX_PER_CHANNEL = 10;

const snipes = new Map();       // channelId → [deleted messages]
const editSnipes = new Map();   // channelId → [edited messages]

function pushCapped(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  const arr = map.get(key);
  arr.unshift(value);
  if (arr.length > MAX_PER_CHANNEL) arr.length = MAX_PER_CHANNEL;
}

function getAt(map, key, index = 0) {
  const arr = map.get(key);
  if (!arr || !arr.length) return null;
  const i = Math.max(0, index | 0);
  return arr[i] || null;
}

// ── Deleted message ──────────────────────────────────────
export function recordDelete(msg) {
  if (!msg?.channel?.id) return;

  // Ưu tiên lấy từ message cache (có content đầy đủ)
  const cached = getCachedMessage(msg.id);

  const author = msg.author || {};
  const cachedAuthor = cached
    ? { id: cached.authorId, tag: cached.authorTag, bot: cached.authorBot }
    : null;

  const entry = {
    messageId: msg.id,
    channelId: msg.channel.id,
    guildId: msg.guild?.id || null,

    authorId: author.id || cachedAuthor?.id || null,
    authorTag: author.tag || author.username || cachedAuthor?.tag || 'unknown',
    authorBot: !!author.bot || !!cachedAuthor?.bot,

    content: msg.content || cached?.content || '',
    attachments: cached?.attachments || [...(msg.attachments?.values?.() || [])].map((a) => ({
      name: a.name,
      url: a.url,
      size: a.size,
      contentType: a.contentType,
    })),
    embeds: cached?.embeds ?? (msg.embeds || []).length,
    stickers: cached?.stickers || [...(msg.stickers?.values?.() || [])].map((s) => s.name),
    mentionedUsers: cached?.mentionedUsers || [...(msg.mentions?.users?.values?.() || [])].map((u) => ({
      id: u.id,
      tag: u.tag || u.username,
    })),

    deletedAt: Date.now(),
    createdAt: msg.createdTimestamp || cached?.createdAt || null,
    fromCache: !!cached?.content,
  };

  pushCapped(snipes, msg.channel.id, entry);

  // Cleanup cache sau khi đã dùng
  if (cached) deleteCached(msg.id);
}

// ── Edited message ───────────────────────────────────────
export function recordEdit(oldMsg, newMsg) {
  if (!oldMsg?.channel?.id && !newMsg?.channel?.id) return;

  const channelId = newMsg?.channel?.id || oldMsg?.channel?.id;
  const messageId = newMsg?.id || oldMsg?.id;

  // Lấy content cũ — ưu tiên cached (nếu message đã bị edit nhiều lần)
  const cached = messageId ? getCachedMessage(messageId) : null;

  const oldContent = cached?.content ?? oldMsg?.content ?? '';
  const newContent = newMsg?.content ?? '';

  if (oldContent === newContent) return;

  const author = newMsg?.author || oldMsg?.author || {};
  const entry = {
    messageId,
    channelId,
    guildId: newMsg?.guild?.id || oldMsg?.guild?.id || null,

    authorId: author.id || null,
    authorTag: author.tag || author.username || 'unknown',

    oldContent,
    newContent,

    editedAt: Date.now(),
    createdAt: newMsg?.createdTimestamp || oldMsg?.createdTimestamp || null,
  };

  pushCapped(editSnipes, channelId, entry);

  // Update cache với content mới
  if (cached) {
    cached.content = newContent;
  }
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
  } else {
    snipes.clear();
    editSnipes.clear();
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