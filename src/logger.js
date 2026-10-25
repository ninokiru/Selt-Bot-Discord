import chalk from 'chalk';

function resolveChalkLevel() {
  if (process.env.NO_COLOR) return 0;
  if (process.env.FORCE_COLOR) return 3;
  if (!process.stdout.isTTY) return 0;
  return 3;
}
chalk.level = resolveChalkLevel();

const LEVELS = {
  info:  { label: 'INFO',  color: chalk.cyan,         rank: 2 },
  ok:    { label: '  OK',  color: chalk.green,        rank: 2 },
  warn:  { label: 'WARN',  color: chalk.yellow,       rank: 1 },
  error: { label: ' ERR',  color: chalk.red,          rank: 0 },
  debug: { label: ' DBG',  color: chalk.gray,         rank: 3 },
  ws:    { label: '  WS',  color: chalk.magenta,      rank: 2 },
  voice: { label: 'VOICE', color: chalk.blue,         rank: 2 },
  cmd:   { label: ' CMD',  color: chalk.cyanBright,   rank: 2 },
};

const config = {
  debugEnabled: false,
  minLevel: 0,
  showTime: true,
};

let outputFn = (line) => {
  try { process.stdout.write(line + '\n'); } catch {}
};

export function setDebug(v) { config.debugEnabled = !!v; }
export function setOutput(fn) {
  if (typeof fn !== 'function') {
    outputFn = (line) => { try { process.stdout.write(line + '\n'); } catch {} };
    return;
  }
  outputFn = (line) => { try { fn(line); } catch {} };
}
export function setLogConfig(partial = {}) { Object.assign(config, partial); }

function ts() {
  if (!config.showTime) return '';
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return chalk.gray(`${hh}:${mm}:${ss}`) + ' ';
}

function prefix(tag) {
  return tag ? chalk.magenta(`[${tag}]`) + ' ' : '';
}

function shouldEmit(level) {
  const l = LEVELS[level] || LEVELS.info;
  if (level === 'debug' && !config.debugEnabled) return false;
  if (l.rank < config.minLevel) return false;
  return true;
}

function emit(level, tag, msg) {
  if (!shouldEmit(level)) return;
  const l = LEVELS[level] || LEVELS.info;
  let body;
  try {
    body = typeof msg === 'function' ? String(msg()) : String(msg ?? '');
  } catch (e) {
    body = `[log error: ${e.message}]`;
  }
  outputFn(`${ts()}${prefix(tag)}${l.color(`[${l.label}]`)} ${body}`);
}

export function makeLogger(tag = '') {
  return {
    info:  (m) => emit('info', tag, m),
    ok:    (m) => emit('ok', tag, m),
    warn:  (m) => emit('warn', tag, m),
    error: (m) => emit('error', tag, m),
    debug: (m) => emit('debug', tag, m),
    ws:    (m) => emit('ws', tag, m),
    voice: (m) => emit('voice', tag, m),
    cmd:   (m) => emit('cmd', tag, m),
    raw:   (m) => {
      try {
        const body = typeof m === 'function' ? String(m()) : String(m ?? '');
        outputFn(body);
      } catch {}
    },
    child(extra) {
      return makeLogger(tag ? `${tag}:${extra}` : String(extra ?? ''));
    },
  };
}

export const log = makeLogger();