import { resume as resumeMusic, pause as pauseMusic, getMusicState } from '../../music.js';
import { AudioPlayerStatus } from '@discordjs/voice';

export async function register({ registerCommand }) {
  registerCommand('resume', {
    category: 'Music',
    description: 'Tiếp tục / Tạm dừng nhạc',
    usage: '.resume',
    handler: async ({ reply, logger }) => {
      const st = getMusicState();
      if (!st) return reply('Không có nhạc');

      const status = st.player.state.status;

      if (status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused) {
        if (resumeMusic({ logger })) reply('▶ Tiếp tục');
        else reply('Không resume được');
      } else if (status === AudioPlayerStatus.Playing) {
        if (pauseMusic({ logger })) reply('⏸ Tạm dừng');
        else reply('Không pause được');
      } else {
        reply('Không có nhạc đang phát');
      }
    },
  });
}