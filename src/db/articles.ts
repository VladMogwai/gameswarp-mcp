import { pool } from './pool.js';
import type { LanguageCode } from '../config/languages.js';
import type { RawArticle } from '../sources/types.js';

const COLUMNS = 8;

/**
 * Sources re-serve the same items on every poll, so the write must be
 * idempotent. Conflicting rows are left alone rather than updated: an edited
 * headline is not worth losing the original we already resolved to a game.
 *
 * Returns how many rows were actually new.
 */
export async function saveArticles(
  source: { id: string; outlet: string; language: LanguageCode },
  articles: RawArticle[],
): Promise<number> {
  if (articles.length === 0) return 0;

  const values: unknown[] = [];
  const rows = articles.map((article, index) => {
    values.push(
      article.guid,
      source.id,
      source.outlet,
      article.url,
      article.title,
      article.summary ?? null,
      article.publishedAt,
      source.language,
    );
    const offset = index * COLUMNS;
    const placeholders = Array.from({ length: COLUMNS }, (_, i) => `$${offset + i + 1}`);
    return `(${placeholders.join(', ')}, $${articles.length * COLUMNS + index + 1}::jsonb)`;
  });
  for (const article of articles) values.push(JSON.stringify(article.categories));

  const result = await pool.query(
    `insert into articles
       (guid, source_id, outlet, url, title, summary, published_at, language, categories)
     values ${rows.join(', ')}
     on conflict (guid) do nothing`,
    values,
  );
  return result.rowCount ?? 0;
}

export async function countArticles(): Promise<number> {
  const result = await pool.query<{ count: string }>('select count(*)::text from articles');
  return Number(result.rows[0]?.count ?? 0);
}
