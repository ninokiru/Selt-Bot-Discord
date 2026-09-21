import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import pLimit from 'p-limit';

import { DiscordAPI } from './api.js';
import { Cooldown, CooldownRegistry } from './cooldown.js';
import { makeLogger, setDebug, setOutput, log as rootLog } from './logger.js';
import { setShuttingDown, isShuttingDown } from './shutdown.js';
import {
  readLines, readJson, writeJson, parseProxy, sleep, randInt,
  isoToMs, shorten, detectCountry, checkProxy, auditSecretFile,
  inspectProxiesFile,
} from './utils.js';
import {
  getQuestName, getTaskType, getSecondsNeeded, getSecondsDone,
  getEnrolledAt, getActivityId, isEnrolled, isCompleted, isCompletable,
  getUnsupportedTaskType, isClaimed,
  estimateQuestSeconds, formatDuration,
} from './quest.js';
import { completeVideo } from './completer/video.js';
import { completeHeartbeat } from './completer/heartbeat.js';
import { pickActivityChannel, invalidateActivityChannel } from './voice.js';
import { createDashboard } from './dashboard.js';
import { showSplash } from './splash.js';
import { pickUserAgent, getClientInfo, fetchLatestClientInfo } from './useragent.js';
import { downloadFreeProxies } from './proxydl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONFIG_PATH  = path.join(ROOT, 'config.json');
const TOKENS_PATH  = path.join(ROOT, 'tokens.txt');
const PROXIES_PATH = path.join(ROOT, 'proxies.txt');
const STATE_PATH   = path.join(ROOT, '.state.json');
const FALLBACK_BUILD = 504649;
const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';
const INTER_QUEST_DELAY_SEC = 5;
const ENROLL_LOCATION = 11;
const MAX_STATE_QUEST_IDS = 2000;

const CONFIG_DEFAULTS = {
  proxyCooldownMs: 20000,
  proxyCooldownJitterMs: 6000,
  enrollCooldownMinMs: 25000,
  enrollCooldownMaxMs: 40000,
  accountSwitchDelayMinMs: 5000,
  accountSwitchDelayMaxMs: 10000,
  actionStartDelayMinMs: 3000,
  actionStartDelayMaxMs: 8000,
  requestJitterMinMs: 200,
  requestJitterMaxMs: 1500,
  detectProxyCountry: true,
  useProxies: true,
  allowDirectFallback: true,
  warnIfNoProxies: true,
  autoDownloadProxies: true,
  autoDownloadCountries: [
    'AD', 'AE', 'AF', 'AG', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU',
    'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ',
    'BN', 'BO', 'BR', 'BS', 'BT', 'BW', 'BY', 'BZ', 'CA', 'CD',
    'CF', 'CG', 'CH', 'CI', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU',
    'CV', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC',
    'EE', 'EG', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FM', 'FR', 'GA',
    'GB', 'GD', 'GE', 'GH', 'GM', 'GN', 'GQ', 'GR', 'GT', 'GW',
    'GY', 'HK', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IN',
    'IQ', 'IR', 'IS', 'IT', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH',
    'KI', 'KM', 'KN', 'KR', 'KW', 'KZ', 'LA', 'LB', 'LC', 'LI',
    'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD',
    'ME', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MR', 'MT',
    'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NE', 'NG', 'NI',
    'NL', 'NO', 'NP', 'NR', 'NZ', 'OM', 'PA', 'PE', 'PG', 'PH',
    'PK', 'PL', 'PT', 'PW', 'PY', 'QA', 'RO', 'RS', 'RU', 'RW',
    'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SI', 'SK', 'SL', 'SM',
    'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SY', 'SZ', 'TD', 'TG',
    'TH', 'TJ', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW',
    'TZ', 'UA', 'UG', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VN',
    'VU', 'WS', 'YE', 'ZA', 'ZM', 'ZW'
  ],
  proxiesPerCountry: 1,
  maxTotalProxies: 200,
  proxyVerifyTimeoutMs: 5000,
  proxyVerifyConcurrency: 80,
  proxyFallbackPoolSize: 5000,
  pollInterval: 60,
  heartbeatIntervalGame: 60,
  heartbeatIntervalStream: 30,
  videoSpeed: 7,
  videoMaxFuture: 10,
  videoIntervalSec: 12,
  progressLogEvery: 5,
  autoAccept: true,
  autoUpdateClientVersion: true,
  concurrency: 1,
  debug: false,
  jitterMs: [5000, 30000],
  retry: { maxAttempts: 3, baseDelayMs: 2000 },
  clientVersion: '1.0.9175',
  electronVersion: '32.2.7',
  chromeVersion: '128.0.6613.186',
  osVersion: '10.0.26100',
  nativeBuildNumber: 59498,
  proxyCheckConcurrency: 100,
  countryDetectConcurrency: 30,
};

