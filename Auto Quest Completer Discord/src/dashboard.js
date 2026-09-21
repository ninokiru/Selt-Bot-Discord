import blessed from 'blessed';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Immutable — cache ở module scope ─────────────────────────────
const NODE_VERSION = process.version;
const HOSTNAME = os.hostname().slice(0, 24) || 'unknown';
const ANSI_RE = /\x1b\[[0-9;]*m/g;

let VERSION = '1.0.0';
try {
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')
  );
  VERSION = pkg.version || VERSION;
} catch {
  // package.json thiếu / lỗi đọc → dùng VERSION mặc định 1.0.0
}

// ── Logo tiers ───────────────────────────────────────────────────
const LOGO_PATH = path.resolve(__dirname, '..', 'assets', 'logo.txt');

const SMALL_LOGO = [
  '██████╗  ██████╗  █████╗ ',
  '██╔══██╗██╔═══██╗██╔══██╗',
  '██║  ██║██║   ██║███████║',
  '██║  ██║██║▄▄ ██║██╔══██║',
  '██████╔╝╚██████╔╝██║  ██║',
  '╚═════╝  ╚══▀▀═╝ ╚═╝  ╚═╝',
];
const SMALL_LOGO_WIDTH = Math.max(...SMALL_LOGO.map((l) => l.length));

const MIN_BODY_HEIGHT = 18;

let cachedLogo = null;
let cachedLogoLoaded = false;

function loadLogoFile() {
  if (cachedLogoLoaded) return cachedLogo;
  cachedLogoLoaded = true;
  try {
    const raw = fs.readFileSync(LOGO_PATH, 'utf8');
    const lines = raw.replace(/\n+$/, '').split('\n').map((l) => l.replace(/\s+$/, ''));
    if (!lines.length) return null;
    cachedLogo = lines;
    return cachedLogo;
  } catch {
    return null;
  }
}

function pickLogo(cols, rows = 30) {
  const full = loadLogoFile();
  if (full) {
    const maxW = Math.max(...full.map((l) => l.length));
    const h = full.length;
    if (maxW + 4 <= cols && h + MIN_BODY_HEIGHT <= rows) {
      return { lines: full, tier: 'large' };
    }
  }
  if (SMALL_LOGO_WIDTH + 4 <= cols && SMALL_LOGO.length + MIN_BODY_HEIGHT <= rows) {
    return { lines: SMALL_LOGO, tier: 'small' };
  }
  return { lines: [`   DQA v${VERSION}`], tier: 'text' };
}

