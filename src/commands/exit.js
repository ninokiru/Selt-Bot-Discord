export async function register({ registerCommand }) {
  registerCommand('exit', {
    category: 'System',
    description: 'Tắt selfbot',
    usage: '.exit',
    hidden: true,
    handler: async ({ reply }) => {
      await reply('Đang dừng selfbot...');
      if (typeof globalThis.__sbStop === 'function') globalThis.__sbStop();
    },
  });
}