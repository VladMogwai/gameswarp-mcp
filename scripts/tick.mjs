// One scheduled pass: apply migrations, poll every source, resolve new names.
// Safe to run repeatedly - every step is idempotent. Run with: npm run tick
import { migrate } from '../dist/db/migrate.js';
import { ingestAll } from '../dist/sources/ingest.js';
import { resolveCategories } from '../dist/resolve/categories.js';
import { pool } from '../dist/db/pool.js';

const started = Date.now();
let failures = 0;

try {
  await migrate();

  const reports = await ingestAll();
  console.log('\nsources');
  for (const r of reports) {
    const newest = r.newestItemAt ? r.newestItemAt.toISOString().slice(0, 10) : '-';
    const flags = [r.stale ? 'STALE' : '', r.error ?? ''].filter(Boolean).join(' ');
    console.log(
      `  ${r.sourceId.padEnd(24)} ${r.status.padStart(9)}  +${String(r.inserted).padStart(3)}` +
        `  newest ${newest}  ${flags}`,
    );
    if (r.error !== undefined) failures++;
  }

  const inserted = reports.reduce((sum, r) => sum + r.inserted, 0);
  const stale = reports.filter((r) => r.stale).map((r) => r.sourceId);

  // Only names never seen before cost a Steam lookup, so a routine tick is quick
  // even though the first full pass took a quarter of an hour.
  const resolved = await resolveCategories();

  console.log(
    `\n${inserted} new articles, ${resolved.looked_up} names looked up, ` +
      `${resolved.games} games found, ${resolved.links} links added`,
  );
  if (stale.length > 0) console.log(`stale sources: ${stale.join(', ')}`);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (error) {
  console.error('tick failed:', error);
  failures++;
} finally {
  await pool.end();
}

// A single unreachable outlet must not fail the run; losing every source must.
process.exit(failures >= 8 ? 1 : 0);
