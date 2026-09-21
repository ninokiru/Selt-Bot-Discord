import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

// ── Sleep / random ───────────────────────────────────────────────
export function sleep(ms) {
  const n = Math.max(0, ms | 0);
  if (n === 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, n));
}

export function randInt(min, max) {
  const a = Math.ceil(Math.min(min, max));
  const b = Math.floor(Math.max(min, max));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return a || 0;
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

export function jitter(range) {
  if (!Array.isArray(range) || range.length !== 2) return 0;
  const [min, max] = range;
  if (typeof min !== 'number' || typeof max !== 'number') return 0;
  return randInt(min, max);
}

// ── File I/O ─────────────────────────────────────────────────────
export function readLines(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

export function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

export function auditSecretFile(file, label) {
  try {
    if (!fs.existsSync(file)) return;
    if (process.platform === 'win32') return;
    const st = fs.statSync(file);
    const mode = st.mode & 0o777;
    if (mode & 0o077) {
      process.stderr.write(
        `[warn] ${label} (${file}) có permission ${mode.toString(8)} — nên set 0600\n`
      );
    }
  } catch {}
}

// ── Text ─────────────────────────────────────────────────────────
export function shorten(s, n = 60) {
  s = String(s ?? '');
  if (s.length <= n) return s;
  if (n <= 1) return s.slice(0, n);
  return s.slice(0, n - 1) + '…';
}

export function redactSecret(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/([A-Za-z0-9_-]{20,})\.([A-Za-z0-9_-]{5,})\.([A-Za-z0-9_-]{20,})/g, '$1.***.***')
    .replace(/(Authorization["'\s:]+)["']?[\w.\-]+["']?/gi, '$1***')
    .replace(/(token["'\s:=]+)["']?[\w.\-]+["']?/gi, '$1***');
}

// ── Proxy ────────────────────────────────────────────────────────
const VALID_PROTOCOLS = new Set(['http', 'https', 'socks', 'socks4', 'socks5']);

export function parseProxy(line) {
  if (!line || typeof line !== 'string') return null;

  let label = null;
  let url = line.trim();
  if (!url) return null;

  const pipe = url.indexOf('|');
  if (pipe !== -1) {
    label = url.slice(0, pipe).trim() || null;
    url = url.slice(pipe + 1).trim();
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url;

  let u;
  try { u = new URL(url); } catch { return null; }

  const protocol = u.protocol.replace(':', '').toLowerCase();
  if (!VALID_PROTOCOLS.has(protocol)) return null;

  const host = u.hostname;
  if (!host) return null;

  const portRaw = u.port;
  const port = portRaw ? parseInt(portRaw, 10) : (protocol.startsWith('socks') ? 1080 : 8080);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;

  return {
    label,
    protocol,
    host,
    port,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
  };
}

// Kiểm tra file proxy — trả thống kê + dòng lỗi
export function inspectProxiesFile(file) {
  try {
    if (!fs.existsSync(file)) return { exists: false, raw: 0, parsed: 0, bad: [] };

    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    const bad = [];
    let parsed = 0;

    for (const line of lines) {
      const p = parseProxy(line);
      if (p) parsed++;
      else if (bad.length < 5) bad.push(line);
    }

    return { exists: true, raw: lines.length, parsed, bad };
  } catch (e) {
    return { exists: false, raw: 0, parsed: 0, bad: [], error: e.message };
  }
}

export function buildAgent(proxy) {
  if (!proxy || !proxy.host) return undefined;
  const { protocol, host, port, username, password } = proxy;

  try {
    if (protocol === 'socks4' || protocol === 'socks5' || protocol === 'socks') {
      return new SocksProxyAgent({
        host, port, username, password,
        type: protocol === 'socks4' ? 4 : 5,
      });
    }
    return new HttpsProxyAgent({
      host, port, username, password,
      protocol: protocol === 'https' ? 'https:' : 'http:',
    });
  } catch {
    return undefined;
  }
}

// ── Country detection ────────────────────────────────────────────
const COUNTRY_ENDPOINTS = [
  { url: 'https://ipwho.is/', pick: (d) => d?.country_code },
  { url: 'https://api.country.is/', pick: (d) => d?.country },
];

export async function detectCountry(proxy) {
  const agent = buildAgent(proxy);
  if (!agent) return 'XX';

  for (const ep of COUNTRY_ENDPOINTS) {
    try {
      const res = await axios.get(ep.url, {
        httpsAgent: agent,
        httpAgent: agent,
        proxy: false,
        timeout: 8000,
        validateStatus: () => true,
      });
      if (res.status === 200) {
        const code = ep.pick(res.data);
        if (typeof code === 'string' && /^[A-Za-z]{2}$/.test(code)) {
          return code.toUpperCase();
        }
      }
    } catch {}
  }
  return 'XX';
}

// ── Proxy health check ───────────────────────────────────────────
export async function checkProxy(proxy, userAgent, timeoutMs = 8000) {
  if (!proxy) return false;
  const agent = buildAgent(proxy);
  if (!agent) return false;

  try {
    const res = await axios.get('https://discord.com/api/v9/gateway', {
      httpsAgent: agent,
      httpAgent: agent,
      proxy: false,
      timeout: timeoutMs,
      validateStatus: () => true,
      headers: { 'User-Agent': userAgent || 'Mozilla/5.0' },
    });
    return res.status === 200 && typeof res.data?.url === 'string';
  } catch {
    return false;
  }
}

// ── Misc ─────────────────────────────────────────────────────────
export function isoToMs(iso) {
  if (!iso || typeof iso !== 'string') return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

export function sha12(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 12);
}