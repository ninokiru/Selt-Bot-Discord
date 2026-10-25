import { fmtUptime, fmtDur } from '../utils.js';

export async function register({ registerCommand }) {
  registerCommand('uptime', {
    category: 'System',
    description: 'Thời gian chạy',
    usage: '.uptime',
    handler: async ({ session, reply, stats }) => {
      const startedAt = stats?.snapshot().startedAt || Date.now();
      const elapsed = Date.now() - startedAt;

      let extra = '';
      if (session) {
        const snap = session.snapshot();
        const remain = Math.max(0, snap.maxMs - snap.elapsed);
        extra = ` · còn ${fmtDur(remain / 1000)} (${snap.percent}%)`;
      }

      reply(`Uptime: ${fmtUptime(elapsed)}${extra}`);
    },
  });
}