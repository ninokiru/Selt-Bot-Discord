import { skip as skipMusic } from '../../music.js';

export async function register({ registerCommand }) {
  registerCommand('skip', {
    category: 'Music',
    description: 'Bỏ qua nhạc đang nghe',
    usage: '.skip',
    handler: async ({ reply, stats, logger }) => {
      if (skipMusic({ logger, stats })) reply('⏭ Bỏ qua');
      else reply('Không có nhạc đang phát');
    },
  });
}