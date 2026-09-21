import { sleep, randInt } from '../utils.js';
import { isShuttingDown } from '../shutdown.js';
import { isCompleted, isClaimed } from '../quest.js';

const MAX_CONSECUTIVE_FAILS = 5;
const MAX_429_STREAK = 3;
const MAX_WALL_SECONDS = 2 * 60 * 60; // 2h cứng
const MAX_LOOP_ITER = 5000;

export async function completeVideo({ api, quest, config, logger }) {
  const name = quest._name;
  const qid = quest.id;
  let done = quest._secondsDone;
  const needed = quest._secondsNeeded;

  if (isCompleted(quest) || isClaimed(quest)) {
    logger.info(`  ⊘ "${name}" đã hoàn thành/claim — bỏ qua`);
    return true;
  }

  if (!needed || needed <= 0) {
    logger.warn(`  "${name}" target không hợp lệ (${needed}s) — bỏ qua`);
    return false;
  }

  logger.info(`🎬 Video: ${name} (${done | 0}/${needed}s)`);

  const speed = Math.max(1, config.videoSpeed || 7);
  const maxFuture = Math.max(0, config.videoMaxFuture || 0);
  const intervalSec = Math.max(10, config.videoIntervalSec || 12);
  const logEvery = Math.max(1, config.progressLogEvery || 5);
  const enrolledTs = quest._enrolledTs || Date.now() / 1000;

  const estimatedWall = Math.ceil(needed / speed) * intervalSec;
  const hardDeadline = Date.now() + Math.min(MAX_WALL_SECONDS, estimatedWall * 3 + 300) * 1000;

  let failStreak = 0;
  let streak429 = 0;
  let progressCount = 0;
  let iter = 0;

  while (done < needed) {
    if (++iter > MAX_LOOP_ITER) {
      logger.error(`  "${name}" vượt MAX_LOOP_ITER (${MAX_LOOP_ITER}) — abort`);
      return false;
    }

    if (isShuttingDown()) {
      logger.warn(`  Dừng giữa chừng: ${name}`);
      return false;
    }

    if (Date.now() > hardDeadline) {
      logger.error(`  "${name}" vượt safety timeout — abort`);
      return false;
    }

    const now = Date.now() / 1000;
    const maxAllowed = Math.min((now - enrolledTs) + maxFuture, needed);
    const next = Math.min(needed, done + speed);

    if (maxAllowed - done >= speed) {
      let res;
      try {
        res = await api.post(`/quests/${qid}/video-progress`, {
          timestamp: Math.min(needed, next + Math.random()),
        });
      } catch (e) {
        failStreak++;
        logger.warn(`  Video "${name}" throw (${failStreak}/${MAX_CONSECUTIVE_FAILS}): ${e.message}`);
        if (failStreak >= MAX_CONSECUTIVE_FAILS) {
          logger.error(`  "${name}" fail liên tiếp ${failStreak} — abort`);
          return false;
        }
        await sleep(5000);
        continue;
      }

      if (res.status === 200) {
        failStreak = 0;
        streak429 = 0;

        if (res.data?.completed_at) {
          logger.ok(`✅ Hoàn thành: ${name}`);
          return true;
        }
        done = next;
        progressCount++;

        if (progressCount % logEvery === 0 || done >= needed) {
          const pct = Math.floor((done / needed) * 100);
          logger.progress(`  [${name}] ${done | 0}/${needed}s (${pct}%)`);
        }
      } else if (res.status === 429) {
        streak429++;
        const retryAfter = (res.data?.retry_after ?? 10) * 1000;
        logger.warn(`  Video 429 (${streak429}/${MAX_429_STREAK}) — chờ ${(retryAfter / 1000).toFixed(0)}s`);
        if (streak429 >= MAX_429_STREAK) {
          logger.error(`  "${name}" rate limit liên tục — abort`);
          return false;
        }
        await sleep(retryAfter + 1000);
        continue;
      } else {
        failStreak++;
        logger.warn(`  Video progress lỗi (${res.status}) [${failStreak}/${MAX_CONSECUTIVE_FAILS}]`);
        if (failStreak >= MAX_CONSECUTIVE_FAILS) {
          logger.error(`  "${name}" fail liên tiếp ${failStreak} — abort`);
          return false;
        }
        await sleep(5000);
        continue;
      }
    }

    if (next >= needed) break;

    const intervalMs = intervalSec * 1000 + randInt(0, 3000);
    const until = Date.now() + intervalMs;
    while (Date.now() < until && !isShuttingDown()) {
      await sleep(Math.min(1000, until - Date.now()));
    }
  }

  try {
    await api.post(`/quests/${qid}/video-progress`, { timestamp: needed });
  } catch {}
  logger.ok(`✅ Hoàn thành: ${name}`);
  return true;
}