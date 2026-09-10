// Builds the patch-drop eval dataset and writes it to evals/datasets.
// Game names are resolved to appids through Steam rather than written down: a
// mistyped appid silently produces a case about the wrong game.
// Usage: node scripts/build-dataset.mjs
import { writeFileSync } from 'node:fs';
import { buildCases } from '../dist/evals/patch-drops.js';
import { resolveGameName } from '../dist/steam/search.js';
import { closePool } from '../dist/db/pool.js';

// Games with years of history, where a fall has something to be measured
// against. Deliberately spread across genres, studios and release years so the
// dataset is not a portrait of one kind of game.
const NAMES = [
  "No Man's Sky", 'Cyberpunk 2077', 'ELDEN RING', 'Valheim', "Baldur's Gate 3",
  'Counter-Strike 2', 'Grand Theft Auto V', 'Stardew Valley', "Don't Starve Together",
  'Rust', 'Unturned', 'Phasmophobia', 'Red Dead Redemption 2', 'PUBG: BATTLEGROUNDS',
  'Warframe', 'Dead by Daylight', 'Monster Hunter: World', 'Destiny 2',
  "Tom Clancy's Rainbow Six Siege", 'Team Fortress 2', 'The Witcher 3: Wild Hunt',
  'New World', 'Battlefield 2042', 'Hell Let Loose', 'Raft', 'Terraria', 'The Forest',
  'Hades', 'Euro Truck Simulator 2', 'ARK: Survival Evolved', 'Fallout 76',
  'Crusader Kings III', 'Apex Legends', 'The Sims 4', 'PowerWash Simulator',
  'Old School RuneScape', 'Street Fighter 6', 'Cities: Skylines', 'Cities: Skylines II',
  'Sid Meier’s Civilization VI', 'Total War: WARHAMMER III', 'Football Manager 2024',
  'Deep Rock Galactic', 'Satisfactory', 'Factorio', 'RimWorld', 'Project Zomboid',
  'Slay the Spire', 'Dota 2', 'War Thunder', 'World of Tanks Blitz', 'SCUM',
  'DayZ', 'Squad', 'Insurgency: Sandstorm', 'Sea of Thieves', 'Halo Infinite',
  'Overwatch 2', 'Call of Duty', 'Diablo IV', 'Path of Exile', 'Lost Ark',
  'Elite Dangerous', 'Star Citizen', 'X4: Foundations', 'Kerbal Space Program',
  'Kerbal Space Program 2', 'Stellaris', 'Hearts of Iron IV', 'Europa Universalis IV',
  'Age of Empires IV', 'Company of Heroes 3', 'Total War: PHARAOH',
  'The Elder Scrolls Online', 'Final Fantasy XIV Online', 'Black Desert',
  'Guild Wars 2', 'Albion Online', 'Enshrouded', 'Palworld', 'Helldivers 2',
  'Manor Lords', 'Content Warning', 'Lethal Company', 'Baldur’s Gate 3',
  'Remnant II', 'Starfield', 'Hogwarts Legacy', 'The Day Before', 'Suicide Squad',
  'Dragon’s Dogma 2', 'Tekken 8', 'Persona 3 Reload', 'Like a Dragon: Infinite Wealth',
  'Warhammer 40,000: Darktide', 'Back 4 Blood', 'Evil Dead: The Game',
  'MultiVersus', 'Marvel Rivals', 'THE FINALS', 'XDefiant', 'Concord',
  'Once Human', 'Wuthering Waves', 'Genshin Impact', 'Honkai: Star Rail',
  'Grounded', 'V Rising', 'Core Keeper', 'Vampire Survivors', 'Balatro',
  'Cult of the Lamb', 'Dave the Diver', 'Sons Of The Forest', 'Green Hell',
  'The Long Dark', 'Subnautica', 'Astroneer', 'No More Room in Hell',
  'Garry’s Mod', 'PAYDAY 3', 'PAYDAY 2', 'Killing Floor 2', 'Deceit',
  'Golf With Your Friends', 'Human Fall Flat', 'Overcooked! 2', 'Among Us',
  'Fall Guys', 'Rocket League', 'Brawlhalla', 'Dead Cells', 'Risk of Rain 2',
  'Monster Hunter Rise', 'Nioh 2', 'Sekiro: Shadows Die Twice', 'DARK SOULS III',
  'Cuphead', 'Hollow Knight', 'Celeste', 'Ori and the Will of the Wisps',
];

console.log(`resolving ${NAMES.length} names...`);
const names = new Map();
for (const name of NAMES) {
  const hit = await resolveGameName(name);
  if (hit !== null) names.set(hit.appid, hit.name);
}
console.log(`resolved to ${names.size} distinct appids\n`);

const { cases, rejected } = await buildCases([...names.keys()], names);

console.log(`cases: ${cases.length}, rejected: ${rejected.length}\n`);
for (const c of cases) {
  const period = c.granularity === 'month' ? c.bucket.slice(0, 7) : `week ${c.bucket}`;
  console.log(`  ${c.game.slice(0, 26).padEnd(28)} ${period.padEnd(12)} ${c.shareBefore}% -> ${c.shareAfter}%  ${c.patchDate}  ${c.patchTitle.slice(0, 44)}`);
}

const reasons = {};
for (const r of rejected) {
  const key = r.reason.replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}/g, 'DATE').replace(/^\d+/, 'N');
  reasons[key] = (reasons[key] ?? 0) + 1;
}
console.log('\nrejection reasons:', JSON.stringify(reasons));

writeFileSync('evals/datasets/patch-drops.json', JSON.stringify(cases, null, 2) + '\n');
console.log('\nwritten to evals/datasets/patch-drops.json');
await closePool();
