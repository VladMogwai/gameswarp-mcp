import Parser from 'rss-parser';
import { getText } from '../steam/http.js';
import { stripMarkup } from '../steam/markup.js';
import type { LanguageCode } from '../config/languages.js';
import type { NewsSource, RawArticle } from './types.js';

interface RssOptions {
  id: string;
  outlet: string;
  url: string;
  language: LanguageCode;
  gameNamesInCategories: boolean;
}

const parser = new Parser({
  customFields: { item: [['content:encoded', 'contentEncoded']] },
});

interface ParsedItem {
  guid?: string;
  link?: string;
  title?: string;
  contentSnippet?: string;
  content?: string;
  contentEncoded?: string;
  summary?: string;
  isoDate?: string;
  pubDate?: string;
  categories?: unknown;
}

/**
 * Builds a source from any RSS or Atom feed. rss-parser flattens the difference
 * between the two, which is the only real variation among the outlets we read -
 * Polygon serves Atom, the rest serve RSS 2.0.
 *
 * YouTube channel feeds are also RSS, so a channel is added the same way.
 */
export function rssSource(options: RssOptions): NewsSource {
  return {
    id: options.id,
    outlet: options.outlet,
    language: options.language,
    gameNamesInCategories: options.gameNamesInCategories,
    async fetch(): Promise<RawArticle[]> {
      // Feeds change hourly, so the disk cache is bypassed deliberately.
      const xml = await getText(options.url, { cache: false });
      const feed = await parser.parseString(xml);
      return (feed.items as ParsedItem[]).map(toArticle).filter(isUsable);
    },
  };
}

function toArticle(item: ParsedItem): RawArticle {
  const url = item.link ?? '';
  const summary = item.contentSnippet ?? item.summary ?? item.content ?? item.contentEncoded;
  const published = item.isoDate ?? item.pubDate;
  return {
    // Some feeds omit guid; the link is the next most stable identifier.
    guid: item.guid ?? url,
    url,
    title: stripMarkup(item.title ?? ''),
    summary: summary === undefined ? undefined : stripMarkup(summary).slice(0, 2000),
    publishedAt: published === undefined ? new Date() : new Date(published),
    categories: normaliseCategories(item.categories),
  };
}

/** Feeds express categories as strings, or as objects with the text in `_`. */
function normaliseCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const value =
      typeof entry === 'string'
        ? entry
        : typeof entry === 'object' && entry !== null && '_' in entry
          ? String((entry as { _: unknown })._)
          : '';
    const trimmed = value.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return [...new Set(out)];
}

function isUsable(article: RawArticle): boolean {
  return (
    article.guid.length > 0 &&
    article.url.length > 0 &&
    article.title.length > 0 &&
    !Number.isNaN(article.publishedAt.getTime())
  );
}
