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
    if (hidden.has(name)) continue;
    out.push({ name, ...def });
  }
  return out;
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

function checkRateLimit(userId, commandName, rlCfg) {
  if (!rlCfg?.enabled) return { allowed: true };

  const now = Date.now();
  const windowMs = rlCfg.windowMs ?? 60000;
  const maxCommands = rlCfg.maxCommands ?? 10;
  const cooldownMs = rlCfg.cooldownMs ?? 1500;
  const ignoreDuplicateMs = rlCfg.ignoreDuplicateMs ?? 3000;

  let b = rateBuckets.get(userId);
  if (!b) {
    b = { windowStart: now, count: 0, lastAt: 0, lastCmd: null, lastCmdAt: 0 };
    rateBuckets.set(userId, b);
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
          const sent = await msg.reply(`⏳ Chờ ${sec}s`).catch(() => null);
          if (sent) markCodeSent(sent.id);
        }
        return;
      }
    }

    const handler = registry.get(name);
    if (!handler) {
      logger.debug(`Unknown: ${name}`);
      if (msg?.reply) {
        const sent = await msg.reply(`Lệnh "${name}" không tồn tại. Dùng .cmd`).catch(() => null);
        if (sent) markCodeSent(sent.id);
      }
      return;
    }

    const replyFn = async (text) => {
      const anti = config.antiDetection || {};
      const delay = randInt(anti.reactDelayMinMs ?? 200, anti.reactDelayMaxMs ?? 800);
      await sleep(delay);
      if (msg?.reply) {
        const sent = await msg.reply(String(text).slice(0, 1900)).catch(() => null);
        if (sent) markCodeSent(sent.id);
      }
    };

    try {
      await handler.handler({
        name, args, msg, client, config, logger, stats, session, source,
        reply: replyFn,
      });
      stats?.bump('commandsExecuted');
      logger.cmd(`OK ${name} ${args.join(' ')} (${source})`);
    } catch (e) {
      stats?.bump('commandsFailed');
      logger.error(`Command "${name}" lỗi: ${e.message}`);
      await replyFn(`Lỗi: ${e.message}`);
    }
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

  rl.on('close', () => {});

  return rl;
}