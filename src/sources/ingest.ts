import { saveArticles } from '../db/articles.js';
import { loadSourceState, recordFailure, recordSuccess } from '../db/sources.js';
import { SOURCES } from './index.js';
import type { NewsSource, RawArticle } from './types.js';

/**
 * A source can keep answering 200 while quietly publishing nothing: VG247 served
 * a healthy feed whose newest item was three months old. Anything past this is
 * reported as stale so it can be dropped from the feed rather than presented as
 * news.
 */
const STALE_AFTER_DAYS = 3;

export interface IngestReport {
  sourceId: string;
  status: 'updated' | 'unchanged' | 'error';
  fetched: number;
  inserted: number;
  newestItemAt: Date | undefined;
  stale: boolean;
  error: string | undefined;
}

function newest(articles: RawArticle[]): Date | undefined {
  let latest: Date | undefined;
  for (const article of articles) {
    if (latest === undefined || article.publishedAt > latest) latest = article.publishedAt;
  }
  return latest;
}

function isStale(newestItemAt: Date | undefined): boolean {
  if (newestItemAt === undefined) return false;
  return Date.now() - newestItemAt.getTime() > STALE_AFTER_DAYS * 86_400_000;
}

async function ingestOne(source: NewsSource): Promise<IngestReport> {
  const state = await loadSourceState(source.id);
  try {
    const result = await source.fetch({
      etag: state?.etag,
      lastModified: state?.lastModified,
    });

    const newestItemAt = newest(result.articles) ?? state?.newestItemAt;
    const inserted = result.articles.length === 0 ? 0 : await saveArticles(source, result.articles);

    await recordSuccess(source.id, {
      etag: result.etag,
      lastModified: result.lastModified,
      newestItemAt: newest(result.articles),
      status: result.notModified ? 'unchanged' : 'updated',
    });

    return {
      sourceId: source.id,
      status: result.notModified ? 'unchanged' : 'updated',
      fetched: result.articles.length,
      inserted,
      newestItemAt,
      stale: isStale(newestItemAt),
      error: undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordFailure(source.id, message);
    return {
      sourceId: source.id,
      status: 'error',
      fetched: 0,
      inserted: 0,
      newestItemAt: state?.newestItemAt,
      stale: isStale(state?.newestItemAt),
      error: message,
    };
  }
}

/** One tick over every source. A failing source never costs us the others. */
export async function ingestAll(sources: NewsSource[] = SOURCES): Promise<IngestReport[]> {
  return Promise.all(sources.map(ingestOne));
}
