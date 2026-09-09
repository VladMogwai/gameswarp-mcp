/**
 * Every tool result competes for the model's context. A tool that returns
 * everything it found is worse than one that returns less and says so: the
 * model loses room to reason and gets no signal that it should narrow the query.
 */
export const MAX_RESPONSE_CHARS = 20_000;

export function budgeted(lines: string[], hint: string): string {
  const kept: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length > MAX_RESPONSE_CHARS) {
      kept.push(
        `\n[${lines.length - kept.length} more items omitted to stay within the response budget. ${hint}]`,
      );
      break;
    }
    kept.push(line);
    size += line.length + 1;
  }
  return kept.join('\n');
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}...`;
}
