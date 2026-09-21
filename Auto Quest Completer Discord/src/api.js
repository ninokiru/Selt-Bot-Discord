import axios from 'axios';
import { buildHeaders, timezoneForCountry } from './builder.js';
import { buildAgent, sleep, randInt, redactSecret } from './utils.js';
import { isShuttingDown } from './shutdown.js';

const API_BASE = 'https://discord.com/api/v9';

const DEFAULT_RETRY = { maxAttempts: 3, baseDelayMs: 2000 };
const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

// Cắt mọi thứ dài quá để tránh log phình / leak
function safeBodyPreview(data, max = 200) {
  if (data == null) return '';
  try {
    if (typeof data === 'string') return redactSecret(data.slice(0, max));
    if (Buffer.isBuffer(data)) return `<buffer ${data.length}B>`;
    const s = JSON.stringify(data);
    return redactSecret(s.slice(0, max));
  } catch {
    return '<unserializable>';
  }
}

function safeBodySize(data) {
  if (data == null) return 0;
  try {
    if (typeof data === 'string') return data.length;
    if (Buffer.isBuffer(data)) return data.length;
    return JSON.stringify(data).length;
  } catch {
    return 0;
  }
}

export class DiscordAPI {
  constructor({
    token, buildNumber, userAgent, clientInfo, timezone,
    retry, jitterMs, requestJitterMs, logger,
  }) {
    this.token = token;
    this.logger = logger || {
      debug: () => {}, info: () => {}, ok: () => {}, warn: () => {}, error: () => {},
    };
    this.retry = { ...DEFAULT_RETRY, ...(retry || {}) };
    this.jitterMs = Array.isArray(jitterMs) && jitterMs.length === 2 ? jitterMs : [0, 0];
    this.requestJitterMs =
      Array.isArray(requestJitterMs) && requestJitterMs.length === 2
        ? requestJitterMs
        : [0, 0];
    this.currentProxy = null;
    this.timezone = timezone || DEFAULT_TZ;

    this.http = axios.create({
      baseURL: API_BASE,
      timeout: 20000,
      proxy: false,
      validateStatus: () => true,
      maxRedirects: 0,
      headers: buildHeaders({
        token,
        buildNumber,
        userAgent,
        clientInfo,
        timezone: this.timezone,
      }),
    });
  }

  setProxy(proxy) {
    if (this.currentProxy === proxy) return;

    const agent = buildAgent(proxy);
    this.http.defaults.httpsAgent = agent;
    this.http.defaults.httpAgent = agent;
    this.currentProxy = proxy;

    const tz = timezoneForCountry(proxy?.label);
    if (tz !== this.timezone) {
      this.timezone = tz;
      if (this.http.defaults.headers) {
        this.http.defaults.headers['X-Discord-Timezone'] = tz;
      }
    }

    this.logger.debug(
      proxy
        ? `Proxy → ${proxy.label || ''} ${proxy.host}:${proxy.port} · tz ${tz}`
        : `Proxy → direct · tz ${this.timezone}`
    );
  }

  async _requestJitter() {
    const [min, max] = this.requestJitterMs;
    if (max > 0 && max >= min) {
      const wait = randInt(min, max);
      if (wait > 0) await sleep(wait);
    }
  }

