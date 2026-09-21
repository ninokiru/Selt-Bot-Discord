import { getQueueInfo } from '../../music.js';

export async function register({ registerCommand }) {
  registerCommand('queue', {
    category: 'Music',
    description: 'Xem queue',
    usage: '.queue',
    hidden: true,
    handler: async ({ reply }) => {
      const q = getQueueInfo();
      const lines = [];

      if (q.current) lines.push(`▶ Đang phát: ${q.current.title}`);
      if (q.queue.length) {
        lines.push(`\nĐang chờ (${q.queue.length}):`);
        q.queue.slice(0, 5).forEach((t, i) => lines.push(`  ${i + 1}. ${t.title}`));
        if (q.queue.length > 5) lines.push(`  ... +${q.queue.length - 5}`);
      }

      reply(lines.join('\n') || 'Queue trống');
    },
  });
}