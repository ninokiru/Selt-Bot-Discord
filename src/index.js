import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSelfbotClient, loadAllowedChannels } from './client.js';
import { makeLogger, setDebug, setOutput, log as rootLog } from './logger.js';
import { setShuttingDown, isShuttingDown } from './shutdown.js';
import { readLines, readJson, sleep, fmtDur, auditSecretFile } from './utils.js';
import { createDashboard } from './dashboard.js';
import { createSession, logSessionEnd } from './session.js';
import { createStats } from './stats.js';
import {
  loadCommandFiles,
  buildDispatcher,
  startConsole,
} from './commands/index.js';
import { leaveVoice, getVoiceState } from './voiceSession.js';
import { initRPC, applyRPCFromConfig } from './rpc.js';
import { initAfk, getAfk } from './afk.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONFIG_PATH = path.join(ROOT, 'config.json');
const CHANNEL_PATH = path.join(ROOT, 'channel.txt');
const TOKENS_PATH = path.join(ROOT, 'tokens.txt');
const SESSION_LOG = path.join(ROOT, 'session.log');

let currentClient = null;
let consoleRl = null;
let session = null;
let stats = null;
let dispatcher = null;
let stopped = false;
let activeDashboard = null;

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

async function startSelfbot(config, token, dashboard) {
  const logger = makeLogger('sb');
  logger.info('🚀 Khởi động selfbot gateway...');

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

  // Init AFK
  initAfk(config);

  // Init RPC
  initRPC({ config, logger, getClient: () => currentClient });

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
    applyRPCFromConfig();
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
  const dashTimer = setInterval(() => {
    if (isShuttingDown() || !currentClient) return;
    try {
      dashboard.setPing(currentClient.ws?.ping ?? 0);
      dashboard.setGuilds(currentClient.guilds?.cache?.size || 0);
      dashboard.setStats(stats.snapshot());
      if (session) dashboard.setSessionElapsed(session.elapsedMs());

      // AFK
      dashboard.setAfk(getAfk());

      // Voice
      const vs = getVoiceState();
      if (vs.connected) {
        const g = currentClient.guilds.cache.get(vs.guildId);
        const c = g?.channels?.cache?.get(vs.channelId);
        dashboard.setVoice(`${g?.name || '?'} / ${c?.name || '?'}`);
      } else {
        dashboard.setVoice('Not connected');
      }
    } catch {}
  }, 2000);

  client._dashTimer = dashTimer;

  return client;
}

async function stopSelfbot(dashboard) {
  if (stopped) return;
  stopped = true;

  const logger = makeLogger('sb');

  if (session) {
    session.stop();
    logSessionEnd({ session, path: SESSION_LOG, logger });
    session = null;
  }

  if (consoleRl) {
    try { consoleRl.close(); } catch {}
    consoleRl = null;
  }

  try {
    const vs = getVoiceState();
    if (vs.connected) {
      await leaveVoice({ logger, stats });
      dashboard?.setVoice('Not connected');
    }
  } catch {}

  if (currentClient) {
    try {
      if (currentClient._dashTimer) clearInterval(currentClient._dashTimer);
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
  const config = readJson(CONFIG_PATH, null);
  if (!config) {
    console.error(`Không đọc được ${CONFIG_PATH}`);
    process.exit(1);
  }
  setDebug(config.debug);

  auditSecretFile(TOKENS_PATH, 'tokens.txt');

  const tokens = readLines(TOKENS_PATH);
  if (!tokens.length) {
    console.error(`Không có token trong ${TOKENS_PATH}`);
    process.exit(1);
  }

  const token = tokens[0];

  const dashboard = createDashboard({ onQuit: () => requestShutdown() });
  activeDashboard = dashboard;
  setOutput((line) => dashboard.appendLog(line));

  process.on('SIGINT', () => requestShutdown());
  process.on('SIGTERM', () => requestShutdown());

  const client = await startSelfbot(config, token, dashboard);

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