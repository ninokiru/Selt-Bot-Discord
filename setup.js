#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

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
  gray: '\x1b[90m',
};

function c(color, s) {
  return `${C[color] || ''}${s}${C.reset}`;
}

function log(icon, color, msg) {
  console.log(`  ${c(color, icon)}  ${msg}`);
}

function header(msg) {
  console.log('');
  console.log(`  ${c('cyan', '▸')} ${c('bold', msg)}`);
}

function footer(msg) {
  console.log(`  ${c('gray', msg)}`);
  console.log('');
}

function ok(msg) { log('✓', 'green', msg); }
function warn(msg) { log('⚠', 'yellow', msg); }
function err(msg) { log('✗', 'red', msg); }
function info(msg) { log('·', 'gray', msg); }

// ── Prompt ───────────────────────────────────────────────────────
function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
    rl.question(`  ${c('gray', question)}`, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

// ── Banner ───────────────────────────────────────────────────────
function banner() {
  console.log('');
  console.log(`  ${c('cyan', '╔═══════════════════════════════════════════════╗')}`);
  console.log(`  ${c('cyan', '║')}         ${c('bold', 'LUMINA TOOLS · SETUP')}                ${c('cyan', '║')}`);
  console.log(`  ${c('cyan', '╚═══════════════════════════════════════════════╝')}`);
  console.log('');
}

// ── Config ───────────────────────────────────────────────────────
const SETUP_CONFIG = {
  nodeMinMajor: 20,
  tools: [
    { id: 'root', label: 'Root launcher', dir: __dirname, skip: true },
    { id: 'quest', label: 'Farm Quest', dir: path.join(__dirname, 'Auto Quest Completer Discord') },
    { id: 'selfbot', label: 'Selfbot', dir: path.join(__dirname, 'Self Bot') },
  ],
  ytDlp: {
    targetDir: path.join(__dirname, 'Self Bot', 'bin'),
  },
};

// yt-dlp download URLs theo platform
function buildYtDlpUrl() {
  const p = process.platform;
  const a = process.arch;

  if (p === 'win32') {
    return {
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
      filename: 'yt-dlp.exe',
    };
  }
  if (p === 'darwin') {
    return {
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
      filename: 'yt-dlp',
    };
  }
  if (p === 'linux') {
    if (a === 'arm64' || a === 'arm') {
      return {
        url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64',
        filename: 'yt-dlp',
      };
    }
    return {
      url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
      filename: 'yt-dlp',
    };
  }
  return null;
}

// ── Step 1: Check Node ───────────────────────────────────────────
function checkNode() {
  header('Kiểm tra Node.js');

  const version = process.versions.node;
  const major = parseInt(version.split('.')[0], 10);

  if (major < SETUP_CONFIG.nodeMinMajor) {
    err(`Node.js v${version} — cần >= v${SETUP_CONFIG.nodeMinMajor}`);
    footer('Cài đặt Node.js mới tại: https://nodejs.org/');
    return false;
  }

  ok(`Node.js v${version}`);
  return true;
}

// ── Step 2: Check folder tools ───────────────────────────────────
function checkToolFolders() {
  header('Kiểm tra thư mục tools');

  let allOk = true;

  for (const tool of SETUP_CONFIG.tools) {
    if (tool.skip) continue;

    if (!fs.existsSync(tool.dir)) {
      err(`${tool.label}: thư mục không tồn tại (${path.basename(tool.dir)})`);
      allOk = false;
      continue;
    }

    const pkg = path.join(tool.dir, 'package.json');
    if (!fs.existsSync(pkg)) {
      err(`${tool.label}: package.json không tồn tại`);
      allOk = false;
      continue;
    }

    ok(`${tool.label}: ${c('gray', tool.dir)}`);
  }

  return allOk;
}

// ── Step 3: Install npm deps ─────────────────────────────────────
function npmInstall(dir, label) {
  return new Promise((resolve) => {
    const hasNodeModules = fs.existsSync(path.join(dir, 'node_modules'));

    if (hasNodeModules) {
      info(`${label}: đã có node_modules — chạy npm install để update`);
    }

    const child = spawn('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: dir,
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        FORCE_COLOR: process.env.FORCE_COLOR || '1',
      },
    });

    child.on('exit', (code) => {
      if (code === 0) {
        ok(`${label}: cài deps xong`);
        resolve(true);
      } else {
        err(`${label}: npm install fail (code ${code})`);
        resolve(false);
      }
    });

    child.on('error', (e) => {
      err(`${label}: ${e.message}`);
      resolve(false);
    });
  });
}

