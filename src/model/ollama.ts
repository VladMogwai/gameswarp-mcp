import { parseJson, toJsonSchema } from './json.js';
import { ModelError, type CompletionRequest, type CompletionResponse, type ModelProvider } from './types.js';

interface OllamaResponse {
  model?: string;
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * A model running on this machine. Nothing leaves the host, which is the whole
 * point of the self-hosted path; the cost is that a small model plans worse over
 * several steps than a frontier one.
 */
export function ollamaProvider(options: {
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}): ModelProvider {
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:11434';
  const id = `ollama:${options.model}`;

  return {
    id,
    local: true,
    async complete<T>(request: CompletionRequest): Promise<CompletionResponse<T>> {
      const messages = [
        ...(request.system === undefined ? [] : [{ role: 'system', content: request.system }]),
        { role: 'user', content: request.prompt },
      ];

      const body: Record<string, unknown> = {
        model: options.model,
        messages,
        stream: false,
        options: {
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxTokens === undefined ? {} : { num_predict: request.maxTokens }),
        },
      };
      // Ollama constrains generation to a JSON Schema through `format`.
      if (request.schema !== undefined) body['format'] = toJsonSchema(request.schema);

      const started = Date.now();
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
      });
      if (!response.ok) {
        throw new ModelError(id, `HTTP ${response.status} ${await response.text()}`);
      }

      const payload = (await response.json()) as OllamaResponse;
      if (payload.error !== undefined) throw new ModelError(id, payload.error);

      const text = payload.message?.content ?? '';
      return {
        text,
        parsed:
          request.schema === undefined ? undefined : parseJson<T>(id, request.schema, text),
        inputTokens: payload.prompt_eval_count,
        outputTokens: payload.eval_count,
        model: payload.model ?? options.model,
        latencyMs: Date.now() - started,
      };
    },
  };
}
