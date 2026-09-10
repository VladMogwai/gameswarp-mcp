import { fetchReviewTimeline } from '../steam/histogram.js';
import { AppNotFoundError, fetchNews } from '../steam/news.js';

export interface PatchDropCase {
  appid: number;
  game: string;
  /** The month the rating fell, as YYYY-MM. */
  month: string;
  shareBefore: number;
  shareAfter: number;
  reviewsInMonth: number;
  /** Ground truth: the developer announcement nearest the fall. */
  patchDate: string;
  patchTitle: string;
}

const MIN_DROP = 0.08;
const MIN_REVIEWS = 300;
const PATCH_WINDOW_DAYS = 21;

/**
 * Builds cases where a rating fell and exactly one developer announcement sits
 * near the fall. The single-patch requirement is what makes the answer checkable:
 * with two updates in the same window there is no fact to be right about, only an
 * opinion about which mattered more.
 */
export async function buildCases(appids: number[], names: Map<number, string>): Promise<{
  cases: PatchDropCase[];
  rejected: { appid: number; reason: string }[];
}> {
  const cases: PatchDropCase[] = [];
  const rejected: { appid: number; reason: string }[] = [];

  for (const appid of appids) {
    try {
      const timeline = await fetchReviewTimeline(appid);
      const months = timeline.buckets;
      if (months.length < 6) {
        rejected.push({ appid, reason: 'too little history' });
        continue;
      }

      const drops = months
        .map((point, index) => ({ point, previous: months[index - 1] }))
        .filter(
          (entry) =>
            entry.previous !== undefined &&
            entry.point.up + entry.point.down >= MIN_REVIEWS &&
            entry.previous.positiveShare - entry.point.positiveShare >= MIN_DROP,
        );

      if (drops.length === 0) {
        rejected.push({ appid, reason: 'no drop that large' });
        continue;
      }

      const news = await fetchNews(appid);
      const patches = news.filter((item) => item.source === 'developer');

      for (const drop of drops) {
        const month = drop.point.date;
        const windowStart = new Date(month.getTime() - PATCH_WINDOW_DAYS * 86_400_000);
        const windowEnd = new Date(month.getTime() + 31 * 86_400_000);
        const near = patches.filter((item) => item.date >= windowStart && item.date < windowEnd);

        if (near.length !== 1) {
          rejected.push({
            appid,
            reason: `${near.length} patches near ${month.toISOString().slice(0, 7)}`,
          });
          continue;
        }
        const patch = near[0]!;
        cases.push({
          appid,
          game: names.get(appid) ?? String(appid),
          month: month.toISOString().slice(0, 7),
          shareBefore: Number((drop.previous!.positiveShare * 100).toFixed(1)),
          shareAfter: Number((drop.point.positiveShare * 100).toFixed(1)),
          reviewsInMonth: drop.point.up + drop.point.down,
          patchDate: patch.date.toISOString().slice(0, 10),
          patchTitle: patch.title,
        });
      }
    } catch (error) {
      rejected.push({
        appid,
        reason: error instanceof AppNotFoundError ? 'unknown app' : String(error).slice(0, 60),
      });
    }
  }

  return { cases, rejected };
}
