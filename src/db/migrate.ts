import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closePool, query, withClient } from './pool.js';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

/**
  * Migrations are plain .sql files applied in alphabetical order, each in its own
  * transaction. There is deliberately no rollback: at this stage dropping the
  * database and rebuilding it is cheaper than maintaining down-migrations that
  * nobody runs.
  */
export async function migrate(): Promise<void> {
  await query(`
    create table if not exists migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await query<{ name: string }>('select name from migrations')).rows.map((r) => r.name),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await withClient(async (client) => {
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into migrations (name) values ($1)', [file]);
        await client.query('commit');
        console.error(`applied: ${file}`);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`migration ${file} failed: ${String(error)}`);
      }
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => closePool())
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
