import {
  getSnipe,
  getEditSnipe,
  getAllSnipes,
  getAllEditSnipes,
  findSnipeByUser,
  findEditSnipeByUser,
  clearSnipes,
  getStats,
} from '../snipe.js';
import { fmtDur } from '../utils.js';

const MAX_LIST = 10;

function shortId(id) {
  if (!id) return '?';
  return String(id).slice(-6);
}

function jumpLink(entry) {
  const gid = entry.guildId || '@me';
  return `https://discord.com/channels/${gid}/${entry.channelId}/${entry.messageId}`;
}

function formatAttachments(list) {
  if (!list || !list.length) return '';
  const names = list.map((a) => a.name || 'file').slice(0, 3);
  const extra = list.length > 3 ? ` +${list.length - 3}` : '';
  return `📎 ${names.join(', ')}${extra}`;
}

function formatSnipe(entry, index, total) {
  const durAgo = entry.deletedAt
    ? fmtDur((Date.now() - entry.deletedAt) / 1000) + ' trước'
    : '?';

  const cacheTag = entry.fromCache ? ' {gray-fg}(cached){/gray-fg}' : '';
  const botTag = entry.authorBot ? ' {gray-fg}[BOT]{/gray-fg}' : '';

  const header = `#${index + 1}/${total} — ${entry.authorTag}${botTag} · ${durAgo}${cacheTag}`;

  const lines = [header];

  if (entry.content) {
    const content = entry.content.length > 600
      ? entry.content.slice(0, 597) + '...'
      : entry.content;
    lines.push(`"${content}"`);
  } else {
    lines.push('{gray-fg}(không có text — tin gửi trước khi selfbot cache){/gray-fg}');
  }

  const att = formatAttachments(entry.attachments);
  if (att) lines.push(att);

  if (entry.embeds > 0) lines.push(`📋 ${entry.embeds} embed`);
  if (entry.stickers?.length) lines.push(`🏷️  ${entry.stickers.join(', ')}`);

  if (entry.mentionedUsers?.length) {
    const tags = entry.mentionedUsers.map((u) => `@${u.tag}`).slice(0, 5).join(' ');
    lines.push(`💬 ${tags}`);
  }

  lines.push(`🔗 ${jumpLink(entry)}`);

  return lines.join('\n');
}

function formatEditSnipe(entry, index, total) {
  const durAgo = entry.editedAt
    ? fmtDur((Date.now() - entry.editedAt) / 1000) + ' trước'
    : '?';

  const header = `#${index + 1}/${total} — ${entry.authorTag} · ${durAgo}`;

  const oldC = (entry.oldContent || '').slice(0, 400);
  const newC = (entry.newContent || '').slice(0, 400);

  const lines = [
    header,
    `{gray-fg}Trước:{/gray-fg} "${oldC}"`,
    `{gray-fg}Sau:  {/gray-fg} "${newC}"`,
    `🔗 ${jumpLink(entry)}`,
  ];

  return lines.join('\n');
}

