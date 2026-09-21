import {
  enableAfk,
  disableAfk,
  isAfk,
  getAfk,
  getConfig,
  setConfig,
} from '../afk.js';
import { fmtDur } from '../utils.js';

export async function register({ registerCommand }) {
  registerCommand('afk', {
    category: 'Utility',
    description: 'Bật/tắt AFK tự phản hồi khi bị ping',
    usage: '.afk [reason] | off | status | list | clear',
    handler: async ({ args, client, reply }) => {
      const arg = args.join(' ').trim();
      const lower = arg.toLowerCase();

      // ── .afk status ──────────────────────────────────
      if (lower === 'status' || lower === 'info') {
        const st = getAfk();
        const cf = getConfig();
        if (!st.enabled) return reply('AFK đang tắt');

        let msg =
          `AFK: BẬT\n` +
          `Reason: ${st.reason || '(không có)'}\n` +
          `Từ: ${fmtDur(st.duration / 1000)} trước\n` +
          `Cooldown: ${(st.cooldownMs / 1000).toFixed(0)}s (${st.cooldownMode})\n` +
          `Silent: ${st.silentMode ? 'on' : 'off'} · React: ${st.reactEmoji || 'none'}\n` +
          `Pings: ${st.totalPings} · Replies: ${st.totalReplies}`;

        if (st.topPingers.length) {
          msg += '\nTop pingers:';
          for (const p of st.topPingers) {
            msg += `\n  ${p.tag} × ${p.count}`;
          }
        }
        return reply(msg);
      }

      // ── .afk list ────────────────────────────────────
      if (lower === 'list') {
        const st = getAfk();
        if (!st.topPingers.length) return reply('Chưa ai ping trong lúc AFK');
        const lines = st.topPingers.map((p, i) =>
          `  ${i + 1}. ${p.tag} × ${p.count} (lần cuối ${fmtDur((Date.now() - p.lastAt) / 1000)} trước)`
        );
        return reply(`Ai đã ping:\n${lines.join('\n')}`);
      }

      // ── .afk off ─────────────────────────────────────
      if (lower === 'off' || lower === 'clear' || lower === 'stop') {
        if (!isAfk()) return reply('AFK đang tắt');
        disableAfk();
        return reply('✓ Đã tắt AFK');
      }

      // ── .afk silent on/off ───────────────────────────
      if (lower === 'silent on') {
        setConfig({ silentMode: true });
        return reply('✓ Silent mode ON — chỉ react emoji');
      }
      if (lower === 'silent off') {
        setConfig({ silentMode: false });
        return reply('✓ Silent mode OFF');
      }

      // ── .afk (no args) ───────────────────────────────
      if (!arg) {
        if (isAfk()) {
          disableAfk();
          return reply('✓ Đã tắt AFK');
        }
        enableAfk('', client.user.id);
        return reply('✓ Đã bật AFK (không có lý do)');
      }

      // ── .afk <reason> ────────────────────────────────
      enableAfk(arg, client.user.id);
      reply(`✓ Đã bật AFK: ${arg}`);
    },
  });
}