import axios from 'axios';

const DEFAULTS = {
  clientVersion: '1.0.9175',
  electronVersion: '32.2.7',
  chromeVersion: '128.0.6613.186',
  osVersion: '10.0.26100',
  nativeBuildNumber: 59498,
};

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 ' +
  'Electron/32.2.7 Safari/537.36';

function safeStr(v, fallback) {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  return s ? s : fallback;
}

function safeInt(v, fallback) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isVersionLike(s) {
  return typeof s === 'string' && /^\d+(\.\d+){1,3}$/.test(s);
}

function sanitizeVersion(v, fallback) {
  const s = safeStr(v, '');
  if (isVersionLike(s)) return s;
  return fallback;
}

function stripControl(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\x00-\x1f\x7f]/g, '');
}

export function parseUserAgent(ua) {
  if (typeof ua !== 'string' || !ua) return null;
  const discord = ua.match(/discord\/([\d.]+)/i);
  const chrome = ua.match(/Chrome\/([\d.]+)/i);
  const electron = ua.match(/Electron\/([\d.]+)/i);
  const windows = ua.match(/Windows NT ([\d.]+)/i);
  if (!discord && !chrome && !electron) return null;
  return {
    clientVersion: discord?.[1] || null,
    chromeVersion: chrome?.[1] || null,
    electronVersion: electron?.[1] || null,
    osVersion: windows?.[1] || null,
  };
}

export function pickUserAgent(config) {
  const raw = config?.userAgent;

  if (typeof raw === 'string' && raw.trim()) {
    const cleaned = stripControl(raw.trim());
    if (/discord\//i.test(cleaned) || /Electron\//i.test(cleaned)) {
      return cleaned;
    }
  }

  const info = getClientInfo(config);
  return buildUserAgent(info);
}

export function getClientInfo(config) {
  const clientVersion = sanitizeVersion(config?.clientVersion, DEFAULTS.clientVersion);
  const electronVersion = sanitizeVersion(config?.electronVersion, DEFAULTS.electronVersion);
  const chromeVersion = sanitizeVersion(config?.chromeVersion, DEFAULTS.chromeVersion);
  const osVersion = safeStr(config?.osVersion, DEFAULTS.osVersion);
  const nativeBuildNumber = safeInt(config?.nativeBuildNumber, DEFAULTS.nativeBuildNumber);

  return {
    clientVersion,
    electronVersion,
    chromeVersion,
    osVersion,
    nativeBuildNumber,
  };
}

export function buildUserAgent(info = {}) {
  const clientVersion = sanitizeVersion(info.clientVersion, DEFAULTS.clientVersion);
  const electronVersion = sanitizeVersion(info.electronVersion, DEFAULTS.electronVersion);
  const chromeVersion = sanitizeVersion(info.chromeVersion, DEFAULTS.chromeVersion);

  return (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    `(KHTML, like Gecko) discord/${clientVersion} Chrome/${chromeVersion} ` +
    `Electron/${electronVersion} Safari/537.36`
  );
}

export function userAgentMatchesClientInfo(ua, clientInfo) {
  const parsed = parseUserAgent(ua);
  if (!parsed) return false;
  return (
    parsed.clientVersion === clientInfo.clientVersion &&
    parsed.electronVersion === clientInfo.electronVersion &&
    parsed.chromeVersion === clientInfo.chromeVersion
  );
}

// ── Auto-fetch client version từ discord.com/app ─────────────────
// Discord đặt version trong JS asset. Chúng ta scan regex.
export async function fetchLatestClientInfo(userAgent) {
  try {
    const res = await axios.get('https://discord.com/app', {
      headers: { 'User-Agent': userAgent },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (res.status !== 200) return null;

    // Tìm "1.0.XXXX" — client version thường có dạng này
    const html = String(res.data);
    const m = html.match(/(?:client[_-]?version|discord)[^\d]*(1\.0\.\d{3,5})/i);
    if (m && isVersionLike(m[1])) {
      return { clientVersion: m[1] };
    }

    return null;
  } catch {
    return null;
  }
}

export const _defaults = { ...DEFAULTS, userAgent: DEFAULT_UA };