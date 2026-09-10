// Builds the patch-drop eval dataset from Steam and writes it to evals/datasets.
// Run with: node scripts/build-dataset.mjs
import { writeFileSync } from 'node:fs';
import { buildCases } from '../dist/evals/patch-drops.js';
import { query, closePool } from '../dist/db/pool.js';

// Long-lived games, where a decade of history gives drops something to be
// measured against. Games we learned about from this week's articles are mostly
// new releases with no history at all.
const SEED = [
  [275850, "No Man's Sky"], [1091500, 'Cyberpunk 2077'], [1245620, 'ELDEN RING'],
  [892970, 'Valheim'], [1086940, "Baldur's Gate 3"], [730, 'Counter-Strike 2'],
  [271590, 'Grand Theft Auto V'], [413150, 'Stardew Valley'], [322330, "Don't Starve Together"],
  [252490, 'Rust'], [304930, 'Unturned'], [739630, 'Phasmophobia'],
  [1174180, 'Red Dead Redemption 2'], [578080, 'PUBG: BATTLEGROUNDS'], [1938090, 'Call of Duty'],
  [230410, 'Warframe'], [381210, 'Dead by Daylight'], [582010, 'Monster Hunter: World'],
  [1085660, 'Destiny 2'], [359550, 'Rainbow Six Siege'], [440, 'Team Fortress 2'],
  [292030, 'The Witcher 3'], [1063730, 'New World'], [1517290, 'Battlefield 2042'],
  [686810, 'Hell Let Loose'], [648800, 'Raft'], [105600, 'Terraria'],
  [242760, 'The Forest'], [1145360, 'Hades'], [227300, 'Euro Truck Simulator 2'],
];

const names = new Map(SEED.map(([id, name]) => [id, name]));
const { cases, rejected } = await buildCases(SEED.map(([id]) => id), names);

console.log(`случаев: ${cases.length}, отброшено: ${rejected.length}\n`);
for (const c of cases) {
  console.log(`  ${c.game.padEnd(26)} ${c.month}  ${c.shareBefore}% -> ${c.shareAfter}%  (${c.reviewsInMonth} отз.)`);
  console.log(`  ${' '.repeat(26)} ${c.patchDate}  ${c.patchTitle.slice(0, 60)}`);
}

const reasons = {};
for (const r of rejected) reasons[r.reason.replace(/\d+/g, 'N')] = (reasons[r.reason.replace(/\d+/g, 'N')] ?? 0) + 1;
console.log('\nпричины отбраковки:', JSON.stringify(reasons));

writeFileSync('evals/datasets/patch-drops.json', JSON.stringify(cases, null, 2) + '\n');
console.log(`\nзаписано в evals/datasets/patch-drops.json`);
await closePool();
