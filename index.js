#!/usr/bin/env node
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── ANSI ─────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  clear: '\x1b[2J\x1b[H',
  altScreenOff: '\x1b[?1049l',
  showCursor: '\x1b[?25h',
};

function c(color, s) {
  return `${C[color] || ''}${s}${C.reset}`;
}

function clear() {
  process.stdout.write(C.altScreenOff + C.clear + C.showCursor);
}

// ── Load config ──────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  launcher: {
    title: 'LUMINA TOOLS LAUNCHER',
    showBanner: true,
    showDescriptions: true,
    confirmExit: false,
    clearAltScreen: true,
    killTreeOnExit: true,
    autoCheckDeps: true,
    autoCheckInstalled: true,
  },
  shared: {
    tokensFile: 'tokens.txt',
    proxiesFile: 'proxies.txt',
  },
  tools: {
    quest: {
      enabled: true,
      label: 'Farm Quest',
      folder: 'Auto Quest Completer Discord',
      description: 'Auto-accept + complete Discord quests',
      key: '1',
    },
    selfbot: {
      enabled: true,
      label: 'Selfbot',
      folder: 'Self Bot',
      description: 'Gateway selfbot · voice · music · rpc',
      key: '2',
    },
  },
  exit: {
    key: '3',
    label: 'Exit',
    aliases: ['q', 'quit', 'exit'],
  },
  logging: {
    debug: false,
    showTimestamp: false,
  },
};

function merge(defaults, user) {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(user || {})) {
    if (k.startsWith('_')) continue;
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      defaults[k] &&
      typeof defaults[k] === 'object'
    ) {
      out[k] = merge(defaults[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.error('[warn] config.json không tồn tại — dùng default');
      return DEFAULT_CONFIG;
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
    if (!raw.trim()) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return merge(DEFAULT_CONFIG, parsed);
  } catch (e) {
    console.error(`[error] config.json lỗi parse: ${e.message}`);
    console.error('[warn] dùng default config');
    return DEFAULT_CONFIG;
  }
}

const CONFIG = loadConfig();

function logDebug(msg) {
  if (CONFIG.logging?.debug) {
    console.error(`[debug] ${msg}`);
  }
}

// ── Tool registry từ config ──────────────────────────────────────
const TOOLS = {};

for (const [id, tool] of Object.entries(CONFIG.tools || {})) {
  if (!tool.enabled) continue;

  if (TOOLS[tool.key]) {
    console.error(`[warn] Tool key "${tool.key}" bị trùng — bỏ qua "${id}"`);
    continue;
  }

  TOOLS[tool.key] = {
    id,
    key: tool.key,
    label: tool.label,
    dir: path.join(__dirname, tool.folder),
    folder: tool.folder,
    desc: tool.description,
  };
}

logDebug(`Loaded ${Object.keys(TOOLS).length} tools: ${Object.keys(TOOLS).join(', ')}`);

// ── Prompt ───────────────────────────────────────────────────────
function prompt(question = '') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
    if (question) process.stdout.write(question);
    rl.once('line', (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

// ── Menu ─────────────────────────────────────────────────────────
function renderMenu() {
  clear();

  const title = CONFIG.launcher.title || 'LUMINA TOOLS LAUNCHER';
  const showBanner = CONFIG.launcher.showBanner !== false;
  const showDesc = CONFIG.launcher.showDescriptions !== false;

  console.log('');

  if (showBanner) {
    const innerWidth = 47;
    const padLen = Math.max(0, innerWidth - title.length);
    const leftPad = Math.floor(padLen / 2);
    const rightPad = padLen - leftPad;

    console.log(`  ${c('cyan', '╔═══════════════════════════════════════════════╗')}`);
    console.log(
      `  ${c('cyan', '║')}${' '.repeat(leftPad)}${c('bold', title)}${' '.repeat(rightPad)}${c('cyan', '║')}`
    );
    console.log(`  ${c('cyan', '╚═══════════════════════════════════════════════╝')}`);
    console.log('');
  }

  const sortedKeys = Object.keys(TOOLS).sort();
  for (const key of sortedKeys) {
    const tool = TOOLS[key];
    const label = String(tool.label || '').padEnd(12);
    const line = showDesc
      ? `  ${c('bold', `[${tool.key}]`)}  ${c('cyan', label)} ${c('gray', tool.desc)}`
      : `  ${c('bold', `[${tool.key}]`)}  ${c('cyan', tool.label)}`;
    console.log(line);
    console.log('');
  }

  const exitKey = CONFIG.exit?.key || '3';
  const exitLabel = CONFIG.exit?.label || 'Exit';
  console.log(`  ${c('bold', `[${exitKey}]`)}  ${c('cyan', exitLabel)}`);
  console.log('');

  const allKeys = [...sortedKeys, exitKey].join('-');
  process.stdout.write(`  ${c('gray', `Chọn [${allKeys}]: `)}`);
}

// ── Check installed ──────────────────────────────────────────────
function checkToolInstalled(tool) {
  if (CONFIG.launcher.autoCheckInstalled === false) {
    return { ok: true };
  }

  const dir = tool.dir;

  if (!fs.existsSync(dir)) {
    return { ok: false, reason: `Thư mục "${tool.folder}" không tồn tại` };
  }

  const pkg = path.join(dir, 'package.json');
  if (!fs.existsSync(pkg)) {
    return { ok: false, reason: `"${tool.folder}/package.json" không tồn tại` };
  }

  if (CONFIG.launcher.autoCheckDeps !== false) {
    const nm = path.join(dir, 'node_modules');
    if (!fs.existsSync(nm)) {
      return {
        ok: false,
        reason: `Chưa cài deps — chạy: cd "${tool.folder}" && npm install`,
      };
    }
  }

  return { ok: true };
}

// ── Kill process tree ────────────────────────────────────────────
function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        process.kill(pid, 'SIGTERM');
      }
    }
  } catch (e) {
    logDebug(`killTree fail: ${e.message}`);
  }
}

