import { getJson } from './http.js';

export interface TimelinePoint {
  /** First day of the month for rollups, the day itself for recent points. */
  date: Date;
  up: number;
  down: number;
  positiveShare: number;
}

export interface ReviewTimeline {
  /** Monthly, covering the whole life of the game. */
  months: TimelinePoint[];
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
  };
}

/** The source for locating rating drops: monthly ups and downs since launch. */
export async function fetchReviewTimeline(appid: number): Promise<ReviewTimeline> {
  const response = await getJson<HistogramResponse>(
    `https://store.steampowered.com/appreviewhistogram/${appid}?l=english`,
  );
  return {
    months: (response.results?.rollups ?? []).map(toPoint),
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
