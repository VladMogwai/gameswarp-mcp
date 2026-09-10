import { defaultProvider } from '../model/index.js';
import type { ChatMessage, ModelProvider, ToolCall } from '../model/types.js';
import { TOOLS, TOOLS_BY_NAME, ToolInputError, type Tool } from '../tools/index.js';

export interface AgentStep {
  call: ToolCall;
  result: string;
  failed: boolean;
  durationMs: number;
}

export interface AgentRun {
  answer: string;
  steps: AgentStep[];
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** True when the model was still calling tools when the budget ran out. */
  exhausted: boolean;
}

export interface AgentOptions {
  provider?: ModelProvider;
  tools?: Tool[];
  system?: string;
  /**
   * Each step is one model call plus one tool call. A small model wanders, so
   * this is a budget rather than a safety net: without it a confused run costs
   * minutes and finishes nowhere.
   */
  maxSteps?: number;
  onStep?: (step: AgentStep) => void;
}

const DEFAULT_SYSTEM = `You investigate Steam games using the tools provided.

Work in steps. A typical investigation:
1. get_review_timeline to find the month when a rating moved.
2. get_game_news with both since and until around that month, kind "patches",
   to find which update landed near it.
3. get_reviews for that window with voted_up false, to read the complaints.

Rules:
- Every tool needs an appid. If you only have a name, call search_games first.
- Reviews can only be read for recent windows. For older periods rely on the
  timeline and the patch notes.
- When a tool reports a problem, read the message: it says what to do instead.
- Stop calling tools once you can answer, and answer with specifics - dates,
  percentages, patch names - not impressions.`;

/**
 * The agent calls its tools directly, in process. MCP is how other people's
 * clients reach these same tools; routing our own calls through a protocol
 * inside one process would buy nothing.
 */
export async function runAgent(question: string, options: AgentOptions = {}): Promise<AgentRun> {
  const provider = options.provider ?? defaultProvider();
  const tools = options.tools ?? TOOLS;
  const byName = options.tools === undefined
    ? TOOLS_BY_NAME
    : new Map(options.tools.map((tool) => [tool.name, tool]));
  const maxSteps = options.maxSteps ?? 8;
  const started = Date.now();

  const messages: ChatMessage[] = [
    { role: 'system', content: options.system ?? DEFAULT_SYSTEM },
    { role: 'user', content: question },
  ];

  const steps: AgentStep[] = [];
  const seenCalls = new Map<string, string>();
  let inputTokens = 0;
  let outputTokens = 0;

  const definitions = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  for (let step = 0; step < maxSteps; step++) {
    // On the final step the tools are withheld. A small model will keep
    // gathering forever if allowed to; with nothing left to call it answers
    // from what it already has, which by then is usually enough.
    const lastStep = step === maxSteps - 1;
    const response = await provider.chat({
      messages,
      ...(lastStep ? {} : { tools: definitions }),
    });
    inputTokens += response.inputTokens ?? 0;
    outputTokens += response.outputTokens ?? 0;

    if (response.toolCalls.length === 0) {
      return {
        answer: response.text,
        steps,
        inputTokens,
        outputTokens,
        durationMs: Date.now() - started,
        exhausted: false,
      };
    }

    messages.push({
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls,
    });

    for (const call of response.toolCalls) {
      const stepStarted = Date.now();
      const signature = `${call.name}:${JSON.stringify(call.arguments)}`;
      const previous = seenCalls.get(signature);

      // Repeating a call re-feeds the same thousands of tokens and teaches the
      // model nothing. Saying so costs a sentence and breaks the loop.
      const { result, failed } =
        previous === undefined
          ? await execute(byName, call)
          : {
              result:
                `You already called ${call.name} with these exact arguments and the ` +
                `result is earlier in this conversation. Either use it, call something ` +
                `else, or answer the question.`,
              failed: true,
            };
      if (previous === undefined) seenCalls.set(signature, result);
      const record: AgentStep = { call, result, failed, durationMs: Date.now() - stepStarted };
      steps.push(record);
      options.onStep?.(record);
      messages.push({ role: 'tool', content: result, toolCallId: call.id });
    }
  }

  return {
    answer: '',
    steps,
    inputTokens,
    outputTokens,
    durationMs: Date.now() - started,
    exhausted: true,
  };
}

/**
 * A failing tool is fed back as text rather than thrown. The model wrote the
 * arguments, so it is the one that can fix them - and a run that dies on a typo
 * has learned nothing.
 */
async function execute(
  byName: Map<string, Tool>,
  call: ToolCall,
): Promise<{ result: string; failed: boolean }> {
  const tool = byName.get(call.name);
  if (tool === undefined) {
    const known = [...byName.keys()].join(', ');
    return { result: `No tool named "${call.name}". Available: ${known}.`, failed: true };
  }
  try {
    return { result: await tool.run(call.arguments), failed: false };
  } catch (error) {
    if (error instanceof ToolInputError) return { result: error.message, failed: true };
    return {
      result: `Tool ${call.name} failed: ${error instanceof Error ? error.message : String(error)}`,
      failed: true,
    };
  }
}
