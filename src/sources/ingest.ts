import { saveArticles } from '../db/articles.js';
import { fetchAllSources, SOURCES } from './index.js';
import type { NewsSource } from './types.js';

export interface IngestReport {
  sourceId: string;
  fetched: number;
  inserted: number;
  error: string | undefined;
}

/** Pulls every source and writes what came back. Never throws for one bad source. */
export async function ingestAll(sources: NewsSource[] = SOURCES): Promise<IngestReport[]> {
  const results = await fetchAllSources(sources);
  const byId = new Map(sources.map((source) => [source.id, source]));

  const reports: IngestReport[] = [];
  for (const result of results) {
    const source = byId.get(result.sourceId);
    const inserted =
      source === undefined || result.articles.length === 0
        ? 0
        : await saveArticles(source, result.articles);
    reports.push({
      sourceId: result.sourceId,
      fetched: result.articles.length,
      inserted,
      error: result.error?.message,
    });
  }
  return reports;
}
