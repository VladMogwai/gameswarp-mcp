const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1]?.toLowerCase() === 'x'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * В новостях Steam две разные разметки: анонсы разработчика приходят в BBCode
 * ([p], [url="..."]), пресса — в HTML (<strong>, <a>). Чистим обе одним проходом.
 * Блочные теги превращаем в перенос строки, чтобы текст не слипся в одну строку.
 */
export function stripMarkup(raw: string): string {
  return decodeEntities(
    raw
      .replace(/\[\/?(?:p|br|list|\*|h[1-6]|quote|table|tr)\b[^\]]*\]/gi, '\n')
      .replace(/<\/?(?:p|br|div|li|ul|ol|h[1-6]|blockquote|tr)\b[^>]*>/gi, '\n')
      .replace(/\[[^\]\n]{0,200}\]/g, '')
      .replace(/<[^>\n]{0,500}>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