// ── Runtime flags ────────────────────────────────────────────────
let childRunning = false;

// ── Spawn foreground ─────────────────────────────────────────────
function runTool(tool) {
  return new Promise((resolve) => {
    const dir = tool.dir;
    logDebug(`Spawning tool "${tool.id}" in ${dir}`);

    const child = spawn('npm', ['start'], {
      cwd: dir,
      stdio: 'inherit',
      shell: true,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        FORCE_COLOR: process.env.FORCE_COLOR || '1',
      },
    });

    childRunning = true;

    const forwardSigint = () => {
      logDebug(`SIGINT forwarded to tool "${tool.id}"`);
      if (CONFIG.launcher.killTreeOnExit !== false) {
        killTree(child.pid);
      } else {
        try { child.kill('SIGINT'); } catch {}
      }
    };
    process.on('SIGINT', forwardSigint);

    child.on('exit', (code) => {
      process.off('SIGINT', forwardSigint);
      childRunning = false;
      if (CONFIG.launcher.clearAltScreen !== false) {
        process.stdout.write(C.altScreenOff);
      }
      process.stdout.write(C.showCursor + '\n');
      resolve(code ?? 0);
    });

    child.on('error', (err) => {
      process.off('SIGINT', forwardSigint);
      childRunning = false;
      console.error(`\n  ${c('red', `Lỗi spawn "${tool.id}": ${err.message}`)}\n`);
      resolve(1);
    });
  });
}

// ── Actions ──────────────────────────────────────────────────────
async function actionRun(key) {
  const tool = TOOLS[key];
  if (!tool) return;

  const check = checkToolInstalled(tool);

  if (!check.ok) {
    clear();
    console.log('');
    console.log(`  ${c('red', 'Không chạy được:')} ${check.reason}`);
    console.log('');
    await prompt(`  ${c('gray', 'Enter để quay lại menu...')}`);
    return;
  }

  clear();
  console.log('');
  console.log(`  ${c('cyan', `Đang khởi động ${tool.label}...`)}`);
  console.log('');
  await new Promise((r) => setTimeout(r, 400));

  await runTool(tool);

  clear();
  console.log('');
  console.log(`  ${c('gray', `${tool.label} đã dừng.`)}`);
  console.log('');
  await prompt(`  ${c('gray', 'Enter để quay lại menu...')}`);
}

async function actionExit() {
  if (CONFIG.launcher.confirmExit) {
    clear();
    console.log('');
    const ans = await prompt(`  ${c('yellow', 'Thoát? [y/N]: ')}`);
    if (ans.toLowerCase() !== 'y') return;
  }

  clear();
  console.log('');
  console.log(`  ${c('gray', 'Bye.')}`);
  console.log('');
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  while (true) {
    renderMenu();
    const input = await prompt('');

    if (!input) continue;

    // Chọn tool
    if (TOOLS[input]) {
      await actionRun(input);
      continue;
    }

    // Chọn exit
    const exitKey = CONFIG.exit?.key || '3';
    const exitAliases = CONFIG.exit?.aliases || ['q', 'quit', 'exit'];
    if (input === exitKey || exitAliases.includes(input.toLowerCase())) {
      await actionExit();
      continue;
    }

    // Không khớp key nào → thông báo
    console.log(`  ${c('yellow', `Không có lựa chọn "${input}"`)}`);
    await new Promise((r) => setTimeout(r, 800));
  }
}

// ── SIGINT ───────────────────────────────────────────────────────
process.on('SIGINT', () => {
  if (childRunning) return;

  clear();
  console.log('');
  console.log(`  ${c('gray', 'Bye.')}`);
  console.log('');
  process.exit(0);
});

main().catch((err) => {
  console.error(`\n  ${c('red', 'Launcher error:')} ${err.message}\n`);
  process.exit(1);
});