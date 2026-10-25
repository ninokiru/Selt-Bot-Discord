import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtDur } from './utils.js';
import { isShuttingDown } from './shutdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RPC_CONFIG_PATH = path.resolve(__dirname, '..', 'rpc.json');
const RPC_DIR = path.dirname(RPC_CONFIG_PATH);

const ACTIVITY_TYPES = {
  PLAYING: 0,
  STREAMING: 1,
  LISTENING: 2,
  WATCHING: 3,
  CUSTOM: 4,
  COMPETING: 5,
};

const VALID_STATUS = ['online', 'idle', 'dnd', 'invisible'];

const MIN_REFRESH_SEC = 15;
const DEFAULT_REFRESH_SEC = 60;
const ASSET_OK_TTL_MS = 60 * 60 * 1000;
const ASSET_FAIL_TTL_MS = 5 * 60 * 1000;

let ctx = { mainConfig: null, logger: null, getClient: null, stats: null };

const runtime = {
  enabled: false,
  suspended: false,
  applied: false,
  activityName: '',
  activityType: '',
  status: 'online',
  appliedAt: 0,
  lastError: '',
  refreshIntervalSec: 0,
  refreshTimer: null,
  watchdog: null,
  watchDebounce: null,
  applying: false,
  assetCache: new Map(),
  warnedKeys: new Set(),
};

function log(level, msg) {
  const l = ctx.logger;
  if (l && typeof l[level] === 'function') l[level](msg);
}

function bump(key) {
  try { ctx.stats?.bump?.(key); } catch {}
}

export function initRPC({ config, logger, getClient, stats }) {
  ctx = { mainConfig: config, logger, getClient, stats };
}

// ── Sanitize ─────────────────────────────────────────────
// Discord ẩn RPC nếu text dùng font "fancy" (mathematical/fullwidth/enclosed)
function sanitize(text) {
  if (text == null) return '';
  return String(text)
    .normalize('NFC')
    .replace(/[\u{1D400}-\u{1D7FF}]/gu, '')
    .replace(/[\u{FF00}-\u{FFEF}]/gu, '')
    .replace(/[\u{2460}-\u{24FF}]/gu, '')
    .replace(/[\u{0300}-\u{036F}]/gu, '')
    .replace(/[\u{1F100}-\u{1F1FF}]/gu, '')
    .trim();
}

function capText(value, max) {
  return sanitize(value).slice(0, max).trim();
}

function isHttpUrl(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isDiscordCdn(value) {
  return /^https?:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//i.test(String(value || ''));
}

function normalizeAppId(value) {
  const s = String(value || '').trim();
  return /^\d{17,20}$/.test(s) ? s : '';
}

function normalizeStatus(value) {
  const s = String(value || 'online').toLowerCase();
  return VALID_STATUS.includes(s) ? s : 'online';
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

// ── Config ───────────────────────────────────────────────
let loadError = '';

function loadRpcConfig() {
  loadError = '';
  let rawText;
  try {
    rawText = fs.readFileSync(RPC_CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    loadError = e.code === 'ENOENT'
      ? 'Không tìm thấy rpc.json'
      : `Đọc rpc.json fail: ${e.message}`;
    return null;
  }

  try {
    const raw = JSON.parse(rawText || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      loadError = 'rpc.json phải là object';
      return null;
    }
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!k.startsWith('_')) out[k] = v;
    }
    return out;
  } catch (e) {
    loadError = `rpc.json sai JSON: ${e.message}`;
    return null;
  }
}

// ── Templates ────────────────────────────────────────────
function buildVars(client) {
  const u = client?.user;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const uptimeMs = Number(client?.uptime) || Math.round(process.uptime() * 1000);

  return {
    user: u?.username || '?',
    tag: u?.tag || u?.username || '?',
    id: u?.id || '',
    guilds: String(client?.guilds?.cache?.size ?? 0),
    ping: String(Math.round(Number(client?.ws?.ping) || 0)),
    uptime: fmtDur(uptimeMs / 1000),
    clock: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    status: client?.presence?.status || 'online',
  };
}

function renderText(value, vars, max, useTemplates = true) {
  if (value == null) return '';
  let text = String(value);
  if (useTemplates) {
    text = text.replace(/\{(\w+)\}/g, (match, key) => {
      const k = String(key).toLowerCase();
      return vars[k] !== undefined ? String(vars[k]) : match;
    });
  }
  return capText(text, max);
}

// ── Timestamp ────────────────────────────────────────────
function parseNowOffset(rest) {
  const re = /(\d+)\s*(d|h|m|s)/gi;
  let total = 0;
  let matched = false;
  let m;
  while ((m = re.exec(rest))) {
    matched = true;
    const n = Number.parseInt(m[1], 10);
    switch (m[2].toLowerCase()) {
      case 'd': total += n * 86400; break;
      case 'h': total += n * 3600; break;
      case 'm': total += n * 60; break;
      case 's': total += n; break;
      default: break;
    }
  }
  return matched ? total : null;
}

function parseTimestamp(value) {
  if (value == null || value === '' || value === 0) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return null;
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }

  const s = String(value).trim().toLowerCase();
  if (!s) return null;

  if (s === 'now') return Math.floor(Date.now() / 1000);

  const rel = s.match(/^now\s*([+-])\s*(.+)$/);
  if (rel) {
    const total = parseNowOffset(rel[2]);
    if (total == null) return null;
    return Math.floor(Date.now() / 1000) + (rel[1] === '-' ? -total : total);
  }

  const inFuture = s.match(/^in\s+(.+)$/);
  if (inFuture) {
    const total = parseNowOffset(inFuture[1]);
    if (total == null) return null;
    return Math.floor(Date.now() / 1000) + total;
  }

  const n = Number(s);
  if (Number.isFinite(n) && n > 0) {
    return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }

  return null;
}

