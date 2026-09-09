import { z, type ZodType } from 'zod';
import { ModelError } from './types.js';

export function toJsonSchema(schema: ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

/**
 * Models wrap JSON in prose and fences however much you ask them not to, and a
 * smaller model does it more often. Recovering the object is cheaper than
 * failing the whole run over punctuation.
 */
export function parseJson<T>(providerId: string, schema: ZodType, text: string): T {
  const candidates = [text, stripFence(text), extractObject(text)].filter(
    (value): value is string => value !== undefined,
  );

  for (const candidate of candidates) {
    try {
      const result = schema.safeParse(JSON.parse(candidate));
      if (result.success) return result.data as T;
    } catch {
      // Try the next candidate.
    }
  }
  throw new ModelError(providerId, `response did not match the schema: ${text.slice(0, 200)}`);
}

function stripFence(text: string): string | undefined {
  const match = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return match?.[1]?.trim();
}

function extractObject(text: string): string | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
}
