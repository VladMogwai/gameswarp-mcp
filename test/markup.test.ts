import { describe, expect, it } from 'vitest';
import { stripMarkup } from '../src/steam/markup.js';

describe('stripMarkup', () => {
  it('убирает BBCode анонсов разработчика, абзацы разделяет пустой строкой', () => {
    expect(stripMarkup('[p]Hello,[/p][p]World[/p]')).toBe('Hello,\n\nWorld');
  });

  it('разворачивает ссылки BBCode в текст', () => {
    expect(stripMarkup('see the [url="https://x.dev"]Voyagers[/url] update')).toBe(
      'see the Voyagers update',
    );
  });

  it('убирает HTML прессы', () => {
    expect(stripMarkup('<strong>Light No Fire</strong> from <a href="#">Hello Games</a>')).toBe(
      'Light No Fire from Hello Games',
    );
  });

  it('декодирует html-сущности, включая числовые', () => {
    expect(stripMarkup('Sean&nbsp;Murray &amp; co&#39;s &quot;jump&quot;')).toBe(
      "Sean Murray & co's \"jump\"",
    );
  });

  it('схлопывает лишние переносы и пробелы', () => {
    expect(stripMarkup('[p]a[/p][p][/p][p][/p][p]b[/p]')).toBe('a\n\nb');
  });

  it('не падает на пустой строке', () => {
    expect(stripMarkup('')).toBe('');
  });
});
