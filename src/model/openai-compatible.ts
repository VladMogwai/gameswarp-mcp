import { parseJson, toJsonSchema } from './json.js';
import {
  ModelError,
  normaliseToolCall,
  type ChatRequest,
  type ChatResponse,
  type CompletionRequest,
  type CompletionResponse,
  type ModelProvider,
} from './types.js';

interface RawChatResponse {
  model?: string;
  choices?: {
    message?: {
      content?: string;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[];
    };
  }[];
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

  /**
   * Retried for two reasons that both look like errors but are not faults of the
   * caller. Free tiers meter by tokens per minute and answer 429 when a burst
   * arrives, and a model occasionally emits tool arguments the vendor itself
   * cannot parse - a bad sample, not a bad request. Both come right on a repeat.
   */
  function isTransient(status: number, message: string): boolean {
    if (status === 429 || status >= 500) return true;
    return /parse tool call|tool.call.*json/i.test(message);
  }

  /**
   * A rate limiter knows exactly when it will let you back in, and says so - in
   * the Retry-After header, or failing that in the prose of the error. Guessing
   * an exponential backoff instead means either waiting far too long or giving
   * up a second before the door opens, which is what happened here: the limit
   * asked for 4.8 seconds and a doubling backoff ran out of attempts first.
   */
  function waitFor(response: Response, message: string, attempt: number): number {
    const header = response.headers.get('retry-after');
    if (header !== null) {
      const seconds = Number.parseFloat(header);
      if (Number.isFinite(seconds)) return seconds * 1000 + 250;
    }
    const stated = /try again in ([0-9.]+)\s*s/i.exec(message);
    if (stated?.[1] !== undefined) return Number.parseFloat(stated[1]) * 1000 + 250;
    return 2_000 * 2 ** attempt;
  }

  async function post(body: Record<string, unknown>): Promise<RawChatResponse> {
    let lastMessage = 'unknown error';
    let wait = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const response = await fetch(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({ ...body, model: options.model }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      });
      const payload = (await response.json()) as RawChatResponse;
      if (response.ok && payload.error === undefined) return payload;

      lastMessage = payload.error?.message ?? `HTTP ${response.status}`;
      if (!isTransient(response.status, lastMessage)) break;
      wait = waitFor(response, lastMessage, attempt);
    }
    throw new ModelError(id, lastMessage);
  }

  return {
    id,
    local: false,

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const started = Date.now();
      const payload = await post({
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
          ...(message.toolCalls === undefined
            ? {}
            : {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                })),
              }),
        })),
        ...(request.tools === undefined
          ? {}
          : {
              tools: request.tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
            }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
      });

      const message = payload.choices?.[0]?.message;
      return {
        text: message?.content ?? '',
        toolCalls: (message?.tool_calls ?? []).map((call) =>
          normaliseToolCall({
            ...(call.id === undefined ? {} : { id: call.id }),
            name: call.function?.name ?? '',
            arguments: call.function?.arguments,
          }),
        ),
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
        model: payload.model ?? options.model,
        latencyMs: Date.now() - started,
      };
    },

    async complete<T>(request: CompletionRequest): Promise<CompletionResponse<T>> {
      const messages = [
        ...(request.system === undefined ? [] : [{ role: 'system', content: request.system }]),
        { role: 'user', content: request.prompt },
      ];

      const body: Record<string, unknown> = {
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
      const payload = await post(body);

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
