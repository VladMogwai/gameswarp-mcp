# Architecture

Agreed 2026-09-09.

```
                        Steam API
                            |
   +------------------------v-------------------------+
   | 1. Steam client + fetchers                       |
   |    http.ts, news.ts, reviews.ts, histogram.ts    |
   +------------------------+-------------------------+
                            |
   +------------------------v-------------------------+
   | 2. Crawler                                       |
   |    scheduling, queueing, resumption              |
   +------------------------+-------------------------+
                            |
   +------------------------v-------------------------+
   | 3. Storage (Postgres)                            |
   |    games, news, reviews, timelines, analyses     |
   +------------------------+-------------------------+
                            |
   +------------------------v-------------------------+
   | 4. Queries                                       |
   |    find rating drops, search, similar games      |
   +---+--------------+--------------------+----------+
       |              |                    |
  +----v-----+  +-----v------+     +-------v-----+
  | 5. Agent |  | 6. MCP     |     | 7. HTTP API |
  | analysis |  | for models |     | for browsers|
  | & recs   |  +------------+     +-------+-----+
  +----+-----+                             |
       |                             +-----v-----+
       |                             | 8. Client |
       |                             +-----------+
  +----v----------+
  | 9. Evals      |
  +---------------+
```

## Modules

**1. Steam client and fetchers.** One HTTP client with pacing, retries and a disk
cache; thin per-endpoint functions on top. They know nothing about the database
or about models. Done: `http.ts`, `markup.ts`, `news.ts`.

**2. Crawler.** Walks thousands of appids and writes to the database. Scheduling,
queueing, resumption after an interrupt, marking dead appids (Steam answers 403
for those). The most backend-heavy module in the project.

**3. Storage.** Postgres. News alone for five thousand games is on the order of
850 MB, so files are not an option.

**4. Queries.** Find rating drops, find the patch nearest a date, search by
meaning, find similar games. The only layer that knows SQL.

**5. Agent.** Game analysis and recommendations. Calls layer 4 **directly**:
inside one process a hop through a protocol buys nothing.

**6. MCP server.** Not a stage in the pipeline but a **second door to the same
data**: browsers go through the HTTP API, models come here. It analyses nothing
itself - it hands a model the tools and gets out of the way. A thin wrapper over
layer 4.

**7-8. HTTP API and client.** News feed, analysis page, search, comparison.

**9. Evals.** Runs the agent over datasets with objective ground truth and scores
the results.

## Key decision

The agent (5) and the MCP server (6) call **the same layer 4 functions**. Query
logic is never duplicated and MCP stays thin - which is why it is not part of the
pipeline.

## Entry points

Two ways in, both landing on the same game page:

**The feed.** Press articles pulled from outlet RSS. Eurogamer, Rock Paper Shotgun
and VG247 name the game among an article's categories, mixed in with platform,
genre and studio tags; the strict resolver separates them. PC Gamer and
GamingOnLinux tag only genres, so those need the game extracted from the headline -
the first place in the project where a model is actually required.

**Search by name.** Steam's own store search, so no local catalogue is needed. It
matches prefixes but not typos, so the UI searches as the user types rather than
on submit. Localised: searching in Russian returns Russian titles.

Both paths end the same way: a game is created as a stub row, and its reviews,
timeline and patch notes are fetched only when someone asks about it.

## Models

Every call to a model goes through one interface, so which model answers is a
configuration choice rather than a code change:

```
ModelProvider { id, local, complete(request) -> response }
```

`complete` takes an optional zod schema. Providers express that constraint
differently - Ollama through `format`, OpenAI-compatible servers through
`response_format` - and the adapter hides the difference, validating the answer
before returning it. Small models wrap JSON in prose and fences no matter what
the prompt says, so the parser recovers the object before giving up.

Two adapters cover the ground:

- `ollamaProvider` - a model on this machine. Nothing leaves the host.
- `openAICompatibleProvider` - anything speaking the OpenAI chat shape, which
  includes Groq, Together, OpenRouter and several free tiers.

`local` is on the interface rather than implied, because sending game data to a
hosted model is a decision worth making explicitly in a project whose premise is
that the data stays put.

Token counts come back on every response. That is what makes cost per analysis a
measurement rather than a guess, and it is also what makes "how much worse is a
local 8B at this task than a frontier model?" answerable with numbers.

Selected by environment:

```
MODEL_PROVIDER=ollama            MODEL_NAME=gemma4:12b          (default)
MODEL_PROVIDER=openai-compatible MODEL_NAME=llama-3.3-70b
  MODEL_BASE_URL=https://api.groq.com/openai/v1  MODEL_API_KEY=...
```

## Languages

English and Russian are supported. Romanian is deferred: Steam holds only a few
hundred Romanian reviews per game against hundreds of thousands of English ones,
and it does not localise store descriptions to Romanian - it silently returns
English.

Multilingual support is nonetheless built into the schema: language is a key
(`game_locales(appid, language)`, `reviews.language`, `news.language`) rather than
a per-language column. Adding a language means one line in
`src/config/languages.ts` plus data - no migration.

`game_locales.is_fallback` marks the case where Steam answered a locale request
with English text. The distinction matters: otherwise an English description
sitting in a localised row looks like a translation that was never made.
