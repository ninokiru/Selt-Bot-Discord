import { setVolume } from '../../music.js';

export async function register({ registerCommand }) {
  registerCommand('volume', {
    category: 'Music',
    description: 'Set volume 0-100',
    usage: '.volume <0-100>',
    hidden: true,
    handler: async ({ args, reply, logger }) => {
      const v = parseInt(args[0], 10);
      if (!Number.isFinite(v) || v < 0 || v > 100) return reply('Volume phải 0-100');

      if (setVolume(v, { logger })) reply(`🔊 Volume = ${v}`);
      else reply('Không có nhạc');
    },
  });
}