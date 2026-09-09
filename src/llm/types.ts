/**
 * The boundary every model call goes through. Nothing above this layer knows
 * whether the model runs locally, behind someone else's API, or not at all -
 * which is the point: models get swapped for speed, cost or quality, and that
 * swap must never reach into business logic.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  /** Already parsed. Providers hand these back as objects or as JSON strings. */
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  /** Set on a `tool` message to say which call it answers. */
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object matching this schema instead of free text. */
  responseSchema?: Record<string, unknown>;
}

/**
 * Tokens and duration come back on every call, not on request. Knowing what a
 * feature costs is a property of the system, and a number nobody collected is a
 * number nobody can act on later.
 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage;
  /** The model that actually answered, which may differ from the one requested. */
  model: string;
}

export interface LlmProvider {
  /** Stable identifier recorded alongside generated content, e.g. "ollama". */
  readonly id: string;
  readonly model: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export class LlmError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'LlmError';
  }
}
