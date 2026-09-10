import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ollamaProvider } from '../src/model/ollama.js';
import { openAICompatibleProvider } from '../src/model/openai-compatible.js';
import { ModelError , normaliseToolCall } from '../src/model/types.js';

const schema = z.object({ sameEvent: z.boolean(), reason: z.string() });

function mockFetch(body: unknown, ok = true) {
  const fn = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => '' }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => vi.unstubAllGlobals());

describe('ollamaProvider', () => {
  it('sends a JSON Schema when a zod schema is given', async () => {
    const fetchMock = mockFetch({ message: { content: '{"sameEvent":true,"reason":"same patch"}' } });
    await ollamaProvider({ model: 'test' }).complete({ prompt: 'x', schema });
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.format.type).toBe('object');
    expect(Object.keys(body.format.properties)).toEqual(['sameEvent', 'reason']);
  });

  it('parses and validates the response', async () => {
    mockFetch({
      message: { content: '{"sameEvent":true,"reason":"same patch"}' },
      prompt_eval_count: 12,
      eval_count: 7,
    });
    const result = await ollamaProvider({ model: 'test' }).complete<{ sameEvent: boolean }>({
      prompt: 'x',
      schema,
    });
    expect(result.parsed?.sameEvent).toBe(true);
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(7);
  });

  it('recovers JSON from a fenced answer, which small models keep producing', async () => {
    mockFetch({ message: { content: 'Sure!\n```json\n{"sameEvent":false,"reason":"different"}\n```' } });
    const result = await ollamaProvider({ model: 'test' }).complete<{ reason: string }>({
      prompt: 'x',
      schema,
    });
    expect(result.parsed?.reason).toBe('different');
  });

  it('fails loudly when the answer cannot match the schema', async () => {
    mockFetch({ message: { content: 'I think they are the same, honestly' } });
    await expect(
      ollamaProvider({ model: 'test' }).complete({ prompt: 'x', schema }),
    ).rejects.toBeInstanceOf(ModelError);
  });
});

describe('openAICompatibleProvider', () => {
  it('uses response_format and reports usage', async () => {
    const fetchMock = mockFetch({
      choices: [{ message: { content: '{"sameEvent":true,"reason":"ok"}' } }],
      usage: { prompt_tokens: 30, completion_tokens: 9 },
      model: 'served-model',
    });
    const result = await openAICompatibleProvider({
      id: 'test',
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
      model: 'asked-model',
    }).complete({ prompt: 'x', schema });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.response_format.type).toBe('json_schema');
    expect(result.inputTokens).toBe(30);
    // The model that answered is recorded, not the one we asked for.
    expect(result.model).toBe('served-model');
  });

  it('marks hosted providers as not local', () => {
    const provider = openAICompatibleProvider({
      id: 'test', baseUrl: 'https://example.com/v1', apiKey: 'k', model: 'm',
    });
    expect(provider.local).toBe(false);
    expect(ollamaProvider({ model: 'test' }).local).toBe(true);
  });
});

describe('chat with tools', () => {
  it('normalises tool calls whose arguments arrive as an object', () => {
    const call = normaliseToolCall({ name: 'get_x', arguments: { appid: 1 } });
    expect(call.name).toBe('get_x');
    expect(call.arguments).toEqual({ appid: 1 });
  });

  it('normalises tool calls whose arguments arrive as a JSON string', () => {
    expect(normaliseToolCall({ name: 'a', arguments: '{"appid":2}' }).arguments).toEqual({
      appid: 2,
    });
  });

  it('survives malformed argument JSON rather than throwing', () => {
    expect(normaliseToolCall({ name: 'a', arguments: '{not json' }).arguments).toEqual({});
  });

  it('invents an id when the provider omits one, so calls stay addressable', () => {
    expect(normaliseToolCall({ name: 'a', arguments: {} }).id).toMatch(/^call_/);
  });

  it('keeps the id when the provider supplies one', () => {
    expect(normaliseToolCall({ id: 'call_abc', name: 'a', arguments: {} }).id).toBe('call_abc');
  });
});
