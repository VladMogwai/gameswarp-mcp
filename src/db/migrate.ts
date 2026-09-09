import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from './pool.js';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

/**
 * Миграции — простые .sql, применяются по алфавиту, каждая в своей транзакции.
 * Отката нет намеренно: на этой стадии проще снести базу и накатить заново,
 * чем поддерживать down-миграции, которыми никто не пользуется.
 */
export async function migrate(): Promise<void> {
  await pool.query(`
    create table if not exists migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await pool.query<{ name: string }>('select name from migrations')).rows.map((r) => r.name),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.error(`применена: ${file}`);
    } catch (error) {
      await client.query('rollback');
      throw new Error(`миграция ${file} упала: ${String(error)}`);
    } finally {
      client.release();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => pool.end())
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
