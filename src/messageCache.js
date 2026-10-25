const MAX_AGE_MS = 30 * 60 * 1000;   // 30 phút
const MAX_SIZE = 2000;               // tối đa 2000 message
const MAX_CONTENT_LEN = 4000;
const MAX_ATTACHMENTS = 10;
const MAX_STICKERS = 5;
const MAX_MENTIONS = 10;
const MAX_TAG_LEN = 100;

const cache = new Map();             // messageId → entry

let timer = null;

function startCleanup() {
  if (timer) return;
  timer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of cache) {
      if (now - entry.cachedAt > MAX_AGE_MS) cache.delete(id);
    }
  }, 5 * 60 * 1000);
  if (timer.unref) timer.unref();
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

function normalizeAttachments(input) {
  return listOf(input).slice(0, MAX_ATTACHMENTS).map((a) => ({
    name: a?.name != null ? capStr(a.name, MAX_TAG_LEN) : a?.name,
    url: a?.url,
    proxyURL: a?.proxyURL,
    size: a?.size,
    contentType: a?.contentType,
  }));
}

function normalizeStickers(input) {
  return listOf(input)
    .map((s) => (typeof s === 'string' ? s : s?.name))
    .filter(Boolean)
    .slice(0, MAX_STICKERS);
}

function normalizeMentions(input) {
  return listOf(input).slice(0, MAX_MENTIONS).map((u) => ({
    id: u?.id ?? null,
    tag: capStr(u?.tag || u?.username || 'unknown', MAX_TAG_LEN),
  }));
}

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function cacheMessage(msg) {
  if (!msg?.id) return;

  if (cache.has(msg.id)) {
    cache.delete(msg.id);
  } else if (cache.size >= MAX_SIZE) {
    // Xoá entry cũ nhất (LRU)
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }

  const author = msg.author || {};

  cache.set(msg.id, {
    id: msg.id,
    channelId: msg.channel?.id || null,
    guildId: msg.guild?.id || null,

    authorId: author.id || null,
    authorTag: capStr(author.tag || author.username || 'unknown', MAX_TAG_LEN),
    authorBot: !!author.bot,

    content: capStr(msg.content || '', MAX_CONTENT_LEN),
    attachments: normalizeAttachments(msg.attachments),
    embeds: (msg.embeds || []).length,
    stickers: normalizeStickers(msg.stickers),
    mentionedUsers: normalizeMentions(msg.mentions?.users),

    createdAt: msg.createdTimestamp || Date.now(),
    cachedAt: Date.now(),
  });

  startCleanup();
}

export function getCachedMessage(messageId) {
  if (!messageId) return null;
  const entry = cache.get(messageId);
  if (!entry) return null;

  // Refresh LRU order
  cache.delete(messageId);
  cache.set(messageId, entry);
  return entry;
}

export function updateCachedMessage(messageId, patch) {
  if (!messageId || !patch || typeof patch !== 'object') return null;
  const entry = cache.get(messageId);
  if (!entry) return null;

  if (has(patch, 'content') && patch.content !== undefined) {
    entry.content = capStr(patch.content, MAX_CONTENT_LEN);
  }
  if (has(patch, 'authorTag') && patch.authorTag !== undefined) {
    entry.authorTag = capStr(patch.authorTag || 'unknown', MAX_TAG_LEN);
  }
  if (has(patch, 'authorBot') && patch.authorBot !== undefined) {
    entry.authorBot = !!patch.authorBot;
  }
  if (has(patch, 'channelId') && patch.channelId !== undefined) {
    entry.channelId = patch.channelId ? String(patch.channelId) : null;
  }
  if (has(patch, 'guildId') && patch.guildId !== undefined) {
    entry.guildId = patch.guildId ? String(patch.guildId) : null;
  }
  if (has(patch, 'attachments') && patch.attachments !== undefined) {
    entry.attachments = normalizeAttachments(patch.attachments);
  }
  if (has(patch, 'embeds') && patch.embeds !== undefined) {
    const n = Number(patch.embeds);
    entry.embeds = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  if (has(patch, 'stickers') && patch.stickers !== undefined) {
    entry.stickers = normalizeStickers(patch.stickers);
  }
  if (has(patch, 'mentionedUsers') && patch.mentionedUsers !== undefined) {
    entry.mentionedUsers = normalizeMentions(patch.mentionedUsers);
  }

  entry.cachedAt = Date.now();
  cache.delete(messageId);
  cache.set(messageId, entry);
  return entry;
}

export function deleteCached(messageId) {
  cache.delete(messageId);
}

export function getCacheSize() {
  return cache.size;
}

export function getCacheStats() {
  return {
    size: cache.size,
    maxSize: MAX_SIZE,
    maxAgeMs: MAX_AGE_MS,
  };
}

export function clearCache() {
  cache.clear();
}
