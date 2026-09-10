import type { ZodType } from 'zod';

export interface CompletionRequest {
  /** Standing instruction, separate from the task so it can be reused verbatim. */
  system?: string | undefined;
  prompt: string;
  /**
   * When given, the model is constrained to produce JSON matching this shape and
   * the result is parsed and validated before it is returned. Providers express
   * the constraint differently, which is precisely what this layer hides.
   */
  schema?: ZodType | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
}

export interface CompletionResponse<T = unknown> {
  text: string;
  /** Present only when a schema was requested; already validated against it. */
  parsed: T | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  /** The model that actually answered, which may differ from the one asked for. */
  model: string;
  latencyMs: number;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Already parsed: providers return these as objects or as JSON strings. */
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema describing the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[] | undefined;
  /** On a `tool` message, which call it answers. */
  toolCallId?: string | undefined;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[] | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  model: string;
  latencyMs: number;
}

export interface ModelProvider {
  /** Stable and recorded alongside every generated artefact, e.g. "ollama:gemma4:12b". */
  id: string;
  /** True when the provider runs on this machine and nothing leaves it. */
  local: boolean;
  /**
   * One prompt in, one answer out, optionally validated against a schema. This
   * covers extraction and classification, which is most of what the pipeline
   * asks a model to do.
   */
  complete<T = unknown>(request: CompletionRequest): Promise<CompletionResponse<T>>;
  /**
   * A conversation the model can extend with tool calls. Needed by the agent and
   * by nothing else, which is why it is separate: a classifier should not have to
   * build a message array to ask one question.
   */
  chat(request: ChatRequest): Promise<ChatResponse>;
}

let toolCallCounter = 0;

/** Providers disagree on whether arguments arrive parsed, and some omit call ids. */
export function normaliseToolCall(raw: {
  id?: string | undefined;
  name: string;
  arguments: unknown;
}): ToolCall {
  let parsed: Record<string, unknown> = {};
  if (typeof raw.arguments === 'string') {
    try {
      parsed = JSON.parse(raw.arguments) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  } else if (raw.arguments !== null && typeof raw.arguments === 'object') {
    parsed = raw.arguments as Record<string, unknown>;
  }
  return { id: raw.id ?? `call_${++toolCallCounter}`, name: raw.name, arguments: parsed };
}

export class ModelError extends Error {
  constructor(
    readonly providerId: string,
    message: string,
  ) {
    super(`${providerId}: ${message}`);
    this.name = 'ModelError';
  }
}
