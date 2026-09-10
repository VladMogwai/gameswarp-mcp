// Fetches store details for games that arrived as stubs from an article.
// appdetails is the strictest Steam endpoint for request rate, so this runs
// slowly on purpose. Usage: node scripts/fill-details.mjs [limit]
import { gamesMissingDetails, saveGameDetails } from '../dist/db/games.js';
import { fetchGameDetails } from '../dist/steam/details.js';
import { closePool } from '../dist/db/pool.js';

const appids = await gamesMissingDetails(Number(process.argv[2] ?? 40));
console.log(`games without details: ${appids.length}\n`);

let filled = 0;
for (const appid of appids) {
  try {
    const details = await fetchGameDetails(appid);
    await saveGameDetails(details);
    filled++;
    console.log(`  ${String(appid).padStart(8)}  ${details.name.slice(0, 40).padEnd(42)}${details.headerImage ? 'cover' : 'no cover'}`);
  } catch (error) {
    console.log(`  ${String(appid).padStart(8)}  skipped: ${String(error).slice(0, 60)}`);
  }
}
console.log(`\nfilled ${filled}/${appids.length}`);
await closePool();
