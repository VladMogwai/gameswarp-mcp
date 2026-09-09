import { pool } from './pool.js';

export interface ArticleHit {
  id: number;
  outlet: string;
  title: string;
  summary: string | undefined;
  url: string;
  publishedAt: Date;
  categories: string[];
}

interface ArticleRow {
  id: string;
  outlet: string;
  title: string;
  summary: string | null;
  url: string;
  published_at: Date;
  categories: string[];
}

/**
 * Full-text search over collected press articles, newest first among equally
 * relevant hits. Titles are weighted above summaries because outlets put the
 * subject of an article in the headline.
 */
export async function searchArticles(
  query: string,
  opts: { limit?: number; sinceDays?: number } = {},
): Promise<ArticleHit[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const sinceDays = opts.sinceDays ?? 3650;

  const result = await pool.query<ArticleRow>(
    `select id::text, outlet, title, summary, url, published_at,
            coalesce(array(select jsonb_array_elements_text(categories)), '{}') as categories
     from articles
     where published_at > now() - ($3 || ' days')::interval
       and (setweight(to_tsvector('english', title), 'A') ||
            setweight(to_tsvector('english', coalesce(summary, '')), 'B'))
           @@ websearch_to_tsquery('english', $1)
     order by ts_rank(
                setweight(to_tsvector('english', title), 'A') ||
                setweight(to_tsvector('english', coalesce(summary, '')), 'B'),
                websearch_to_tsquery('english', $1)
              ) desc,
              published_at desc
     limit $2`,
    [query, limit, String(sinceDays)],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    outlet: row.outlet,
    title: row.title,
    summary: row.summary ?? undefined,
    url: row.url,
    publishedAt: row.published_at,
    categories: row.categories,
  }));
}
