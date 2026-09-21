import chalk from 'chalk';

// ── Color level ──────────────────────────────────────────────────
// Tôn trọng: NO_COLOR (tắt hết), FORCE_COLOR (bật force), non-TTY
function resolveChalkLevel() {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return 0;

  const force = process.env.FORCE_COLOR;
  if (force !== undefined) {
    if (force === '' || force === 'true' || force === '1') return 3;
    if (force === '0' || force === 'false') return 0;
    const n = parseInt(force, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 3) return n;
  }

  // Không phải TTY → không màu (khi pipe ra file, blessed không phải TTY)
  if (!process.stdout.isTTY) return 0;

  return 3;
}

chalk.level = resolveChalkLevel();

// ── Levels ────────────────────────────────────────────────────────
const LEVELS = {
  info:     { label: 'INFO', color: chalk.cyan, rank: 2 },
  ok:       { label: '  OK', color: chalk.green, rank: 2 },
  warn:     { label: 'WARN', color: chalk.yellow, rank: 1 },
  error:    { label: ' ERR', color: chalk.red, rank: 0 },
  debug:    { label: ' DBG', color: chalk.gray, rank: 3 },
  progress: { label: 'PROG', color: chalk.dim, rank: 2 },
};

// ── Runtime config ────────────────────────────────────────────────
const config = {
  debugEnabled: false,
  minLevel: 0,           // 0 = hiện hết; 3 = chỉ error
  showTime: true,
  timeFormat: 'short',   // 'short' (HH:MM:SS) | 'iso'
  onError: null,         // (err, line) => void — hook khi outputFn throw
};

// ── Output ────────────────────────────────────────────────────────
let outputFn = (line) => {
  try {
    process.stdout.write(line + '\n');
  } catch {
    // stdout closed / EPIPE — bỏ qua
  }
};

export function setDebug(v) {
  config.debugEnabled = !!v;
}

export function setOutput(fn) {
  if (typeof fn !== 'function') {
    outputFn = (line) => process.stdout.write(line + '\n');
    return;
  }
  outputFn = (line) => {
    try {
      fn(line);
    } catch (err) {
      // Không để 1 lỗi dashboard kill cả log pipeline
      if (config.onError) {
        try { config.onError(err, line); } catch {}
      }
      try { process.stdout.write(line + '\n'); } catch {}
    }
  };
}

export function setLogConfig(partial = {}) {
  Object.assign(config, partial);
}

// ── Format ────────────────────────────────────────────────────────
function ts() {
  if (!config.showTime) return '';
  const d = new Date();
  if (config.timeFormat === 'iso') {
    return chalk.gray(d.toISOString()) + ' ';
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return chalk.gray(`${hh}:${mm}:${ss}`) + ' ';
}

function prefix(tag) {
  return tag ? chalk.magenta(`[${tag}]`) + ' ' : '';
}

// ── Emit ──────────────────────────────────────────────────────────
function shouldEmit(level) {
  const l = LEVELS[level] || LEVELS.info;
  if (level === 'debug' && !config.debugEnabled) return false;
  if (l.rank < config.minLevel) return false;
  return true;
}

function emit(level, tag, msg) {
  if (!shouldEmit(level)) return;

  const l = LEVELS[level] || LEVELS.info;
  const time = ts();
  const t = prefix(tag);

  let body;
  try {
    body = typeof msg === 'function' ? String(msg()) : String(msg ?? '');
  } catch (e) {
    body = `[log error: ${e.message}]`;
  }

  const line = `${time}${t}${l.color(`[${l.label}]`)} ${body}`;

  try {
    outputFn(line);
  } catch {
    // Không để logger kill app
  }
}

// ── Logger factory ────────────────────────────────────────────────
export function makeLogger(tag = '') {
  const logger = {
    info:     (m) => emit('info', tag, m),
    ok:       (m) => emit('ok', tag, m),
    warn:     (m) => emit('warn', tag, m),
    error:    (m) => emit('error', tag, m),
    debug:    (m) => emit('debug', tag, m),
    progress: (m) => emit('progress', tag, m),
    raw:      (m) => {
      try {
        const body = typeof m === 'function' ? String(m()) : String(m ?? '');
        outputFn(body);
      } catch {}
    },
    // Child logger với tag mới, kế thừa config
    child(extraTag) {
      const t = tag ? `${tag}:${extraTag}` : String(extraTag ?? '');
      return makeLogger(t);
    },
  };

  return logger;
}

export const log = makeLogger();

// Re-export cho debug
export const _internal = {
  resolveChalkLevel,
  getConfig: () => ({ ...config }),
};