export async function register({ registerCommand }) {
  registerCommand('cmd', {
    category: 'System',
    description: 'Xem tất cả lệnh',
    usage: '.cmd',
    handler: async ({ reply }) => {
      const { getVisibleCommands } = await import('./index.js');
      const list = getVisibleCommands();

      const lines = list.map((def) => {
        const usage = (def.usage || `.${def.name || '?'}`).padEnd(34);
        return `  ${usage} ${def.description || ''}`;
      });

      reply(`Lệnh (${list.length}):\n${lines.join('\n')}`);
    },
  });
}