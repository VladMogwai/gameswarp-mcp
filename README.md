# steam-signal-mcp

MCP server for investigating Steam games through what players actually write —
reviews, review timelines and patch notes — instead of a single aggregate score.

> Status: in development.

## Why

A Steam rating tells you 84% of people liked a game. It does not tell you what broke
in the March patch, whether it was fixed, or what the people with 300 hours think that
the people with 20 minutes do not. That information exists — it is just buried in a
hundred thousand reviews.

## Tools

TODO

## Development

```bash
npm install
npm run dev        # tsc --watch
npm test
npm run inspect    # build + MCP Inspector
```

See [TASKS.md](./TASKS.md) for the working spec and
[API-NOTES.md](./API-NOTES.md) for verified Steam endpoints.

## License

MIT
