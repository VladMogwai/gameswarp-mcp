// Explains rating falls and stores the answers, so a page can serve them
// instantly. Usage: node scripts/analyse-drops.mjs [limit] [model]
import { findDrops, analyseDrop, cacheTimeline } from '../dist/analysis/drops.js';
import { gamesDiscussed } from '../dist/db/queries.js';
import { defaultProvider, ollamaProvider } from '../dist/model/index.js';
import { closePool } from '../dist/db/pool.js';

const limit = Number(process.argv[2] ?? 8);

// With no argument the environment decides, so the same script runs against a
// hosted model in CI and a local one on a laptop. Naming a model on the command
// line forces Ollama, which is what you want while iterating.
const forced = process.argv[3];
const provider = forced === undefined ? defaultProvider() : ollamaProvider({ model: forced });

// Drops can only be found in history we hold, so make sure the games currently
// in the news have theirs before looking.
const discussed = await gamesDiscussed(30, 25);
let cached = 0;
for (const game of discussed) {
  try {
    if ((await cacheTimeline(game.appid)) > 0) cached++;
  } catch {
    // A game with no history is not an error, just nothing to explain.
  }
}
console.log(`timelines cached for ${cached}/${discussed.length} games in the news\n`);

const drops = await findDrops(limit);
console.log(`drops to explain: ${drops.length}, model ${provider.id}\n`);

for (const drop of drops) {
  const result = await analyseDrop(drop, { provider });
  const shift = `${(drop.shareBefore * 100).toFixed(0)}%->${(drop.shareAfter * 100).toFixed(0)}%`;
  const period = drop.granularity === 'month' ? drop.bucket.slice(0, 7) : drop.bucket;
  console.log(
    `  ${result.status.padEnd(8)} ${drop.game.slice(0, 28).padEnd(30)} ${period} ${shift.padEnd(11)}` +
      ` ${result.steps} steps ${(result.durationMs / 1000).toFixed(0)}s`,
  );
  if (result.status === 'saved') console.log(`           ${result.answer.replace(/\s+/g, ' ').slice(0, 150)}`);
}
await closePool();
