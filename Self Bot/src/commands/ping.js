export async function register({ registerCommand }) {
  registerCommand('ping', {
    category: 'System',
    description: 'Xem ping',
    usage: '.ping',
    handler: async ({ client, reply }) => {
      const p = client?.ws?.ping ?? 0;
      const emoji = p < 100 ? '🟢' : p < 250 ? '🟡' : '🔴';
      reply(`${emoji} Ping: ${p}ms`);
    },
  });
}