import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RPC_CONFIG_PATH = path.resolve(__dirname, '..', 'rpc.json');

const ACTIVITY_TYPES = {
  PLAYING: 0,
  STREAMING: 1,
  LISTENING: 2,
  WATCHING: 3,
  COMPETING: 5,
};

const VALID_STATUS = ['online', 'idle', 'dnd', 'invisible'];

let ctx = { mainConfig: null, logger: null, getClient: null };

export function initRPC({ config, logger, getClient }) {
  ctx = { mainConfig: config, logger, getClient };
}

function log(level, msg) {
  const l = ctx.logger;
  if (l && typeof l[level] === 'function') l[level](msg);
}

// ── Sanitize: strip unicode fancy fonts ───────────────────
// Extension cảnh báo: "fonts like this" làm RPC không hiện
function sanitize(text) {
  if (text == null) return text;
  return String(text)
    // Loại bỏ mathematical alphanumeric, fullwidth, enclosed, combining
    .replace(/[\u{1D400}-\u{1D7FF}]/gu, '')
    .replace(/[\u{FF00}-\u{FFEF}]/gu, '')
    .replace(/[\u{2460}-\u{24FF}]/gu, '')
    .replace(/[\u{0300}-\u{036F}]/gu, '')
    .replace(/[\u{1F100}-\u{1F1FF}]/gu, '')
    .trim();
}

// ── Load rpc.json ─────────────────────────────────────────
function loadRpcConfig() {
  const raw = readJson(RPC_CONFIG_PATH, null);
  if (!raw) return null;

  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
}

// ── Parse timestamp ───────────────────────────────────────
// Extension dùng milliseconds — auto convert về seconds
function parseTimestamp(value) {
  if (value == null || value === '' || value === 0) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 0) return null;
    // Nếu > 1e12 → ms, convert về seconds
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }

  const s = String(value).trim().toLowerCase();
  if (!s) return null;

  if (s === 'now') return Math.floor(Date.now() / 1000);

  // "now ± Xd Yh Zm Ws"
  const m = s.match(/^now\s*([+-])\s*(.*)$/);
  if (m) {
    const sign = m[1] === '-' ? -1 : 1;
    const rest = m[2];
    let total = 0;
    const dh = rest.match(/(\d+)\s*d/);
    const hh = rest.match(/(\d+)\s*h/);
    const mm = rest.match(/(\d+)\s*m/);
    const ss = rest.match(/(\d+)\s*s/);
    if (dh) total += parseInt(dh[1], 10) * 86400;
    if (hh) total += parseInt(hh[1], 10) * 3600;
    if (mm) total += parseInt(mm[1], 10) * 60;
    if (ss) total += parseInt(ss[1], 10);
    return Math.floor(Date.now() / 1000) + sign * total;
  }

  const n = Number(s);
  if (Number.isFinite(n)) {
    return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }

  return null;
}

