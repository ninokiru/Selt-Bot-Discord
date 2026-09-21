import { sleep, randInt } from '../utils.js';
import { isShuttingDown } from '../shutdown.js';
import { isCompleted, isClaimed } from '../quest.js';

const MAX_CONSECUTIVE_FAILS = 5;
const MAX_429_STREAK = 3;
const MAX_WALL_SECONDS = 2 * 60 * 60;
const MAX_LOOP_ITER = 5000;

// Handle cả 4 task: PLAY_ON_DESKTOP, PLAY_ON_DESKTOP_V2, STREAM_ON_DESKTOP, PLAY_ACTIVITY
export async function completeHeartbeat({ api, quest, config, logger, channelId }) {
  const name = quest._name;
  const qid = quest.id;
  const taskType = quest._taskType;
  let done = quest._secondsDone;
  const needed = quest._secondsNeeded;

  if (isCompleted(quest) || isClaimed(quest)) {
    logger.info(`  ⊘ "${name}" đã hoàn thành/claim — bỏ qua`);
    return true;
  }

  if (!needed || needed <= 0) {
    logger.warn(`  "${name}" target không hợp lệ — bỏ qua`);
    return false;
  }

  const isActivity = taskType === 'PLAY_ACTIVITY';
  const isStream = taskType === 'STREAM_ON_DESKTOP';
  const isGame = taskType === 'PLAY_ON_DESKTOP' || taskType === 'PLAY_ON_DESKTOP_V2';

  // ── stream_key ────────────────────────────────────────────────
  let streamKey;
  if (isActivity) {
    const cid = channelId || quest._channelId || 0;
    if (!cid) logger.warn(`  Không tìm được channel ID — có thể không count`);
    streamKey = `call:${cid}:1`;
  } else {
    const pid = quest._pid || (Math.floor(Math.random() * 29000) + 1000);
    streamKey = `call:0:${pid}`;
  }

  const remainingMin = Math.max(0, Math.round((needed - done) / 60));
  const emoji = isActivity ? '🕹️ ' : '🎮';
  logger.info(`${emoji} ${taskType}: ${name} (~${remainingMin} phút còn lại)`);

  // ── interval ──────────────────────────────────────────────────
  const baseInterval = isGame
    ? config.heartbeatIntervalGame
    : config.heartbeatIntervalStream;

  const hardDeadline = Date.now() + Math.min(MAX_WALL_SECONDS, needed * 3 + 300) * 1000;
  const logEvery = Math.max(1, config.progressLogEvery || 5);

  let failStreak = 0;
  let streak429 = 0;
  let progressCount = 0;
  let iter = 0;

  while (done < needed) {
    if (++iter > MAX_LOOP_ITER) {
      logger.error(`  "${name}" vượt MAX_LOOP_ITER — abort`);
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

    let res;
    try {
      res = await api.post(`/quests/${qid}/heartbeat`, {
        stream_key: streamKey,
        terminal: false,
      });
    } catch (e) {
      failStreak++;
      logger.warn(`  Heartbeat "${name}" throw (${failStreak}/${MAX_CONSECUTIVE_FAILS}): ${e.message}`);
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

      const prog = res.data?.progress || {};
      const taskProg = prog[taskType] || (isActivity ? prog.PLAY_ACTIVITY : null);
      if (taskProg?.value !== undefined) done = taskProg.value;
      progressCount++;

      if (progressCount % logEvery === 0 || done >= needed) {
        const pct = Math.floor((done / needed) * 100);
        logger.progress(`  [${name}] ${done | 0}/${needed}s (${pct}%)`);
      }

      if (res.data?.completed_at || done >= needed) {
        try {
          await api.post(`/quests/${qid}/heartbeat`, {
            stream_key: streamKey,
            terminal: true,
          });
        } catch {}
        logger.ok(`✅ Hoàn thành: ${name}`);
        return true;
      }
    } else if (res.status === 429) {
      streak429++;
      const retryAfter = (res.data?.retry_after ?? 10) * 1000;
      logger.warn(`  Heartbeat 429 (${streak429}/${MAX_429_STREAK}) — chờ ${(retryAfter / 1000).toFixed(0)}s`);
      if (streak429 >= MAX_429_STREAK) {
        logger.error(`  "${name}" rate limit liên tục — abort`);
        return false;
      }
      await sleep(retryAfter + 1000);
      continue;
    } else {
      failStreak++;
      logger.warn(`  Heartbeat lỗi (${res.status}) [${failStreak}/${MAX_CONSECUTIVE_FAILS}]`);
      if (failStreak >= MAX_CONSECUTIVE_FAILS) {
        logger.error(`  "${name}" fail liên tiếp ${failStreak} — abort`);
        return false;
      }
      await sleep(5000);
      continue;
    }

    const intervalMs = baseInterval * 1000 + randInt(0, 5000);
    const until = Date.now() + intervalMs;
    while (Date.now() < until && !isShuttingDown()) {
      await sleep(Math.min(1000, until - Date.now()));
    }
  }

  try {
    await api.post(`/quests/${qid}/heartbeat`, { stream_key: streamKey, terminal: true });
  } catch {}
  logger.ok(`✅ Hoàn thành: ${name}`);
  return true;
}