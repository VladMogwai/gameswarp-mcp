import type { LanguageCode } from '../config/languages.js';

/** One item as a source produced it, before anything resolves it to a game. */
export interface RawArticle {
  /** Stable across re-fetches. Feeds re-serve the same items on every poll. */
  guid: string;
  url: string;
  title: string;
  summary: string | undefined;
  publishedAt: Date;
  /**
   * Whatever the source labels the item with. For some outlets this contains the
   * game name among platform, genre and studio tags; for others only genres.
   */
  categories: string[];
}

/** Validators a source may send back to avoid re-downloading unchanged content. */
export interface FetchContext {
  etag: string | undefined;
  lastModified: string | undefined;
}

export interface FetchResult {
  articles: RawArticle[];
  /** True when the source confirmed nothing changed and sent no content. */
  notModified: boolean;
  etag: string | undefined;
  lastModified: string | undefined;
}

export interface NewsSource {
  /** Unique, stable, and recorded on every row so one source can be re-run. */
  id: string;
  /** Who wrote the article, which is not always who served it. */
  outlet: string;
  language: LanguageCode;
  /**
   * Whether `categories` can contain the game name. False means articles from
   * this source need the game extracted from the headline instead, which is a
   * different mechanism with its own accuracy.
   */
  gameNamesInCategories: boolean;
  fetch(context: FetchContext): Promise<FetchResult>;
}

export interface SourceResult {
  sourceId: string;
  result: FetchResult | undefined;
  error: Error | undefined;
}
