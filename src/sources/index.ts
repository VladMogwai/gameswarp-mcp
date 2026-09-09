import { rssSource } from './rss.js';
import type { NewsSource } from './types.js';

/**
 * The registry of news sources. Adding one means adding an entry here; adding a
 * kind of source that is not a feed means writing another factory beside
 * `rssSource` and using it here. Nothing else in the pipeline changes.
 *
 * `gameNamesInCategories` was measured, not guessed: Eurogamer, Rock Paper
 * Shotgun and VG247 list the game among an article's categories, while PC Gamer
 * and GamingOnLinux tag only genres and platforms.
 */
export const SOURCES: NewsSource[] = [
  rssSource({
    id: 'rss:eurogamer',
    outlet: 'Eurogamer',
    url: 'https://www.eurogamer.net/feed',
    language: 'en',
    gameNamesInCategories: true,
  }),
  rssSource({
    id: 'rss:rockpapershotgun',
    outlet: 'Rock Paper Shotgun',
    url: 'https://www.rockpapershotgun.com/feed',
    language: 'en',
    gameNamesInCategories: true,
  }),
  rssSource({
    id: 'rss:vg247',
    outlet: 'VG247',
    url: 'https://www.vg247.com/feed',
    language: 'en',
    gameNamesInCategories: true,
  }),
  rssSource({
    id: 'rss:pcgamer',
    outlet: 'PC Gamer',
    url: 'https://www.pcgamer.com/rss/',
    language: 'en',
    gameNamesInCategories: false,
  }),
  rssSource({
    id: 'rss:pcgamesn',
    outlet: 'PCGamesN',
    url: 'https://www.pcgamesn.com/mainrss.xml',
    language: 'en',
    gameNamesInCategories: false,
  }),
  rssSource({
    id: 'rss:gamingonlinux',
    outlet: 'GamingOnLinux',
    url: 'https://www.gamingonlinux.com/article_rss.php',
    language: 'en',
    gameNamesInCategories: false,
  }),
  rssSource({
    id: 'rss:polygon',
    outlet: 'Polygon',
    url: 'https://www.polygon.com/rss/index.xml',
    language: 'en',
    gameNamesInCategories: false,
  }),
  rssSource({
    id: 'rss:kotaku',
    outlet: 'Kotaku',
    url: 'https://kotaku.com/rss',
    language: 'en',
    gameNamesInCategories: false,
  }),
];

export { type NewsSource, type RawArticle, type SourceResult } from './types.js';
export { rssSource } from './rss.js';

/**
 * Fetches every source. One failing source must not lose the others, so errors
 * are returned per source rather than thrown.
 */
export async function fetchAllSources(sources: NewsSource[] = SOURCES) {
  return Promise.all(
    sources.map(async (source) => {
      try {
        return { sourceId: source.id, articles: await source.fetch(), error: undefined };
      } catch (error) {
        return {
          sourceId: source.id,
          articles: [],
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    }),
  );
}
