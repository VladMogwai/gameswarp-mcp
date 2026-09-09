import pg from 'pg';

const CONNECTION_STRING =
  process.env['DATABASE_URL'] ?? 'postgres://gameswarp:gameswarp@localhost:5433/gameswarp';

export const pool = new pg.Pool({ connectionString: CONNECTION_STRING });