function normalizeConfig(raw) {
  const c = { ...CONFIG_DEFAULTS, ...(raw || {}) };

  const ensureNumber = (k, min) => {
    if (typeof c[k] !== 'number' || Number.isNaN(c[k]) || (min !== undefined && c[k] < min)) {
      c[k] = CONFIG_DEFAULTS[k];
    }
  };

  for (const k of [
    'proxyCooldownMs', 'proxyCooldownJitterMs',
    'enrollCooldownMinMs', 'enrollCooldownMaxMs',
    'accountSwitchDelayMinMs', 'accountSwitchDelayMaxMs',
    'actionStartDelayMinMs', 'actionStartDelayMaxMs',
    'requestJitterMinMs', 'requestJitterMaxMs',
  ]) ensureNumber(k, 0);

  ensureNumber('pollInterval', 1);
  ensureNumber('heartbeatIntervalGame', 5);
  ensureNumber('heartbeatIntervalStream', 5);
  ensureNumber('videoSpeed', 1);
  ensureNumber('videoMaxFuture', 0);
  ensureNumber('videoIntervalSec', 10);
  ensureNumber('progressLogEvery', 1);
  ensureNumber('concurrency', 1);
  ensureNumber('proxyCheckConcurrency', 1);
  ensureNumber('countryDetectConcurrency', 1);
  ensureNumber('proxyVerifyTimeoutMs', 1000);
  ensureNumber('proxyVerifyConcurrency', 1);
  ensureNumber('proxyFallbackPoolSize', 1);

  const swap = (a, b) => {
    if (c[a] > c[b]) { const t = c[a]; c[a] = c[b]; c[b] = t; }
  };
  swap('enrollCooldownMinMs', 'enrollCooldownMaxMs');
  swap('accountSwitchDelayMinMs', 'accountSwitchDelayMaxMs');
  swap('actionStartDelayMinMs', 'actionStartDelayMaxMs');
  swap('requestJitterMinMs', 'requestJitterMaxMs');

  if (!Array.isArray(c.jitterMs) || c.jitterMs.length !== 2) {
    c.jitterMs = CONFIG_DEFAULTS.jitterMs;
  }
  if (!c.retry || typeof c.retry !== 'object') c.retry = { ...CONFIG_DEFAULTS.retry };
  if (typeof c.retry.maxAttempts !== 'number' || c.retry.maxAttempts < 1) {
    c.retry.maxAttempts = CONFIG_DEFAULTS.retry.maxAttempts;
  }
  if (typeof c.retry.baseDelayMs !== 'number' || c.retry.baseDelayMs < 0) {
    c.retry.baseDelayMs = CONFIG_DEFAULTS.retry.baseDelayMs;
  }

  if (typeof c.useProxies !== 'boolean') c.useProxies = CONFIG_DEFAULTS.useProxies;
  if (typeof c.detectProxyCountry !== 'boolean') c.detectProxyCountry = CONFIG_DEFAULTS.detectProxyCountry;
  if (typeof c.allowDirectFallback !== 'boolean') c.allowDirectFallback = CONFIG_DEFAULTS.allowDirectFallback;
  if (typeof c.warnIfNoProxies !== 'boolean') c.warnIfNoProxies = CONFIG_DEFAULTS.warnIfNoProxies;
  if (typeof c.autoDownloadProxies !== 'boolean') c.autoDownloadProxies = CONFIG_DEFAULTS.autoDownloadProxies;
  if (!Array.isArray(c.autoDownloadCountries) || !c.autoDownloadCountries.length) {
    c.autoDownloadCountries = CONFIG_DEFAULTS.autoDownloadCountries;
  }
  if (typeof c.proxiesPerCountry !== 'number' || c.proxiesPerCountry < 1) {
    c.proxiesPerCountry = CONFIG_DEFAULTS.proxiesPerCountry;
  }
  if (typeof c.maxTotalProxies !== 'number' || c.maxTotalProxies < 1) {
    c.maxTotalProxies = CONFIG_DEFAULTS.maxTotalProxies;
  }
  if (typeof c.autoAccept !== 'boolean') c.autoAccept = CONFIG_DEFAULTS.autoAccept;
  if (typeof c.autoUpdateClientVersion !== 'boolean') {
    c.autoUpdateClientVersion = CONFIG_DEFAULTS.autoUpdateClientVersion;
  }
  if (typeof c.debug !== 'boolean') c.debug = CONFIG_DEFAULTS.debug;

  return c;
}

let running = false;
let lastShutdownTs = 0;

const ctx = {
  config: null,
  tokens: [],
  proxies: [],
  buildNumber: FALLBACK_BUILD,
  state: { completed: {} },
  dashboard: null,
  questCacheByToken: new Map(),
  channelCacheByToken: new Map(),
  enrollmentBlockedByToken: new Map(),
  validatedTokens: new Map(),
  claimedCountByToken: new Map(),
  userAgent: null,
  clientInfo: null,
  stats: { failed: 0, skipped: 0 },
};

function tokenKeyOf(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

// ── Shutdown ─────────────────────────────────────────────────────
function forceShutdown() {
  try { ctx.dashboard?.destroy(); } catch {}
  process.exit(0);
}

function requestShutdown() {
  const now = Date.now();
  if (isShuttingDown()) {
    if (now - lastShutdownTs < 500) return;
    forceShutdown();
    return;
  }
  lastShutdownTs = now;
  setShuttingDown(true);
  if (ctx.dashboard) {
    ctx.dashboard.setPhase('SHUTTING DOWN');
    ctx.dashboard.setCurrent('đang dừng sau quest hiện tại...', true);
  }
  rootLog.warn('Đang dừng... (ấn q / ctrl+c lần nữa để force)');
}

// ── Helpers ──────────────────────────────────────────────────────
async function sleepResponsive(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until && !isShuttingDown()) {
    await sleep(Math.min(1000, until - Date.now()));
  }
}

