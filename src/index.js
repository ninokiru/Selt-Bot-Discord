import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSelfbotClient, loadAllowedChannels } from './client.js';
import { makeLogger, setDebug, setOutput, log as rootLog } from './logger.js';
import { setShuttingDown, isShuttingDown } from './shutdown.js';
import { readLines, sleep, fmtDur, auditSecretFile } from './utils.js';
import { createDashboard } from './dashboard.js';
import { createSession, logSessionEnd } from './session.js';
import { createStats } from './stats.js';
import { loadConfig } from './config.js';
import {
  loadCommandFiles,
  buildDispatcher,
  startConsole,
} from './commands/index.js';
import { leaveVoice, getVoiceState } from './voiceSession.js';
import { stopStream, getStreamState } from './stream.js';
import {
  initRPC,
  applyRPCFromConfig,
  stopRPC,
  getRpcState,
} from './rpc.js';
import { initAfk, getAfk, flushAfk } from './afk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONFIG_PATH = path.join(ROOT, 'config.json');
const CHANNEL_PATH = path.join(ROOT, 'channel.txt');
const TOKENS_PATH = path.join(ROOT, 'tokens.txt');

let currentClient = null;
let currentConfig = null;
let consoleRl = null;
let session = null;
let stats = null;
let dispatcher = null;
let stopped = false;
let activeDashboard = null;
let dashTimer = null;

function requestShutdown() {
  if (isShuttingDown()) {
    try { currentClient?.destroy(); } catch {}
    try { activeDashboard?.destroy(); } catch {}
    process.exit(0);
  }
  setShuttingDown(true);
  rootLog.warn('Đang dừng selfbot...');
}
globalThis.__sbStop = () => requestShutdown();

function resolveToken(config) {
  const envName = config.tokenEnv || 'DISCORD_TOKEN';
  const envToken = envName ? process.env[envName] : '';
  if (envToken && envToken.trim()) {
    return { token: envToken.trim(), source: `env ${envName}` };
  }

  const tokens = readLines(TOKENS_PATH);
  if (tokens.length) return { token: tokens[0], source: 'tokens.txt' };

  return null;
}

