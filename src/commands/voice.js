import { getVoiceState, joinVoice, leaveVoice, isVoiceChannel } from '../voiceSession.js';
import {
  startConfirm,
  isPending,
  getRemaining,
  getPendingChannel,
} from '../voiceConfirm.js';
import { isStreaming } from '../stream.js';

const CONFIRM_TTL_MS = 30000;
const LIST_LIMIT = 25;
const STREAM_BLOCK_MSG = 'Đang stream — dùng .stream stop trước khi đổi voice.';

function startLeaveConfirm(vs, msg, reply) {
  const textChannelId = msg?.channel?.id ?? null;

  if (!vs.connected) {
    return reply(
      'Chưa ở voice channel nào.\n' +
      'Dùng: .voice <channel_id> để tham gia'
    );
  }

  // Chỉ nhắc lại nếu confirm đang chờ thuộc channel hiện tại
  if (isPending() && getPendingChannel() === textChannelId) {
    const remain = Math.ceil(getRemaining() / 1000);
    return reply(
      `Đang chờ xác nhận rời voice (còn ${remain}s).\n` +
      `Trả lời **yes** để rời, **no** để ở lại.`
    );
  }

  startConfirm(textChannelId, CONFIRM_TTL_MS);

  return reply(
    `Bạn có muốn rời voice channel hiện tại không?\n` +
    `Trả lời **yes** để rời, **no** để ở lại.\n` +
    `(Hết hạn sau ${CONFIRM_TTL_MS / 1000}s)`
  );
}

function resolveVoiceNames(client, guildId, channelId) {
  const guild = guildId ? client.guilds?.cache?.get(guildId) : null;
  const channel = guild && channelId ? guild.channels?.cache?.get(channelId) : null;
  return { guild, channel };
}

export async function register({ registerCommand }) {
  registerCommand('voice', {
    category: 'Voice',
    description: 'Voice: xem trạng thái, liệt kê kênh, join/leave',
    usage: '.voice status | .voice list [guild_id] | .voice leave | .voice <channel_id>',
    handler: async ({ args, msg, client, config, reply, stats, logger }) => {
      const sub = (args[0] || '').trim();
      const cmd = sub.toLowerCase();

      // ── Case 0: Read-only — status ──────────────────────
      if (cmd === 'status') {
        const vs = getVoiceState();
        const { guild, channel } = resolveVoiceNames(client, vs.guildId, vs.channelId);

        const lines = [
          'Voice status:',
          `- Connected: ${vs.connected ? 'có' : 'không'}`,
          `- Connecting: ${vs.connecting ? 'có' : 'không'}`,
          `- Status: ${vs.status || 'không có'}`,
          `- Guild: ${guild ? `${guild.name} (${guild.id})` : (vs.guildId || '—')}`,
          `- Channel: ${channel ? `${channel.name} (${channel.id})` : (vs.channelId || '—')}`,
          `- Reconnect attempts: ${vs.reconnectAttempts}`,
        ];
        if (vs.lastError) lines.push(`- Last error: ${vs.lastError}`);

        return reply(lines.join('\n'));
      }

      // ── Case 0b: Read-only — list ───────────────────────
      if (cmd === 'list') {
        const vs = getVoiceState();
        const explicit = (args[1] || '').trim();
        const guildId = explicit || msg?.guild?.id || vs.guildId || null;

        if (!guildId) {
          return reply(
            'Dùng: .voice list <guild_id> (hoặc chạy lệnh trong guild).'
          );
        }

        const guild = client.guilds?.cache?.get(guildId);
        if (!guild) {
          return reply(`Không tìm thấy guild "${guildId}"`);
        }

        const channels = [];
        for (const c of guild.channels?.cache?.values?.() || []) {
          if (!isVoiceChannel(c)) continue;
          if (c.joinable === false) continue;
          channels.push(c);
        }

        if (!channels.length) {
          return reply(`Guild ${guild.name} không có voice channel nào để join.`);
        }

        const lines = [`Voice channels — ${guild.name} (${guild.id})`];
        for (const c of channels.slice(0, LIST_LIMIT)) {
          const mark = c.id === vs.channelId ? ' (hiện tại)' : '';
          lines.push(`- ${c.name} — ${c.id}${mark}`);
        }
        if (channels.length > LIST_LIMIT) {
          lines.push(`... và ${channels.length - LIST_LIMIT} kênh khác`);
        }

        return reply(lines.join('\n'));
      }

      // ── Stream guard: status/list vẫn chạy, join/leave bị chặn
      if (isStreaming()) {
        return reply(STREAM_BLOCK_MSG);
      }

      const vs = getVoiceState();

      // ── Case 1: leave / không có channel ID → confirm ───
      if (cmd === 'leave' || !sub) {
        // Console không có channel để confirm — rời luôn
        if (!msg) {
          if (!vs.connected) {
            return reply('Chưa ở voice channel nào.\nDùng: .voice <channel_id> để tham gia');
          }
          try {
            await leaveVoice({ logger, stats });
            return reply('✓ Đã rời voice');
          } catch (e) {
            return reply(`Lỗi khi rời: ${e.message}`);
          }
        }
        return startLeaveConfirm(vs, msg, reply);
      }

      // ── Case 2: Có channel ID → join ────────────────────
      // Tìm guild chứa channel
      let guild = null;
      let channel = null;

      if (client.guilds?.cache) {
        for (const g of client.guilds.cache.values()) {
          const c = g.channels?.cache?.get?.(sub);
          if (c) {
            guild = g;
            channel = c;
            break;
          }
        }
      }

      if (!guild || !channel) {
        return reply(`Không tìm thấy channel "${sub}"`);
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
