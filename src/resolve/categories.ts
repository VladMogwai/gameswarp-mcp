import { query } from '../db/pool.js';
import { linkArticleToGame, saveResolution, upsertGameStub } from '../db/games.js';
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

  const names = await query<{ name: string }>(
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

  const known = new Set(
    (await query<{ name: string }>('select name from name_resolutions')).rows.map((r) => r.name),
  );
  const pending = names.rows.map((r) => r.name).filter((name) => !known.has(name));
  report.alreadyKnown = names.rows.length - pending.length;

  // Each lookup costs a Steam request with a pause between, so a full pass runs
  // for many minutes. Writing after every one would hold a database connection
  // open across those pauses, which is how a hosted database drops it; results
  // are batched instead and flushed periodically so an interrupted run still
  // keeps most of its work.
  let batch: { name: string; appid: number | null; gameName?: string | undefined }[] = [];

  async function flush(): Promise<void> {
    for (const entry of batch) {
      if (entry.appid !== null && entry.gameName !== undefined) {
        await upsertGameStub(entry.appid, entry.gameName);
      }
      await saveResolution(entry.name, entry.appid);
    }
    batch = [];
  }

  let index = 0;
  for (const name of pending) {
    index++;
    const hit = await resolveGameName(name);
    batch.push({
      name,
      appid: hit?.appid ?? null,
      ...(hit === null ? {} : { gameName: hit.name }),
    });
    report.looked_up++;
    if (hit !== null) report.games++;
    if (batch.length >= 25) await flush();
    opts.onProgress?.(index, pending.length);
  }
  await flush();

  const links = await query<{ article_id: string; appid: number }>(
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
