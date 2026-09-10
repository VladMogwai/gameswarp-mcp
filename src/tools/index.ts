import { z } from 'zod';
import { searchArticles } from '../db/queries.js';
import { fetchReviewTimeline } from '../steam/histogram.js';
import { AppNotFoundError, fetchNews } from '../steam/news.js';
import { fetchReviews, fetchReviewSummary, WindowTooDeepError } from '../steam/reviews.js';
import { searchGames } from '../steam/search.js';
import { budgeted, isoDay, truncate } from '../mcp/format.js';
import { ToolInputError, type Tool } from './types.js';

export { ToolInputError, type Tool } from './types.js';

function jsonSchemaOf(shape: z.ZodRawShape): Record<string, unknown> {
  return z.toJSONSchema(z.object(shape)) as Record<string, unknown>;
}

/** Turns the errors the fetchers raise into text a model can act on. */
function explain(error: unknown, appid: number): never {
  if (error instanceof AppNotFoundError) {
    throw new ToolInputError(
      `Steam has no app ${appid}. Use search_games to find the right appid by name.`,
    );
  }
  if (error instanceof WindowTooDeepError) {
    throw new ToolInputError(
      `${error.message} Ask for a recent window instead, or use get_review_timeline, ` +
        `which covers the whole history cheaply.`,
    );
  }
  throw error;
}

const searchGamesArgs = z.object({
  query: z.string().min(1).describe('Game name or the beginning of one'),
  language: z.enum(['en', 'ru']).optional().describe('Language of the returned titles'),
  limit: z.number().int().min(1).max(20).optional(),
});

const timelineArgs = z.object({
  appid: z.number().int().positive(),
  since: z.string().optional().describe('ISO date; months from here onwards'),
  until: z.string().optional().describe('ISO date; months before this'),
  all_months: z
    .boolean()
    .optional()
    .describe('Return every month. Off by default: only months where the rating moved'),
});

const newsArgs = z.object({
  appid: z.number().int().positive(),
  kind: z.enum(['patches', 'press', 'all']).optional(),
  since: z.string().optional().describe('ISO date; only items published on or after it'),
  until: z.string().optional().describe('ISO date; only items published before it'),
  limit: z.number().int().min(1).max(100).optional(),
});

const reviewsArgs = z.object({
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
});

const articlesArgs = z.object({
  query: z.string().min(1),
  since_days: z.number().int().min(1).optional().describe('Only articles this recent'),
  limit: z.number().int().min(1).max(50).optional(),
});