// ── Buttons / party ──────────────────────────────────────
function collectButtons(cfg, vars) {
  const entries = [];

  if (Array.isArray(cfg.buttons)) {
    for (const b of cfg.buttons) {
      if (!b || typeof b !== 'object') continue;
      entries.push({ label: b.label ?? b.name, url: b.url });
    }
  }

  for (const n of [1, 2]) {
    entries.push({
      label: cfg[`button${n}_label`],
      url: cfg[`button${n}_url`],
    });
  }

  const labels = [];
  const urls = [];
  const seen = new Set();

  for (const entry of entries) {
    const label = renderText(entry.label, vars, 32, cfg.templates !== false);
    const url = String(entry.url || '').trim();
    if (!label && !url) continue;

    if (!label) {
      log('warn', 'RPC button thiếu label — bỏ qua');
      continue;
    }
    if (!isHttpUrl(url)) {
      log('warn', `RPC button "${label}" cần URL http(s) hợp lệ`);
      continue;
    }
    if (seen.has(url)) continue;

    seen.add(url);
    labels.push(label);
    urls.push(url.slice(0, 512));
    if (labels.length >= 2) break;
  }

  return { labels, urls };
}

function buildParty(cfg, vars) {
  const current = toInt(cfg.party_current, 0);
  const max = toInt(cfg.party_max, 0);
  const rawId = cfg.party_id
    ? renderText(cfg.party_id, vars, 128, cfg.templates !== false)
    : '';

  if (current <= 0 || max <= 0 || current > max) {
    return rawId ? { id: rawId } : null;
  }

  const party = { size: [current, max] };
  if (rawId) party.id = rawId;
  return party;
}