// ── Helpers ──────────────────────────────────────────────────────
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

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h}h${mm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}d${hh}h` : `${d}d`;
}

// ── Dashboard ────────────────────────────────────────────────────
export function createDashboard(options = {}) {
  let onQuitExternal = typeof options.onQuit === 'function' ? options.onQuit : () => {};
  let onSelectExternal = typeof options.onSelect === 'function' ? options.onSelect : () => {};

  const screen = blessed.screen({
    smartCSR: true,
    title: `DQA v${VERSION}`,
    fullUnicode: true,
    dockBorders: true,
    autoPadding: true,
  });

  // ── Render scheduling ──────────────────────────────────────────
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

  // ── State ──────────────────────────────────────────────────────
  const startedAt = Date.now();
  const state = {
    tokens: 0,
    proxies: 0,
    regions: 'DIRECT',
    cooldown: '0s',
    phase: 'READY',
    current: null,
    running: false,
    enrolled: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    estimateRemainSec: 0,
    queuePos: null,
    queueTotal: null,
  };
  let spinnerIdx = 0;

  // ── Widgets ────────────────────────────────────────────────────
  const header = blessed.box({
    parent: screen,
    top: 0, left: 0, width: '100%',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' }, fg: 'white' },
    label: ` {bold}{cyan-fg}Quest Auto Completer{/cyan-fg}{/bold} {gray-fg}v${VERSION}{/gray-fg} `,
    content: '',
  });

  const stats = blessed.box({
    parent: screen,
    left: 0, width: '100%',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' }, fg: 'white' },
    label: ' Stats ',
    content: '',
  });

  const menuItems = [
    '[1] Scan & complete quests',
    '[2] Exit',
  ];
  let menuIndex = 0;
  let menuEnabled = true;

  const menu = blessed.box({
    parent: screen,
    left: 0, width: '100%',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' }, fg: 'white' },
    label: ' Menu  {gray-fg}chọn số tương ứng hoặc enter{/gray-fg} ',
    content: '',
  });

  const log = blessed.log({
    parent: screen,
    left: 0, width: '100%',
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

  // ── Responsive sizing ──────────────────────────────────────────
  function computeStatsHeight(cols) {
    if (cols >= 100) return 5;
    if (cols >= 40) return 8;
    return 6;
  }

  function computeMenuHeight(cols) {
    return cols >= 100 ? 3 : 5;
  }

  // ── Layout ─────────────────────────────────────────────────────
  function layout() {
    const cols = screen.cols || process.stdout.columns || 120;
    const rows = screen.rows || process.stdout.rows || 30;

    const logo = pickLogo(cols, rows);
    const logoHeight = logo.lines.length;
    const headerHeight = logoHeight + 4;

    header.top = 0;
    header.height = headerHeight;
    const logoBlock = '\n' + logo.lines.join('\n') + '\n';
    const tagline = `{gray-fg}▸ discord selfbot · multi-region proxy · auto-enroll · v${VERSION}{/gray-fg}`;
    header.setContent(logoBlock + tagline);

    const statsTop = headerHeight;
    const statsHeight = computeStatsHeight(cols);
    stats.top = statsTop;
    stats.height = statsHeight;

    const menuTop = statsTop + statsHeight;
    const menuHeight = computeMenuHeight(cols);
    menu.top = menuTop;
    menu.height = menuHeight;

    const logTop = menuTop + menuHeight;
    const logHeight = Math.max(3, rows - logTop - 1);
    log.top = logTop;
    log.height = logHeight;

    refreshStats();
    refreshMenu();
    refreshStatus();
    invalidate();
  }

  // ── Render stats ───────────────────────────────────────────────
  function refreshStats() {
    const cols = screen.cols || 120;
    const valueW = 8;
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

    const cells = [
      cell('Tokens', state.tokens),
      cell('Proxies', state.proxies),
      cell('Regions', state.regions, 'cyan'),
      cell('Cooldown', state.cooldown, 'yellow'),

      cell('Uptime', fmtUptime(Date.now() - startedAt)),
      cell('Node', NODE_VERSION),
      cell('Host', HOSTNAME, 'cyan'),
      cell('State', state.phase),

      cell('Enrolled', state.enrolled),
      cell('Completed', state.completed, 'green'),
      cell('Failed', state.failed, 'red'),
      cell('Skipped', state.skipped, 'yellow'),
    ];

    let lines;
    if (cols >= 100) {
      lines = [];
      for (let i = 0; i < cells.length; i += 4) {
        lines.push('  ' + cells.slice(i, i + 4).join(''));
      }
    } else if (cols >= 40) {
      lines = [];
      for (let i = 0; i < cells.length; i += 2) {
        lines.push('  ' + cells.slice(i, i + 2).join(''));
      }
    } else {
      lines = [
        '  ' + cells[0],
        '  ' + cells[1],
        '  ' + cells[2],
        '  ' + cells[3],
      ];
    }

    stats.setContent(lines.join('\n'));
  }

  // ── Render menu ────────────────────────────────────────────────
  function refreshMenu() {
    const cols = screen.cols || 120;

    const rendered = menuItems.map((item, i) => {
      if (i === menuIndex && menuEnabled) {
        return `{cyan-bg}{black-fg}  ${item}  {/black-fg}{/cyan-bg}`;
      }
      if (!menuEnabled) {
        return `{gray-fg}  ${item}  {/gray-fg}`;
      }
      return `  ${item}  `;
    });

    if (cols >= 100) {
      menu.setContent(rendered.join('   '));
    } else {
      menu.setContent(rendered.join('\n'));
    }
  }

  // ── Render status ──────────────────────────────────────────────
  function refreshStatus() {
    if (state.running) {
      const frame = SPINNER[spinnerIdx % SPINNER.length];
      const phase = blessed.escape(String(state.phase ?? ''));
      const task = state.current
        ? ` ${blessed.escape(String(state.current))}`
        : '';

      const queue = state.queueTotal
        ? `{cyan-fg}${state.queuePos ?? 0}/${state.queueTotal}{/cyan-fg}`
        : '';

      const est =
        state.estimateRemainSec > 0
          ? `{yellow-fg}còn ~${fmtDur(state.estimateRemainSec)}{/yellow-fg}`
          : '';

      const meta = [queue, est].filter(Boolean).join(' · ');
      const metaStr = meta ? `   ${meta}` : '';

      status.setContent(
        ` {yellow-fg}${frame}{/yellow-fg} {bold}${phase}{/bold}${task}${metaStr}` +
        `   {gray-fg}q / ctrl+c để dừng{/gray-fg}`
      );
    } else {
      status.setContent(
        ` {green-fg}●{/green-fg} {bold}READY{/bold}` +
        `   {gray-fg}1 · 2 · enter để chọn · q quit{/gray-fg}`
      );
    }
  }

  // ── Menu control ───────────────────────────────────────────────
  function triggerSelect(i) {
    if (!menuEnabled) return;
    onSelectExternal(i);
  }

  screen.key(['enter'], () => {
    if (!menuEnabled) return;
    log.log(`[menu] enter → ${menuItems[menuIndex]}`);
    invalidate();
    triggerSelect(menuIndex);
  });

  screen.key(['1'], () => {
    if (!menuEnabled) return;
    menuIndex = 0;
    refreshMenu();
    log.log(`[menu] 1 → Scan & complete quests`);
    invalidate();
    triggerSelect(0);
  });

  screen.key(['2'], () => {
    if (!menuEnabled) return;
    menuIndex = 1;
    refreshMenu();
    log.log(`[menu] 2 → Exit`);
    invalidate();
    setTimeout(() => triggerSelect(1), 250);
  });

  screen.key(['escape', 'q'], () => onQuitExternal());
  screen.key(['C-c'], () => onQuitExternal());

  // ── Tick ───────────────────────────────────────────────────────
  const tickTimer = setInterval(() => {
    spinnerIdx++;
    if (state.running) {
      refreshStatus();
      refreshStats();
      invalidate();
    }
  }, 250);

  // ── Resize ─────────────────────────────────────────────────────
  screen.on('resize', () => {
    layout();
    try { screen.render(); } catch {}
  });

  screen.on('destroy', () => {
    if (tickTimer) clearInterval(tickTimer);
    if (renderTimer) clearTimeout(renderTimer);
  });

  layout();

  // ── Public API ─────────────────────────────────────────────────
  return {
    screen, header, stats, menu, log, status,

    appendLog(line) {
      const clean = String(line ?? '').replace(ANSI_RE, '');
      log.log(clean);
    },

    appendTrusted(line) {
      const clean = String(line ?? '').replace(ANSI_RE, '');
      log.log(clean);
    },

    updateStats(partial) {
      Object.assign(state, partial);
      refreshStats();
      invalidate();
    },

    updateProgress(partial) {
      Object.assign(state, partial);
      refreshStats();
      invalidate();
    },

    setPhase(text) {
      state.phase = text;
      refreshStatus();
      refreshStats();
      invalidate();
    },

    setCurrent(text, running = undefined) {
      state.current = text;
      if (running !== undefined) state.running = !!running;
      else state.running = !!text;
      refreshStatus();
      invalidate();
    },

    setRunning(running) {
      state.running = !!running;
      refreshStatus();
      invalidate();
    },

    clearCurrent() {
      state.current = null;
      state.running = false;
      refreshStatus();
      invalidate();
    },

    setEstimate(remainSec) {
      state.estimateRemainSec = Math.max(0, Math.floor(remainSec) || 0);
      refreshStatus();
      invalidate();
    },

    setQueue(pos, total) {
      if (total == null || total <= 0) {
        state.queuePos = null;
        state.queueTotal = null;
      } else {
        state.queuePos = pos;
        state.queueTotal = total;
      }
      refreshStatus();
      invalidate();
    },

    clearEstimate() {
      state.estimateRemainSec = 0;
      state.queuePos = null;
      state.queueTotal = null;
      refreshStatus();
      invalidate();
    },

    setMenuEnabled(enabled) {
      menuEnabled = !!enabled;
      refreshMenu();
      invalidate();
    },

    lockKeys(lock) {
      screen.lockKeys = !!lock;
      invalidate();
    },

    onSelect(handler) {
      onSelectExternal = typeof handler === 'function' ? handler : () => {};
    },

    onQuit(handler) {
      onQuitExternal = typeof handler === 'function' ? handler : () => {};
    },

    focus() {
      menu.focus();
    },

    destroy() {
      screen.destroy();
    },

    render: scheduleRender,
  };
}