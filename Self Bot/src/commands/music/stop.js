import { stopAll as stopMusic } from '../../music.js';

export async function register({ registerCommand }) {
  registerCommand('stop', {
    category: 'Music',
    description: 'Tắt nhạc + xoá queue',
    usage: '.stop',
    handler: async ({ reply, stats, logger }) => {
      if (stopMusic({ logger, stats })) reply('⏹ Đã tắt nhạc');
      else reply('Không có nhạc đang phát');
    },
  });
}