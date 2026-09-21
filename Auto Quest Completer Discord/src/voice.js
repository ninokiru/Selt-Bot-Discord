import pLimit from 'p-limit';
import { sleep } from './utils.js';
import { isShuttingDown } from './shutdown.js';

const CHANNEL_TYPE = {
  DM: 1,
  GROUP_DM: 3,
  GUILD_VOICE: 2,
  GUILD_STAGE_VOICE: 13,
};

const cache = new Map();
const inflight = new Map();

const GUILD_SCAN_LIMIT = 25;
const GUILD_CHANNEL_CONCURRENCY = 5;
const MAX_429_RETRY = 2;

async function getWithRetry(api, url, logger, attempt = 0) {
  const res = await api.get(url, { retries: 1, timeout: 12000 });
  if (res.status === 429 && attempt < MAX_429_RETRY) {
    const wait = ((res.data?.retry_after ?? 3) * 1000) + 500;
    logger?.debug(`429 ${url} — chờ ${(wait / 1000).toFixed(1)}s`);
    await sleep(wait);
    return getWithRetry(api, url, logger, attempt + 1);
  }
  return res;
}

async function findDmChannel(api, logger) {
  try {
    const res = await getWithRetry(api, '/users/@me/channels', logger);
    if (res.status !== 200 || !Array.isArray(res.data)) return null;

    const dm = res.data.find((c) => c?.type === CHANNEL_TYPE.DM && c?.id);
    if (dm) return dm.id;

    const group = res.data.find((c) => c?.type === CHANNEL_TYPE.GROUP_DM && c?.id);
    if (group) return group.id;
  } catch (e) {
    logger?.debug(`DM channel fetch fail: ${e.message}`);
  }
  return null;
}

async function findGuildVoiceChannel(api, logger) {
  let guilds;
  try {
    const res = await getWithRetry(api, '/users/@me/guilds', logger);
    if (res.status !== 200 || !Array.isArray(res.data)) return null;
    guilds = res.data;
  } catch (e) {
    logger?.debug(`Guild list fetch fail: ${e.message}`);
    return null;
  }

  if (!guilds.length) return null;

  const limit = pLimit(GUILD_CHANNEL_CONCURRENCY);
  const slice = guilds.slice(0, GUILD_SCAN_LIMIT);

  // State object — atomic update trong single-thread event loop
  const state = { found: null, done: false };

  await Promise.all(
    slice.map((g) =>
      limit(async () => {
        // Skip sớm nếu đã tìm thấy hoặc shutdown
        if (state.done || isShuttingDown()) return;
        if (!g?.id) return;

        try {
          const cRes = await getWithRetry(api, `/guilds/${g.id}/channels`, logger);

          // Check lại sau await — task khác có thể đã tìm thấy
          if (state.done) return;
          if (cRes.status !== 200 || !Array.isArray(cRes.data)) return;

          const voice =
            cRes.data.find((c) => c?.type === CHANNEL_TYPE.GUILD_VOICE && c?.id) ||
            cRes.data.find((c) => c?.type === CHANNEL_TYPE.GUILD_STAGE_VOICE && c?.id);

          if (voice && !state.found) {
            state.found = voice.id;
            state.done = true;
          }
        } catch (e) {
          logger?.debug(`Guild ${g.id} channels fail: ${e.message}`);
        }
      })
    )
  );

  return state.found;
}

export async function pickActivityChannel(api, logger, tokenKey = null) {
  const key = tokenKey || api.token || 'default';

  if (cache.has(key)) return cache.get(key);
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    try {
      const dm = await findDmChannel(api, logger);
      if (dm) {
        logger?.debug(`Activity channel = DM ${dm}`);
        cache.set(key, dm);
        return dm;
      }

      const voice = await findGuildVoiceChannel(api, logger);
      if (voice) {
        logger?.debug(`Activity channel = voice ${voice}`);
        cache.set(key, voice);
        return voice;
      }

      logger?.warn('Không tìm được channel nào cho PLAY_ACTIVITY');
      return null;
    } catch (e) {
      logger?.warn(`pickActivityChannel throw: ${e.message}`);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}

export function invalidateActivityChannel(tokenKey) {
  if (tokenKey) cache.delete(tokenKey);
  else cache.clear();
}

export function getCachedChannel(tokenKey) {
  return cache.get(tokenKey) || null;
}