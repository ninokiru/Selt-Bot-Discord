import { play as playMusic } from '../../music.js';

export async function register({ registerCommand }) {
  registerCommand('play', {
    category: 'Music',
    description: 'Nghe nhạc YouTube',
    usage: '.play <link hoặc tên bài>',
    handler: async ({ args, config, reply, stats, logger }) => {
      const query = args.join(' ').trim();
      if (!query) return reply('Cần link YouTube hoặc tên bài');

      try {
        const info = await playMusic({ query, config, logger, stats });
        const dur = info.durationInSec
          ? ` (${Math.floor(info.durationInSec / 60)}:${String(info.durationInSec % 60).padStart(2, '0')})`
          : '';
        reply(`▶ ${info.title}${dur}`);
      } catch (e) {
        reply(`❌ ${e.message}`);
      }
    },
  });
}