import { query } from './pool.js';
import type { AgentRun } from '../agent/loop.js';
import type { LanguageCode } from '../config/languages.js';

export interface StoredAnalysis {
  id: number;
  appid: number;
  kind: string;
  language: string;
  periodStart: string | null;
  periodEnd: string | null;
  question: string;
  answer: string;
  model: string;
  createdAt: Date;
}

interface AnalysisRow {
  id: string;
  appid: number;
  kind: string;
  language: string;
  period_start: string | null;
  period_end: string | null;
  question: string;
  answer: string;
  model: string;
  created_at: Date;
}

export async function saveAnalysis(input: {
  appid: number;
  kind: 'drop' | 'summary';
  language: LanguageCode;
  periodStart?: Date;
  periodEnd?: Date;
  question: string;
  run: AgentRun;
  model: string;
}): Promise<number> {
  const steps = input.run.steps.map((step) => ({
    tool: step.call.name,
    arguments: step.call.arguments,
    failed: step.failed,
    durationMs: step.durationMs,
  }));

  const result = await query<{ id: string }>(
    `insert into analyses
       (appid, kind, language, period_start, period_end, question, answer,
        steps, model, input_tokens, output_tokens, duration_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
     returning id::text`,
    [
      input.appid,
      input.kind,
      input.language,
      input.periodStart ?? null,
      input.periodEnd ?? null,
      input.question,
      input.run.answer,
      JSON.stringify(steps),
      input.model,
      input.run.inputTokens,
      input.run.outputTokens,
      input.run.durationMs,
    ],
  );
  return Number(result.rows[0]?.id ?? 0);
}

export async function loadAnalyses(
  appid: number,
  language: LanguageCode,
): Promise<StoredAnalysis[]> {
  const result = await query<AnalysisRow>(
    `select id::text, appid, kind, language, period_start, period_end, question,
            answer, model, created_at
     from analyses where appid = $1 and language = $2
     order by period_start desc nulls last, created_at desc`,
    [appid, language],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    appid: row.appid,
    kind: row.kind,
    language: row.language,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    question: row.question,
    answer: row.answer,
    model: row.model,
    createdAt: row.created_at,
  }));
}

export async function saveTimeline(
  appid: number,
  buckets: { date: Date; up: number; down: number }[],
  granularity: 'week' | 'month',
): Promise<void> {
  if (buckets.length === 0) return;
  const values: unknown[] = [];
  const rows = buckets.map((bucket, index) => {
    values.push(appid, bucket.date, bucket.up, bucket.down, granularity);
    const offset = index * 5;
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
  });
  await query(
    `insert into review_timeline_cache (appid, bucket, up, down, granularity)
     values ${rows.join(', ')}
     on conflict (appid, bucket) do update set
       up = excluded.up, down = excluded.down,
       granularity = excluded.granularity, fetched_at = now()`,
    values,
  );
}
