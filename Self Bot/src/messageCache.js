const MAX_AGE_MS = 30 * 60 * 1000;   // 30 phút
const MAX_SIZE = 2000;               // tối đa 2000 message

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

export function cacheMessage(msg) {
  if (!msg?.id) return;

  if (cache.size >= MAX_SIZE) {
    // Xoá entry cũ nhất
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }

  const author = msg.author || {};

  cache.set(msg.id, {
    id: msg.id,
    channelId: msg.channel?.id || null,
    guildId: msg.guild?.id || null,

    authorId: author.id || null,
    authorTag: author.tag || author.username || 'unknown',
    authorBot: !!author.bot,

    content: msg.content || '',
    attachments: [...(msg.attachments?.values?.() || [])].map((a) => ({
      name: a.name,
      url: a.url,
      proxyURL: a.proxyURL,
      size: a.size,
      contentType: a.contentType,
    })),
    embeds: (msg.embeds || []).length,
    stickers: [...(msg.stickers?.values?.() || [])].map((s) => s.name),
    mentionedUsers: [...(msg.mentions?.users?.values?.() || [])].map((u) => ({
      id: u.id,
      tag: u.tag || u.username,
    })),

    createdAt: msg.createdTimestamp || Date.now(),
    cachedAt: Date.now(),
  });

  startCleanup();
}

export function getCachedMessage(messageId) {
  return cache.get(messageId) || null;
}

export function deleteCached(messageId) {
  cache.delete(messageId);
}

export function getCacheSize() {
  return cache.size;
}

export function clearCache() {
  cache.clear();
}