export const TOOLS: Tool[] = [
  {
    name: 'search_games',
    description:
      'Find a game on Steam by name and get its appid, which every other tool needs. ' +
      "Matches prefixes (\"no man\" finds No Man's Sky) but not typos. Searching in " +
      'Russian returns Russian titles.',
    shape: searchGamesArgs.shape,
    parameters: jsonSchemaOf(searchGamesArgs.shape),
    async run(raw) {
      const { query, language, limit } = searchGamesArgs.parse(raw);
      const hits = await searchGames(query, { language: language ?? 'en', limit: limit ?? 10 });
      if (hits.length === 0) throw new ToolInputError(`Nothing on Steam matches "${query}".`);
      return budgeted(
        hits.map(
          (hit) =>
            `${hit.appid}  ${hit.name}` +
            (hit.metascore === undefined ? '' : `  (metacritic ${hit.metascore})`),
        ),
        'Narrow the query.',
      );
    },
  },

  {
    name: 'get_review_timeline',
    description:
      'Finds when a rating moved. Buckets are monthly for older games and weekly for ' +
      'recent ones - the header says which, so read the labels rather than assuming. ' +
      'By default returns only the buckets where the positive share shifted by 3 points ' +
      'or more, which is what you want when looking for a drop; pass all_months to see ' +
      'every bucket, or since and until to look at one period. Cheap and covers the whole ' +
      'history, unlike get_reviews.',
    shape: timelineArgs.shape,
    parameters: jsonSchemaOf(timelineArgs.shape),
    async run(raw) {
      const args = timelineArgs.parse(raw);
      const { appid } = args;
      try {
        const [timeline, summary] = await Promise.all([
          fetchReviewTimeline(appid),
          fetchReviewSummary(appid),
        ]);
        if (timeline.buckets.length === 0) {
          throw new ToolInputError(
            `App ${appid} has no review history. Either the appid is wrong - check it with ` +
              `search_games - or nobody has reviewed it yet.`,
          );
        }

        const since = args.since === undefined ? undefined : new Date(args.since);
        const until = args.until === undefined ? undefined : new Date(args.until);
        const inWindow = timeline.buckets.filter(
          (point) =>
            (since === undefined || point.date >= since) &&
            (until === undefined || point.date < until),
        );

        // A hundred-odd months of a steady rating is noise that crowds out the
        // question. Unless asked for everything, keep the months that moved and
        // the ones on either side, which is what makes a drop readable.
        const keep = args.all_months === true ? inWindow : notable(inWindow);
        // A week bucket labelled as a month would read as a whole month of data.
        const label = (point: { date: Date }): string =>
          timeline.granularity === 'month' ? isoDay(point.date).slice(0, 7) : isoDay(point.date);
        const lines = keep.map(
          (point) =>
            `${label(point)}  ${(point.positiveShare * 100).toFixed(0)}%` +
            `  (+${point.up} / -${point.down})`,
        );
        const omitted = inWindow.length - keep.length;

        return (
          `Overall: ${summary.totalPositive} positive, ${summary.totalNegative} negative` +
          ` - ${summary.scoreDescription}\n` +
          `${inWindow.length} ${timeline.granularity}s on record` +
          (omitted > 0 ? `, ${omitted} steady ones omitted; pass all_months for every bucket` : '') +
          `\n\n` +
          budgeted(lines, 'Narrow with since and until.')
        );
      } catch (error) {
        if (error instanceof ToolInputError) throw error;
        return explain(error, appid);
      }
    },
  },

  {
    name: 'get_game_news',
    description:
      'News Steam holds for a game. Developer announcements are the patch notes, and ' +
      'they carry dates - use them to find which patch landed near a rating change. ' +
      'Press items are third-party articles Steam syndicates. Pass both since and until ' +
      'to look at one period: with since alone you get everything up to today, newest first.',
    shape: newsArgs.shape,
    parameters: jsonSchemaOf(newsArgs.shape),
    async run(raw) {
      const { appid, kind, since, until, limit } = newsArgs.parse(raw);
      try {
        const sinceDate = since === undefined ? undefined : new Date(since);
        const untilDate = until === undefined ? undefined : new Date(until);
        const wanted = kind ?? 'all';
        const items = (await fetchNews(appid))
          .filter((item) => (sinceDate === undefined ? true : item.date >= sinceDate))
          .filter((item) => (untilDate === undefined ? true : item.date < untilDate))
          .filter((item) =>
            wanted === 'all'
              ? true
              : wanted === 'patches'
                ? item.source === 'developer'
                : item.source === 'press',
          )
          .slice(0, limit ?? 30);

        if (items.length === 0) {
          throw new ToolInputError(
            `No ${wanted} news for app ${appid} in that range. Steam keeps only what the ` +
              `developer published, so an old window may genuinely be empty; widen it or drop kind.`,
          );
        }
        return budgeted(
          items.map(
            (item) =>
              `${isoDay(item.date)}  [${item.source}] ${item.title}\n    ${truncate(item.body, 300)}`,
          ),
          'Narrow with `since` and `until`, or set kind to "patches".',
        );
      } catch (error) {
        if (error instanceof ToolInputError) throw error;
        return explain(error, appid);
      }
    },
  },

  {
    name: 'get_reviews',
    description:
      'Reviews for a game, optionally limited to a date window, sentiment, or players ' +
      'with real time in the game. Only recent windows can be read: Steam offers no way ' +
      'to jump to an old date, so anything more than a few months back fails with a ' +
      'clear message. Use get_review_timeline for old history instead.',
    shape: reviewsArgs.shape,
    parameters: jsonSchemaOf(reviewsArgs.shape),
    async run(raw) {
      const args = reviewsArgs.parse(raw);
      const { appid } = args;
      try {
        const wanted = args.limit ?? 40;
        const minMinutes = (args.min_playtime_hours ?? 0) * 60;
        const selective = args.voted_up !== undefined || minMinutes > 0;

        const scanned = await fetchReviews(appid, {
          language: 'en',
          ...(args.since === undefined ? {} : { since: new Date(args.since) }),
          ...(args.until === undefined ? {} : { until: new Date(args.until) }),
          maxItems: selective ? Math.max(wanted * 25, 500) : wanted * 2,
        });

        const reviews = scanned
          .filter((review) => (args.voted_up === undefined ? true : review.votedUp === args.voted_up))
          .filter((review) => (review.playtimeAtReviewMinutes ?? 0) >= minMinutes)
          .slice(0, wanted);

        if (reviews.length === 0) {
          throw new ToolInputError(
            `Scanned ${scanned.length} reviews for app ${appid} and none matched those ` +
              `filters. Widen the window, lower min_playtime_hours, or drop voted_up.`,
          );
        }
        return budgeted(
          reviews.map((review) => {
            const hours = Math.round((review.playtimeAtReviewMinutes ?? 0) / 60);
            return (
              `${isoDay(review.postedAt)}  ${review.votedUp ? '+' : '-'}  ${hours}h played\n` +
              `    ${truncate(review.body, 400)}`
            );
          }),
          'Lower `limit`, narrow the window, or raise min_playtime_hours.',
        );
      } catch (error) {
        if (error instanceof ToolInputError) throw error;
        return explain(error, appid);
      }
    },
  },

  {
    name: 'search_articles',
    description:
      'Full-text search over gaming press articles collected from outlet feeds. Unlike ' +
      'the Steam tools this covers the industry generally, so it answers what is being ' +
      'written about a game or a topic right now.',
    shape: articlesArgs.shape,
    parameters: jsonSchemaOf(articlesArgs.shape),
    async run(raw) {
      const { query, since_days, limit } = articlesArgs.parse(raw);
      const hits = await searchArticles(query, {
        limit: limit ?? 20,
        ...(since_days === undefined ? {} : { sinceDays: since_days }),
      });
      if (hits.length === 0) throw new ToolInputError(`No collected articles match "${query}".`);
      return budgeted(
        hits.map(
          (hit) =>
            `${isoDay(hit.publishedAt)}  [${hit.outlet}] ${hit.title}\n    ${hit.url}` +
            (hit.summary === undefined ? '' : `\n    ${truncate(hit.summary, 220)}`),
        ),
        'Narrow the query or lower `limit`.',
      );
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

const MOVE_THRESHOLD = 0.03;

/** Months whose positive share shifted from the previous one, plus their neighbours. */
function notable(months: { date: Date; up: number; down: number; positiveShare: number }[]) {
  if (months.length <= 12) return months;
  const keep = new Set<number>([0, months.length - 1]);
  for (let i = 1; i < months.length; i++) {
    const previous = months[i - 1];
    const current = months[i];
    if (previous === undefined || current === undefined) continue;
    if (Math.abs(current.positiveShare - previous.positiveShare) >= MOVE_THRESHOLD) {
      keep.add(i - 1);
      keep.add(i);
      if (i + 1 < months.length) keep.add(i + 1);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => months[i]!);
}
