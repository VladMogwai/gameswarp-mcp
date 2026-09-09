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

export interface ModelProvider {
  /** Stable and recorded alongside every generated artefact, e.g. "ollama:gemma4:12b". */
  id: string;
  /** True when the provider runs on this machine and nothing leaves it. */
  local: boolean;
  complete<T = unknown>(request: CompletionRequest): Promise<CompletionResponse<T>>;
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