async function actionStartDelay(config) {
  const wait = randInt(config.actionStartDelayMinMs, config.actionStartDelayMaxMs);
  if (wait > 0) {
    rootLog.info(`⏳ Khởi động sau ${(wait / 1000).toFixed(1)}s...`);
    await sleepResponsive(wait);
  }
}

async function accountSwitchDelay(config) {
  const wait = randInt(config.accountSwitchDelayMinMs, config.accountSwitchDelayMaxMs);
  if (wait > 0) {
    rootLog.info(`↻ Chờ ${(wait / 1000).toFixed(1)}s trước account kế...`);
    await sleepResponsive(wait);
  }
}

async function enrollCooldown(config, logger) {
  const wait = randInt(config.enrollCooldownMinMs, config.enrollCooldownMaxMs);
  if (wait > 0) {
    logger.info(`   ⏳ Chờ ${(wait / 1000).toFixed(1)}s trước enroll kế...`);
    await sleepResponsive(wait);
  }
}

// ── Stats sync ───────────────────────────────────────────────────
function syncStats() {
  const { stats, questCacheByToken, dashboard } = ctx;
  if (!dashboard) return;

  let totalEnrolled = 0;
  let totalCompleted = 0;
  for (const map of questCacheByToken.values()) {
    for (const q of map.values()) {
      if (isEnrolled(q) && !isClaimed(q)) totalEnrolled++;
      if (isCompleted(q) && !isClaimed(q)) totalCompleted++;
    }
  }

  dashboard.updateProgress({
    enrolled: totalEnrolled,
    completed: totalCompleted,
    failed: stats.failed,
    skipped: stats.skipped,
  });
}

// ── API factory ──────────────────────────────────────────────────
function createApi(token, logger, opts = {}) {
  return new DiscordAPI({
    token,
    buildNumber: ctx.buildNumber,
    userAgent: ctx.userAgent,
    clientInfo: ctx.clientInfo,
    timezone: opts.timezone || DEFAULT_TZ,
    retry: opts.retry || ctx.config.retry,
    jitterMs: opts.jitterMs || ctx.config.jitterMs,
    requestJitterMs: opts.requestJitterMs || [
      ctx.config.requestJitterMinMs,
      ctx.config.requestJitterMaxMs,
    ],
    logger,
  });
}

