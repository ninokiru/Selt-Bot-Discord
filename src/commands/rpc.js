import { getRpcState, reloadRPC, suspendRPC } from '../rpc.js';
import { fmtDur } from '../utils.js';

export async function register({ registerCommand }) {
  registerCommand('rpc', {
    category: 'Presence',
    description: 'Xem, reload hoặc tắt Rich Presence',
    usage: '.rpc [status|reload|on|off]',
    aliases: ['presence'],
    handler: async ({ args, reply }) => {
      const sub = String(args[0] || 'status').toLowerCase();

      if (sub === 'reload' || sub === 'on') {
        const activity = await reloadRPC({ force: sub === 'on' });
        const st = getRpcState();

        if (!activity) {
          return reply(
            st.lastError
              ? `RPC không áp dụng: ${st.lastError}`
              : 'RPC không áp dụng — kiểm tra rpc.json'
          );
        }

        const label = [st.type, st.name].filter(Boolean).join(' · ');
        const refresh = st.refreshIntervalSec > 0 ? ` · refresh ${st.refreshIntervalSec}s` : '';
        return reply(`Đã áp dụng RPC: ${label}${refresh}`);
      }

      if (sub === 'off') {
        suspendRPC();
        return reply('Đã tắt RPC tạm thời. Dùng .rpc on để bật lại.');
      }

      if (sub === 'status' || sub === 'info') {
        const st = getRpcState();
        const stateLabel = st.suspended
          ? 'tạm tắt'
          : st.enabled
            ? (st.applied ? 'ON' : 'ON (chưa áp dụng)')
            : 'OFF';

        const lines = [`RPC: ${stateLabel}`];
        if (st.name) lines.push(`Activity: ${st.type} · ${st.name}`);
        if (st.status) lines.push(`Status: ${st.status}`);
        if (st.appliedAt) lines.push(`Áp dụng: ${fmtDur((Date.now() - st.appliedAt) / 1000)} trước`);
        if (st.refreshIntervalSec) lines.push(`Refresh: ${st.refreshIntervalSec}s`);
        if (st.lastError) lines.push(`Lỗi cuối: ${st.lastError}`);

        return reply(lines.join('\n'));
      }

      return reply('Usage: .rpc [status|reload|on|off]');
    },
  });
}
