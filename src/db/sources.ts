import { pool } from './pool.js';

export interface SourceState {
  sourceId: string;
  etag: string | undefined;
  lastModified: string | undefined;
  lastSuccessAt: Date | undefined;
  newestItemAt: Date | undefined;
  consecutiveFailures: number;
}

interface StateRow {
  source_id: string;
  etag: string | null;
  last_modified: string | null;
  last_success_at: Date | null;
  newest_item_at: Date | null;
  consecutive_failures: number;
}

export async function loadSourceState(sourceId: string): Promise<SourceState | undefined> {
  const result = await pool.query<StateRow>(
    'select * from source_state where source_id = $1',
    [sourceId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    sourceId: row.source_id,
    etag: row.etag ?? undefined,
    lastModified: row.last_modified ?? undefined,
    lastSuccessAt: row.last_success_at ?? undefined,
    newestItemAt: row.newest_item_at ?? undefined,
    consecutiveFailures: row.consecutive_failures,
  };
}

export async function recordSuccess(
  sourceId: string,
  update: {
    etag: string | undefined;
    lastModified: string | undefined;
    newestItemAt: Date | undefined;
    status: string;
  },
): Promise<void> {
  await pool.query(
    `insert into source_state
       (source_id, etag, last_modified, last_attempt_at, last_success_at, last_status,
        last_error, newest_item_at, consecutive_failures)
     values ($1, $2, $3, now(), now(), $4, null, $5, 0)
     on conflict (source_id) do update set
       etag = excluded.etag,
       last_modified = excluded.last_modified,
       last_attempt_at = now(),
       last_success_at = now(),
       last_status = excluded.last_status,
       last_error = null,
       -- Keep the newest date we have ever seen; a 304 carries no items.
       newest_item_at = greatest(source_state.newest_item_at, excluded.newest_item_at),
       consecutive_failures = 0`,
    [sourceId, update.etag ?? null, update.lastModified ?? null, update.status,
     update.newestItemAt ?? null],
  );
}

export async function recordFailure(sourceId: string, error: string): Promise<void> {
  await pool.query(
    `insert into source_state
       (source_id, last_attempt_at, last_status, last_error, consecutive_failures)
     values ($1, now(), 'error', $2, 1)
     on conflict (source_id) do update set
       last_attempt_at = now(),
       last_status = 'error',
       last_error = excluded.last_error,
       consecutive_failures = source_state.consecutive_failures + 1`,
    [sourceId, error.slice(0, 500)],
  );
}
