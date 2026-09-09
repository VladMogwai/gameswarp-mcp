import { getJson } from './http.js';
import { steamCode, type LanguageCode } from '../config/languages.js';

export interface Review {
  recommendationId: string;
  appid: number;
  language: string;
  votedUp: boolean;
  votesUp: number;
  votesFunny: number;
  weightedVoteScore: number | undefined;
  playtimeAtReviewMinutes: number | undefined;
  playtimeForeverMinutes: number | undefined;
  postedAt: Date;
  body: string;
}

export interface ReviewSummary {
  totalReviews: number;
  totalPositive: number;
  totalNegative: number;
  /** Steam's own band: "Overwhelmingly Positive", "Mixed", ... */
  scoreDescription: string;
  score: number;
}

interface RawAuthor {
  playtime_at_review?: number;
  playtime_forever?: number;
}

interface RawReview {
  recommendationid: string;
  author: RawAuthor;
  language: string;
  review: string;
  timestamp_created: number;
  voted_up: boolean;
  votes_up: number;
  votes_funny: number;
  weighted_vote_score: string | number;
}

interface ReviewsResponse {
  success?: number;
  cursor?: string;
  query_summary?: {
    total_reviews?: number;
    total_positive?: number;
    total_negative?: number;
    review_score?: number;
    review_score_desc?: string;
  };
  reviews?: RawReview[];
}

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;

/**
 * Thrown when a date window lies deeper in history than the page budget allows.
 * Steam offers no way to jump to a date: `day_range` silently ignores anything
 * beyond roughly a year, so an old window can only be reached by walking every
 * newer review first. Reaching October 2022 for No Man's Sky means 1,328 pages,
 * about half an hour at a polite pace.
 *
 * The caller gets the numbers rather than an empty array, so it can schedule a
 * background crawl instead of assuming the window is genuinely empty.
 */
export class WindowTooDeepError extends Error {
  constructor(
    readonly appid: number,
    readonly pagesWalked: number,
    readonly oldestReached: Date,
    readonly windowStart: Date,
  ) {
    super(
      `Reviews for app ${appid} before ${oldestReached.toISOString().slice(0, 10)} need ` +
        `more than ${pagesWalked} pages; the window starts at ` +
        `${windowStart.toISOString().slice(0, 10)}. Crawl this game in the background instead.`,
    );
    this.name = 'WindowTooDeepError';
  }
}

function endpoint(appid: number, params: Record<string, string>): string {
  const query = new URLSearchParams({ json: '1', purchase_type: 'all', ...params });
  return `https://store.steampowered.com/appreviews/${appid}?${query.toString()}`;
}

/** Totals and the official rating band, in one request that fetches no review text. */
export async function fetchReviewSummary(
  appid: number,
  opts: { language?: LanguageCode | 'all' } = {},
): Promise<ReviewSummary> {
  const language = opts.language === undefined || opts.language === 'all'
    ? 'all'
    : steamCode(opts.language);
  const response = await getJson<ReviewsResponse>(
    endpoint(appid, { num_per_page: '0', language }),
  );
  const summary = response.query_summary ?? {};
  return {
    totalReviews: summary.total_reviews ?? 0,
    totalPositive: summary.total_positive ?? 0,
    totalNegative: summary.total_negative ?? 0,
    scoreDescription: summary.review_score_desc ?? 'unknown',
    score: summary.review_score ?? 0,
  };
}

/**
 * Steam cannot filter reviews by date, so a date range means walking `recent`
 * backwards until the window is passed. `maxItems` is not a nicety: popular
 * games hold six figures of reviews and an unbounded walk would never finish.
 */
export async function fetchReviews(
  appid: number,
  opts: {
    language?: LanguageCode | 'all';
    since?: Date;
    until?: Date;
    maxItems?: number;
    /** Each page is 100 reviews and one request. Raise it for a background crawl. */
    maxPages?: number;
  } = {},
): Promise<Review[]> {
  const language = opts.language === undefined || opts.language === 'all'
    ? 'all'
    : steamCode(opts.language);
  const maxItems = opts.maxItems ?? 500;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const sinceMs = opts.since?.getTime();
  const untilMs = opts.until?.getTime();

  const collected: Review[] = [];
  let cursor = '*';
  let oldestSeen: Date | undefined;
  const seenCursors = new Set<string>();

  for (let page = 0; page < maxPages; page++) {
    if (seenCursors.has(cursor)) break;
    seenCursors.add(cursor);

    const response = await getJson<ReviewsResponse>(
      endpoint(appid, {
        num_per_page: String(PAGE_SIZE),
        filter: 'recent',
        language,
        cursor,
      }),
    );
    const batch = response.reviews ?? [];
    if (batch.length === 0) break;

    let passedWindow = false;
    for (const raw of batch) {
      const postedMs = raw.timestamp_created * 1000;
      oldestSeen = new Date(postedMs);
      if (sinceMs !== undefined && postedMs < sinceMs) {
        passedWindow = true;
        continue;
      }
      if (untilMs !== undefined && postedMs > untilMs) continue;
      collected.push(normalise(raw, appid));
      if (collected.length >= maxItems) return collected;
    }

    // `recent` is ordered newest first, so once a page falls out of the window
    // every later page will too.
    if (passedWindow) break;
    if (response.cursor === undefined) break;
    cursor = response.cursor;

    const exhausted = page === maxPages - 1;
    const neverReachedWindow = sinceMs !== undefined && collected.length === 0;
    if (exhausted && neverReachedWindow && oldestSeen !== undefined) {
      throw new WindowTooDeepError(appid, maxPages, oldestSeen, new Date(sinceMs));
    }
  }

  return collected;
}

function normalise(raw: RawReview, appid: number): Review {
  const weighted = Number(raw.weighted_vote_score);
  return {
    recommendationId: raw.recommendationid,
    appid,
    language: raw.language,
    votedUp: raw.voted_up,
    votesUp: raw.votes_up,
    votesFunny: raw.votes_funny,
    weightedVoteScore: Number.isFinite(weighted) ? weighted : undefined,
    playtimeAtReviewMinutes: raw.author.playtime_at_review,
    playtimeForeverMinutes: raw.author.playtime_forever,
    postedAt: new Date(raw.timestamp_created * 1000),
    body: raw.review,
  };
}