async function installAllDeps() {
  header('Cài đặt dependencies');

  let allOk = true;

  for (const tool of SETUP_CONFIG.tools) {
    console.log('');
    console.log(`  ${c('cyan', `▸ ${tool.label}`)}`);

    if (tool.skip) {
      info('Không cần cài deps');
      continue;
    }

    const result = await npmInstall(tool.dir, tool.label);
    if (!result) allOk = false;
  }

  return allOk;
}

// ── Step 4: Download yt-dlp ──────────────────────────────────────
const MAX_REDIRECTS = 5;

function downloadFile(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > MAX_REDIRECTS) {
      return reject(new Error('Too many redirects'));
    }

    const tmpDest = `${dest}.download`;

    const req = https.get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 },
      (res) => {
        // Redirect — follow manually
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return downloadFile(res.headers.location, dest, depth + 1)
            .then(resolve)
            .catch(reject);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        // Tạo file stream NGAY LÚC NÀY (sau redirect đã ổn định)
        const file = fs.createWriteStream(tmpDest);

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        let lastPrint = 0;

        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const now = Date.now();
            if (now - lastPrint > 500) {
              lastPrint = now;
              const pct = Math.floor((received / total) * 100);
              const recMb = (received / 1024 / 1024).toFixed(1);
              const totMb = (total / 1024 / 1024).toFixed(1);
              process.stdout.write(
                `\r    ${c('gray', `Downloading... ${pct}% (${recMb}MB / ${totMb}MB)`)}   `
              );
            }
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          file.close(() => {
            process.stdout.write('\r' + ' '.repeat(80) + '\r');

            try {
              if (fs.existsSync(dest)) fs.unlinkSync(dest);
            } catch {}

            try {
              fs.renameSync(tmpDest, dest);
              resolve();
            } catch (e) {
              try { fs.unlinkSync(tmpDest); } catch {}
              reject(e);
            }
          });
        });

        file.on('error', (e) => {
          try { file.close(); } catch {}
          try { fs.unlinkSync(tmpDest); } catch {}
          reject(e);
        });

        res.on('error', (e) => {
          try { file.close(); } catch {}
          try { fs.unlinkSync(tmpDest); } catch {}
          reject(e);
        });
      }
    );

    req.on('timeout', () => {
      try { req.destroy(); } catch {}
      reject(new Error('Download timeout (30s)'));
    });

    req.on('error', (e) => {
      try { fs.unlinkSync(tmpDest); } catch {}
      reject(e);
    });
  });
}

async function setupYtDlp() {
  header('yt-dlp (music extractor)');

  // FIX: đổi tên biến từ "info" thành "ytInfo" để không shadow function info()
  const ytInfo = buildYtDlpUrl();
  if (!ytInfo) {
    warn(`Platform ${process.platform}/${process.arch} không được hỗ trợ auto-download`);
    footer('Tải thủ công: https://github.com/yt-dlp/yt-dlp/releases');
    return false;
  }

  const targetDir = SETUP_CONFIG.ytDlp.targetDir;
  const targetPath = path.join(targetDir, ytInfo.filename);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Cleanup file .download rác từ lần chạy trước
  try {
    const stale = `${targetPath}.download`;
    if (fs.existsSync(stale)) {
      fs.unlinkSync(stale);
      info('Đã xoá file .download cũ');
    }
  } catch {}

  if (fs.existsSync(targetPath)) {
    const stats = fs.statSync(targetPath);
    const sizeMb = (stats.size / 1024 / 1024).toFixed(1);
    ok(`Đã có sẵn: ${ytInfo.filename} (${sizeMb}MB)`);

    const ans = await prompt('Tải lại (update)? [y/N]: ');
    if (ans.toLowerCase() !== 'y') {
      if (process.platform !== 'win32') {
        try { fs.chmodSync(targetPath, 0o755); } catch {}
      }
      return true;
    }
  }

  info(`Đang tải ${ytInfo.filename}...`);

  try {
    await downloadFile(ytInfo.url, targetPath);

    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(targetPath, 0o755);
        ok(`Đã set executable: ${ytInfo.filename}`);
      } catch (e) {
        warn(`Không set được executable: ${e.message}`);
      }
    }

    const stats = fs.statSync(targetPath);
    const sizeMb = (stats.size / 1024 / 1024).toFixed(1);
    ok(`Đã tải: ${ytInfo.filename} (${sizeMb}MB)`);

    return true;
  } catch (e) {
    err(`Tải thất bại: ${e.message}`);
    footer('Tải thủ công: https://github.com/yt-dlp/yt-dlp/releases');
    return false;
  }
}

