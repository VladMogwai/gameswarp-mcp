import { afterEach, describe, expect, it, vi } from 'vitest';
import { ollamaProvider } from '../src/llm/ollama.js';
import { LlmError } from '../src/llm/types.js';

function mockFetch(payload: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      json: async () => payload,
    })),
  );
}

const provider = ollamaProvider({ model: 'test-model', host: 'http://localhost:1' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ollamaProvider', () => {
  it('reports usage so the cost of a call is never lost', async () => {
    mockFetch({
      model: 'test-model',
      message: { content: 'hello' },
      prompt_eval_count: 84,
      eval_count: 12,
    });
    const response = await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(response.content).toBe('hello');
    expect(response.usage.inputTokens).toBe(84);
    expect(response.usage.outputTokens).toBe(12);
    expect(response.usage.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('parses tool calls whose arguments arrive as an object', async () => {
    mockFetch({
      message: { content: '', tool_calls: [{ function: { name: 'get_x', arguments: { appid: 1 } } }] },
    });
    const response = await provider.chat({ messages: [] });
    expect(response.toolCalls[0]?.name).toBe('get_x');
    expect(response.toolCalls[0]?.arguments).toEqual({ appid: 1 });
  });

  it('parses tool calls whose arguments arrive as a JSON string', async () => {
    mockFetch({
      message: { tool_calls: [{ function: { name: 'get_x', arguments: '{"appid":2}' } }] },
    });
    const response = await provider.chat({ messages: [] });
    expect(response.toolCalls[0]?.arguments).toEqual({ appid: 2 });
  });

  it('invents an id when the provider omits one, so calls stay addressable', async () => {
    mockFetch({ message: { tool_calls: [{ function: { name: 'a', arguments: {} } }] } });
    const response = await provider.chat({ messages: [] });
    expect(response.toolCalls[0]?.id).toMatch(/^call_/);
  });

  it('survives malformed argument JSON instead of throwing', async () => {
    mockFetch({ message: { tool_calls: [{ function: { name: 'a', arguments: '{not json' } }] } });
    const response = await provider.chat({ messages: [] });
    expect(response.toolCalls[0]?.arguments).toEqual({});
  });

  it('wraps transport failures as LlmError naming the provider', async () => {
    mockFetch({}, false, 503);
    await expect(provider.chat({ messages: [] })).rejects.toThrow(LlmError);
  });

  it('surfaces an error the model returned in the body', async () => {
    mockFetch({ error: 'model not found' });
    await expect(provider.chat({ messages: [] })).rejects.toThrow(/model not found/);
  });
});
