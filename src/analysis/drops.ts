import { runAgent } from '../agent/loop.js';
import { loadAnalyses, saveAnalysis, saveTimeline } from '../db/analyses.js';
import { query } from '../db/pool.js';
import { defaultProvider, type ModelProvider } from '../model/index.js';
import { fetchReviewTimeline } from '../steam/histogram.js';
import { DEFAULT_LANGUAGE, type LanguageCode } from '../config/languages.js';

export interface Drop {
  appid: number;
  game: string;
  /** First day of the bucket that fell. */
  bucket: string;
  granularity: 'week' | 'month';
  shareBefore: number;
  shareAfter: number;
  reviews: number;
}

const MIN_DROP = 0.05;
const MIN_REVIEWS = 200;

/**
 * Rating falls worth explaining, newest first. The threshold is higher than the
 * one the page draws with: a page can afford to show a small dip, an analysis
 * costs a minute of model time and should be spent on something real.
 */
export async function findDrops(limit = 20): Promise<Drop[]> {
  const rows = await query<{
    appid: number;
    name: string;
    bucket: string;
    granularity: 'week' | 'month';
    up: number;
    down: number;
    prev_up: number;
    prev_down: number;
  }>(
    `with t as (
       select c.appid, g.name, c.bucket, c.granularity, c.up, c.down,
              lag(c.up) over w as prev_up,
              lag(c.down) over w as prev_down
       from review_timeline_cache c
       join games g on g.appid = c.appid
       window w as (partition by c.appid order by c.bucket)
     )
     select * from t
     where prev_up is not null
       and up + down >= $1
       and prev_up + prev_down > 0
       and (prev_up::float / (prev_up + prev_down)) - (up::float / (up + down)) >= $2
     order by bucket desc
     limit $3`,
    [MIN_REVIEWS, MIN_DROP, limit],
  );

  return rows.rows.map((row) => ({
    appid: row.appid,
    game: row.name,
    bucket: row.bucket,
    granularity: row.granularity,
    shareBefore: row.prev_up / (row.prev_up + row.prev_down),
    shareAfter: row.up / (row.up + row.down),
    reviews: row.up + row.down,
  }));
}

export interface AnalysisResult {
  drop: Drop;
  status: 'saved' | 'skipped' | 'empty';
  answer: string;
  steps: number;
  durationMs: number;
}

/**
 * Explains a fall and stores the answer. Analyses are written once and served
 * from the row afterwards: a page cannot wait a minute for a model, and for old
 * periods Steam will not serve the reviews at all, so the answer produced here
 * is the only one that will ever exist.
 */
export async function analyseDrop(
  drop: Drop,
  options: { provider?: ModelProvider; language?: LanguageCode; force?: boolean } = {},
): Promise<AnalysisResult> {
  const provider = options.provider ?? defaultProvider();
  const language = options.language ?? DEFAULT_LANGUAGE;
  const periodStart = drop.bucket;

  if (options.force !== true) {
    const existing = await loadAnalyses(drop.appid, language);
    if (existing.some((row) => row.kind === 'drop' && row.periodStart === periodStart)) {
      return { drop, status: 'skipped', answer: '', steps: 0, durationMs: 0 };
    }
  }

  const period =
    drop.granularity === 'month' ? drop.bucket.slice(0, 7) : `the week of ${drop.bucket}`;
  const question =
    `Why did ${drop.game} ratings drop in ${period}? Its Steam appid is ${drop.appid}. ` +
    `Name the update responsible and its date, and say what players complained about.`;

  const run = await runAgent(question, { provider });
  if (run.answer.trim().length === 0) {
    return { drop, status: 'empty', answer: '', steps: run.steps.length, durationMs: run.durationMs };
  }

  await saveAnalysis({
    appid: drop.appid,
    kind: 'drop',
    language,
    periodStart: new Date(periodStart),
    question,
    run,
    model: provider.id,
  });

  return {
    drop,
    status: 'saved',
    answer: run.answer,
    steps: run.steps.length,
    durationMs: run.durationMs,
  };
}

/** Ensures a game's history is cached before drops can be found in it. */
export async function cacheTimeline(appid: number): Promise<number> {
  const timeline = await fetchReviewTimeline(appid);
  await saveTimeline(appid, timeline.buckets, timeline.granularity);
  return timeline.buckets.length;
}
