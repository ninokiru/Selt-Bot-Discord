import { getStreamState, startStream, stopStream } from '../stream.js';
import { fmtDur } from '../utils.js';

export async function register({ registerCommand }) {
  registerCommand('stream', {
    category: 'Voice',
    description: 'Go Live — stream màn hình vào voice channel',
    usage: '.stream [channel_id] | .stream status | .stream stop',
    handler: async ({ args, client, config, logger, stats, reply }) => {
      const sub = (args[0] || '').trim();
      const cmd = sub.toLowerCase();

      if (cmd === 'status') {
        const st = getStreamState();
        const lines = ['Stream status:'];
        lines.push(`- Active: ${st.active ? 'có' : 'không'}`);
        lines.push(`- Starting: ${st.starting ? 'có' : 'không'}`);
        lines.push(`- Guild: ${st.guildName || st.guildId || '—'}`);
        lines.push(`- Channel: ${st.channelName || st.channelId || '—'}`);
        lines.push(`- Viewers: ${st.viewerCount}`);
        if (st.active && st.startedAt) {
          lines.push(`- Duration: ${fmtDur((Date.now() - st.startedAt) / 1000)}`);
        }
        if (st.lastError) lines.push(`- Last error: ${st.lastError}`);
        return reply(lines.join('\n'));
      }

      if (cmd === 'stop') {
        const st = getStreamState();
        if (!st.active && !st.starting) {
          return reply('Chưa stream.');
        }
        await stopStream({ client, config, logger, stats });
        return reply('✓ Đã dừng stream');
      }

      const res = await startStream({
        client,
        channelId: sub,
        config,
        logger,
        stats,
      });

      reply(`✓ Đang stream màn hình vào ${res.channelName} (${res.guildName})`);
    },
  });
}
