import chalk from 'chalk';

function resolveChalkLevel() {
  if (process.env.NO_COLOR) return 0;
  if (process.env.FORCE_COLOR) return 3;
  if (!process.stdout.isTTY) return 0;
  return 3;
}
chalk.level = resolveChalkLevel();

const LUMINA = [
  '   ___       ___       ___       ___       ___       ___   ',
  '   /\\__\\     /\\__\\     /\\__\\     /\\  \\     /\\__\\     /\\  \\  ',
  '  /:/  /    /:/ _/_   /::L_L_   _\\:\\  \\   /:| _|_   /::\\  \\ ',
  ' /:/__/    /:/_/\\__\\ /:/L:\\__\\ /\\/::\\__\\ /::|/\\__\\ /::\\:\\__\\',
  ' \\:\\  \\    \\:\\/:/  / \\/_/:/  / \\::/\\/__/ \\/|::/  / \\/\\::/  /',
  '  \\:\\__\\    \\::/  /    /:/  /   \\:\\__\\     |:/  /    /:/  / ',
  '   \\/__/     \\/__/     \\/__/     \\/__/     \\/__/     \\/__/ ',
];

const TAGLINE = 'outcome · built for He';
const INIT_TEXT = 'initializing ...';

const CLEAR = '\x1b[2J\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

function write(s) {
  try { process.stdout.write(s); } catch {}
}

function centerOf(width, cols) {
  return ' '.repeat(Math.max(0, Math.floor((cols - width) / 2)));
}

function displayWidth(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function shouldSkip() {
  const v = process.env.SKIP_SPLASH;
  return v === '1' || v === 'true' || v === 'yes';
}

function interruptibleSleep(ms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

export async function showSplash(ms = 1500) {
  if (shouldSkip() || ms <= 0) return;

  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const artWidth = Math.max(...LUMINA.map((l) => l.length));
  const compact = cols < artWidth + 4 || rows < LUMINA.length + 8;

  write(CLEAR + HIDE_CURSOR);

  try {
    if (compact) {
      const line = chalk.cyan.bold(`LUMINA v1.0.0`);
      write(centerOf(displayWidth(line), cols) + line + '\n\n');
      const tag = chalk.gray(TAGLINE);
      write(centerOf(displayWidth(tag), cols) + tag + '\n\n');
    } else {
      write('\n');
      for (const line of LUMINA) {
        write(centerOf(line.length, cols) + chalk.cyan(line) + '\n');
      }
      write('\n');
      const tag = chalk.gray(TAGLINE);
      write(centerOf(displayWidth(tag), cols) + tag + '\n\n');
    }

    const init = chalk.dim(INIT_TEXT);
    write(centerOf(displayWidth(init), cols) + init + '\n');

    await interruptibleSleep(ms);
  } finally {
    write(CLEAR + SHOW_CURSOR);
  }
}