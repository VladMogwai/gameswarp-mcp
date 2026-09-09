import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/steam/http.js', () => ({
  getText: vi.fn(async () => FEED),
}));

const { rssSource } = await import('../src/sources/rss.js');

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Example</title>
  <item>
    <title>No Man&apos;s Sky gets a &lt;strong&gt;huge&lt;/strong&gt; update</title>
    <link>https://example.com/a</link>
    <guid isPermaLink="false">example-1</guid>
    <pubDate>Mon, 07 Oct 2024 10:00:00 +0000</pubDate>
    <description>&lt;p&gt;The update lands today.&lt;/p&gt;</description>
    <category>No Man's Sky</category>
    <category>PC</category>
    <category>PC</category>
  </item>
  <item>
    <title>An item with no guid</title>
    <link>https://example.com/b</link>
    <pubDate>Tue, 08 Oct 2024 10:00:00 +0000</pubDate>
  </item>
  <item>
    <title>An item with no link at all</title>
    <pubDate>Wed, 09 Oct 2024 10:00:00 +0000</pubDate>
  </item>
</channel></rss>`;

const source = rssSource({
  id: 'rss:example',
  outlet: 'Example',
  url: 'https://example.com/feed',
  language: 'en',
  gameNamesInCategories: true,
});

describe('rssSource', () => {
  it('exposes the configuration it was built with', () => {
    expect(source.id).toBe('rss:example');
    expect(source.outlet).toBe('Example');
    expect(source.gameNamesInCategories).toBe(true);
  });

  it('strips markup and entities out of titles and summaries', async () => {
    const [first] = await source.fetch();
    expect(first?.title).toBe("No Man's Sky gets a huge update");
    expect(first?.summary).toBe('The update lands today.');
  });

  it('keeps categories, deduplicated', async () => {
    const [first] = await source.fetch();
    expect(first?.categories).toEqual(["No Man's Sky", 'PC']);
  });

  it('parses the publication date', async () => {
    const [first] = await source.fetch();
    expect(first?.publishedAt.toISOString()).toBe('2024-10-07T10:00:00.000Z');
  });

  it('falls back to the link when a feed omits guid', async () => {
    const articles = await source.fetch();
    expect(articles[1]?.guid).toBe('https://example.com/b');
  });

  it('drops items that cannot be identified at all', async () => {
    const articles = await source.fetch();
    expect(articles).toHaveLength(2);
    expect(articles.map((a) => a.title)).not.toContain('An item with no link at all');
  });
});
