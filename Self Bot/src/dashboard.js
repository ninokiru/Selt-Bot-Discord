import blessed from 'blessed';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtUptime, fmtDur } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NODE_VERSION = process.version;
const HOSTNAME = os.hostname().slice(0, 24) || 'unknown';
const ANSI_RE = /\x1b\[[0-9;]*m/g;

let VERSION = '1.0.0';
try {
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')
  );
  VERSION = pkg.version || VERSION;
} catch {}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function pad(s, n) {
  s = String(s ?? '');
  if (s.length >= n) return s;
  return s + ' '.repeat(n - s.length);
}

function fit(s, n) {
  s = String(s ?? '');
  if (s.length <= n) return s + ' '.repeat(n - s.length);
  if (n <= 1) return s.slice(0, n);
  return s.slice(0, n - 1) + '…';
}

export function createDashboard(options = {}) {
  let onQuitExternal = typeof options.onQuit === 'function' ? options.onQuit : () => {};

  const screen = blessed.screen({
    smartCSR: true,
    title: `Lumina Selfbot v${VERSION}`,
    fullUnicode: true,
    dockBorders: true,
    autoPadding: true,
  });

  let renderTimer = null;
  let dirty = true;

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (!dirty) return;
      dirty = false;
      try { screen.render(); } catch {}
    }, 120);
  }

  function invalidate() {
    dirty = true;
    scheduleRender();
  }

  const startedAt = Date.now();
  const state = {
    user: '-',
    userId: '-',
    status: 'OFFLINE',
    voice: 'Not connected',
    guilds: 0,
    ping: 0,
    sessionMaxMin: 0,
    sessionElapsedMs: 0,
    running: false,
    afk: {
      enabled: false,
      reason: '',
      duration: 0,
      totalPings: 0,
      totalReplies: 0,
      silent: false,
    },
    stats: {
      messagesReceived: 0,
      messagesDeleted: 0,
      messagesEdited: 0,
      commandsReceived: 0,
      commandsExecuted: 0,
      commandsFailed: 0,
      errors: 0,
      voiceJoins: 0,
      voiceLeaves: 0,
      musicPlayed: 0,
      musicSkipped: 0,
      afkPings: 0,
      afkReplies: 0,
    },
  };
  let spinnerIdx = 0;

  // ── Header ──────────────────────────────────────────────
  const header = blessed.box({
    parent: screen,
    top: 0, left: 0, width: '100%', height: 3,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' }, fg: 'white' },
    label: ` {bold}{cyan-fg}Lumina Selfbot{/cyan-fg}{/bold} {gray-fg}v${VERSION}{/gray-fg} `,
    content: ' {gray-fg}gateway · voice · music · afk · snipe · rich presence · session{/gray-fg}',
  });

  // ── Session panel ────────────────────────────────────────
  const sessionBox = blessed.box({
    parent: screen,
    top: 3, left: 0, width: '100%', height: 6,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' }, fg: 'white' },
    label: ' Session ',
    content: '',
  });

  // ── Stats panel ──────────────────────────────────────────
  const statsBox = blessed.box({
    parent: screen,
    top: 9, left: 0, width: '100%', height: 6,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' }, fg: 'white' },
    label: ' Stats ',
    content: '',
  });

  // ── Commands hint ────────────────────────────────────────
  const commandsBox = blessed.box({
    parent: screen,
    top: 15, left: 0, width: '100%', height: 3,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' }, fg: 'white' },
    label: ' Commands ',
    content:
      ' {gray-fg}.cmd  .ping  .uptime  .voice  .play  .skip  .resume  .stop  .afk  .snipe  .editsnipe{/gray-fg}',
  });

  // ── Log ──────────────────────────────────────────────────
  const log = blessed.log({
    parent: screen,
    top: 18, left: 0, width: '100%', height: '100%-19',
    tags: false,
    wrap: false,
    scrollable: true,
    mouse: true, keys: true, vi: true,
    scrollbar: { ch: ' ', style: { bg: 'cyan' } },
    border: { type: 'line' },
    style: { border: { fg: 'gray' }, fg: 'white' },
    label: ' Log ',
  });

  const status = blessed.box({
    parent: screen,
    bottom: 0, left: 0, width: '100%', height: 1,
    tags: true,
    style: { fg: 'gray', bg: 'black' },
    content: '',
  });

  function refreshSession() {
    const valueW = 16;
    const labelW = 12;

    function cell(label, val, color) {
      const v = fit(val, valueW);
      const safe = blessed.escape(v);
      const lbl = pad(label, labelW);
      const colored = color
        ? `{${color}-fg}${safe}{/${color}-fg}`
        : `{bold}${safe}{/bold}`;
      return `{gray-fg}${lbl}{/gray-fg}${colored}  `;
    }

    const sessionPct = state.sessionMaxMin > 0
      ? Math.min(100, Math.floor((state.sessionElapsedMs / (state.sessionMaxMin * 60 * 1000)) * 100))
      : 0;

    const sessionColor =
      sessionPct >= 90 ? 'red' : sessionPct >= 75 ? 'yellow' : 'green';

    const line1 =
      '  ' +
      cell('User', state.user, 'cyan') +
      cell('ID', state.userId);

    const line2 =
      '  ' +
      cell('Status', state.status, state.status === 'ONLINE' ? 'green' : 'yellow') +
      cell('Voice', state.voice, state.voice === 'Not connected' ? null : 'cyan');

    const line3 =
      '  ' +
      cell('Guilds', state.guilds) +
      cell('Ping', `${state.ping}ms`) +
      cell('Host', HOSTNAME, 'cyan');

    const line4 =
      '  ' +
      cell('Uptime', fmtUptime(state.sessionElapsedMs)) +
      cell('Session', `${sessionPct}%`, sessionColor) +
      cell('Max', state.sessionMaxMin > 0 ? `${state.sessionMaxMin}m` : '-');

    let afkLabel, afkColor;
    if (state.afk.enabled) {
      afkLabel = state.afk.silent ? 'ON (silent)' : 'ON';
      afkColor = 'yellow';
    } else {
      afkLabel = 'OFF';
      afkColor = 'gray';
    }

    const afkDuration = state.afk.enabled
      ? fmtDur(state.afk.duration / 1000)
      : '-';

    const afkReason = state.afk.enabled && state.afk.reason
      ? state.afk.reason
      : '-';

    const line5 =
      '  ' +
      cell('AFK', afkLabel, afkColor) +
      cell('Duration', afkDuration) +
      cell('Reason', afkReason);

    sessionBox.setContent([line1, line2, line3, line4, line5].join('\n'));
  }

  function refreshStats() {
    const s = state.stats;
    const valueW = 10;
    const labelW = 14;

    function cell(label, val, color) {
      const v = fit(val, valueW);
      const safe = blessed.escape(v);
      const lbl = pad(label, labelW);
      const colored = color
        ? `{${color}-fg}${safe}{/${color}-fg}`
        : `{bold}${safe}{/bold}`;
      return `{gray-fg}${lbl}{/gray-fg}${colored}  `;
    }

    const line1 =
      '  ' +
      cell('Messages', s.messagesReceived) +
      cell('Deleted', s.messagesDeleted, s.messagesDeleted > 0 ? 'red' : null) +
      cell('Edited', s.messagesEdited, s.messagesEdited > 0 ? 'yellow' : null);

    const line2 =
      '  ' +
      cell('Cmd recv', s.commandsReceived) +
      cell('Cmd exec', s.commandsExecuted, 'green') +
      cell('Cmd fail', s.commandsFailed, s.commandsFailed > 0 ? 'red' : null);

    const line3 =
      '  ' +
      cell('Voice join', s.voiceJoins) +
      cell('Voice leave', s.voiceLeaves) +
      cell('Music play', s.musicPlayed, 'green');

    const line4 =
      '  ' +
      cell('Music skip', s.musicSkipped) +
      cell('AFK pings', s.afkPings, s.afkPings > 0 ? 'yellow' : null) +
      cell('AFK reply', s.afkReplies, s.afkReplies > 0 ? 'green' : null);

    statsBox.setContent([line1, line2, line3, line4].join('\n'));
  }

  function refreshStatus() {
    if (!state.running) {
      status.setContent(
        ` {yellow-fg}●{/yellow-fg} {bold}STARTING...{/bold}` +
        `   {gray-fg}vui lòng chờ{/gray-fg}`
      );
      return;
    }

    const frame = SPINNER[spinnerIdx % SPINNER.length];

    const parts = [
      ` {green-fg}${frame}{/green-fg} {bold}SELFBOT ONLINE{/bold}`,
    ];

    if (state.afk.enabled) {
      const afkStr = state.afk.silent
        ? `{yellow-fg}AFK (silent){/yellow-fg}`
        : `{yellow-fg}AFK{/yellow-fg}`;
      parts.push(afkStr);
    }

    if (state.voice && state.voice !== 'Not connected') {
      parts.push(`{cyan-fg}${state.voice}{/cyan-fg}`);
    }

    parts.push(`{gray-fg}.cmd trong console · q quit · ctrl+c force{/gray-fg}`);

    status.setContent(parts.join(' · '));
  }

  const tickTimer = setInterval(() => {
    spinnerIdx++;
    if (state.running) {
      state.sessionElapsedMs = Date.now() - startedAt;
      if (state.afk.enabled && state.afk.setAt) {
        state.afk.duration = Date.now() - state.afk.setAt;
      }
      refreshStatus();
      refreshSession();
      refreshStats();
      invalidate();
    }
  }, 500);

  screen.on('resize', () => {
    try { screen.realloc(); screen.clear(); } catch {}
    refreshSession();
    refreshStats();
    try { screen.render(); } catch {}
  });

  screen.on('destroy', () => {
    if (tickTimer) clearInterval(tickTimer);
    if (renderTimer) clearTimeout(renderTimer);
  });

  screen.key(['escape', 'q'], () => onQuitExternal());
  screen.key(['C-c'], () => onQuitExternal());

  refreshSession();
  refreshStats();
  refreshStatus();

  return {
    screen, header, sessionBox, statsBox, commandsBox, log, status,

    appendLog(line) {
      const clean = String(line ?? '').replace(ANSI_RE, '');
      log.log(clean);
    },

    setRunning(r) {
      state.running = !!r;
      refreshStatus();
      invalidate();
    },

    setUser(user) {
      state.user = user?.tag || '-';
      state.userId = user?.id || '-';
      refreshSession();
      invalidate();
    },

    setStatus(s) {
      state.status = String(s ?? '-');
      refreshSession();
      invalidate();
    },

    setVoice(text) {
      state.voice = String(text ?? 'Not connected');
      refreshSession();
      refreshStatus();
      invalidate();
    },

    setGuilds(n) {
      state.guilds = n | 0;
      refreshSession();
      invalidate();
    },

    setPing(ms) {
      state.ping = ms | 0;
      refreshSession();
      invalidate();
    },

    setSessionMax(min) {
      state.sessionMaxMin = min | 0;
      refreshSession();
      invalidate();
    },

    setStats(snap) {
      if (!snap) return;
      state.stats = { ...state.stats, ...snap };
      refreshStats();
      invalidate();
    },

    setAfk(afk) {
      if (!afk) return;
      state.afk = {
        enabled: !!afk.enabled,
        reason: afk.reason || '',
        setAt: afk.setAt || null,
        duration: afk.duration || 0,
        totalPings: afk.totalPings || 0,
        totalReplies: afk.totalReplies || 0,
        silent: !!afk.silentMode,
      };
      refreshSession();
      refreshStatus();
      invalidate();
    },

    onQuit(handler) {
      onQuitExternal = typeof handler === 'function' ? handler : () => {};
    },

    destroy() { screen.destroy(); },
    render: scheduleRender,
  };
}