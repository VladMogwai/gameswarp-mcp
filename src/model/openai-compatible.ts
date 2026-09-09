import { parseJson, toJsonSchema } from './json.js';
import { ModelError, type CompletionRequest, type CompletionResponse, type ModelProvider } from './types.js';

interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * Anything speaking the OpenAI chat-completions shape, which by now is most of
 * them: OpenAI itself, Groq, Together, OpenRouter, and several free tiers. One
 * adapter covers them all because only the base URL and model name differ.
 *
 * Not local: the prompt leaves the machine. For a project whose selling point is
 * that game data stays put, that is a deliberate choice each time, which is why
 * `local` is on the interface rather than implied.
 */
export function openAICompatibleProvider(options: {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): ModelProvider {
  const id = options.id;

  return {
    id,
    local: false,
    async complete<T>(request: CompletionRequest): Promise<CompletionResponse<T>> {
      const messages = [
        ...(request.system === undefined ? [] : [{ role: 'system', content: request.system }]),
        { role: 'user', content: request.prompt },
      ];

      const body: Record<string, unknown> = {
        model: options.model,
        messages,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
      };
      if (request.schema !== undefined) {
        body['response_format'] = {
          type: 'json_schema',
          json_schema: { name: 'result', strict: true, schema: toJsonSchema(request.schema) },
        };
      }

      const started = Date.now();
      const response = await fetch(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      });

      const payload = (await response.json()) as ChatResponse;
      if (!response.ok || payload.error !== undefined) {
        throw new ModelError(id, payload.error?.message ?? `HTTP ${response.status}`);
      }

      const text = payload.choices?.[0]?.message?.content ?? '';
      return {
        text,
        parsed:
          request.schema === undefined ? undefined : parseJson<T>(id, request.schema, text),
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
        model: payload.model ?? options.model,
        latencyMs: Date.now() - started,
      };
    },
  };
}
