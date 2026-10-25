import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sleep, randInt } from '../utils.js';
import { markCodeSent } from '../afk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const registry = new Map();
const categories = new Map();
const hidden = new Set();
const rateBuckets = new Map();

const RATE_TTL_MS = 60 * 60 * 1000;
const RATE_MAX_BUCKETS = 1000;
const RATE_PRUNE_EVERY_MS = 60 * 1000;
const RATE_PRUNE_TIMER_MS = 10 * 60 * 1000;
const MAX_REPLY_CHARS = 1900;

let lastRatePruneAt = 0;

export function registerCommand(name, def) {
  if (!name || !def?.handler) return;
  registry.set(name, def);
  if (Array.isArray(def.aliases)) {
    for (const a of def.aliases) registry.set(a, def);
  }
  if (def.hidden) hidden.add(name);
  if (def.category) {
    if (!categories.has(def.category)) categories.set(def.category, []);
    categories.get(def.category).push(def);
  }
}

export function getRegistry() { return registry; }
export function getCategories() { return categories; }
export function getVisibleCommands() {
  const seen = new Set();
  const out = [];
  for (const [name, def] of registry) {
    if (seen.has(def)) continue;
    seen.add(def);
    if (def.hidden || hidden.has(name)) continue;
    out.push({ ...def, name });
  }
  return out;
}

// ── Tìm lệnh gần đúng (Levenshtein, không dependency) ─────
function levenshtein(a, b) {
  a = String(a ?? '').toLowerCase();
  b = String(b ?? '').toLowerCase();
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1);
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

export function findClosestCommand(name, maxDistance = 2) {
  const target = String(name ?? '').trim().toLowerCase();
  if (!target) return null;

  let best = null;
  let bestDistance = maxDistance + 1;

  for (const key of registry.keys()) {
    const distance = levenshtein(target, key);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = key;
      if (distance === 0) break;
    }
  }

  return bestDistance <= maxDistance ? best : null;
}

// Trả về lệnh theo tên hoặc alias (kể cả hidden).
export function findCommand(name) {
  const target = String(name ?? '').trim().toLowerCase();
  if (!target) return null;

  let def = null;
  for (const [key, value] of registry) {
    if (key.toLowerCase() === target) {
      def = value;
      break;
    }
  }
  if (!def) return null;

  let canonical = target;
  for (const [key, value] of registry) {
    if (value === def) {
      canonical = key;
      break;
    }
  }

  return {
    name: canonical,
    def,
    hidden: hidden.has(canonical) || !!def.hidden,
  };
}

function collectFiles(dir, base = '') {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }

  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...collectFiles(path.join(dir, entry.name), rel));
    } else if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'index.js') {
      out.push({ full: path.join(dir, entry.name), rel });
    }
  }
  return out;
}

export async function loadCommandFiles(ctx) {
  const files = collectFiles(__dirname);
  let loaded = 0;
  for (const { full, rel } of files) {
    try {
      const mod = await import(pathToFileURL(full).href);
      if (typeof mod.register !== 'function') continue;
      await mod.register({ registerCommand, ...ctx });
      loaded++;
    } catch (e) {
      ctx.logger?.error(`Load "${rel}" fail: ${e.message}`);
    }
  }
  return loaded;
}

// ── Rate limiter buckets: hết hạn sau 1h, tối đa 1000 entry ─
function bucketLastUsed(bucket) {
  return Math.max(bucket.lastAt || 0, bucket.windowStart || 0);
}

function trimRateBuckets() {
  if (rateBuckets.size <= RATE_MAX_BUCKETS) return;

  const entries = [...rateBuckets.entries()]
    .sort((a, b) => bucketLastUsed(a[1]) - bucketLastUsed(b[1]));
  const excess = rateBuckets.size - RATE_MAX_BUCKETS;

  for (let i = 0; i < excess; i++) {
    rateBuckets.delete(entries[i][0]);
  }
}

function pruneRateBuckets(now = Date.now()) {
  for (const [key, bucket] of rateBuckets) {
    if (now - bucketLastUsed(bucket) > RATE_TTL_MS) {
      rateBuckets.delete(key);
    }
  }
  trimRateBuckets();
}

function maybePruneRateBuckets(now) {
  if (now - lastRatePruneAt < RATE_PRUNE_EVERY_MS) {
    trimRateBuckets();
    return;
  }
  lastRatePruneAt = now;
  pruneRateBuckets(now);
}

const ratePruneTimer = setInterval(() => pruneRateBuckets(), RATE_PRUNE_TIMER_MS);
if (typeof ratePruneTimer?.unref === 'function') ratePruneTimer.unref();

