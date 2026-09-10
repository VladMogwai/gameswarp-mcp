import { fetchReviewTimeline } from '../steam/histogram.js';
import { AppNotFoundError, fetchNews } from '../steam/news.js';

export interface PatchDropCase {
  appid: number;
  game: string;
  /** First day of the bucket that fell. */
  bucket: string;
  granularity: 'week' | 'month';
  shareBefore: number;
  shareAfter: number;
  reviewsInBucket: number;
  /** Ground truth: the developer announcement nearest the fall. */
  patchDate: string;
  patchTitle: string;
}

const MIN_DROP = 0.08;
const MIN_REVIEWS = 300;

/**
 * `feed_type: 1` means the studio published it, not that it changed the game.
 * Under that flag Steam carries patch notes alongside dev blogs, status reports,
 * stream invitations and discount announcements. Treating them all as patches
 * made a sale ("Save 35% on Manor Lords") the correct answer to "which update
 * caused this drop", and marked the agent wrong for naming a real one.
 */
const PATCH_WORDS =
  /\b(update|patch|hotfix|version|v?\d+\.\d+|release[ds]?|now available|out now|launch(es|ed)?|expansion|dlc|season \d)\b/i;

const NOT_PATCH_WORDS =
  /\b(save \d+%|sale|discount|free weekend|dev(eloper)? (blog|diary|update)|status report|devblog|behind the scenes|roadmap|trailer|customer support|sign-?ups?|modathon|stream|q&a|interview|contest|giveaway|survey|wishlist|pre-?order|coming soon|bundle|soundtrack|merch)\b/i;

/**
 * A studio post that plausibly changed the game, rather than talked about it.
 *
 * Titles are all we have, so this is a heuristic and it stays one: "Developer
 * Update" and "Update 3.0" differ by a word. It is deliberately biased towards
 * rejecting - losing a real patch costs a case, keeping a sale announcement
 * makes the eval measure the wrong thing entirely.
 */
export function looksLikePatch(title: string): boolean {
  if (NOT_PATCH_WORDS.test(title)) return false;
  return PATCH_WORDS.test(title);
}

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
      const patches = news.filter(
        (item) => item.source === 'developer' && looksLikePatch(item.title),
      );

      // The window has to follow the bucket. Steam reports weekly for recent
      // games and monthly for old ones, and a month-wide search around a week
      // sweeps in four neighbouring weeks' worth of updates - which is how a
      // case ends up with no single answer to be right about.
      const bucketDays = timeline.granularity === 'week' ? 7 : 31;
      const lead = Math.round(bucketDays * 0.7);

      for (const drop of drops) {
        const start = drop.point.date;
        const windowStart = new Date(start.getTime() - lead * 86_400_000);
        const windowEnd = new Date(start.getTime() + bucketDays * 86_400_000);
        const near = patches.filter((item) => item.date >= windowStart && item.date < windowEnd);

        if (near.length !== 1) {
          rejected.push({
            appid,
            reason: `${near.length} patches near ${start.toISOString().slice(0, 10)}`,
          });
          continue;
        }
        const patch = near[0]!;
        cases.push({
          appid,
          game: names.get(appid) ?? String(appid),
          bucket: start.toISOString().slice(0, 10),
          granularity: timeline.granularity,
          shareBefore: Number((drop.previous!.positiveShare * 100).toFixed(1)),
          shareAfter: Number((drop.point.positiveShare * 100).toFixed(1)),
          reviewsInBucket: drop.point.up + drop.point.down,
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
