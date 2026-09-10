import { z } from 'zod';
import { runAgent, type AgentRun } from '../agent/loop.js';
import { defaultProvider, type ModelProvider } from '../model/index.js';
import type { PatchDropCase } from './patch-drops.js';

export interface CaseResult {
  case: PatchDropCase;
  correct: boolean;
  namedDate: string | null;
  daysOff: number | null;
  failure: 'none' | 'no-answer' | 'no-patch-named' | 'wrong-patch';
  steps: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  answer: string;
}

export interface EvalReport {
  model: string;
  cases: number;
  correct: number;
  accuracy: number;
  failures: Record<string, number>;
  medianSteps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  medianDurationMs: number;
  results: CaseResult[];
}

const TOLERANCE_DAYS = 7;

const extraction = z.object({
  patch_date: z
    .string()
    .nullable()
    .describe('The date of the update the answer blames, as YYYY-MM-DD, or null'),
});

/**
 * The agent answers in prose, so a second, much cheaper call pulls out the claim
 * being scored. This is extraction, not judgement: the model is asked what the
 * answer said, never whether it was right. Correctness is then a date comparison,
 * which cannot flatter anybody.
 */
async function extractClaim(provider: ModelProvider, answer: string): Promise<string | null> {
  if (answer.trim().length === 0) return null;
  try {
    const result = await provider.complete<{ patch_date: string | null }>({
      system: 'You extract a single fact from text. You never judge or add anything.',
      prompt:
        `Which update or patch does this text blame for a rating drop? Give its date ` +
        `strictly as YYYY-MM-DD, or null if no date is stated.\n\n${answer}`,
      schema: extraction,
      temperature: 0,
    });
    return normaliseDate(result.parsed?.patch_date ?? null);
  } catch {
    // A failed extraction means the claim could not be read, not that the run
    // is over. Scoring it as "no patch named" keeps the case and the run.
    return null;
  }
}

/**
 * The schema asks for YYYY-MM-DD and models answer "October 7, 2022" anyway.
 * Date parsing happens to accept that, but "early October" produces an invalid
 * date that would silently score a correct answer as wrong, so anything that
 * does not resolve to a real day is treated as no claim at all.
 */
function normaliseDate(value: string | null): string | null {
  if (value === null || value.trim().length === 0) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export async function runEval(
  cases: PatchDropCase[],
  options: { provider?: ModelProvider; onCase?: (result: CaseResult) => void } = {},
): Promise<EvalReport> {
  const provider = options.provider ?? defaultProvider();
  const results: CaseResult[] = [];

  for (const testCase of cases) {
    let run: AgentRun;
    try {
      run = await runAgent(
        `Why did ${testCase.game} ratings drop in ${testCase.month}? Name the update responsible and its date.`,
        { provider },
      );
    } catch (error) {
      results.push({
        case: testCase,
        correct: false,
        namedDate: null,
        daysOff: null,
        failure: 'no-answer',
        steps: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        answer: `run failed: ${String(error).slice(0, 200)}`,
      });
      continue;
    }

    const namedDate = await extractClaim(provider, run.answer);
    const daysOff = namedDate === null ? null : daysBetween(namedDate, testCase.patchDate);
    const correct = daysOff !== null && daysOff <= TOLERANCE_DAYS;

    const result: CaseResult = {
      case: testCase,
      correct,
      namedDate,
      daysOff,
      failure:
        run.answer.trim().length === 0
          ? 'no-answer'
          : namedDate === null
            ? 'no-patch-named'
            : correct
              ? 'none'
              : 'wrong-patch',
      steps: run.steps.length,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      durationMs: run.durationMs,
      answer: run.answer,
    };
    results.push(result);
    options.onCase?.(result);
  }

  const failures: Record<string, number> = {};
  for (const result of results) {
    if (result.failure !== 'none') failures[result.failure] = (failures[result.failure] ?? 0) + 1;
  }

  const correct = results.filter((r) => r.correct).length;
  return {
    model: provider.id,
    cases: results.length,
    correct,
    accuracy: results.length === 0 ? 0 : correct / results.length,
    failures,
    medianSteps: median(results.map((r) => r.steps)),
    totalInputTokens: results.reduce((sum, r) => sum + r.inputTokens, 0),
    totalOutputTokens: results.reduce((sum, r) => sum + r.outputTokens, 0),
    medianDurationMs: median(results.map((r) => r.durationMs)),
    results,
  };
}
