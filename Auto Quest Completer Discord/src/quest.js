import { isoToMs } from './utils.js';

export const SUPPORTED_TASKS = [
  'WATCH_VIDEO',
  'PLAY_ON_DESKTOP',
  'PLAY_ON_DESKTOP_V2',
  'STREAM_ON_DESKTOP',
  'PLAY_ACTIVITY',
  'WATCH_VIDEO_ON_MOBILE',
];

export const UNSUPPORTED_TASKS = [
  'PLAY_ON_XBOX',
  'PLAY_ON_PLAYSTATION',
  'ACHIEVEMENT_IN_GAME',
  'ACHIEVEMENT_IN_ACTIVITY',
];

const hasOwn = Object.prototype.hasOwnProperty;

export function _get(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (hasOwn.call(obj, k) && obj[k] !== undefined && obj[k] !== null) {
      return obj[k];
    }
  }
  return undefined;
}

function asInt(v, fallback = 0) {
  if (typeof v === 'number' && Number.isFinite(v)) return v | 0;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function safeObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export function getTaskConfig(quest) {
  const cfg = safeObj(quest?.config);
  return _get(cfg, 'taskConfig', 'task_config', 'taskConfigV2', 'task_config_v2');
}

export function getConfigVersion(quest) {
  const cfg = safeObj(quest?.config);
  const v = _get(cfg, 'configVersion', 'config_version');
  const n = asInt(v, 2);
  return n === 1 ? 1 : 2;
}

export function getQuestName(quest) {
  const cfg = safeObj(quest?.config);
  const msgs = safeObj(cfg.messages);

  const qn = _get(msgs, 'questName', 'quest_name');
  if (typeof qn === 'string' && qn.trim()) return qn.trim();

  const gt = _get(msgs, 'gameTitle', 'game_title');
  if (typeof gt === 'string' && gt.trim()) return gt.trim();

  const appName = safeObj(cfg.application).name;
  if (typeof appName === 'string' && appName.trim()) return appName.trim();

  return `Quest#${quest?.id ?? '?'}`;
}

export function getExpiresAt(quest) {
  const cfg = safeObj(quest?.config);
  const v = _get(cfg, 'expiresAt', 'expires_at');
  return typeof v === 'string' ? v : null;
}

export function getStartsAt(quest) {
  const cfg = safeObj(quest?.config);
  const v = _get(cfg, 'startsAt', 'starts_at');
  return typeof v === 'string' ? v : null;
}

export function isExpired(quest) {
  const iso = getExpiresAt(quest);
  if (!iso) return false;
  const ms = isoToMs(iso);
  if (!ms) return false;
  return ms <= Date.now();
}

export function notStarted(quest) {
  const iso = getStartsAt(quest);
  if (!iso) return false;
  const ms = isoToMs(iso);
  if (!ms) return false;
  return ms > Date.now();
}

export function getUserStatus(quest) {
  const us = _get(quest, 'userStatus', 'user_status');
  return safeObj(us);
}

export function isEnrolled(quest) {
  const us = getUserStatus(quest);
  return !!_get(us, 'enrolledAt', 'enrolled_at');
}

export function isCompleted(quest) {
  const us = getUserStatus(quest);
  return !!_get(us, 'completedAt', 'completed_at');
}

export function isClaimed(quest) {
  const us = getUserStatus(quest);
  return !!_get(us, 'claimedAt', 'claimed_at');
}

export function getEnrolledAt(quest) {
  const us = getUserStatus(quest);
  const v = _get(us, 'enrolledAt', 'enrolled_at');
  return typeof v === 'string' ? v : null;
}

export function getClaimedAt(quest) {
  const us = getUserStatus(quest);
  const v = _get(us, 'claimedAt', 'claimed_at');
  return typeof v === 'string' ? v : null;
}

function taskHasKey(tasks, t) {
  return hasOwn.call(tasks, t) && tasks[t] !== undefined && tasks[t] !== null;
}

export function getTaskType(quest) {
  const tc = getTaskConfig(quest);
  const tasks = safeObj(tc?.tasks);
  for (const t of SUPPORTED_TASKS) {
    if (taskHasKey(tasks, t)) return t;
  }
  return null;
}

export function getUnsupportedTaskType(quest) {
  const tc = getTaskConfig(quest);
  const tasks = safeObj(tc?.tasks);
  for (const t of UNSUPPORTED_TASKS) {
    if (taskHasKey(tasks, t)) return t;
  }
  return null;
}

export function getSecondsNeeded(quest) {
  const tc = getTaskConfig(quest);
  const t = getTaskType(quest);
  if (!tc || !t) return 0;
  const tasks = safeObj(tc.tasks);
  const target = tasks[t]?.target;
  return asInt(target, 0);
}

export function getSecondsDone(quest) {
  const t = getTaskType(quest);
  if (!t) return 0;
  const us = getUserStatus(quest);
  const version = getConfigVersion(quest);

  if (version === 1) {
    const legacy = asInt(us.stream_progress_seconds, 0);
    if (legacy > 0) return legacy;
  }

  const prog = safeObj(us.progress);
  const entry = safeObj(prog[t]);
  return asInt(entry.value, 0);
}

export function getActivityId(quest) {
  const cfg = safeObj(quest?.config);
  const app = safeObj(cfg.application);
  if (app.id) return app.id;

  const apps = Array.isArray(cfg.applications) ? cfg.applications : [];
  for (const a of apps) {
    if (a && typeof a === 'object' && a.id) return a.id;
  }
  return null;
}

export function isCompletable(quest) {
  if (isExpired(quest)) return false;
  if (notStarted(quest)) return false;
  const tc = getTaskConfig(quest);
  const tasks = safeObj(tc?.tasks);
  return SUPPORTED_TASKS.some((t) => taskHasKey(tasks, t));
}

export function isUnsupportedOnly(quest) {
  if (isExpired(quest)) return false;
  if (isCompletable(quest)) return false;
  const tc = getTaskConfig(quest);
  const tasks = safeObj(tc?.tasks);
  return UNSUPPORTED_TASKS.some((t) => taskHasKey(tasks, t));
}

export function classifyQuest(quest) {
  const taskType = getTaskType(quest);
  const unsupported = taskType ? null : getUnsupportedTaskType(quest);
  const expired = isExpired(quest);

  return {
    taskType,
    unsupportedTask: unsupported,
    expired,
    completable: !expired && !!taskType,
    unsupportedOnly: !expired && !taskType && !!unsupported,
    enrolled: isEnrolled(quest),
    completed: isCompleted(quest),
    claimed: isClaimed(quest),
    secondsNeeded: taskType ? getSecondsNeeded(quest) : 0,
    secondsDone: taskType ? getSecondsDone(quest) : 0,
  };
}

export function estimateQuestSeconds(quest, config = {}) {
  const t = getTaskType(quest);
  if (!t) return 0;

  const needed = getSecondsNeeded(quest);
  const done = getSecondsDone(quest);
  const remain = Math.max(0, needed - done);
  if (remain === 0) return 0;

  if (t === 'WATCH_VIDEO' || t === 'WATCH_VIDEO_ON_MOBILE') {
    const speed = Math.max(1, config.videoSpeed || 7);
    return Math.ceil(remain / speed);
  }

  return remain;
}

export function formatDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return `${sec}s`;

  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;

  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h}h${mm}m` : `${h}h`;

  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}d${hh}h` : `${d}d`;
}