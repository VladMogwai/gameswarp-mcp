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

  async function post(body: Record<string, unknown>): Promise<RawChatResponse> {
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
    if (!response.ok || payload.error !== undefined) {
      throw new ModelError(id, payload.error?.message ?? `HTTP ${response.status}`);
    }
    return payload;
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
