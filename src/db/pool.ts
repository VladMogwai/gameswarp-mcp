import pg from 'pg';
import { loadEnvFile } from '../config/env.js';

loadEnvFile();

/**
 * Postgres DATE columns carry no time, but the driver turns them into a Date at
 * local midnight. Serialising that back through UTC moves the day - the month a
 * rating fell was rendered as the month before it. Date-only columns are kept as
 * the strings the database sent.
 */
pg.types.setTypeParser(1082, (value) => value);

const LOCAL = 'postgres://gameswarp:gameswarp@localhost:5433/gameswarp';
const connectionString = process.env['DATABASE_URL'] ?? LOCAL;
const hosted = !connectionString.includes('localhost');

// TLS is left to the connection string, which hosted providers already set to
// sslmode=require. Overriding it here would only weaken certificate checking.
const pool = new pg.Pool({
  connectionString,
  // A hosted database suspends when idle, so holding many connections open buys
  // nothing and a short idle timeout lets it go back to sleep.
  max: hosted ? 3 : 10,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 15_000,
});

/**
 * An idle connection dropped by the server surfaces as an error event on the
 * pool, and an unhandled one kills the process. That is exactly what happens
 * during long work with sparse queries - a crawl or an eval run, where minutes
 * pass between statements - so the event is absorbed here and the connection is
 * simply discarded.
 */
pool.on('error', (error) => {
  console.error(`db: idle connection dropped (${error.message}); it will be replaced`);
});

const RETRYABLE = new Set([
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNREFUSED',
  '57P01', // admin_shutdown, which is how a suspended database says goodbye
]);

function isRetryable(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && RETRYABLE.has(code);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a query, replacing a dead connection rather than failing the caller.
 * A hosted database that scaled to zero refuses the first connection and accepts
 * the second, and there is no way to ask in advance which one this is.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<pg.QueryResult<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await pool.query<T>(text, values);
    } catch (error) {
      if (!isRetryable(error)) throw error;
      lastError = error;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export { pool };
