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

interface OllamaResponse {
  model?: string;
  message?: {
    content?: string;
    tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[];
  };
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

  async function post(body: Record<string, unknown>): Promise<OllamaResponse> {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model: options.model, stream: false }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
    });
    if (!response.ok) {
      throw new ModelError(id, `HTTP ${response.status} ${await response.text()}`);
    }
    const payload = (await response.json()) as OllamaResponse;
    if (payload.error !== undefined) throw new ModelError(id, payload.error);
    return payload;
  }

  return {
    id,
    local: true,

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const started = Date.now();
      const payload = await post({
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.toolCalls === undefined
            ? {}
            : {
                tool_calls: message.toolCalls.map((call) => ({
                  function: { name: call.name, arguments: call.arguments },
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
        options: {
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxTokens === undefined ? {} : { num_predict: request.maxTokens }),
        },
      });

      return {
        text: payload.message?.content ?? '',
        toolCalls: (payload.message?.tool_calls ?? []).map((call) =>
          normaliseToolCall({
            ...(call.id === undefined ? {} : { id: call.id }),
            name: call.function?.name ?? '',
            arguments: call.function?.arguments,
          }),
        ),
        inputTokens: payload.prompt_eval_count,
        outputTokens: payload.eval_count,
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
        options: {
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxTokens === undefined ? {} : { num_predict: request.maxTokens }),
        },
      };
      // Ollama constrains generation to a JSON Schema through `format`.
      if (request.schema !== undefined) body['format'] = toJsonSchema(request.schema);

      const started = Date.now();
      const payload = await post(body);

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
