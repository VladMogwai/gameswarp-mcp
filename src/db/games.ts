import { pool } from './pool.js';

/**
 * Games arrive as stubs: an appid and a name, learned the moment an article
 * mentions one. Everything else is filled in later, only for games somebody
 * actually asks about, which is why `details_fetched_at` stays null here.
 */
export async function upsertGameStub(appid: number, name: string): Promise<void> {
  await pool.query(
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
  const result = await pool.query(
    `insert into article_games (article_id, appid, method) values ($1, $2, $3)
     on conflict (article_id, appid) do nothing`,
    [articleId, appid, method],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function loadResolution(
  name: string,
): Promise<{ known: boolean; appid: number | null }> {
  const result = await pool.query<{ appid: number | null }>(
    'select appid from name_resolutions where name = $1',
    [name],
  );
  const row = result.rows[0];
  return row === undefined ? { known: false, appid: null } : { known: true, appid: row.appid };
}

/** A null appid is a real answer, and the useful one: most category tags are not games. */
export async function saveResolution(name: string, appid: number | null): Promise<void> {
  await pool.query(
    `insert into name_resolutions (name, appid) values ($1, $2)
     on conflict (name) do update set appid = excluded.appid, resolved_at = now()`,
    [name, appid],
  );
}