export async function register({ registerCommand }) {
  registerCommand('snipe', {
    category: 'Utility',
    description: 'Xem tin nhắn vừa bị xoá trong channel',
    usage: '.snipe [n | list | stats | clear | @user]',
    handler: async ({ args, msg, client, reply }) => {
      const channelId = msg?.channel?.id;
      if (!channelId) return reply('Không xác định được channel');

      const arg = (args[0] || '').trim();

      // ── .snipe clear ────────────────────────────────────
      if (arg.toLowerCase() === 'clear') {
        clearSnipes(channelId);
        return reply('✓ Đã xoá cache snipe của channel này');
      }

      // ── .snipe stats ────────────────────────────────────
      if (arg.toLowerCase() === 'stats') {
        const st = getStats();
        return reply(
          `Snipe cache:\n` +
          `  Deleted:      ${st.totalDeletes}\n` +
          `  Edited:       ${st.totalEdits}\n` +
          `  From cache:   ${st.fromCacheCount}\n` +
          `  Channels:     ${st.channels}\n` +
          `  Max/channel:  ${st.maxPerChannel}`
        );
      }

      // ── .snipe list ─────────────────────────────────────
      if (arg.toLowerCase() === 'list') {
        const all = getAllSnipes(channelId);
        if (!all.length) return reply('Chưa có tin nào bị xoá trong channel');

        const lines = all.slice(0, MAX_LIST).map((entry, i) => {
          const durAgo = fmtDur((Date.now() - entry.deletedAt) / 1000);
          const content = (entry.content || '(no text)').slice(0, 60);
          return `#${i + 1} ${entry.authorTag} · ${durAgo} trước: "${content}"`;
        });

        return reply(
          `Tin bị xoá (${all.length}/${MAX_LIST}):\n${lines.join('\n')}`
        );
      }

      // ── .snipe @user ────────────────────────────────────
      const userMention = arg.match(/^<@!?(\d+)>$/);
      if (userMention) {
        const userId = userMention[1];
        const entry = findSnipeByUser(channelId, userId);
        if (!entry) return reply(`Không có tin bị xoá của user này trong channel`);

        const all = getAllSnipes(channelId);
        const idx = all.indexOf(entry);
        return reply(formatSnipe(entry, idx >= 0 ? idx : 0, all.length));
      }

      // ── .snipe [n] ──────────────────────────────────────
      const idx = parseInt(arg, 10);
      const index = Number.isFinite(idx) && idx > 0 ? idx - 1 : 0;

      const all = getAllSnipes(channelId);
      if (!all.length) return reply('Không có tin nhắn bị xoá gần đây');

      if (index >= all.length) {
        return reply(`Chỉ có ${all.length} tin bị xoá — không có #${index + 1}`);
      }

      const entry = all[index];
      return reply(formatSnipe(entry, index, all.length));
    },
  });

  registerCommand('editsnipe', {
    category: 'Utility',
    description: 'Xem tin nhắn vừa bị sửa trong channel',
    usage: '.editsnipe [n | list | stats | clear | @user]',
    aliases: ['esnipe'],
    handler: async ({ args, msg, client, reply }) => {
      const channelId = msg?.channel?.id;
      if (!channelId) return reply('Không xác định được channel');

      const arg = (args[0] || '').trim();

      // ── clear ───────────────────────────────────────────
      if (arg.toLowerCase() === 'clear') {
        clearSnipes(channelId);
        return reply('✓ Đã xoá cache editsnipe của channel này');
      }

      // ── stats ───────────────────────────────────────────
      if (arg.toLowerCase() === 'stats') {
        const st = getStats();
        return reply(
          `Edit snipe cache:\n` +
          `  Edited:       ${st.totalEdits}\n` +
          `  Channels:     ${st.channels}\n` +
          `  Max/channel:  ${st.maxPerChannel}`
        );
      }

      // ── list ────────────────────────────────────────────
      if (arg.toLowerCase() === 'list') {
        const all = getAllEditSnipes(channelId);
        if (!all.length) return reply('Chưa có tin nào bị sửa trong channel');

        const lines = all.slice(0, MAX_LIST).map((entry, i) => {
          const durAgo = fmtDur((Date.now() - entry.editedAt) / 1000);
          const oldC = (entry.oldContent || '').slice(0, 40);
          const newC = (entry.newContent || '').slice(0, 40);
          return `#${i + 1} ${entry.authorTag} · ${durAgo} trước: "${oldC}" → "${newC}"`;
        });

        return reply(
          `Tin bị sửa (${all.length}/${MAX_LIST}):\n${lines.join('\n')}`
        );
      }

      // ── @user ───────────────────────────────────────────
      const userMention = arg.match(/^<@!?(\d+)>$/);
      if (userMention) {
        const userId = userMention[1];
        const entry = findEditSnipeByUser(channelId, userId);
        if (!entry) return reply('Không có tin bị sửa của user này trong channel');

        const all = getAllEditSnipes(channelId);
        const idx = all.indexOf(entry);
        return reply(formatEditSnipe(entry, idx >= 0 ? idx : 0, all.length));
      }

      // ── [n] ─────────────────────────────────────────────
      const idx = parseInt(arg, 10);
      const index = Number.isFinite(idx) && idx > 0 ? idx - 1 : 0;

      const all = getAllEditSnipes(channelId);
      if (!all.length) return reply('Không có tin nhắn bị sửa gần đây');

      if (index >= all.length) {
        return reply(`Chỉ có ${all.length} tin bị sửa — không có #${index + 1}`);
      }

      const entry = all[index];
      return reply(formatEditSnipe(entry, index, all.length));
    },
  });
}