function checkRateLimit(userId, commandName, rlCfg) {
  if (!rlCfg?.enabled) return { allowed: true };

  const now = Date.now();
  const windowMs = rlCfg.windowMs ?? 60000;
  const maxCommands = rlCfg.maxCommands ?? 10;
  const cooldownMs = rlCfg.cooldownMs ?? 1500;
  const ignoreDuplicateMs = rlCfg.ignoreDuplicateMs ?? 3000;

  maybePruneRateBuckets(now);

  let b = rateBuckets.get(userId);
  if (!b) {
    b = { windowStart: now, count: 0, lastAt: 0, lastCmd: null, lastCmdAt: 0 };
    rateBuckets.set(userId, b);
    trimRateBuckets();
  }

  if (now - b.windowStart >= windowMs) {
    b.windowStart = now;
    b.count = 0;
  }

  if (
    ignoreDuplicateMs > 0 &&
    commandName === b.lastCmd &&
    now - b.lastCmdAt < ignoreDuplicateMs
  ) {
    return { allowed: false, reason: 'duplicate' };
  }

  if (cooldownMs > 0 && now - b.lastAt < cooldownMs) {
    return { allowed: false, reason: 'cooldown', waitMs: cooldownMs - (now - b.lastAt) };
  }

  if (b.count >= maxCommands) {
    return { allowed: false, reason: 'window', waitMs: windowMs - (now - b.windowStart) };
  }

  b.count++;
  b.lastAt = now;
  b.lastCmd = commandName;
  b.lastCmdAt = now;
  return { allowed: true };
}

async function safeReply(msg, text) {
  if (typeof msg?.reply !== 'function') return null;
  try {
    const sent = await msg.reply(String(text ?? '').slice(0, MAX_REPLY_CHARS));
    if (sent?.id) {
      try { markCodeSent(sent.id); } catch {}
    }
    return sent;
  } catch {
    return null;
  }
}

function printConsoleReply(logger, text) {
  const lines = String(text ?? '').split(/\r?\n/);
  for (const line of lines) {
    try { logger.cmd(`  ${line}`); } catch {}
  }
}

export function buildDispatcher(ctx) {
  const { config, logger, stats, session } = ctx;
  const rlCfg = config.commands?.rateLimit || {};

  return async ({ name, args, msg, client, source }) => {
    stats?.bump('commandsReceived');

    if (source !== 'console') {
      const userId = msg?.author?.id || 'unknown';
      const rl = checkRateLimit(userId, name, rlCfg);

      if (!rl.allowed) {
        if (rl.reason === 'duplicate') {
          logger.debug(`Ignore duplicate "${name}"`);
          return;
        }
        if (rl.reason === 'cooldown') {
          logger.debug(`Cooldown "${name}" — ${(rl.waitMs / 1000).toFixed(1)}s`);
        } else if (rl.reason === 'window') {
          logger.warn(`Rate limit: ${userId} — chờ ${(rl.waitMs / 1000).toFixed(0)}s`);
        }

        if (!rlCfg.silentOnLimit && msg?.reply) {
          const sec = Math.ceil(rl.waitMs / 1000);
          await safeReply(msg, `⏳ Chờ ${sec}s`);
        }
        return;
      }
    }

    const handler = registry.get(name);
    if (!handler) {
      const suggestion = findClosestCommand(name);
      const base = `Lệnh "${name}" không tồn tại. Dùng .cmd`;

      if (source === 'console' || !msg) {
        logger.warn(`${base}${suggestion ? ` Có phải ý bạn là .${suggestion}?` : ''}`);
        return;
      }

      logger.debug(`Unknown: ${name}${suggestion ? ` (gợi ý: ${suggestion})` : ''}`);
      const lines = [base];
      if (suggestion) lines.push(`Có phải ý bạn là .${suggestion}?`);
      await safeReply(msg, lines.join('\n'));
      return;
    }

    const replyFn = async (text) => {
      const body = String(text ?? '');

      if (source === 'console' || !msg) {
        printConsoleReply(logger, body);
        return;
      }

      const anti = config.antiDetection || {};
      const delay = randInt(anti.reactDelayMinMs ?? 200, anti.reactDelayMaxMs ?? 800);
      await sleep(delay);
      await safeReply(msg, body);
    };

    const startedAt = Date.now();
    try {
      await handler.handler({
        name, args, msg, client, config, logger, stats, session, source,
        reply: replyFn,
      });
    } catch (e) {
      stats?.bump('commandsFailed');
      const ms = Date.now() - startedAt;
      logger.error(`Command "${name}" lỗi sau ${ms}ms: ${e?.message ?? e}`);
      try { await replyFn(`Lỗi: ${e?.message ?? e}`); } catch {}
      return;
    }

    stats?.bump('commandsExecuted');
    const ms = Date.now() - startedAt;
    const argText = Array.isArray(args) ? args.join(' ') : '';
    logger.cmd(`OK ${name}${argText ? ` ${argText}` : ''} (${source}, ${ms}ms)`);
  };
}

export function startConsole({ dispatcher, config, logger, getClient }) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const raw = String(line || '').trim();
    if (!raw) return;

    const prefix = config.commands?.prefix || '.';
    const str = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    const [name, ...args] = str.trim().split(/\s+/);
    if (!name) return;

    logger.cmd(`> ${name} ${args.join(' ')}`);

    try {
      await dispatcher({ name, args, msg: null, client: getClient(), source: 'console' });
    } catch (e) {
      logger.error(`Console: ${e.message}`);
    }
  });

  rl.on('error', (e) => {
    logger.error(`Console input lỗi: ${e?.message ?? e}`);
  });

  rl.on('close', () => {});

  return rl;
}
