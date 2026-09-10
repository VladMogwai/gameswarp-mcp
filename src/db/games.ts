import { query } from './pool.js';

/**
 * Games arrive as stubs: an appid and a name, learned the moment an article
 * mentions one. Everything else is filled in later, only for games somebody
 * actually asks about, which is why `details_fetched_at` stays null here.
 */
export async function upsertGameStub(appid: number, name: string): Promise<void> {
  await query(
    `insert into games (appid, name) values ($1, $2)
     on conflict (appid) do nothing`,
    [appid, name],
  );
}

export async function linkArticleToGame(
  articleId: number,
  appid: number,
  method: 'category' | 'title' | 'manual',
): Promise<boolean> {
  const result = await query(
    `insert into article_games (article_id, appid, method) values ($1, $2, $3)
     on conflict (article_id, appid) do nothing`,
    [articleId, appid, method],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function loadResolution(
  name: string,
): Promise<{ known: boolean; appid: number | null }> {
  const result = await query<{ appid: number | null }>(
    'select appid from name_resolutions where name = $1',
    [name],
  );
  const row = result.rows[0];
  return row === undefined ? { known: false, appid: null } : { known: true, appid: row.appid };
}

/** A null appid is a real answer, and the useful one: most category tags are not games. */
export async function saveResolution(name: string, appid: number | null): Promise<void> {
  await query(
    `insert into name_resolutions (name, appid) values ($1, $2)
     on conflict (name) do update set appid = excluded.appid, resolved_at = now()`,
    [name, appid],
  );
}

/** Fills in what the store knows, for games that arrived as stubs from an article. */
export async function saveGameDetails(details: {
  appid: number;
  name: string;
  developers: string[];
  publishers: string[];
  releaseDate: Date | undefined;
  genres: string[];
  categories: string[];
  priceCents: number | undefined;
  headerImage: string | undefined;
  capsuleImage: string | undefined;
}): Promise<void> {
  await query(
    `update games set
       name = $2, developer = $3, publisher = $4, release_date = $5,
       genres = $6, categories = $7, price_cents = $8,
       header_image = $9, capsule_image = $10,
       details_fetched_at = now(), updated_at = now()
     where appid = $1`,
    [
      details.appid,
      details.name,
      details.developers[0] ?? null,
      details.publishers[0] ?? null,
      details.releaseDate ?? null,
      details.genres,
      details.categories,
      details.priceCents ?? null,
      details.headerImage ?? null,
      details.capsuleImage ?? null,
    ],
  );
}

export async function gamesMissingDetails(limit: number): Promise<number[]> {
  const result = await query<{ appid: number }>(
    'select appid from games where details_fetched_at is null order by appid limit $1',
    [limit],
  );
  return result.rows.map((row) => row.appid);
}
