import pg from 'pg';

const LOCAL = 'postgres://gameswarp:gameswarp@localhost:5433/gameswarp';
const connectionString = process.env['DATABASE_URL'] ?? LOCAL;

// Hosted Postgres requires TLS; the local container does not offer it.
const hosted = connectionString !== LOCAL && !connectionString.includes('localhost');

export const pool = new pg.Pool({
  connectionString,
  ...(hosted ? { ssl: { rejectUnauthorized: false } } : {}),
  // Neon and friends suspend an idle database, so a pool that keeps many
  // connections open buys nothing and a short idle timeout releases them.
  max: hosted ? 3 : 10,
  idleTimeoutMillis: 10_000,
});
