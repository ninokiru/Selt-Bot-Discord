const REPLY_MAX = 1900;
const CATEGORY_ORDER = ['System', 'Voice', 'Utility'];
const TRUNC_HINT = '\n... Dùng .cmd <name> để xem chi tiết.';

function aliasText(def) {
  const aliases = Array.isArray(def.aliases) ? def.aliases.filter(Boolean) : [];
  return aliases.map((a) => `.${a}`).join(', ');
}

function groupCommands(list) {
  const groups = new Map();
  for (const item of list) {
    const category = item.category || 'Khác';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }

  const known = CATEGORY_ORDER.filter((category) => groups.has(category));
  const extra = [...groups.keys()]
    .filter((category) => !CATEGORY_ORDER.includes(category))
    .sort((a, b) => a.localeCompare(b));

  return [...known, ...extra].map((category) => ({
    category,
    items: groups.get(category).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

function fitReply(text) {
  if (text.length < REPLY_MAX) return text;

  let cut = text.slice(0, REPLY_MAX - 1 - TRUNC_HINT.length);
  const nl = cut.lastIndexOf('\n');
  if (nl > 0) cut = cut.slice(0, nl);
  return (cut + TRUNC_HINT).slice(0, REPLY_MAX - 1);
}

function formatDetails(found) {
  const def = found.def;
  const aliases = aliasText(def);

  return [
    `Lệnh .${found.name}`,
    `Category: ${def.category || 'Khác'}`,
    `Usage: ${def.usage || `.${found.name}`}`,
    `Aliases: ${aliases || '(không có)'}`,
    `Hidden: ${found.hidden ? 'có' : 'không'}`,
    `Mô tả: ${def.description || '(không có)'}`,
  ].join('\n');
}

export async function register({ registerCommand }) {
  registerCommand('cmd', {
    category: 'System',
    description: 'Xem tất cả lệnh',
    usage: '.cmd [name]',
    handler: async ({ args, reply }) => {
      const { getVisibleCommands, findCommand, findClosestCommand } = await import('./index.js');

      const query = (Array.isArray(args) ? args.join(' ') : '').trim().replace(/^\./, '');

      if (query) {
        const found = findCommand(query);
        if (!found) {
          const suggestion = findClosestCommand(query);
          const lines = [`Không tìm thấy lệnh "${query}". Dùng .cmd để xem danh sách.`];
          if (suggestion) lines.push(`Có phải ý bạn là .${suggestion}?`);
          return reply(lines.join('\n'));
        }
        return reply(formatDetails(found));
      }

      const list = getVisibleCommands();
      const lines = [`Lệnh (${list.length}):`];

      for (const group of groupCommands(list)) {
        lines.push(`[${group.category}]`);
        for (const item of group.items) {
          const aliases = aliasText(item);
          lines.push(
            `  .${item.name}${aliases ? ` (${aliases})` : ''} — ${item.description || '(không có)'}`
          );
        }
      }

      return reply(fitReply(lines.join('\n')));
    },
  });
}
