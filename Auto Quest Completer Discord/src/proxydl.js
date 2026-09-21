import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import pLimit from 'p-limit';
import { buildAgent, checkProxy } from './utils.js';

// Nguồn proxy free — cập nhật 5-30 phút
const SOURCES_BY_COUNTRY = [
  (cc) => `https://raw.githubusercontent.com/databay-labs/free-proxy-list/master/by-country/${cc.toLowerCase()}/http.txt`,
  (cc) => `https://raw.githubusercontent.com/databay-labs/free-proxy-list/master/by-country/${cc.toLowerCase()}/socks5.txt`,
];

const FALLBACK_SOURCES = [
  'https://raw.githubusercontent.com/ProxyScrape/free-proxy-list/main/proxies/all.txt',
  'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt',
];

function parseLine(line) {
  if (!line || typeof line !== 'string') return null;
  line = line.trim();
  if (!line || line.startsWith('#')) return null;
  const m = line.match(/(\d{1,3}(?:\.\d{1,3}){3}:\d{2,5})/);
  if (!m) return null;
  return m[1];
}

async function fetchText(url, timeout = 15000) {
  try {
    const res = await axios.get(url, {
      timeout,
      validateStatus: () => true,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (res.status !== 200 || typeof res.data !== 'string') return '';
    return res.data;
  } catch {
    return '';
  }
}

async function fetchByCountry(cc) {
  const results = [];
  for (const srcFn of SOURCES_BY_COUNTRY) {
    try {
      const url = srcFn(cc);
      const text = await fetchText(url);
      if (!text) continue;

      const lines = text.split('\n').map(parseLine).filter(Boolean);
      const seen = new Set();
      for (const l of lines) {
        if (!seen.has(l)) {
          seen.add(l);
          results.push(l);
        }
      }
      if (results.length >= 30) break;
    } catch {}
  }
  return results;
}

async function fetchAll() {
  for (const url of FALLBACK_SOURCES) {
    try {
      const text = await fetchText(url, 20000);
      if (!text) continue;
      const lines = text.split('\n').map(parseLine).filter(Boolean);
      if (lines.length > 0) return lines;
    } catch {}
  }
  return [];
}

async function verifyProxy(ipPort, ua, timeoutMs = 6000) {
  const proxy = {
    label: null,
    protocol: 'http',
    host: ipPort.split(':')[0],
    port: parseInt(ipPort.split(':')[1], 10),
    username: undefined,
    password: undefined,
  };
  try {
    return await checkProxy(proxy, ua, timeoutMs);
  } catch {
    return false;
  }
}

async function detectCountryForIp(ipPort) {
  const proxy = {
    protocol: 'http',
    host: ipPort.split(':')[0],
    port: parseInt(ipPort.split(':')[1], 10),
  };
  const agent = buildAgent(proxy);
  if (!agent) return null;

  for (const url of ['https://ipwho.is/', 'https://api.country.is/']) {
    try {
      const res = await axios.get(url, {
        httpsAgent: agent,
        httpAgent: agent,
        proxy: false,
        timeout: 5000,
        validateStatus: () => true,
      });
      if (res.status === 200) {
        const cc = res.data?.country_code || res.data?.country;
        if (typeof cc === 'string' && /^[A-Za-z]{2}$/.test(cc)) {
          return cc.toUpperCase();
        }
      }
    } catch {}
  }
  return null;
}

export async function downloadFreeProxies({
  outputPath,
  countries = ['VN', 'SG', 'TH', 'ID', 'PH', 'MY', 'JP', 'KR', 'US', 'GB'],
  perCountry = 2,
  maxTotal = 20,
  userAgent = 'Mozilla/5.0',
  logger = { info: () => {}, ok: () => {}, warn: () => {}, debug: () => {} },
}) {
  const byCountry = {};
  const accepted = [];
  const seen = new Set();

  logger.info(`🌐 Tự tải proxy free từ GitHub (${countries.length} nước × ${perCountry})...`);

  for (const cc of countries) {
    if (accepted.length >= maxTotal) break;

    logger.debug(`Fetch proxy ${cc}...`);
    const candidates = await fetchByCountry(cc);
    if (candidates.length === 0) {
      logger.debug(`  ${cc}: không có proxy`);
      continue;
    }

    logger.debug(`  ${cc}: ${candidates.length} candidates, test...`);

    const limit = pLimit(5);
    let got = 0;

    const tasks = candidates.slice(0, 40).map((ipPort) =>
      limit(async () => {
        if (got >= perCountry || accepted.length >= maxTotal) return;
        if (seen.has(ipPort)) return;

        const ok = await verifyProxy(ipPort, userAgent, 6000);
        if (!ok) return;
        if (got >= perCountry) return;
        if (seen.has(ipPort)) return;

        seen.add(ipPort);
        got++;
        accepted.push({ cc, ipPort });
        logger.ok(`  ✓ [${cc}] ${ipPort}`);
      })
    );

    await Promise.all(tasks);
    byCountry[cc] = got;
    logger.debug(`  ${cc}: ${got} proxy sống`);
  }

  if (accepted.length < Math.min(5, maxTotal)) {
    logger.warn('Không đủ proxy từ Databay — thử nguồn fallback...');
    const all = await fetchAll();
    logger.debug(`Fallback pool: ${all.length} proxy`);

    const limit = pLimit(8);
    let tried = 0;

    await Promise.all(
      all.slice(0, 200).map((ipPort) =>
        limit(async () => {
          if (accepted.length >= maxTotal) return;
          if (tried >= 60) return;
          tried++;
          if (seen.has(ipPort)) return;

          const ok = await verifyProxy(ipPort, userAgent, 5000);
          if (!ok) return;
          if (seen.has(ipPort)) return;

          const cc = await detectCountryForIp(ipPort);
          if (!cc) return;
          if (seen.has(ipPort)) return;

          seen.add(ipPort);
          accepted.push({ cc, ipPort });
          byCountry[cc] = (byCountry[cc] || 0) + 1;
          logger.ok(`  ✓ [${cc}] ${ipPort} (fallback)`);
        })
      )
    );
  }

  if (accepted.length === 0) {
    logger.warn('Không tìm được proxy sống nào — dùng direct fallback');
    return { saved: 0, byCountry: {} };
  }

  const lines = accepted.map(({ cc, ipPort }) => `${cc}|http://${ipPort}`);
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, lines.join('\n') + '\n', { mode: 0o600 });
    logger.ok(`Đã lưu ${accepted.length} proxy vào ${path.basename(outputPath)}`);

    const summary = Object.entries(byCountry)
      .filter(([_, n]) => n > 0)
      .map(([cc, n]) => `${cc}:${n}`)
      .join(' ');
    logger.info(`   ${summary}`);
  } catch (e) {
    logger.error(`Ghi proxy file lỗi: ${e.message}`);
    return { saved: 0, byCountry };
  }

  return { saved: accepted.length, byCountry };
}