  async _request(method, url, data, opts = {}) {
    const max = Math.max(1, opts.retries ?? this.retry.maxAttempts);
    const timeout = opts.timeout ?? 20000;
    let attempt = 0;
    let lastRes = null;
    let lastErr = null;

    while (attempt < max) {
      if (isShuttingDown()) {
        throw new Error(`Aborted (shutdown): ${method} ${url}`);
      }

      attempt++;

      await this._requestJitter();

      if (attempt > 1 && this.jitterMs[1] > 0) {
        await sleep(randInt(this.jitterMs[0], this.jitterMs[1]));
      }

      try {
        const res = await this.http.request({ method, url, data, timeout });
        lastRes = res;

        this.logger.debug(
          `${method} ${url} -> ${res.status} (${safeBodySize(res.data)}B)`
        );

        if (res.status !== 429 && (res.status < 500 || res.status >= 600)) {
          return res;
        }

        if (res.status === 429) {
          const retryAfter = (res.data?.retry_after ?? 5) * 1000;
          const wait = Math.min(retryAfter + 1000, 60000);
          this.logger.warn(
            `429 ${method} ${url} – chờ ${(wait / 1000).toFixed(1)}s (lần ${attempt}/${max})`
          );
          if (attempt >= max) return res;
          await sleep(wait);
          continue;
        }

        if (res.status >= 500 && res.status < 600) {
          if (attempt >= max) return res;
          const delay = Math.min(
            this.retry.baseDelayMs * Math.pow(2, attempt - 1),
            30000
          );
          this.logger.warn(
            `5xx ${res.status} ${method} ${url} – retry sau ${(delay / 1000).toFixed(1)}s (${attempt}/${max})`
          );
          await sleep(delay);
          continue;
        }
      } catch (err) {
        lastErr = err;
        // Chỉ log message, không log raw error (chứa config.headers.Authorization)
        const msg = redactSecret(String(err?.message || err));
        this.logger.debug(`Network err ${method} ${url}: ${msg}`);

        if (attempt >= max) break;

        const delay = Math.min(
          this.retry.baseDelayMs * Math.pow(2, attempt - 1),
          30000
        );
        await sleep(delay);
      }
    }

    if (lastRes) return lastRes;
    if (lastErr) {
      // Trả lỗi đã sanitize — không leak token
      const e = new Error(redactSecret(String(lastErr?.message || lastErr)));
      e.code = lastErr?.code;
      throw e;
    }
    throw new Error(`Request failed: ${method} ${url}`);
  }

  get(url, opts) { return this._request('GET', url, undefined, opts); }
  post(url, data, opts) { return this._request('POST', url, data, opts); }

  async validate() {
    let res;
    try {
      res = await this.get('/users/@me', { retries: 2, timeout: 15000 });
    } catch (e) {
      this.logger.error(`Không kết nối được Discord: ${redactSecret(e.message)}`);
      return { ok: false, reason: 'network' };
    }

    if (!res) return { ok: false, reason: 'no-response' };

    if (res.status === 200) {
      const u = res.data || {};
      const flags = u.public_flags ?? 0;
      const flagNames = [];
      if (flags & (1 << 0)) flagNames.push('STAFF');
      if (flags & (1 << 1)) flagNames.push('PARTNER');
      if (flags & (1 << 2)) flagNames.push('HYPESQUAD');
      if (flags & (1 << 6)) flagNames.push('HYPESQUAD_ONLINE');
      if (flags & (1 << 7)) flagNames.push('PREMIUM_EARLY');
      if (flags & (1 << 14)) flagNames.push('VERIFIED_DEV');
      if (flags & (1 << 16)) flagNames.push('VERIFIED_BOT');
      if (flags & (1 << 22)) flagNames.push('ACTIVE_DEV');

      const flagStr = flagNames.length ? flagNames.join(',') : 'none';
      const tag = u.discriminator && u.discriminator !== '0'
        ? `${u.username}#${u.discriminator}`
        : u.username;

      this.logger.ok(`Đăng nhập: ${tag} (${u.id}) · flags: ${flagStr}`);
      return { ok: true, user: { id: u.id, username: u.username, tag, flags: flagStr } };
    }

    if (res.status === 401) {
      this.logger.error('Token không hợp lệ (401) – revoke hoặc sai');
      return { ok: false, reason: 'unauthorized' };
    } else if (res.status === 403) {
      const body = safeBodyPreview(res.data, 200);
      this.logger.error(`Token bị flag (403) – ${body}`);
      return { ok: false, reason: 'forbidden' };
    } else if (res.status === 429) {
      this.logger.error('Validate 429 – bị rate limit');
      return { ok: false, reason: 'rate-limited' };
    } else if (res.status >= 500) {
      this.logger.error(`Validate ${res.status} – Discord server error`);
      return { ok: false, reason: 'server-error' };
    }

    this.logger.error(`Validate lỗi (${res.status})`);
    return { ok: false, reason: 'unknown' };
  }
}