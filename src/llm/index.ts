import { ollamaProvider } from './ollama.js';
import type { LlmProvider } from './types.js';

export * from './types.js';
export { ollamaProvider } from './ollama.js';

/**
 * Which model answers is configuration, not code. Everything above this layer
 * asks for a provider and never names one, so changing model or vendor is two
 * environment variables.
 *
 * LLM_PROVIDER  ollama (default)
 * LLM_MODEL     model name for that provider
 */
export function createProvider(): LlmProvider {
  const kind = process.env['LLM_PROVIDER'] ?? 'ollama';
  const model = process.env['LLM_MODEL'] ?? 'gemma4:12b';

  switch (kind) {
    case 'ollama':
      return ollamaProvider({ model });
    default:
      throw new Error(
        `Unknown LLM_PROVIDER "${kind}". Add a provider module beside src/llm/ollama.ts ` +
          `and register it here.`,
      );
  }
}
