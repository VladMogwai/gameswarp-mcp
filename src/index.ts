#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './mcp/server.js';

// stdout carries the protocol and nothing else; every log goes to stderr.
async function main(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error('gameswarp mcp server ready on stdio');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