async function startSelfbot(config, token, tokenSource, dashboard) {
  const logger = makeLogger('sb');
  currentConfig = config;
  logger.info('🚀 Khởi động selfbot gateway...');
  logger.debug(`Token: ${tokenSource}`);

  loadAllowedChannels(CHANNEL_PATH);

  // Session + stats
  session = createSession({
    config,
    logger,
    onWarn: ({ remainMs }) => {
      rootLog.warn(`Session sắp hết — còn ${fmtDur(remainMs / 1000)}`);
    },
    onExpire: () => rootLog.warn('Session đã hết'),
  });

  stats = createStats();

  initAfk(config);
  initRPC({ config, logger, getClient: () => currentClient, stats });

  // Dispatcher
  dispatcher = buildDispatcher({ config, logger, stats, session });

  // Commands — auto-load
  const loadedCount = await loadCommandFiles({ logger, dashboard });
  logger.info(`Loaded ${loadedCount} command files`);

  // Client
  const client = createSelfbotClient({
    config,
    logger,
    stats,
    dispatcher,
  });

  // Detect invalidated
  client.once('invalidated', () => {
    logger.error('Client bị invalidated (kick, session limit, v.v.)');
    setShuttingDown(true);
  });

  try {
    await client.login(token);
  } catch (e) {
    logger.error(`Login lỗi: ${e.message}`);
    return null;
  }

  if (!client.user) {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 20000);
      client.once('ready', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  if (!client.user) {
    logger.error('Selfbot không ready sau 20s');
    try { await client.destroy(); } catch {}
    return null;
  }

  currentClient = client;

  // Apply RPC
  try {
    await applyRPCFromConfig({ startup: true, quiet: true });
  } catch (e) {
    logger.warn(`RPC apply fail: ${e.message}`);
  }

  // Dashboard
  dashboard.setUser(client.user);
  dashboard.setStatus('ONLINE');
  dashboard.setGuilds(client.guilds?.cache?.size || 0);
  dashboard.setPing(client.ws?.ping ?? 0);
  dashboard.setVoice('Not connected');
  dashboard.setSessionMax(config.sessionMaxMinutes || 360);
  dashboard.setRunning(true);
  dashboard.setStats(stats.snapshot());
  dashboard.setRpc(getRpcState());
  dashboard.setStream(getStreamState());

  logger.ok(`Selfbot ready: ${client.user.tag}`);

  // Console
  if (config.commands?.consoleEnabled !== false) {
    consoleRl = startConsole({
      dispatcher,
      config,
      logger,
      getClient: () => currentClient,
    });
  }

  // Session
  session.start();

  // Dashboard updater
  dashTimer = setInterval(() => {
    if (isShuttingDown() || !currentClient) return;
    try {
      dashboard.setPing(currentClient.ws?.ping ?? 0);
      dashboard.setGuilds(currentClient.guilds?.cache?.size || 0);
      dashboard.setStats(stats.snapshot());
      if (session) dashboard.setSessionElapsed(session.elapsedMs());

      dashboard.setAfk(getAfk());

      const st = getStreamState();
      const vs = getVoiceState();

      dashboard.setStream(st);
      dashboard.setRpc(getRpcState());

      if (st.active) {
        const g = currentClient.guilds.cache.get(st.guildId);
        const c = g?.channels?.cache?.get(st.channelId);
        const liveFor = fmtDur((Date.now() - st.startedAt) / 1000);
        dashboard.setVoice(`${g?.name || '?'} / ${c?.name || '?'} · LIVE ${liveFor}`);
      } else if (st.starting) {
        dashboard.setVoice('Starting stream...');
      } else if (vs.connected) {
        const g = currentClient.guilds.cache.get(vs.guildId);
        const c = g?.channels?.cache?.get(vs.channelId);
        dashboard.setVoice(`${g?.name || '?'} / ${c?.name || '?'}`);
      } else {
        dashboard.setVoice('Not connected');
      }
    } catch {}
  }, 2000);

  return client;
}

async function stopSelfbot(dashboard) {
  if (stopped) return;
  stopped = true;

  const logger = makeLogger('sb');

  if (dashTimer) {
    clearInterval(dashTimer);
    dashTimer = null;
  }

  if (session) {
    session.stop();
    const logPath = path.resolve(ROOT, currentConfig?.sessionLogFile || 'session.log');
    logSessionEnd({ session, path: logPath, logger });
    session = null;
  }

  if (consoleRl) {
    try { consoleRl.close(); } catch {}
    consoleRl = null;
  }

  try {
    const st = getStreamState();
    if (st.active || st.starting) {
      await stopStream({
        client: currentClient,
        config: currentConfig,
        logger,
        stats,
        restore: false,
        reason: 'shutdown',
      });
    }
  } catch {}

  try {
    const vs = getVoiceState();
    if (vs.connected) {
      await leaveVoice({ logger, stats });
      dashboard?.setVoice('Not connected');
    }
  } catch {}

  try {
    stopRPC();
  } catch {}

  try {
    flushAfk();
  } catch {}

  if (currentClient) {
    try {
      await currentClient.destroy();
      logger.ok('Selfbot đã dừng');
    } catch (e) {
      logger.error(`Destroy lỗi: ${e.message}`);
    }
    currentClient = null;
  }

  try { dashboard?.setRunning(false); } catch {}
  try { dashboard?.setStatus('OFFLINE'); } catch {}
}

async function main() {
  let loaded;
  try {
    loaded = loadConfig(CONFIG_PATH);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const config = loaded.config;
  setDebug(config.debug);

  const dashboard = createDashboard({
    onQuit: () => requestShutdown(),
    headless: config.dashboard === false,
  });
  activeDashboard = dashboard;
  setOutput((line) => dashboard.appendLog(line));

  for (const warning of loaded.warnings) {
    rootLog.warn(`Config: ${warning}`);
  }

  auditSecretFile(TOKENS_PATH, 'tokens.txt');
  auditSecretFile(path.join(ROOT, 'rpc.json'), 'rpc.json');

  const resolved = resolveToken(config);
  if (!resolved) {
    rootLog.error(
      `Không có token — đặt ${config.tokenEnv || 'DISCORD_TOKEN'} hoặc tạo ${TOKENS_PATH}`
    );
    try { dashboard.destroy(); } catch {}
    process.exit(1);
  }

  process.on('SIGINT', () => requestShutdown());
  process.on('SIGTERM', () => requestShutdown());

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason ?? '');
    rootLog.error(`Unhandled rejection: ${msg}`);
    try { stats?.bump('errors'); } catch {}
  });

  process.on('uncaughtException', (e) => {
    rootLog.error(`Uncaught exception: ${e?.message || e}`);
    try { stats?.bump('errors'); } catch {}
    requestShutdown();
  });

  process.on('warning', (w) => {
    try { rootLog.debug?.(`Node warning: ${w?.name || ''} ${w?.message || ''}`.trim()); } catch {}
  });

  const client = await startSelfbot(config, resolved.token, resolved.source, dashboard);

  if (isShuttingDown()) {
    await stopSelfbot(dashboard);
    try { dashboard.destroy(); } catch {}
    process.exit(0);
  }

  if (!client) {
    rootLog.error('Selfbot không khởi động được — thoát');
    await stopSelfbot(dashboard);
    try { dashboard.destroy(); } catch {}
    process.exit(1);
  }

  while (!isShuttingDown()) {
    await sleep(1000);

    if (!currentClient) {
      rootLog.warn('Client đã mất — tự động thoát');
      setShuttingDown(true);
      break;
    }
  }

  await stopSelfbot(dashboard);
  try { dashboard.destroy(); } catch {}
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  try { currentClient?.destroy(); } catch {}
  process.exit(1);
});