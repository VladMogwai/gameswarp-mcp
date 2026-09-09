import { LlmError, type ChatRequest, type ChatResponse, type LlmProvider, type ToolCall } from './types.js';

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const TIMEOUT_MS = 300_000;

interface RawToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

interface RawResponse {
  model?: string;
  message?: { content?: string; tool_calls?: RawToolCall[] };
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
  error?: string;
}

/**
 * Local models through Ollama. Nothing here is Ollama-specific above the wire
 * format: swapping in a hosted provider means another file like this one.
 *
 * The timeout is generous on purpose. A 12B model on a laptop answers in tens of
 * seconds, and a multi-step agent turn can be minutes.
 */
export function ollamaProvider(options: { model: string; host?: string }): LlmProvider {
  const host = options.host ?? process.env['OLLAMA_HOST'] ?? DEFAULT_HOST;

  return {
    id: 'ollama',
    model: options.model,

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const started = Date.now();
      const body = {
        model: options.model,
        stream: false,
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
        ...(request.responseSchema === undefined ? {} : { format: request.responseSchema }),
        options: {
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxTokens === undefined ? {} : { num_predict: request.maxTokens }),
        },
      };

      let raw: RawResponse;
      try {
        const response = await fetch(`${host}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new LlmError('ollama', `HTTP ${response.status} from ${host}`);
        }
        raw = (await response.json()) as RawResponse;
      } catch (error) {
        if (error instanceof LlmError) throw error;
        throw new LlmError('ollama', `request to ${host} failed`, error);
      }

      if (raw.error !== undefined) throw new LlmError('ollama', raw.error);

      return {
        content: raw.message?.content ?? '',
        toolCalls: (raw.message?.tool_calls ?? []).map(toToolCall),
        model: raw.model ?? options.model,
        usage: {
          inputTokens: raw.prompt_eval_count ?? 0,
          outputTokens: raw.eval_count ?? 0,
          durationMs: Date.now() - started,
        },
      };
    },
  };
}

let callCounter = 0;

/** Ollama omits call ids and may hand arguments back as a JSON string. */
function toToolCall(raw: RawToolCall): ToolCall {
  const name = raw.function?.name ?? '';
  const rawArgs = raw.function?.arguments;
  let parsed: Record<string, unknown> = {};
  if (typeof rawArgs === 'string') {
    try {
      parsed = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  } else if (rawArgs !== null && typeof rawArgs === 'object') {
    parsed = rawArgs as Record<string, unknown>;
  }
  return { id: raw.id ?? `call_${++callCounter}`, name, arguments: parsed };
}
