import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS, ToolInputError } from '../tools/index.js';

/**
 * A thin wrapper over the shared tool definitions. The server contributes the
 * protocol and nothing else: the tools, their descriptions and their behaviour
 * live in src/tools and are used verbatim by the agent as well, so the two can
 * never drift apart.
 */
export function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'gameswarp', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Investigates Steam games through what players actually write. A typical ' +
        'investigation starts with get_review_timeline to find when a rating moved, ' +
        'then get_game_news to find the patch released around that date, then ' +
        'get_reviews for that same window to read what players said. Reviews can ' +
        'only be read for recent windows; older ones are too deep to fetch live.',
    },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.shape,
      },
      (async (args: Record<string, unknown>) => {
        try {
          return { content: [{ type: 'text' as const, text: await tool.run(args) }] };
        } catch (error) {
          // A failure the model can act on is a result with isError, not a
          // protocol error: the client hands it back and the model adjusts.
          const text =
            error instanceof ToolInputError
              ? error.message
              : error instanceof Error
                ? error.message
                : String(error);
          return { content: [{ type: 'text' as const, text }], isError: true };
        }
      }) as never,
    );
  }

  return server;
}
