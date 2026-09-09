# praxis-mcp

MCP server that lets a model investigate a repository — diffs, code search, and the
team's own written conventions (CONTRIBUTING, style guides, ADRs).

> Status: in development.

## Why

Generic code review tools can find generic bugs. They cannot know that *your* team
decided, in ADR-014, to never throw inside a repository layer. This server gives a
model the tools to look that up.

## Install

TODO

## Tools

TODO

## Development

```bash
npm install
npm run dev        # tsc --watch
npm test
npm run inspect    # build + MCP Inspector
```

See [TASKS.md](./TASKS.md) for the working spec.

## License

MIT