// ── Build number ─────────────────────────────────────────────────
async function fetchLatestBuildNumber(userAgent) {
  try {
    const res = await axios.get('https://discord.com/app', {
      headers: { 'User-Agent': userAgent },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (res.status !== 200) return FALLBACK_BUILD;

    const hashes = [...res.data.matchAll(/\/assets\/([a-f0-9]+)\.js/g)].map((m) => m[1]);
    if (!hashes.length) return FALLBACK_BUILD;

    const re = /["']buildNumber["']\s*[:=]\s*["']?(\d{5,7})["']?/;

    for (const h of hashes.slice(-5)) {
      try {
        const ar = await axios.get(`https://discord.com/assets/${h}.js`, {
          headers: { 'User-Agent': userAgent },
          timeout: 15000,
          validateStatus: () => true,
        });
        const m = ar.data.match(re);
        if (m) {
          const bn = parseInt(m[1], 10);
          rootLog.info(`Build number: ${bn}`);
          return bn;
        }
      } catch {}
    }
    return FALLBACK_BUILD;
  } catch (e) {
    rootLog.warn(`Build number lỗi: ${e.message} – fallback`);
    return FALLBACK_BUILD;
  }
}

// ── Loaders ──────────────────────────────────────────────────────
function loadState() {
  const s = readJson(STATE_PATH, { completed: {} });
  if (!s.completed || typeof s.completed !== 'object') s.completed = {};

  for (const key of Object.keys(s.completed)) {
    const arr = s.completed[key];
    if (Array.isArray(arr) && arr.length > MAX_STATE_QUEST_IDS) {
      s.completed[key] = arr.slice(-MAX_STATE_QUEST_IDS);
    }
  }

  return s;
}

function saveState(state) {
  try { writeJson(STATE_PATH, state); }
  catch (e) { rootLog.warn(`Save state lỗi: ${e.message}`); }
}

function loadTokens() {
  return readLines(TOKENS_PATH).map((l) => l.split('|')[0].trim()).filter(Boolean);
}

async function loadProxies(config) {
  const proxies = readLines(PROXIES_PATH).map(parseProxy).filter(Boolean);
  if (!proxies.length) return proxies;

  const limit = pLimit(config.countryDetectConcurrency);
  await Promise.all(
    proxies.map((p) =>
      limit(async () => {
        if (!p.label && config.detectProxyCountry) {
          p.label = await detectCountry(p);
        } else if (!p.label) {
          p.label = 'XX';
        }
      })
    )
  );
  return proxies;
}

// ── Validation ───────────────────────────────────────────────────
async function validateProxies() {
  const { config, dashboard } = ctx;
  const ua = ctx.userAgent;

  let redownloaded = false;

  const tryFallback = () => {
    if (!config.allowDirectFallback) {
      rootLog.error('Không có proxy sống và allowDirectFallback = false — không chạy được');
      forceShutdown();
      return false;
    }
    ctx.proxies = [];
    rootLog.warn('⚠ Fallback: chạy bằng IP máy (DIRECT)');
    dashboard.updateStats({ regions: 'DIRECT (fallback)' });
    return true;
  };

  if (!config.useProxies) {
    ctx.proxies = [];
    rootLog.info('useProxies = false — chạy bằng IP máy (DIRECT)');
    dashboard.updateStats({ regions: 'DIRECT' });
    return;
  }

  while (true) {
    const loaded = await loadProxies(config);
    ctx.proxies = loaded;

    if (ctx.proxies.length === 0) {
      const info = inspectProxiesFile(PROXIES_PATH);
      if (config.warnIfNoProxies) {
        if (!info.exists) rootLog.warn('proxies.txt không tồn tại');
        else if (info.raw === 0) rootLog.warn('proxies.txt trống hoặc chỉ có comment');
        else if (info.parsed === 0) {
          rootLog.warn(`proxies.txt có ${info.raw} dòng nhưng 0 dòng parse được`);
          if (info.bad.length) {
            for (const l of info.bad) rootLog.warn(`   "${shorten(l, 80)}"`);
          }
        }
      }

      if (!redownloaded && config.autoDownloadProxies) {
        redownloaded = true;
        rootLog.info('→ Tự tải proxy free...');
        try {
          const r = await downloadFreeProxies({
            outputPath: PROXIES_PATH,
            countries: config.autoDownloadCountries,
            perCountry: config.proxiesPerCountry,
            maxTotal: config.maxTotalProxies,
            userAgent: ua,
            verifyTimeoutMs: config.proxyVerifyTimeoutMs,
            verifyConcurrency: config.proxyVerifyConcurrency,
            fallbackPoolSize: config.proxyFallbackPoolSize,
            logger: rootLog,
          });
          if (r.saved > 0) {
            rootLog.ok(`Đã tải ${r.saved} proxy — thử lại`);
            continue;
          }
          rootLog.warn('Tải proxy về 0 cái');
        } catch (e) {
          rootLog.error(`Auto-download lỗi: ${e.message}`);
        }
      }

      return tryFallback();
    }

    dashboard.setPhase('CHECK PROXY');
    dashboard.setCurrent(`checking ${ctx.proxies.length} proxies`);
    rootLog.info(`Check ${ctx.proxies.length} proxies...`);

    const limit = pLimit(config.proxyCheckConcurrency);
    const results = await Promise.all(
      ctx.proxies.map((p) =>
        limit(async () => {
          try {
            const ok = await checkProxy(p, ua, config.proxyVerifyTimeoutMs);
            return { p, ok };
          } catch {
            return { p, ok: false };
          }
        })
      )
    );

    const alive = [];
    for (const { p, ok } of results) {
      if (ok) {
        alive.push(p);
        rootLog.ok(`Proxy OK: [${p.label}] ${p.host}:${p.port}`);
      } else {
        rootLog.warn(`Proxy chết: [${p.label}] ${p.host}:${p.port}`);
      }
    }

    if (alive.length > 0) {
      ctx.proxies = alive;
      rootLog.ok(`Proxy: ${alive.length}/${results.length} sống`);
      const regions = [...new Set(alive.map((p) => p.label))].join(',') || 'XX';
      dashboard.updateStats({ regions });
      return;
    }

    rootLog.warn(`Tất cả ${results.length} proxy đều chết`);

    if (!redownloaded && config.autoDownloadProxies) {
      redownloaded = true;
      rootLog.info('→ Xoá proxy cũ + tự tải proxy mới...');
      try {
        try { fs.unlinkSync(PROXIES_PATH); } catch {}
        const r = await downloadFreeProxies({
          outputPath: PROXIES_PATH,
          countries: config.autoDownloadCountries,
          perCountry: config.proxiesPerCountry,
          maxTotal: config.maxTotalProxies,
          userAgent: ua,
          verifyTimeoutMs: config.proxyVerifyTimeoutMs,
          verifyConcurrency: config.proxyVerifyConcurrency,
          fallbackPoolSize: config.proxyFallbackPoolSize,
          logger: rootLog,
        });
        if (r.saved > 0) {
          rootLog.ok(`Đã tải ${r.saved} proxy mới — validate lại`);
          continue;
        }
        rootLog.warn('Tải proxy về 0 cái');
      } catch (e) {
        rootLog.error(`Auto-download lỗi: ${e.message}`);
      }
    }

    return tryFallback();
  }
}

async function validateTokens() {
  const { dashboard } = ctx;
  if (!ctx.tokens.length) return;

  dashboard.setPhase('CHECK TOKEN');
  rootLog.info(`Check ${ctx.tokens.length} tokens (1 lần duy nhất)...`);

  const total = ctx.tokens.length;
  const aliveTokens = [];
  const deadKeys = new Set();

  for (let i = 0; i < ctx.tokens.length; i++) {
    if (isShuttingDown()) break;
    const token = ctx.tokens[i];
    const tag = `#${i + 1}:${token.slice(-4)}`;
    const logger = makeLogger(tag);
    dashboard.setCurrent(`checking ${tag}`);

    try {
      const api = createApi(token, logger, {
        retry: { maxAttempts: 1, baseDelayMs: 500 },
        jitterMs: [0, 0],
        requestJitterMs: [0, 0],
      });
      api.setProxy(null);

      const result = await api.validate();
      const key = tokenKeyOf(token);

      if (result.ok) {
        aliveTokens.push(token);
        ctx.validatedTokens.set(key, { valid: true, user: result.user });
      } else {
        logger.warn(`Token ${tag} không hợp lệ (${result.reason}) — loại bỏ`);
        ctx.validatedTokens.set(key, { valid: false, reason: result.reason });
        deadKeys.add(key);
      }
    } catch (e) {
      logger.error(`Validate ${tag} throw: ${e.message} — skip`);
      deadKeys.add(tokenKeyOf(token));
    }
  }

  ctx.tokens = aliveTokens;

  for (const key of deadKeys) {
    ctx.questCacheByToken.delete(key);
    ctx.channelCacheByToken.delete(key);
    ctx.enrollmentBlockedByToken.delete(key);
    invalidateActivityChannel(key);
  }

  rootLog.ok(`Token: ${aliveTokens.length}/${total} hợp lệ — không validate lại`);
}

async function checkAll() {
  await validateProxies();
  await validateTokens();
  if (isShuttingDown()) return;
  if (!ctx.dashboard) return;

  ctx.dashboard.updateStats({
    tokens: ctx.tokens.length,
    proxies: ctx.proxies.length,
  });
  ctx.dashboard.clearCurrent();
  ctx.dashboard.setPhase('READY');
}

// ── Quest helpers ────────────────────────────────────────────────
function annotateQuest(quest) {
  quest._name = getQuestName(quest);
  quest._taskType = getTaskType(quest);
  quest._unsupportedTask = getUnsupportedTaskType(quest);
  quest._secondsNeeded = getSecondsNeeded(quest);
  quest._secondsDone = getSecondsDone(quest);
  const enrolledIso = getEnrolledAt(quest);
  quest._enrolledTs = enrolledIso ? isoToMs(enrolledIso) / 1000 : Date.now() / 1000;
  quest._activityId = getActivityId(quest);
  return quest;
}

async function fetchQuests(api, logger) {
  const res = await api.get('/quests/@me');
  if (res.status !== 200) {
    logger.warn(`Fetch quests lỗi (${res.status})`);
    return { quests: [], blockedUntil: null };
  }
  const data = res.data;
  if (Array.isArray(data)) return { quests: data, blockedUntil: null };
  if (data && Array.isArray(data.quests)) {
    const blocked = data.quest_enrollment_blocked_until || null;
    if (blocked) logger.warn(`Enrollment blocked until: ${blocked}`);
    return { quests: data.quests, blockedUntil: blocked };
  }
  return { quests: [], blockedUntil: null };
}

async function fetchClaimedCount(api) {
  try {
    const res = await api.get('/quests/@me/claimed');
    if (res.status !== 200) return 0;
    const data = res.data;
    if (Array.isArray(data)) return data.length;
    if (data && Array.isArray(data.quests)) return data.quests.length;
    return 0;
  } catch {
    return 0;
  }
}

async function enrollQuest(api, quest, logger) {
  const name = quest._name;
  const body = {
    location: ENROLL_LOCATION,
    metadata_sealed: quest.metadata_sealed ?? null,
    traffic_metadata_sealed: quest.traffic_metadata_sealed ?? null,
  };

  const res = await api.post(`/quests/${quest.id}/enroll`, body);

  if ([200, 201, 204].includes(res.status)) {
    logger.ok(`Đã nhận: ${name}`);
    quest.userStatus = quest.userStatus || {};
    quest.userStatus.enrolledAt = new Date().toISOString();
    return true;
  }

  if (res.status === 400) {
    const d = res.data || {};
    if (Array.isArray(d.captcha_key) && d.captcha_key.length) {
      logger.warn(`Enroll "${name}" 400 – CAPTCHA (${d.captcha_service || 'unknown'})`);
    } else {
      logger.warn(`Enroll "${name}" 400 – body sai: ${shorten(JSON.stringify(d.errors ?? d), 200)}`);
    }
  } else if (res.status === 404) {
    logger.warn(`Enroll "${name}" 404`);
  } else if (res.status === 409) {
    logger.warn(`Enroll "${name}" 409 – đã enroll trước`);
  } else if (res.status === 429) {
    logger.warn(`Enroll "${name}" 429 – rate limit`);
  } else {
    logger.warn(`Enroll "${name}" lỗi (${res.status})`);
  }
  return false;
}

// ── SCAN ─────────────────────────────────────────────────────────
async function scanToken(token, tag, proxyList, cooldownRegistry) {
  const { config, dashboard } = ctx;
  const logger = makeLogger(tag);
  const tokenKey = tokenKeyOf(token);

  const cached = ctx.validatedTokens.get(tokenKey);
  if (!cached || !cached.valid) {
    logger.debug(`Token ${tag} không có validated cache — skip`);
    return { enrolled: 0, scanned: 0, skipped: 0, ok: false };
  }

  dashboard.setCurrent(`account ${tag} · fetching`);

  const api = createApi(token, logger);
  api.setProxy(null);

  if (!ctx.claimedCountByToken.has(tokenKey)) {
    const claimedTotal = await fetchClaimedCount(api);
    ctx.claimedCountByToken.set(tokenKey, claimedTotal);
    if (claimedTotal > 0) logger.info(`📦 Đã claim tổng cộng: ${claimedTotal} quest`);
  }

  const questsById = new Map();
  const pidByQuest = new Map();
  let localBlockedUntil = ctx.enrollmentBlockedByToken.get(tokenKey) || null;

  if (!ctx.channelCacheByToken.has(tokenKey)) {
    try {
      const cid = await pickActivityChannel(api, logger, tokenKey);
      ctx.channelCacheByToken.set(tokenKey, cid || null);
    } catch {
      ctx.channelCacheByToken.set(tokenKey, null);
    }
  }

  const shuffledProxies = [...proxyList];
  for (let i = shuffledProxies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledProxies[i], shuffledProxies[j]] = [shuffledProxies[j], shuffledProxies[i]];
  }

  let enrolledCount = 0;
  let anyFetchOk = false;

  for (const proxy of shuffledProxies) {
    if (isShuttingDown()) break;
    const label = proxy?.label || 'DIRECT';

    dashboard.setCurrent(`account ${tag} · [${label}] fetching`);

    // Cooldown per proxy — share giữa các token khi parallel
    if (proxy) {
      const pKey = `${proxy.host}:${proxy.port}`;
      const cd = cooldownRegistry.get(pKey, config.proxyCooldownMs, {
        jitterMs: config.proxyCooldownJitterMs,
      });
      await cd.wait();
    }

    logger.info(proxy ? `🌍 [${label}] fetch quests...` : '🌍 fetch quests (direct)...');
    api.setProxy(proxy);

    let fetched;
    try {
      fetched = await fetchQuests(api, logger);
      anyFetchOk = true;
    } catch (e) {
      logger.error(`fetchQuests [${label}] throw: ${e.message}`);
      continue;
    }

    if (fetched.blockedUntil) {
      localBlockedUntil = fetched.blockedUntil;
      ctx.enrollmentBlockedByToken.set(tokenKey, localBlockedUntil);
    }

    const quests = fetched.quests.map(annotateQuest);
    logger.info(`   → ${quests.length} quest`);

    for (const q of quests) {
      if (!questsById.has(q.id)) {
        q._proxy = proxy;
        q._proxyLabel = label;
        if (!pidByQuest.has(q.id)) {
          pidByQuest.set(q.id, Math.floor(Math.random() * 29000) + 1000);
        }
        q._pid = pidByQuest.get(q.id);
        q._channelId = ctx.channelCacheByToken.get(tokenKey);
        questsById.set(q.id, q);
      } else {
        const existing = questsById.get(q.id);
        if (isCompleted(q) && !isCompleted(existing)) existing.userStatus = q.userStatus;
        else if (isEnrolled(q) && !isEnrolled(existing)) existing.userStatus = q.userStatus;
      }
    }

    if (localBlockedUntil) {
      const blocked = Date.parse(localBlockedUntil);
      if (!Number.isNaN(blocked) && blocked > Date.now()) {
        logger.warn(`⊘ Enrollment blocked đến ${localBlockedUntil}`);
        continue;
      }
      localBlockedUntil = null;
      ctx.enrollmentBlockedByToken.delete(tokenKey);
    }

    if (!config.autoAccept) continue;

    const unaccepted = quests.filter(
      (q) => !isEnrolled(q) && !isCompleted(q) && isCompletable(q)
    );

    for (let ei = 0; ei < unaccepted.length; ei++) {
      if (isShuttingDown()) break;
      const q = unaccepted[ei];
      const tracked = questsById.get(q.id);
      if (tracked && isEnrolled(tracked)) continue;

      if (ei > 0) await enrollCooldown(config, logger);

      dashboard.setCurrent(`account ${tag} · [${label}] enroll ${q._name}`);
      logger.info(`   ✚ [${label}] enroll "${q._name}"`);

      let ok = false;
      try {
        ok = await enrollQuest(api, q, logger);
      } catch (e) {
        logger.error(`enrollQuest "${q._name}" throw: ${e.message}`);
      }
      if (ok) {
        enrolledCount++;
        if (tracked) {
          tracked.userStatus = tracked.userStatus || {};
          tracked.userStatus.enrolledAt = new Date().toISOString();
        }
      }
    }
  }

  if (anyFetchOk) {
    ctx.questCacheByToken.set(tokenKey, questsById);
  }
  syncStats();

  const all = [...questsById.values()];
  const supported = all.filter((q) => q._taskType).length;
  const unsupported = all.filter((q) => !q._taskType && q._unsupportedTask).length;
  const alreadyEnrolled = all.filter((q) => isEnrolled(q)).length;
  const alreadyCompleted = all.filter((q) => isCompleted(q)).length;

  logger.info(`Tổng: ${all.length} quest | hỗ trợ: ${supported} | không hỗ trợ: ${unsupported}`);
  logger.info(`   server: ${alreadyEnrolled} enrolled · ${alreadyCompleted} completed | session: ${enrolledCount} enroll`);

  return {
    enrolled: enrolledCount,
    scanned: all.length,
    skipped: unsupported,
    ok: anyFetchOk,
  };
}

// ── COMPLETE ─────────────────────────────────────────────────────
async function completeToken(token, tag) {
  const { config, state, dashboard } = ctx;
  const logger = makeLogger(tag);
  const tokenKey = tokenKeyOf(token);

  const cached = ctx.validatedTokens.get(tokenKey);
  if (!cached || !cached.valid) {
    logger.debug(`Token ${tag} không có validated cache — skip`);
    return { completed: 0, failed: 0, skipped: 0 };
  }

  const questsById = ctx.questCacheByToken.get(tokenKey);
  if (!questsById || questsById.size === 0) {
    logger.warn('Chưa có cache quest — skip');
    return { completed: 0, failed: 0, skipped: 0 };
  }

  const api = createApi(token, logger);
  const doneIds = new Set(state.completed[tokenKey] || []);
  const channelId = ctx.channelCacheByToken.get(tokenKey) || null;

  const all = [...questsById.values()];

  const skippedUnsupported = all.filter(
    (q) => q._unsupportedTask && !q._taskType && isEnrolled(q) && !isCompleted(q)
  );
  for (const q of skippedUnsupported) {
    logger.info(`⊘ Skip "${q._name}" [${q._unsupportedTask}]`);
    ctx.stats.skipped++;
  }
  syncStats();

  const actionable = all.filter(
    (q) => isEnrolled(q) && !isCompleted(q) && !isClaimed(q) && isCompletable(q)
  );

  const serverCompleted = all.filter((q) => isCompleted(q)).length;
  const serverClaimed = all.filter((q) => isClaimed(q)).length;
  const serverEnrolled = all.filter((q) => isEnrolled(q) && !isCompleted(q)).length;

  logger.info(`Cache: ${all.length} · completed: ${serverCompleted} · claimed: ${serverClaimed} · đang dở: ${serverEnrolled}`);

  let initialEstimate = 0;
  for (const q of actionable) {
    initialEstimate += estimateQuestSeconds(q, config) + INTER_QUEST_DELAY_SEC;
  }

  logger.info(`${actionable.length} quest cần hoàn thành · ước lượng ~${formatDuration(initialEstimate)}`);

  if (!isShuttingDown() && actionable.length > 0) {
    dashboard.setEstimate(initialEstimate);
    dashboard.setQueue(0, actionable.length);
  }

  let completedCount = 0;
  let failedCount = 0;
  let elapsedHandled = 0;

  for (let idx = 0; idx < actionable.length; idx++) {
    const q = actionable[idx];
    if (isShuttingDown()) break;

    if (isCompleted(q) || isClaimed(q)) {
      logger.info(`  ⊘ "${q._name}" đã xong — bỏ qua`);
      ctx.stats.skipped++;
      syncStats();
      elapsedHandled += estimateQuestSeconds(q, config) + INTER_QUEST_DELAY_SEC;
      if (!isShuttingDown()) dashboard.setEstimate(Math.max(0, initialEstimate - elapsedHandled));
      continue;
    }

    api.setProxy(q._proxy || null);
    dashboard.setCurrent(`account ${tag} · ${q._name} · ${q._taskType}`);
    dashboard.setQueue(idx + 1, actionable.length);

    let ok = false;
    try {
      logger.info(`━━━ Complete: ${q._name} (${q._taskType}) ━━━`);
      if (q._taskType === 'WATCH_VIDEO' || q._taskType === 'WATCH_VIDEO_ON_MOBILE') {
        ok = await completeVideo({ api, quest: q, config, logger });
      } else if (
        q._taskType === 'PLAY_ON_DESKTOP' ||
        q._taskType === 'PLAY_ON_DESKTOP_V2' ||
        q._taskType === 'STREAM_ON_DESKTOP' ||
        q._taskType === 'PLAY_ACTIVITY'
      ) {
        ok = await completeHeartbeat({ api, quest: q, config, logger, channelId });
      }
    } catch (e) {
      logger.error(`Lỗi "${q._name}": ${e.message}`);
    }

    if (ok) {
      completedCount++;
      q.userStatus = q.userStatus || {};
      q.userStatus.completedAt = new Date().toISOString();
      doneIds.add(q.id);
      state.completed[tokenKey] = [...doneIds].slice(-MAX_STATE_QUEST_IDS);
      saveState(state);
    } else {
      failedCount++;
      ctx.stats.failed++;
    }
    syncStats();

    elapsedHandled += estimateQuestSeconds(q, config) + INTER_QUEST_DELAY_SEC;
    if (!isShuttingDown()) dashboard.setEstimate(Math.max(0, initialEstimate - elapsedHandled));

    if (idx < actionable.length - 1) {
      for (let s = 0; s < INTER_QUEST_DELAY_SEC; s++) {
        if (isShuttingDown()) break;
        await sleep(1000);
      }
    }
  }

  if (!isShuttingDown()) dashboard.clearEstimate();

  return { completed: completedCount, failed: failedCount, skipped: skippedUnsupported.length };
}

// ── ACTION: Scan + Complete ──────────────────────────────────────
async function actionScanAndComplete() {
  const { config, tokens, proxies, dashboard } = ctx;
  const proxyList = proxies.length ? proxies : [null];

  await actionStartDelay(config);

  const stats = {
    sumEnrolled: 0,
    sumScanned: 0,
    sumUnsupported: 0,
    sumCompleted: 0,
    sumFailed: 0,
    sumSkipped: 0,
    sumErrors: 0,
  };

  // Registry share cooldown per-proxy giữa các token
  const cooldownRegistry = new CooldownRegistry();

  const concurrency = Math.max(1, config.concurrency);
  const parallel = concurrency > 1 && tokens.length > 1;

  if (parallel) {
    rootLog.info(`Chạy song song ${concurrency} token (max)`);
    dashboard.setPhase('RUNNING');
  }

  const processToken = async (token, i) => {
    if (isShuttingDown()) return;
    const tag = `#${i + 1}:${token.slice(-4)}`;

    if (!parallel) dashboard.setPhase('SCAN');

    try {
      const r = await scanToken(token, tag, proxyList, cooldownRegistry);
      stats.sumEnrolled += r.enrolled;
      stats.sumScanned += r.scanned;
      stats.sumUnsupported += r.skipped;
    } catch (e) {
      rootLog.error(`scanToken ${tag} throw: ${e.message}`);
      stats.sumErrors++;
    }

    if (isShuttingDown()) return;

    await sleepResponsive(randInt(2000, 5000));

    if (!parallel) dashboard.setPhase('COMPLETE');

    try {
      const r = await completeToken(token, tag);
      stats.sumCompleted += r.completed;
      stats.sumFailed += r.failed;
      stats.sumSkipped += r.skipped;
    } catch (e) {
      rootLog.error(`completeToken ${tag} throw: ${e.message}`);
      stats.sumErrors++;
    }
  };

  if (parallel) {
    const limit = pLimit(concurrency);
    await Promise.all(
      tokens.map((token, i) => limit(() => processToken(token, i)))
    );
  } else {
    for (let i = 0; i < tokens.length; i++) {
      if (isShuttingDown()) break;
      await processToken(tokens[i], i);
      if (i < tokens.length - 1) await accountSwitchDelay(config);
    }
  }

  rootLog.ok(
    `Xong · ${tokens.length} token · ` +
    `${stats.sumScanned} quest · ${stats.sumEnrolled} enroll · ` +
    `${stats.sumCompleted} complete · ${stats.sumFailed} fail · ` +
    `${stats.sumSkipped} skip · ${stats.sumUnsupported} unsupported · ${stats.sumErrors} lỗi`
  );

  if (!isShuttingDown()) {
    dashboard.clearCurrent();
    dashboard.clearEstimate();
    dashboard.setPhase('READY');
  }
}

// ── Menu handler ─────────────────────────────────────────────────
async function handleSelect(index) {
  if (running) return;

  if (index === 1) {
    forceShutdown();
    return;
  }

  if (index === 0) {
    if (!ctx.tokens.length) {
      rootLog.error('Không có token hợp lệ — không chạy được');
      ctx.dashboard.setPhase('READY');
      return;
    }
  }

  running = true;
  ctx.dashboard.setMenuEnabled(false);

  try {
    if (index === 0) await actionScanAndComplete();
  } catch (e) {
    rootLog.error(`Action lỗi: ${e.message}`);
  } finally {
    running = false;
    if (!isShuttingDown() && ctx.dashboard) {
      ctx.dashboard.clearCurrent();
      ctx.dashboard.clearEstimate();
      ctx.dashboard.setPhase('READY');
      ctx.dashboard.setMenuEnabled(true);
    }
  }
}

// ── Entry ────────────────────────────────────────────────────────
async function main() {
  const raw = readJson(CONFIG_PATH, null);
  if (!raw) {
    console.error(`Không đọc được ${CONFIG_PATH}`);
    process.exit(1);
  }
  const config = normalizeConfig(raw);
  ctx.config = config;
  setDebug(config.debug);

  auditSecretFile(TOKENS_PATH, 'tokens.txt');
  auditSecretFile(PROXIES_PATH, 'proxies.txt');
  auditSecretFile(STATE_PATH, '.state.json');

  ctx.userAgent = pickUserAgent(config);
  ctx.clientInfo = getClientInfo(config);

  // Auto-update client version
  if (config.autoUpdateClientVersion) {
    try {
      const info = await fetchLatestClientInfo(ctx.userAgent);
      if (info?.clientVersion && info.clientVersion !== config.clientVersion) {
        rootLog.info(`Client version update: ${config.clientVersion} → ${info.clientVersion}`);
        config.clientVersion = info.clientVersion;
        ctx.clientInfo = getClientInfo(config);
        ctx.userAgent = pickUserAgent(config);
      }
    } catch {}
  }

  await showSplash(1500);

  const dashboard = createDashboard({
    onSelect: (i) => handleSelect(i),
    onQuit: () => requestShutdown(),
  });
  ctx.dashboard = dashboard;
  setOutput((line) => dashboard.appendLog(line));

  rootLog.info(`UA: ${ctx.userAgent}`);
  rootLog.info(`Client: ${ctx.clientInfo.clientVersion} · Electron ${ctx.clientInfo.electronVersion} · Chrome ${ctx.clientInfo.chromeVersion}`);

  const tokens = loadTokens();
  if (!tokens.length) {
    dashboard.appendTrusted('{red-fg}Không có token trong tokens.txt{/red-fg}');
    await sleep(1500);
    forceShutdown();
    return;
  }
  ctx.tokens = tokens;

  if (config.useProxies) {
    const info = inspectProxiesFile(PROXIES_PATH);
    if (!info.exists) rootLog.info('proxies.txt không tồn tại');
    else if (info.raw === 0) rootLog.info('proxies.txt trống');
    else if (info.parsed === 0) rootLog.warn(`proxies.txt có ${info.raw} dòng nhưng 0 dòng parse được`);
    else rootLog.info(`proxies.txt có ${info.parsed} proxy (${info.raw} dòng)`);
  }

  ctx.proxies = [];
  ctx.state = loadState();
  ctx.buildNumber = await fetchLatestBuildNumber(ctx.userAgent);

  dashboard.updateStats({
    tokens: ctx.tokens.length,
    proxies: 0,
    regions: config.useProxies ? 'checking...' : 'DIRECT',
    cooldown: `${config.proxyCooldownMs / 1000}s–${(config.proxyCooldownMs + config.proxyCooldownJitterMs) / 1000}s`,
  });
  dashboard.setPhase('READY');

  process.on('SIGINT', () => requestShutdown());

  await checkAll();

  if (isShuttingDown()) forceShutdown();
}

main().catch((e) => {
  console.error(e);
  try { ctx.dashboard?.destroy(); } catch {}
  process.exit(1);
});