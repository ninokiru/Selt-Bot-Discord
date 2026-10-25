import { getVoiceState, joinVoice } from '../voiceSession.js';
import { startConfirm, isPending } from '../voiceConfirm.js';

const CONFIRM_TTL_MS = 30000;

export async function register({ registerCommand }) {
  registerCommand('voice', {
    category: 'Voice',
    description: 'Join voice (có ID) hoặc Leave voice (không ID)',
    usage: '.voice [channel_id]',
    handler: async ({ args, client, config, reply, stats, logger }) => {
      const vs = getVoiceState();
      const channelId = (args[0] || '').trim();

      // ── Case 1: Không có channel ID ─────────────────────
      if (!channelId) {
        // Chưa ở voice → báo lỗi
        if (!vs.connected) {
          return reply(
            'Chưa ở voice channel nào.\n' +
            'Dùng: .voice <channel_id> để tham gia'
          );
        }

        // Đang ở voice + đã có pending confirm → nhắc lại
        if (isPending()) {
          const remain = Math.ceil(CONFIRM_TTL_MS / 1000);
          return reply(
            `Đang chờ xác nhận rời voice.\n` +
            `Trả lời **yes** để rời, **no** để ở lại.`
          );
        }

        // Đang ở voice → hỏi confirm
        startConfirm(vs.channelId, CONFIRM_TTL_MS);

        return reply(
          `Bạn có muốn rời voice channel hiện tại không?\n` +
          `Trả lời **yes** để rời, **no** để ở lại.\n` +
          `(Hết hạn sau ${CONFIRM_TTL_MS / 1000}s)`
        );
      }

      // ── Case 2: Có channel ID → join ────────────────────
      // Tìm guild chứa channel
      let guild = null;
      let channel = null;

      if (client.guilds?.cache) {
        for (const g of client.guilds.cache.values()) {
          const c = g.channels?.cache?.get?.(channelId);
          if (c) {
            guild = g;
            channel = c;
            break;
          }
        }
      }

      if (!guild || !channel) {
        return reply(`Không tìm thấy channel "${channelId}"`);
      }

      // Nếu đang ở voice khác → joinVoice tự leave channel cũ
      try {
        await joinVoice({
          client,
          guildId: guild.id,
          channelId: channel.id,
          config,
          logger,
          stats,
        });
        reply(`✓ Đã vào ${channel.name} (${guild.name})`);
      } catch (e) {
        reply(`Join fail: ${e.message}`);
      }
    },
  });
}