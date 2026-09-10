import { loadEnvFile } from '../config/env.js';
import { ollamaProvider } from './ollama.js';
import { openAICompatibleProvider } from './openai-compatible.js';
import type { ModelProvider } from './types.js';

export { ollamaProvider } from './ollama.js';
export { openAICompatibleProvider } from './openai-compatible.js';
export {
  ModelError,
  normaliseToolCall,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type CompletionRequest,
  type CompletionResponse,
  type ModelProvider,
  type ToolCall,
  type ToolDefinition,
} from './types.js';

/**
 * Chosen by environment so the same code runs against a local model or a hosted
 * one without edits - which is what makes "how much worse is a local 8B at this
 * task?" a question you can answer with numbers rather than opinion.
 *
 *   MODEL_PROVIDER=ollama            MODEL_NAME=gemma4:12b        (default)
 *   MODEL_PROVIDER=openai-compatible MODEL_NAME=llama-3.3-70b
 *     MODEL_BASE_URL=https://api.groq.com/openai/v1  MODEL_API_KEY=...
 */
export function defaultProvider(): ModelProvider {
  // Loading the file here as well as in the pool: which module happens to be
  // imported first should not decide whether configuration is visible.
  loadEnvFile();
  const kind = process.env['MODEL_PROVIDER'] ?? 'ollama';
  const model = process.env['MODEL_NAME'] ?? 'gemma4:12b';

  if (kind === 'ollama') {
    const baseUrl = process.env['MODEL_BASE_URL'];
    return ollamaProvider({ model, ...(baseUrl === undefined ? {} : { baseUrl }) });
  }

  if (kind === 'openai-compatible') {
    const baseUrl = process.env['MODEL_BASE_URL'];
    // Vendors hand out keys under their own name and people store them that way.
    // Accepting both saves renaming a secret to satisfy an abstraction.
    const apiKey = process.env['MODEL_API_KEY'] ?? process.env['GROQ_API_KEY'];
    if (baseUrl === undefined || apiKey === undefined || apiKey.length === 0) {
      throw new Error(
        'openai-compatible needs MODEL_BASE_URL and a key in MODEL_API_KEY or GROQ_API_KEY',
      );
    }
    return openAICompatibleProvider({ id: `openai-compatible:${model}`, baseUrl, apiKey, model });
  }

  throw new Error(`Unknown MODEL_PROVIDER: ${kind}`);
}
