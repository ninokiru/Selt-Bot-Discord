import fs from 'node:fs';
import path from 'node:path';
import { sleep, fmtDur } from './utils.js';
import { isShuttingDown } from './shutdown.js';

export function createSession({ config, logger, onWarn, onExpire }) {
  const startedAt = Date.now();
  const maxMs = (config.sessionMaxMinutes || 360) * 60 * 1000;
  const warnMs = (config.sessionWarnMinutes || 300) * 60 * 1000;
  const autoStop = config.sessionAutoStop !== false;

  let timer = null;
  let warned = false;
  let expired = false;
  let stopped = false;

  const stats = {
    startAt: startedAt,
    endAt: null,
    warnAt: null,
  };

  function elapsedMs() {
    return Date.now() - startedAt;
  }

  function remainingMs() {
    return Math.max(0, maxMs - elapsedMs());
  }

  function percent() {
    if (maxMs <= 0) return 0;
    return Math.min(100, Math.floor((elapsedMs() / maxMs) * 100));
  }

  function check() {
    if (stopped) return;
    if (isShuttingDown()) return;

    const elapsed = elapsedMs();

    if (!warned && warnMs > 0 && elapsed >= warnMs) {
      warned = true;
      stats.warnAt = Date.now();
      logger?.warn(`Session cảnh báo: ${fmtDur(elapsed / 1000)} / ${fmtDur(maxMs / 1000)}`);
      onWarn?.({ elapsed, maxMs, remainMs: remainingMs() });
    }

    if (!expired && elapsed >= maxMs) {
      expired = true;
      stats.endAt = Date.now();
      logger?.warn(`Session hết hạn (${fmtDur(maxMs / 1000)})`);
      onExpire?.();
      if (autoStop && typeof globalThis.__sbStop === 'function') {
        globalThis.__sbStop();
      }
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(check, 60 * 1000);
    check();
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function snapshot() {
    return {
      startedAt,
      endAt: stats.endAt,
      elapsed: elapsedMs(),
      remaining: remainingMs(),
      maxMs,
      percent: percent(),
      warned,
      expired,
      stopped,
    };
  }

  return {
    start,
    stop,
    snapshot,
    elapsedMs,
    remainingMs,
    percent,
    isExpired: () => elapsedMs() >= maxMs,
    isWarned: () => warned,
  };
}

export function logSessionEnd({ session, path: logPath, logger }) {
  if (!session || !logPath) return;
  try {
    const snap = session.snapshot();
    const line = JSON.stringify({
      startedAt: new Date(snap.startedAt).toISOString(),
      endedAt: new Date(snap.endAt || Date.now()).toISOString(),
      durationSec: Math.floor(snap.elapsed / 1000),
      maxSec: Math.floor(snap.maxMs / 1000),
    });
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line + '\n');
  } catch (e) {
    logger?.warn(`Session log fail: ${e.message}`);
  }
}