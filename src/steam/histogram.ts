import { getJson } from './http.js';

export type Granularity = 'week' | 'month';

export interface TimelinePoint {
  /** First day of the bucket: a month or a week, depending on granularity. */
  date: Date;
  up: number;
  down: number;
  positiveShare: number;
}

export interface ReviewTimeline {
  /**
   * The whole life of the game, in buckets Steam chose. Games with years of
   * history come back monthly; anything newer comes back weekly, and treating
   * the two the same collapses weeks into a month that never existed.
   */
  buckets: TimelinePoint[];
  granularity: Granularity;
  /** Daily, the last 30 days. */
  recentDays: TimelinePoint[];
}

interface RawPoint {
  date: number;
  recommendations_up: number;
  recommendations_down: number;
}

interface HistogramResponse {
  results?: {
    rollups?: RawPoint[];
    recent?: RawPoint[];
    rollup_type?: string;
  };
}

/** The source for locating rating drops: ups and downs bucketed since launch. */
export async function fetchReviewTimeline(appid: number): Promise<ReviewTimeline> {
  const response = await getJson<HistogramResponse>(
    `https://store.steampowered.com/appreviewhistogram/${appid}?l=english`,
  );
  const declared = response.results?.rollup_type;
  return {
    buckets: (response.results?.rollups ?? []).map(toPoint),
    granularity: declared === 'week' ? 'week' : 'month',
    recentDays: (response.results?.recent ?? []).map(toPoint),
  };
}

function toPoint(raw: RawPoint): TimelinePoint {
  const total = raw.recommendations_up + raw.recommendations_down;
  return {
    date: new Date(raw.date * 1000),
    up: raw.recommendations_up,
    down: raw.recommendations_down,
    positiveShare: total === 0 ? 0 : raw.recommendations_up / total,
  };
}
