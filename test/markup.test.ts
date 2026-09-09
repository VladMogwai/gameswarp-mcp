import { describe, expect, it } from 'vitest';
import { stripMarkup } from '../src/steam/markup.js';

describe('stripMarkup', () => {
  it('strips BBCode from developer posts, separating paragraphs with a blank line', () => {
    expect(stripMarkup('[p]Hello,[/p][p]World[/p]')).toBe('Hello,\n\nWorld');
  });

  it('unwraps BBCode links to their text', () => {
    expect(stripMarkup('see the [url="https://x.dev"]Voyagers[/url] update')).toBe(
      'see the Voyagers update',
    );
  });

  it('strips HTML from press articles', () => {
    expect(stripMarkup('<strong>Light No Fire</strong> from <a href="#">Hello Games</a>')).toBe(
      'Light No Fire from Hello Games',
    );
  });

  it('decodes html entities, including numeric ones', () => {
    expect(stripMarkup('Sean&nbsp;Murray &amp; co&#39;s &quot;jump&quot;')).toBe(
      "Sean Murray & co's \"jump\"",
    );
  });

  it('collapses redundant blank lines and spaces', () => {
    expect(stripMarkup('[p]a[/p][p][/p][p][/p][p]b[/p]')).toBe('a\n\nb');
  });

  it('handles an empty string', () => {
    expect(stripMarkup('')).toBe('');
  });
});
