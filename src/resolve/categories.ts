import { pool } from '../db/pool.js';
import { linkArticleToGame, loadResolution, saveResolution, upsertGameStub } from '../db/games.js';
import { SOURCES } from '../sources/index.js';
import { resolveGameName } from '../steam/search.js';

export interface ResolveReport {
  distinctNames: number;
  alreadyKnown: number;
  looked_up: number;
  games: number;
  links: number;
}

/**
 * Eurogamer and Rock Paper Shotgun list the game among an article's categories,
 * mixed in with platform, genre, studio and perspective tags. Deciding which is
 * which is one Steam search per distinct string - so the answers are cached,
 * including the negative ones. "PC" and "Single Player" are looked up once each
 * and never again; across the current corpus that turns 4,077 lookups into 544.
 */
export async function resolveCategories(
  opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<ResolveReport> {
  const sourceIds = SOURCES.filter((s) => s.gameNamesInCategories).map((s) => s.id);

  const names = await pool.query<{ name: string }>(
    `select distinct jsonb_array_elements_text(categories) as name
     from articles where source_id = any($1)`,
    [sourceIds],
  );

  const report: ResolveReport = {
    distinctNames: names.rows.length,
    alreadyKnown: 0,
    looked_up: 0,
    games: 0,
    links: 0,
  };

  let index = 0;
  for (const { name } of names.rows) {
    index++;
    const cached = await loadResolution(name);
    if (cached.known) {
      report.alreadyKnown++;
    } else {
      const hit = await resolveGameName(name);
      await saveResolution(name, hit?.appid ?? null);
      report.looked_up++;
      if (hit !== null) {
        await upsertGameStub(hit.appid, hit.name);
        report.games++;
      }
    }
    opts.onProgress?.(index, names.rows.length);
  }

  const links = await pool.query<{ article_id: string; appid: number }>(
    `select a.id::text as article_id, r.appid
     from articles a
     cross join lateral jsonb_array_elements_text(a.categories) as c(name)
     join name_resolutions r on r.name = c.name
     where a.source_id = any($1) and r.appid is not null`,
    [sourceIds],
  );
  for (const row of links.rows) {
    if (await linkArticleToGame(Number(row.article_id), row.appid, 'category')) report.links++;
  }

  return report;
}
