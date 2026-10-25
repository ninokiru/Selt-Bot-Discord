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
  const headless = options.headless === true || !process.stdout.isTTY;
  let onQuitExternal = typeof options.onQuit === 'function' ? options.onQuit : () => {};

  // Headless: no blessed screen, no timers — plain stdout log stream only.
  if (headless) {
    return {
      screen: null,
      header: null,
      sessionBox: null,
      statsBox: null,
      commandsBox: null,
      log: null,
      status: null,

      appendLog(line) {
        const clean = String(line ?? '').replace(ANSI_RE, '');
        try { process.stdout.write(clean + '\n'); } catch {}
      },

      setRunning() {},
      setUser() {},
      setStatus() {},
      setVoice() {},
      setGuilds() {},
      setPing() {},
      setSessionMax() {},
      setSessionElapsed() {},
      setStats() {},
      setAfk() {},
      setStream() {},
      setRpc() {},

      onQuit(handler) {
        onQuitExternal = typeof handler === 'function' ? handler : () => {};
      },

      destroy() {},
      render() {},
    };
  }

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
      warns: 0,
      voiceJoins: 0,
      voiceLeaves: 0,
      voiceReconnects: 0,
      presenceUpdates: 0,
      afkPings: 0,
      afkReplies: 0,
      streamStarts: 0,
      streamStops: 0,
      rpcApplies: 0,
      rpcErrors: 0,
    },
    stream: {
      active: false,
      starting: false,
      startedAt: 0,
      viewerCount: 0,
      channelName: '',
      guildName: '',
      lastError: '',
    },
    rpc: {
      enabled: false,
      name: '',
      status: '',
      lastError: '',
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
    content: ' {gray-fg}gateway · voice · stream · afk · snipe · rpc · session{/gray-fg}',
  });

  // ── Session panel ────────────────────────────────────────
  const sessionBox = blessed.box({
    parent: screen,
    top: 3, left: 0, width: '100%', height: 7,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' }, fg: 'white' },
    label: ' Session ',
    content: '',
  });

  // ── Stats panel ──────────────────────────────────────────
  const statsBox = blessed.box({
    parent: screen,
    top: 10, left: 0, width: '100%', height: 7,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' }, fg: 'white' },
    label: ' Stats ',
    content: '',
  });

  // ── Commands hint ────────────────────────────────────────
  const commandsBox = blessed.box({
    parent: screen,
    top: 17, left: 0, width: '100%', height: 3,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' }, fg: 'white' },
    label: ' Commands ',
    content:
      ' {gray-fg}.voice  .stream  .rpc  .afk  .snipe  .editsnipe  ·  .cmd  .ping  .uptime  .exit{/gray-fg}',
  });

  // ── Log ──────────────────────────────────────────────────
  const log = blessed.log({
    parent: screen,
    top: 20, left: 0, width: '100%', height: '100%-21',
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

    sessionBox.setContent(
      [line1, line2, line3, line4, line5].map((l) => l.trimEnd()).join('\n')
    );
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
      cell('Voice recon', s.voiceReconnects);

    const line4 =
      '  ' +
      cell('Stream start', s.streamStarts, s.streamStarts > 0 ? 'green' : null) +
      cell('Stream stop', s.streamStops, s.streamStops > 0 ? 'yellow' : null) +
      cell('Errors', s.errors, s.errors > 0 ? 'red' : null);

    const line5 =
      '  ' +
      cell('AFK pings', s.afkPings, s.afkPings > 0 ? 'yellow' : null) +
      cell('AFK reply', s.afkReplies, s.afkReplies > 0 ? 'green' : null) +
      cell('Warns', s.warns, s.warns > 0 ? 'yellow' : null);

    statsBox.setContent(
      [line1, line2, line3, line4, line5].map((l) => l.trimEnd()).join('\n')
    );
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

    if (state.stream.active) {
      const viewers = Math.max(0, state.stream.viewerCount | 0);
      const dur = state.stream.startedAt > 0
        ? fmtDur((Date.now() - state.stream.startedAt) / 1000)
        : '0s';
      parts.push(
        `{red-fg}LIVE{/red-fg} · {bold}${viewers} viewers{/bold} · ${dur}`
      );
    } else if (state.stream.starting) {
      parts.push('{yellow-fg}STREAM STARTING{/yellow-fg}');
    }

    if (state.rpc.enabled) {
      const rpcName = String(state.rpc.name || '').trim();
      if (rpcName) {
        const short = rpcName.length > 24 ? `${rpcName.slice(0, 23)}…` : rpcName;
        const color = state.rpc.lastError ? 'red' : 'magenta';
        parts.push(`{${color}-fg}RPC: ${blessed.escape(short)}{/${color}-fg}`);
      } else if (state.rpc.lastError) {
        parts.push('{red-fg}RPC error{/red-fg}');
      }
    }

    parts.push(`{gray-fg}.cmd trong console · esc quit · ctrl+c force{/gray-fg}`);

    status.setContent(parts.join(' · '));
  }

  const tickTimer = setInterval(() => {
    spinnerIdx++;
    if (state.running) {
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

  screen.key(['escape'], () => onQuitExternal());
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

    setSessionElapsed(ms) {
      state.sessionElapsedMs = Math.max(0, ms | 0);
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

    setStream(st) {
      if (!st) return;
      state.stream = {
        active: !!st.active,
        starting: !!st.starting,
        startedAt: Number(st.startedAt) || 0,
        viewerCount: Number(st.viewerCount) || 0,
        channelName: st.channelName || '',
        guildName: st.guildName || '',
        lastError: st.lastError || '',
      };
      refreshStatus();
      invalidate();
    },

    setRpc(rpc) {
      if (!rpc) return;
      state.rpc = {
        enabled: !!rpc.enabled,
        name: rpc.name || '',
        status: rpc.status || '',
        lastError: rpc.lastError || '',
      };
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