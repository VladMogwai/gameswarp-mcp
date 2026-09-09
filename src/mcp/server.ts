import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchArticles } from '../db/queries.js';
import { fetchGameDetails } from '../steam/details.js';
import { fetchReviewTimeline } from '../steam/histogram.js';
import { AppNotFoundError, fetchNews } from '../steam/news.js';
import { fetchReviews, fetchReviewSummary, WindowTooDeepError } from '../steam/reviews.js';
import { searchGames } from '../steam/search.js';
import { budgeted, isoDay, truncate } from './format.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

/**
 * A failure the model can act on is a result with isError, not a protocol error:
 * the client hands it back to the model, which can adjust and try again. The text
 * is written for that reader, so it says what to do next rather than what broke.
 */
function failed(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function explain(error: unknown, appid: number): ToolResult {
  if (error instanceof AppNotFoundError) {
    return failed(
      `Steam has no app ${appid}. Use search_games to find the right appid by name.`,
    );
  }
  if (error instanceof WindowTooDeepError) {
    return failed(
      `${error.message} Ask for a recent window instead, or use get_review_timeline, ` +
        `which covers the whole history cheaply.`,
    );
  }
  return failed(error instanceof Error ? error.message : String(error));
}

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'gameswarp', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Investigates Steam games through what players actually write. A typical ' +
        'investigation starts with get_review_timeline to find when a rating moved, ' +
        'then get_game_news to find the patch released around that date, then ' +
        'get_reviews for that same window to read what players said. Reviews can ' +
        'only be read for recent windows; older ones are too deep to fetch live.',
    },
  );

  server.registerTool(
    'search_games',
    {
      title: 'Search Steam games',
      description:
        'Find a game on Steam by name and get its appid, which every other tool needs. ' +
        'Matches prefixes ("no man" finds No Man\'s Sky) but not typos. Searching in ' +
        'Russian returns Russian titles.',
      inputSchema: {
        query: z.string().min(1).describe('Game name or the beginning of one'),
        language: z.enum(['en', 'ru']).optional().describe('Language of the returned titles'),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ query, language, limit }) => {
      try {
        const hits = await searchGames(query, { language: language ?? 'en', limit: limit ?? 10 });
        if (hits.length === 0) return failed(`Nothing on Steam matches "${query}".`);
        return ok(
          budgeted(
            hits.map(
              (hit) =>
                `${hit.appid}  ${hit.name}` +
                (hit.metascore === undefined ? '' : `  (metacritic ${hit.metascore})`),
            ),
            'Narrow the query.',
          ),
        );
      } catch (error) {
        return failed(error instanceof Error ? error.message : String(error));
      }
    },
  );

  server.registerTool(
    'get_review_timeline',
    {
      title: 'Rating over time',
      description:
        'Monthly positive and negative review counts for the whole life of a game, plus ' +
        'the last 30 days daily. This is how you find when a rating moved. It is cheap ' +
        'and covers all history, unlike get_reviews.',
      inputSchema: { appid: z.number().int().positive() },
    },
    async ({ appid }) => {
      try {
        const [timeline, summary] = await Promise.all([
          fetchReviewTimeline(appid),
          fetchReviewSummary(appid),
        ]);
        if (timeline.months.length === 0) {
          return failed(
            `App ${appid} has no review history. Either the appid is wrong - check it with ` +
              `search_games - or nobody has reviewed it yet.`,
          );
        }
        const lines = timeline.months.map(
          (point) =>
            `${isoDay(point.date).slice(0, 7)}  ${(point.positiveShare * 100).toFixed(0)}%` +
            `  (+${point.up} / -${point.down})`,
        );
        return ok(
          `Overall: ${summary.totalPositive} positive, ${summary.totalNegative} negative` +
            ` - ${summary.scoreDescription}\n\n` +
            budgeted(lines, 'The full history is monthly and rarely needs trimming.'),
        );
      } catch (error) {
        return explain(error, appid);
      }
    },
  );

  server.registerTool(
    'get_game_news',
    {
      title: 'Patch notes and press',
      description:
        'News Steam holds for a game. Developer announcements are the patch notes, and ' +
        'they carry dates - use them to find which patch landed near a rating change. ' +
        'Press items are third-party articles Steam syndicates.',
      inputSchema: {
        appid: z.number().int().positive(),
        kind: z.enum(['patches', 'press', 'all']).optional(),
        since: z.string().optional().describe('ISO date; only items published after it'),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ appid, kind, since, limit }) => {
      try {
        const sinceDate = since === undefined ? undefined : new Date(since);
        const wanted = kind ?? 'all';
        const items = (await fetchNews(appid))
          .filter((item) => (sinceDate === undefined ? true : item.date >= sinceDate))
          .filter((item) =>
            wanted === 'all'
              ? true
              : wanted === 'patches'
                ? item.source === 'developer'
                : item.source === 'press',
          )
          .slice(0, limit ?? 30);

        if (items.length === 0) return failed(`No ${wanted} news for app ${appid} in that range.`);
        return ok(
          budgeted(
            items.map(
              (item) =>
                `${isoDay(item.date)}  [${item.source}] ${item.title}\n    ${truncate(item.body, 300)}`,
            ),
            'Narrow with `since`, or set kind to "patches".',
          ),
        );
      } catch (error) {
        return explain(error, appid);
      }
    },
  );

  server.registerTool(
    'get_reviews',
    {
      title: 'Player reviews',
      description:
        'Reviews for a game, optionally limited to a date window, sentiment, or players ' +
        'with real time in the game. Only recent windows can be read: Steam offers no way ' +
        'to jump to an old date, so anything more than a few months back fails with a ' +
        'clear message. Use get_review_timeline for old history instead.',
      inputSchema: {
        appid: z.number().int().positive(),
        since: z.string().optional().describe('ISO date, start of the window'),
        until: z.string().optional().describe('ISO date, end of the window'),
        voted_up: z.boolean().optional().describe('true for positive only, false for negative'),
        min_playtime_hours: z
          .number()
          .min(0)
          .optional()
          .describe('Drop reviews by players with less time than this at the moment of writing'),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ appid, since, until, voted_up, min_playtime_hours, limit }) => {
      try {
        const wanted = limit ?? 40;
        const minMinutes = (min_playtime_hours ?? 0) * 60;

        // Steam returns reviews newest first and offers no server-side filter for
        // sentiment or playtime, so filtering happens here. A popular game runs
        // over 90% positive, which means asking for negative reviews needs a far
        // wider scan than the number finally returned.
        const selective = voted_up !== undefined || minMinutes > 0;
        const scanned = await fetchReviews(appid, {
          language: 'en',
          ...(since === undefined ? {} : { since: new Date(since) }),
          ...(until === undefined ? {} : { until: new Date(until) }),
          maxItems: selective ? Math.max(wanted * 25, 500) : wanted * 2,
        });

        const reviews = scanned
          .filter((review) => (voted_up === undefined ? true : review.votedUp === voted_up))
          .filter((review) => (review.playtimeAtReviewMinutes ?? 0) >= minMinutes)
          .slice(0, wanted);

        if (reviews.length === 0) {
          return failed(
            `Scanned ${scanned.length} reviews for app ${appid} and none matched those ` +
              `filters. Widen the window, lower min_playtime_hours, or drop voted_up.`,
          );
        }
        return ok(
          budgeted(
            reviews.map((review) => {
              const hours = Math.round((review.playtimeAtReviewMinutes ?? 0) / 60);
              return (
                `${isoDay(review.postedAt)}  ${review.votedUp ? '+' : '-'}  ${hours}h played\n` +
                `    ${truncate(review.body, 400)}`
              );
            }),
            'Lower `limit`, narrow the window, or raise min_playtime_hours.',
          ),
        );
      } catch (error) {
        return explain(error, appid);
      }
    },
  );

  server.registerTool(
    'search_articles',
    {
      title: 'Search collected press',
      description:
        'Full-text search over gaming press articles collected from outlet feeds. Unlike ' +
        'the Steam tools this covers the industry generally, so it answers what is being ' +
        'written about a game or a topic right now.',
      inputSchema: {
        query: z.string().min(1),
        since_days: z.number().int().min(1).optional().describe('Only articles this recent'),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, since_days, limit }) => {
      try {
        const hits = await searchArticles(query, {
          limit: limit ?? 20,
          ...(since_days === undefined ? {} : { sinceDays: since_days }),
        });
        if (hits.length === 0) return failed(`No collected articles match "${query}".`);
        return ok(
          budgeted(
            hits.map(
              (hit) =>
                `${isoDay(hit.publishedAt)}  [${hit.outlet}] ${hit.title}\n    ${hit.url}` +
                (hit.summary === undefined ? '' : `\n    ${truncate(hit.summary, 220)}`),
            ),
            'Narrow the query or lower `limit`.',
          ),
        );
      } catch (error) {
        return failed(error instanceof Error ? error.message : String(error));
      }
    },
  );

  return server;
}