// ── Build activity payload ────────────────────────────────
function buildActivity(cfg) {
  const rawName = cfg.application_name || cfg.name || '';
  const name = sanitize(rawName).slice(0, 128);

  if (!name) {
    log('warn', 'rpc.json cần "application_name"');
    return null;
  }

  const typeName = String(cfg.type || 'PLAYING').toUpperCase();
  const typeNum = ACTIVITY_TYPES[typeName] ?? 0;

  const activity = {
    name,
    type: typeNum,
  };

  // Application ID
  if (cfg.application_id) {
    const aid = String(cfg.application_id).trim();
    if (/^\d{15,25}$/.test(aid)) {
      activity.application_id = aid;
    } else {
      log('warn', `application_id "${aid}" không hợp lệ`);
    }
  }

  // URL — chỉ STREAMING
  if (typeNum === 1) {
    const url = cfg.stream_url || cfg.url;
    if (url) activity.url = String(url);
  }

  // Details / State
  const details = sanitize(cfg.details).slice(0, 128);
  if (details) activity.details = details;

  const state = sanitize(cfg.state).slice(0, 128);
  if (state) activity.state = state;

  // Details/State URL (clickable text)
  if (cfg.details_url) activity.details_url = String(cfg.details_url).slice(0, 256);
  if (cfg.state_url) activity.state_url = String(cfg.state_url).slice(0, 256);

  // Timestamps
  const mode = String(cfg.timestamp_mode || 'start').toLowerCase();
  const start = parseTimestamp(cfg.start_timestamp);
  const end = parseTimestamp(cfg.end_timestamp);

  const ts = {};
  if (mode === 'start' || mode === 'both') {
    if (start) ts.start = start;
  }
  if (mode === 'end' || mode === 'both') {
    if (end) ts.end = end;
  }
  if (Object.keys(ts).length) activity.timestamps = ts;

  // Assets
  const assets = {};
  if (cfg.large_image) assets.large_image = String(cfg.large_image);
  if (cfg.large_text) assets.large_text = sanitize(cfg.large_text).slice(0, 128);
  if (cfg.small_image) assets.small_image = String(cfg.small_image);
  if (cfg.small_text) assets.small_text = sanitize(cfg.small_text).slice(0, 128);

  // Clickable URL — extension có field này
  if (cfg.large_url) assets.large_url = String(cfg.large_url);
  if (cfg.small_url) assets.small_url = String(cfg.small_url);

  if (Object.keys(assets).length) activity.assets = assets;

  // Buttons
  const buttons = [];
  const bl1 = sanitize(cfg.button1_label).slice(0, 32);
  const bu1 = String(cfg.button1_url || '').slice(0, 512);
  if (bl1 && bu1) buttons.push({ label: bl1, url: bu1 });

  const bl2 = sanitize(cfg.button2_label).slice(0, 32);
  const bu2 = String(cfg.button2_url || '').slice(0, 512);
  if (bl2 && bu2) buttons.push({ label: bl2, url: bu2 });

  if (buttons.length) activity.buttons = buttons;

  // Party
  const pc = Number(cfg.party_current) | 0;
  const pm = Number(cfg.party_max) | 0;
  const pid = cfg.party_id ? String(cfg.party_id).slice(0, 128) : null;

  if ((pc > 0 && pm > 0 && pc <= pm) || pid) {
    const party = {};
    if (pid) party.id = pid;
    if (pc > 0 && pm > 0 && pc <= pm) party.size = [pc, pm];
    activity.party = party;
  }

  return { activity, status: cfg.status || 'online' };
}

// ── Public ────────────────────────────────────────────────
export function applyRPCFromConfig() {
  const client = ctx.getClient?.();
  if (!client?.user) {
    log('warn', 'Client chưa ready — bỏ qua RPC');
    return null;
  }

  let cfg;
  try {
    cfg = loadRpcConfig();
  } catch (e) {
    log('error', `Load rpc.json fail: ${e.message}`);
    return null;
  }

  if (!cfg) return null;
  if (!cfg.enabled) {
    log('debug', 'RPC disabled trong rpc.json');
    return null;
  }

  let built;
  try {
    built = buildActivity(cfg);
  } catch (e) {
    log('error', `Build activity fail: ${e.message}`);
    return null;
  }

  if (!built) return null;

  const { activity, status: rawStatus } = built;
  const status = VALID_STATUS.includes(String(rawStatus).toLowerCase())
    ? String(rawStatus).toLowerCase()
    : 'online';

  try {
    client.user.setPresence({
      activities: [activity],
      status,
    });

    const extras = [];
    if (activity.details) extras.push('details');
    if (activity.state) extras.push('state');
    if (activity.timestamps) extras.push('timestamps');
    if (activity.assets) extras.push('assets');
    if (activity.buttons) extras.push('buttons');
    if (activity.party) extras.push('party');

    log('ok', `RPC: ${cfg.type} "${activity.name}"${extras.length ? ` (${extras.join(', ')})` : ''}`);
    return activity;
  } catch (e) {
    log('error', `setPresence fail: ${e.message}`);
    return null;
  }
}

export function clearRPC() {
  const client = ctx.getClient?.();
  if (!client?.user) return;

  const st = ctx.mainConfig?.status || {};

  try {
    client.user.setPresence({
      activities: st.text ? [{
        name: String(st.text).slice(0, 128),
        type: ACTIVITY_TYPES[String(st.type || 'PLAYING').toUpperCase()] ?? 0,
      }] : [],
      status: 'online',
    });
    log('ok', 'RPC cleared');
  } catch (e) {
    log('warn', `clearRPC fail: ${e.message}`);
  }
}

export function getRpcConfig() {
  return loadRpcConfig();
}

export function reloadRPC() {
  log('info', 'Reload RPC...');
  return applyRPCFromConfig();
}

export { ACTIVITY_TYPES, VALID_STATUS };