// ── Activity ─────────────────────────────────────────────
function buildActivity(cfg, vars) {
  const typeName = String(cfg.type || 'PLAYING').toUpperCase();
  if (!(typeName in ACTIVITY_TYPES)) {
    log('warn', `RPC type "${typeName}" không hợp lệ — dùng PLAYING`);
  }
  const typeNum = ACTIVITY_TYPES[typeName] ?? ACTIVITY_TYPES.PLAYING;

  const rawName = cfg.application_name ?? cfg.name;
  const name = renderText(rawName, vars, 128, cfg.templates !== false);
  if (!name) {
    throw new Error('rpc.json cần "application_name"');
  }

  const appId = normalizeAppId(cfg.application_id);
  if (cfg.application_id && !appId) {
    log('warn', `application_id "${String(cfg.application_id).slice(0, 30)}" không hợp lệ (cần 17-20 số)`);
  }

  const activity = { name, type: typeNum };
  if (appId) activity.application_id = appId;

  if (typeNum === ACTIVITY_TYPES.STREAMING) {
    const url = renderText(cfg.stream_url || cfg.url, vars, 512, cfg.templates !== false);
    if (!isHttpUrl(url)) {
      throw new Error('type STREAMING cần "stream_url" là URL http(s) hợp lệ');
    }
    activity.url = url;
  }

  const details = renderText(cfg.details, vars, 128, cfg.templates !== false);
  const state = renderText(cfg.state, vars, 128, cfg.templates !== false);

  if (typeNum === ACTIVITY_TYPES.CUSTOM) {
    activity.name = 'Custom Status';
    const custom = state || details;
    if (custom) activity.state = custom;
  } else {
    if (details) activity.details = details;
    if (state) activity.state = state;
  }

  // Timestamps
  const mode = String(cfg.timestamp_mode || 'start').toLowerCase();
  const start = parseTimestamp(cfg.start_timestamp);
  const end = parseTimestamp(cfg.end_timestamp);
  const timestamps = {};

  if ((mode === 'start' || mode === 'both') && start) timestamps.start = start;
  if ((mode === 'end' || mode === 'both') && end) timestamps.end = end;
  if (timestamps.start && timestamps.end && timestamps.end <= timestamps.start) {
    log('warn', 'RPC end_timestamp phải sau start_timestamp — bỏ end');
    delete timestamps.end;
  }
  if (Object.keys(timestamps).length) activity.timestamps = timestamps;

  // Assets (ảnh ngoài được resolve ở finalizeAssets)
  const assets = {};
  const largeImage = String(cfg.large_image || '').trim();
  const smallImage = String(cfg.small_image || '').trim();

  if (largeImage) {
    assets.large_image = largeImage;
    const largeText = renderText(cfg.large_text, vars, 128, cfg.templates !== false);
    if (largeText) assets.large_text = largeText;
  }
  if (smallImage) {
    assets.small_image = smallImage;
    const smallText = renderText(cfg.small_text, vars, 128, cfg.templates !== false);
    if (smallText) assets.small_text = smallText;
  }
  if (Object.keys(assets).length) activity.assets = assets;

  // Buttons — gateway cần labels + metadata.button_urls
  const buttons = collectButtons(cfg, vars);
  if (buttons.labels.length) {
    activity.buttons = buttons.labels;
    activity.metadata = { button_urls: buttons.urls };
    if (!appId) {
      log('warn', 'RPC buttons thường cần application_id mới hiển thị');
    }
  }

  const party = buildParty(cfg, vars);
  if (party) activity.party = party;

  return {
    activity,
    status: normalizeStatus(cfg.status),
    typeName,
    appId,
    refreshInterval: toInt(cfg.refreshInterval, DEFAULT_REFRESH_SEC),
    hotReload: cfg.hotReload !== false,
  };
}

// ── External assets ─────────────────────────────────────
function assetCacheGet(key) {
  const entry = runtime.assetCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    runtime.assetCache.delete(key);
    return null;
  }
  return entry.value;
}

