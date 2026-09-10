// Caches rating history for the games the press is currently writing about, so a
// game page renders without waiting on Steam. Run with: node scripts/fill-timelines.mjs
import { gamesDiscussed } from '../dist/db/queries.js';
import { saveTimeline } from '../dist/db/analyses.js';
import { fetchReviewTimeline } from '../dist/steam/histogram.js';
import { closePool } from '../dist/db/pool.js';

const games = await gamesDiscussed(30, Number(process.argv[2] ?? 20));
console.log(`games: ${games.length}\n`);

for (const game of games) {
  try {
    const timeline = await fetchReviewTimeline(game.appid);
    await saveTimeline(game.appid, timeline.months);
    console.log(`  ${game.name.padEnd(34)} ${String(timeline.months.length).padStart(3)} months`);
  } catch (error) {
    console.log(`  ${game.name.padEnd(34)} skipped: ${String(error).slice(0, 50)}`);
  }
}
await closePool();