// ── Step 5: Check tokens/proxies ─────────────────────────────────
function checkSharedFiles() {
  header('File shared');

  const tokensPath = path.join(__dirname, 'tokens.txt');
  const proxiesPath = path.join(__dirname, 'proxies.txt');

  if (!fs.existsSync(tokensPath)) {
    fs.writeFileSync(
      tokensPath,
      '# Paste Discord token vào đây, mỗi dòng 1 token\n# Dòng bắt đầu # bị bỏ qua\n',
      { mode: 0o600 }
    );
    warn('Đã tạo tokens.txt — cần paste token vào');
  } else {
    const content = fs.readFileSync(tokensPath, 'utf8');
    const validLines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    if (validLines.length === 0) {
      warn('tokens.txt tồn tại nhưng chưa có token');
    } else {
      ok(`tokens.txt: ${validLines.length} token`);
    }
  }

  if (!fs.existsSync(proxiesPath)) {
    fs.writeFileSync(
      proxiesPath,
      '# Paste proxy vào đây, mỗi dòng 1 proxy\n# Format: LABEL|protocol://user:pass@host:port\n# Ví dụ: US|http://1.2.3.4:8080\n# Để trống nếu không dùng proxy\n',
      { mode: 0o600 }
    );
    info('Đã tạo proxies.txt (trống — Quest sẽ tự tải proxy free)');
  } else {
    const content = fs.readFileSync(proxiesPath, 'utf8');
    const validLines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    if (validLines.length === 0) {
      info('proxies.txt trống — Quest sẽ tự tải proxy free');
    } else {
      ok(`proxies.txt: ${validLines.length} proxy`);
    }
  }

  return true;
}

// ── Step 6: Check configs ────────────────────────────────────────
function checkConfigs() {
  header('Config files');

  const configs = [
    { path: path.join(__dirname, 'config.json'), label: 'Launcher config' },
    { path: path.join(__dirname, 'Auto Quest Completer Discord', 'config.json'), label: 'Quest config' },
    { path: path.join(__dirname, 'Self Bot', 'config.json'), label: 'Selfbot config' },
    { path: path.join(__dirname, 'Self Bot', 'rpc.json'), label: 'RPC config' },
  ];

  let allOk = true;

  for (const cfg of configs) {
    if (!fs.existsSync(cfg.path)) {
      err(`${cfg.label}: không tồn tại (${path.basename(cfg.path)})`);
      allOk = false;
    } else {
      try {
        const raw = fs.readFileSync(cfg.path, 'utf8').replace(/^\uFEFF/, '');
        JSON.parse(raw);
        ok(`${cfg.label}: ${c('gray', path.basename(cfg.path))}`);
      } catch (e) {
        err(`${cfg.label}: JSON lỗi — ${e.message}`);
        allOk = false;
      }
    }
  }

  return allOk;
}

// ── Step 7: Verify selfbot deps ──────────────────────────────────
function verifySelfbotDeps() {
  header('Verify selfbot deps');

  const sbDir = path.join(__dirname, 'Self Bot');

  const checks = [
    { label: 'ffmpeg-static', path: path.join(sbDir, 'node_modules', 'ffmpeg-static') },
    { label: '@discordjs/voice', path: path.join(sbDir, 'node_modules', '@discordjs', 'voice') },
    { label: 'discord.js-selfbot-v13', path: path.join(sbDir, 'node_modules', 'discord.js-selfbot-v13') },
    { label: '@discordjs/opus', path: path.join(sbDir, 'node_modules', '@discordjs', 'opus') },
    { label: 'libsodium-wrappers', path: path.join(sbDir, 'node_modules', 'libsodium-wrappers') },
  ];

  let allOk = true;

  for (const check of checks) {
    if (fs.existsSync(check.path)) {
      ok(check.label);
    } else {
      err(`${check.label}: thiếu`);
      allOk = false;
    }
  }

  // Verify ffmpeg binary
  const binName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const binPath = path.join(sbDir, 'node_modules', 'ffmpeg-static', binName);
  if (fs.existsSync(binPath)) {
    ok(`ffmpeg binary: ${c('gray', binName)}`);
  } else {
    warn(`ffmpeg binary chưa tải — npm install lại ffmpeg-static`);
  }

  // Verify yt-dlp
  const ytDlpInfo = buildYtDlpUrl();
  if (ytDlpInfo) {
    const ytPath = path.join(SETUP_CONFIG.ytDlp.targetDir, ytDlpInfo.filename);
    if (fs.existsSync(ytPath)) {
      ok(`yt-dlp binary: ${c('gray', ytDlpInfo.filename)}`);
    } else {
      warn(`yt-dlp binary chưa có`);
    }
  }

  return allOk;
}