function assetCacheSet(key, value, ttlMs) {
  if (runtime.assetCache.size > 200) runtime.assetCache.clear();
  runtime.assetCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function warnOnce(key, msg) {
  if (runtime.warnedKeys.has(key)) return;
  runtime.warnedKeys.add(key);
  if (runtime.warnedKeys.size > 300) runtime.warnedKeys.clear();
  log('warn', msg);
}

async function resolveImage(raw, appId, client) {
  const value = String(raw || '').trim();
  if (!value) return '';

  if (!isHttpUrl(value)) {
    if (value.startsWith('mp:') || value.startsWith('external/')) return value;
    if (/^(twitch|youtube|spotify):/.test(value)) return value;
    if (!appId) {
      warnOnce(`asset:${value}`, `RPC asset "${value}" cần application_id hợp lệ`);
      return '';
    }
    return value;
  }

  if (isDiscordCdn(value)) return value;

  if (!appId) {
    warnOnce(`asset:${value}`, 'Ảnh ngoài cần application_id để upload external asset');
    return '';
  }

  const cacheKey = `${appId}:${value}`;
  const cached = assetCacheGet(cacheKey);
  if (cached !== null) return cached;

  try {
    const { RichPresence } = await import('discord.js-selfbot-v13');
    const list = await RichPresence.getExternal(client, appId, value);
    const assetPath = list?.[0]?.external_asset_path;
    if (!assetPath) throw new Error('Discord không trả external_asset_path');

    assetCacheSet(cacheKey, assetPath, ASSET_OK_TTL_MS);
    log('debug', `RPC external asset: ${value} → ${assetPath}`);
    return assetPath;
  } catch (e) {
    assetCacheSet(cacheKey, '', ASSET_FAIL_TTL_MS);
    warnOnce(`asset:${value}:${e.message}`, `Upload ảnh RPC fail (${value.slice(0, 80)}): ${e.message}`);
    return '';
  }
}

async function finalizeAssets(activity, appId, client) {
  if (!activity.assets) return;

  const large = await resolveImage(activity.assets.large_image, appId, client);
  const small = await resolveImage(activity.assets.small_image, appId, client);

  if (large) activity.assets.large_image = large;
  else delete activity.assets.large_image;

  if (small) activity.assets.small_image = small;
  else delete activity.assets.small_image;

  if (!activity.assets.large_image) delete activity.assets.large_text;
  if (!activity.assets.small_image) delete activity.assets.small_text;

  if (!Object.keys(activity.assets).length) delete activity.assets;
}

// ── Refresh / watch ─────────────────────────────────────
function clearRefreshTimer() {
  if (runtime.refreshTimer) {
    clearInterval(runtime.refreshTimer);
    runtime.refreshTimer = null;
  }
}

function scheduleRefresh(sec) {
  clearRefreshTimer();
  runtime.refreshIntervalSec = sec;

  if (!Number.isFinite(sec) || sec <= 0) return;
  if (sec < MIN_REFRESH_SEC) {
    log('warn', `refreshInterval ${sec}s quá thấp — dùng tối thiểu ${MIN_REFRESH_SEC}s`);
    runtime.refreshIntervalSec = MIN_REFRESH_SEC;
  }

  const ms = Math.max(MIN_REFRESH_SEC, sec) * 1000;
  runtime.refreshTimer = setInterval(() => {
    if (runtime.applying || runtime.suspended || isShuttingDown()) return;
    void applyRPCFromConfig({ reason: 'refresh', quiet: true });
  }, ms);
  if (runtime.refreshTimer.unref) runtime.refreshTimer.unref();
}

function closeWatcher() {
  if (runtime.watchDebounce) {
    clearTimeout(runtime.watchDebounce);
    runtime.watchDebounce = null;
  }
  if (runtime.watchdog) {
    try { runtime.watchdog.close(); } catch {}
    runtime.watchdog = null;
  }
}

function ensureWatcher() {
  if (runtime.watchdog) return;

  try {
    runtime.watchdog = fs.watch(RPC_DIR, { persistent: false }, (_event, filename) => {
      const name = filename ? String(filename) : '';
      if (name && name !== 'rpc.json') return;

      if (runtime.watchDebounce) clearTimeout(runtime.watchDebounce);
      runtime.watchDebounce = setTimeout(() => {
        runtime.watchDebounce = null;
        if (runtime.suspended || isShuttingDown()) return;
        log('info', 'rpc.json thay đổi — reload RPC');
        void applyRPCFromConfig({ reason: 'file' });
      }, 600);
      if (runtime.watchDebounce.unref) runtime.watchDebounce.unref();
    });
    runtime.watchdog.on('error', (e) => {
      log('debug', `RPC watcher: ${e.message}`);
      closeWatcher();
    });
    if (runtime.watchdog.unref) runtime.watchdog.unref();
  } catch (e) {
    log('debug', `Không watch được rpc.json: ${e.message}`);
  }
}

// ── Preset status fallback ──────────────────────────────
function applyMainStatus() {
  const client = ctx.getClient?.();
  if (!client?.user) return;

  const st = ctx.mainConfig?.status || {};
  const type = ACTIVITY_TYPES[String(st.type || 'PLAYING').toUpperCase()] ?? 0;

  try {
    client.user.setPresence({
      activities: st.text ? [{ name: String(st.text).slice(0, 128), type }] : [],
      status: 'online',
    });
  } catch (e) {
    log('debug', `applyMainStatus: ${e.message}`);
  }

  runtime.applied = false;
  runtime.activityName = '';
  runtime.activityType = '';
}

// ── Apply ────────────────────────────────────────────────
function reportError(msg, quiet) {
  const changed = runtime.lastError !== msg;
  runtime.lastError = msg;
  bump('rpcErrors');
  if (quiet && !changed) return;
  log('error', `RPC: ${msg}`);
}

export async function applyRPCFromConfig({ startup = false, reason = 'manual', quiet = false, force = false } = {}) {
  if (isShuttingDown()) return null;
  if (runtime.applying) return null;

  const client = ctx.getClient?.();
  if (!client?.user) {
    if (!quiet) log('warn', 'Client chưa ready — bỏ qua RPC');
    return null;
  }

  const cfg = loadRpcConfig();
  if (!cfg) {
    reportError(loadError || 'Không đọc được rpc.json', quiet);
    return null;
  }

  if (cfg.hotReload !== false) ensureWatcher();
  else closeWatcher();

  if (cfg.enabled === false && !force) {
    runtime.enabled = false;
    clearRefreshTimer();
    if (runtime.applied) applyMainStatus();
    if (!quiet) log('info', 'RPC đang tắt trong rpc.json');
    return null;
  }

  if (startup && cfg.applyOnReady === false) {
    runtime.enabled = false;
    log('info', 'RPC applyOnReady = false — bỏ qua lúc khởi động');
    return null;
  }

  if (runtime.suspended) {
    if (!quiet) log('info', 'RPC đang tạm tắt — dùng .rpc on để bật');
    return null;
  }

  runtime.applying = true;
  runtime.enabled = true;

  try {
    const vars = buildVars(client);
    const built = buildActivity(cfg, vars);

    await finalizeAssets(built.activity, built.appId, client);

    client.user.setPresence({
      activities: [built.activity],
      status: built.status,
    });

    runtime.applied = true;
    runtime.activityName = built.activity.name;
    runtime.activityType = built.typeName;
    runtime.status = built.status;
    runtime.appliedAt = Date.now();
    runtime.lastError = '';

    bump('rpcApplies');
    scheduleRefresh(built.refreshInterval);

    const extras = [];
    if (built.activity.details || built.activity.state) extras.push('text');
    if (built.activity.timestamps) extras.push('timestamp');
    if (built.activity.assets) extras.push('assets');
    if (built.activity.buttons) extras.push('buttons');
    if (built.activity.party) extras.push('party');
    if (built.activity.application_id) extras.push('app');

    const suffix = runtime.refreshIntervalSec > 0 ? ` · refresh ${runtime.refreshIntervalSec}s` : '';
    const line = `RPC: ${built.typeName} "${built.activity.name}"${extras.length ? ` (${extras.join(', ')})` : ''}${suffix}`;
    if (quiet) log('debug', line);
    else log('ok', line);

    return built.activity;
  } catch (e) {
    const changed = runtime.lastError !== e.message;
    runtime.lastError = e.message;
    bump('rpcErrors');
    if (!quiet || changed) log('error', `RPC: ${e.message}`);
    return null;
  } finally {
    runtime.applying = false;
  }
}

export function reloadRPC({ force = false } = {}) {
  runtime.suspended = false;
  log('info', 'Reload RPC...');
  return applyRPCFromConfig({ reason: 'reload', force });
}

export function suspendRPC() {
  runtime.suspended = true;
  runtime.enabled = false;
  clearRefreshTimer();
  applyMainStatus();
  log('info', 'RPC đã tắt (tạm thời)');
}

export function stopRPC() {
  runtime.suspended = true;
  clearRefreshTimer();
  closeWatcher();
  runtime.applied = false;
}

export function clearRPC() {
  clearRefreshTimer();
  runtime.refreshIntervalSec = 0;
  applyMainStatus();
  log('ok', 'RPC cleared');
}

export function getRpcConfig() {
  return loadRpcConfig();
}

export function getRpcState() {
  return {
    enabled: runtime.enabled && !runtime.suspended,
    suspended: runtime.suspended,
    applied: runtime.applied,
    name: runtime.activityName,
    type: runtime.activityType,
    status: runtime.status,
    appliedAt: runtime.appliedAt,
    refreshIntervalSec: runtime.refreshIntervalSec,
    lastError: runtime.lastError,
    configPath: RPC_CONFIG_PATH,
  };
}

export { ACTIVITY_TYPES, VALID_STATUS, parseTimestamp, sanitize };
