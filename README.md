# gameswarp-mcp

An MCP server that lets a model investigate Steam games through what players
actually write — reviews, rating history, patch notes and gaming press.

A Steam rating tells you 84% of people liked a game. It does not tell you what
broke in October, whether it was fixed, or what the players with 300 hours think
that the ones with 20 minutes do not. That information exists; it is just buried
in a hundred thousand reviews.

## Install

```bash
claude mcp add gameswarp -- npx -y gameswarp-mcp
```

Or, for any MCP client, run `npx -y gameswarp-mcp` over stdio.

`search_articles` additionally needs a Postgres database with collected press
articles; the other four tools work against Steam directly with no setup.

## Tools

| Tool | What it answers |
|---|---|
| `search_games` | Name to appid. Prefix matching; Russian titles when asked in Russian |
| `get_review_timeline` | Monthly positive share for the whole life of a game, plus the last 30 days |
| `get_game_news` | Patch notes with dates, and press Steam syndicates |
| `get_reviews` | Reviews filtered by window, sentiment and hours played at the time of writing |
| `search_articles` | Full-text search over collected gaming press |

A typical investigation runs `get_review_timeline` to find when a rating moved,
`get_game_news` to find the patch released around that date, then `get_reviews`
for the same window to read what players said.

## Two constraints worth knowing

**Reviews cannot be read for an arbitrary past window.** Steam offers no way to
jump to a date — `day_range` silently ignores anything beyond about a year — so
the only route back is walking newer reviews first. Reaching October 2022 for No
Man's Sky means roughly 1,300 requests. `get_reviews` therefore works on recent
windows and fails with a clear message rather than burning minutes to return
nothing. Use `get_review_timeline` for old history: it is cheap and complete.

**Steam is unforthcoming about its rate limits but does enforce them.** Requests
are paced, retried with a growing backoff, and cached on disk. 4xx is never
retried: a 403 means the appid does not exist.

## Selecting reviews

A popular game runs over 90% positive, so a naive sample answers "what do people
complain about?" with nothing to complain about. `get_reviews` scans far more
reviews than it returns whenever a filter is selective, and reports how many it
scanned when nothing matches, so the caller can tell an empty window from an
unlucky sample.

Every review carries the hours its author had played at the moment of writing.
A review with 300 hours behind it and one with 15 minutes are different kinds of
evidence, and `min_playtime_hours` exists to separate them.

## Collecting articles

`npm run tick` applies migrations, polls every source and resolves new game names.
Every step is idempotent, so running it repeatedly is safe and cheap: sources that
have not changed answer 304 with no body, and only names never seen before cost a
Steam lookup.

It runs hourly on GitHub Actions against a hosted database. Hourly is not
arbitrary - the tightest feed holds about five hours of articles, and anything
slower loses items permanently.

Set `DATABASE_URL` as a repository secret to enable it. The hosted database holds
the feed, games, links and finished analyses; raw reviews and full patch notes
stay local, where they are fetched on demand and cached to disk, because they are
three orders of magnitude larger.

## Development

```bash
npm install
npm run dev          # tsc --watch
npm test             # unit tests, offline
npm run inspect      # build and open the MCP Inspector
npm run acceptance   # end-to-end over stdio, needs network and the database
docker compose up -d && npm run db:migrate
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how the pieces fit together and
[API-NOTES.md](./API-NOTES.md) for hand-verified Steam endpoints, including a few
that every tutorial still gets wrong.

## License

MIT
