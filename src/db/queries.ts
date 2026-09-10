import { query as run } from './pool.js';

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

  const result = await run<ArticleRow>(
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

export interface FeedItem {
  id: number;
  outlet: string;
  title: string;
  summary: string | undefined;
  url: string;
  publishedAt: Date;
  games: { appid: number; name: string; capsuleImage?: string | null }[];
}

/** The front page: what was published lately, with any games we could identify. */
export async function recentArticles(limit = 40): Promise<FeedItem[]> {
  const result = await run<{
    id: string;
    outlet: string;
    title: string;
    summary: string | null;
    url: string;
    published_at: Date;
    games: { appid: number; name: string; capsuleImage?: string | null }[] | null;
  }>(
    `select a.id::text, a.outlet, a.title, a.summary, a.url, a.published_at,
            coalesce(
              (select json_agg(json_build_object(
                 'appid', g.appid, 'name', g.name, 'capsuleImage', g.capsule_image))
               from article_games ag join games g on g.appid = ag.appid
               where ag.article_id = a.id),
              '[]'
            ) as games
     from articles a
     order by a.published_at desc
     limit $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    outlet: row.outlet,
    title: row.title,
    summary: row.summary ?? undefined,
    url: row.url,
    publishedAt: row.published_at,
    games: row.games ?? [],
  }));
}

export interface DiscussedGame {
  appid: number;
  name: string;
  capsuleImage: string | null;
  outlets: number;
  articles: number;
  lastMention: Date;
}

/**
 * Which games the press wrote about, ranked by how many outlets covered them.
 * Outlet count first, because five publications on one subject is a story and
 * five pieces from one publication is a beat.
 */
export async function gamesDiscussed(days = 7, limit = 20): Promise<DiscussedGame[]> {
  const result = await run<{
    appid: number;
    name: string;
    capsule_image: string | null;
    outlets: string;
    articles: string;
    last_mention: Date;
  }>(
    `select g.appid, g.name, g.capsule_image,
            count(distinct a.outlet)::text as outlets,
            count(*)::text as articles,
            max(a.published_at) as last_mention
     from article_games ag
     join games g on g.appid = ag.appid
     join articles a on a.id = ag.article_id
     where a.published_at > now() - ($1 || ' days')::interval
     group by g.appid, g.name, g.capsule_image
     order by count(distinct a.outlet) desc, count(*) desc, max(a.published_at) desc
     limit $2`,
    [String(days), limit],
  );
  return result.rows.map((row) => ({
    appid: row.appid,
    name: row.name,
    capsuleImage: row.capsule_image,
    outlets: Number(row.outlets),
    articles: Number(row.articles),
    lastMention: row.last_mention,
  }));
}

export interface DropAnalysis {
  periodStart: string;
  answer: string;
  model: string;
  createdAt: Date;
}

export interface GamePage {
  appid: number;
  name: string;
  headerImage: string | null;
  /** Keyed by the first day of the bucket the analysis is about. */
  analyses: Record<string, DropAnalysis>;
  buckets: { bucket: string; up: number; down: number; positiveShare: number }[];
  granularity: 'week' | 'month';
  articles: FeedItem[];
}

/**
 * Issued together rather than one after another. The database is a round trip
 * away - well over a hundred milliseconds of it - so three sequential queries
 * cost three times the latency for no reason.
 */
export async function gamePage(appid: number): Promise<GamePage | undefined> {
  const [game, timeline, articles, analyses] = await Promise.all([
    run<{ appid: number; name: string; header_image: string | null }>(
      'select appid, name, header_image from games where appid = $1',
      [appid],
    ),
    run<{ bucket: string; up: number; down: number; granularity: 'week' | 'month' }>(
      'select bucket, up, down, granularity from review_timeline_cache where appid = $1 order by bucket',
      [appid],
    ),
    run<{
      id: string;
      outlet: string;
      title: string;
      summary: string | null;
      url: string;
      published_at: Date;
    }>(
      `select a.id::text, a.outlet, a.title, a.summary, a.url, a.published_at
       from article_games ag join articles a on a.id = ag.article_id
       where ag.appid = $1 order by a.published_at desc limit 20`,
      [appid],
    ),
    run<{ period_start: string; answer: string; model: string; created_at: Date }>(
      `select distinct on (period_start) period_start, answer, model, created_at
       from analyses
       where appid = $1 and kind = 'drop' and language = 'en'
       order by period_start, created_at desc`,
      [appid],
    ),
  ]);

  const found = game.rows[0];
  if (found === undefined) return undefined;

  return {
    appid: found.appid,
    name: found.name,
    headerImage: found.header_image,
    analyses: Object.fromEntries(
      analyses.rows.map((row) => [
        row.period_start,
        {
          periodStart: row.period_start,
          answer: row.answer,
          model: row.model,
          createdAt: row.created_at,
        },
      ]),
    ),
    granularity: timeline.rows[0]?.granularity ?? 'month',
    buckets: timeline.rows.map((row) => {
      const total = row.up + row.down;
      return {
        bucket: row.bucket,
        up: row.up,
        down: row.down,
        positiveShare: total === 0 ? 0 : row.up / total,
      };
    }),
    articles: articles.rows.map((row) => ({
      id: Number(row.id),
      outlet: row.outlet,
      title: row.title,
      summary: row.summary ?? undefined,
      url: row.url,
      publishedAt: row.published_at,
      games: [],
    })),
  };
}
