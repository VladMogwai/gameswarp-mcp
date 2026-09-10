import type { ZodRawShape } from 'zod';
import type { ToolDefinition } from '../model/types.js';

/**
 * A tool defined once and consumed twice: the MCP server registers it for other
 * people's clients, and the agent hands it straight to the model. Keeping the
 * description in one place matters more than it looks - it is the only thing a
 * model reads when deciding whether to call something, and two copies drift.
 */
export interface Tool extends ToolDefinition {
  /**
   * The argument schema as Zod, which is the source of truth. `parameters` on
   * ToolDefinition is the JSON Schema derived from it: the MCP SDK wants Zod,
   * model providers want JSON Schema, and deriving one from the other keeps a
   * single definition instead of two that drift.
   */
  shape: ZodRawShape;
  /**
   * Runs the tool. Arguments arrive as the model produced them, so the
   * implementation validates rather than trusts.
   */
  run(args: Record<string, unknown>): Promise<string>;
}

/** Thrown by a tool when the caller can fix the problem by asking differently. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}