// ── Step 8: Verify quest deps ────────────────────────────────────
function verifyQuestDeps() {
  header('Verify quest deps');

  const qDir = path.join(__dirname, 'Auto Quest Completer Discord');

  const checks = [
    'axios',
    'blessed',
    'chalk',
    'https-proxy-agent',
    'p-limit',
    'socks-proxy-agent',
  ];

  let allOk = true;

  for (const dep of checks) {
    const depPath = path.join(qDir, 'node_modules', dep, 'package.json');
    if (fs.existsSync(depPath)) {
      ok(dep);
    } else {
      err(`${dep}: thiếu`);
      allOk = false;
    }
  }

  return allOk;
}

// ── Step 9: Chmod secret files (Unix) ────────────────────────────
function chmodSecrets() {
  if (process.platform === 'win32') return true;

  header('Set permissions (Unix)');

  const files = [
    path.join(__dirname, 'tokens.txt'),
    path.join(__dirname, 'proxies.txt'),
    path.join(__dirname, 'Self Bot', 'rpc.json'),
    path.join(__dirname, 'Auto Quest Completer Discord', '.state.json'),
  ];

  for (const file of files) {
    if (fs.existsSync(file)) {
      try {
        fs.chmodSync(file, 0o600);
        ok(`${path.basename(file)}: 600`);
      } catch (e) {
        warn(`${path.basename(file)}: ${e.message}`);
      }
    }
  }

  return true;
}

// ── Summary ──────────────────────────────────────────────────────
function summary(results) {
  console.log('');
  console.log(`  ${c('cyan', '━'.repeat(47))}`);
  console.log('');
  console.log(`  ${c('bold', 'Kết quả setup')}`);
  console.log('');

  let allOk = true;
  for (const [label, pass] of Object.entries(results)) {
    const icon = pass ? c('green', '✓') : c('red', '✗');
    console.log(`  ${icon}  ${label}`);
    if (!pass) allOk = false;
  }

  console.log('');
  console.log(`  ${c('cyan', '━'.repeat(47))}`);
  console.log('');

  if (allOk) {
    console.log(`  ${c('green', 'Setup hoàn tất!')} Chạy ${c('cyan', 'npm start')} để bắt đầu.`);
  } else {
    console.log(`  ${c('yellow', 'Setup xong nhưng có cảnh báo.')} Kiểm tra log phía trên.`);
    console.log(`  ${c('gray', 'Có thể vẫn chạy được — thử npm start.')}`);
  }

  console.log('');
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  banner();

  const results = {};

  results['Node.js'] = checkNode();
  if (!results['Node.js']) {
    summary(results);
    process.exit(1);
  }

  results['Thư mục tools'] = checkToolFolders();
  if (!results['Thư mục tools']) {
    warn('Cấu trúc thư mục chưa đúng — setup có thể không hoàn chỉnh');
  }

  results['Dependencies'] = await installAllDeps();

  console.log('');
  try {
    results['yt-dlp'] = await setupYtDlp();
  } catch (e) {
    err(`yt-dlp: ${e.message}`);
    results['yt-dlp'] = false;
  }

  results['File shared'] = checkSharedFiles();
  results['Config files'] = checkConfigs();
  results['Selfbot deps'] = verifySelfbotDeps();
  results['Quest deps'] = verifyQuestDeps();
  results['Permissions'] = chmodSecrets();

  summary(results);
}

main().catch((e) => {
  console.error('');
  console.error(`  ${c('red', 'Setup error:')} ${e.message}`);
  console.error('');
  process.exit(1);
});