# Steam API notes

Verified by hand on 2026-09-09. Everything below works **without an API key and
without registration**. Cached responses live in `test/fixtures/` so the code can
be developed offline.

## The trap

`https://api.steampowered.com/ISteamApps/GetAppList/v2/` is **dead**. It returns
404, `Method 'GetAppList' not found`. Every tutorial still points at it. Use
SteamSpy for the catalogue instead.

## Endpoints

### Reviews
```
https://store.steampowered.com/appreviews/<appid>?json=1&num_per_page=100&filter=recent&language=english
```
100 items per request, maximum. Paginate with the `cursor` field from the
response, passed back as `&cursor=<...>` (URL-encode it: it contains `+` and `=`).

Review fields:
`recommendationid`, `review`, `voted_up`, `votes_up`, `votes_funny`,
`weighted_vote_score` (Steam's own helpfulness score), `comment_count`,
`timestamp_created`, `timestamp_updated`, `language`, `steam_purchase`,
`received_for_free`, `written_during_early_access`, `refunded`,
`primarily_steam_deck`, `app_release_date`, `reactions`.

Author fields (`review.author`):
`steamid`, `num_games_owned`, `num_reviews`, `playtime_forever`,
`playtime_at_review` - **hours played at the time of writing, the key signal for
selecting reviews** - `playtime_last_two_weeks`, `last_played`, `personaname`,
`avatar`, `profile_url`.

`filter` accepts `recent`, `updated` or `all`. With `all` Steam sorts by its own
helpfulness score and pagination behaves differently, so use `recent` for a full
crawl.

Review counts by language, sampled 2026-09-09:

| Game | English | Russian | Romanian |
|---|---|---|---|
| Hades | 153,866 | 16,798 | 48 |
| Cyberpunk 2077 | 417,379 | 86,882 | 246 |
| Elden Ring | 571,412 | 48,428 | 215 |
| Baldur's Gate 3 | 503,964 | 66,638 | 49 |

### Review histogram over time
```
https://store.steampowered.com/appreviewhistogram/<appid>?l=english
```
`results.rollups` is **monthly for the whole history** (`rollup_type: "month"`);
each point carries `date` (unix), `recommendations_up`, `recommendations_down`.
`results.recent` is the last 30 days, daily.

This is the source for locating rating drops.

### News and patch notes
```
https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=<appid>&count=1000
```

Item fields: `gid`, `appid`, `title`, `url`, `is_external_url`, `author`,
`contents`, `feedlabel`, `feedname`, `feed_type`, `date` (unix).

**`gid`** is the unique item id - the key for deduplicating across re-crawls.

**Split the sources by `feed_type`, not by `feedlabel`:**
- `feed_type: 1` - developer announcement (`feedname` is always
  `steam_community_announcements`)
- `feed_type: 0` - press (`feedname` names the outlet)

`feedlabel` is unsuitable: press carries more than a dozen distinct values
(PC Gamer, PCGamesN, Rock Paper Shotgun, VG247, SteamDB, GamingOnLinux,
Gamemag.ru, eurogamer, Shacknews, pressakey.com, steam_release) and the
announcement label may be localised.

**There is no 500-item cap.** `count=1000` returned 715 items for No Man's Sky,
which is its entire history. Ask for more than you expect and take what comes.

**`maxlength` truncates `contents`.** Omit it when you need the full text.

**Two different markup dialects in `contents`:**
- developer announcements use BBCode: `[p]`, `[url="..."]`, `[b]`
- press articles use HTML: `<strong>`, `<a>`

Both need stripping.

**Size.** Median `contents` is 1,178 characters, maximum around 8,000. One
hundred items is roughly 174 KB. Five thousand games at a hundred items each is
about **850 MB** - which answers whether files would do instead of a database.

**Press is multilingual.** Gamemag.ru writes in Russian, the rest in English. The
response does not carry a language field, so detect it yourself if you need it.

**A non-existent appid returns HTTP 403**, not an empty list, so "no such game"
and "no news" are distinguishable. DLC entries carry news like regular apps.

### Similar games (eval ground truth)
```
https://store.steampowered.com/recommended/morelike/app/<appid>/
```
Returns HTML, around 160 KB. The appids sit in `data-ds-appid` attributes. The
first entry is the game itself and should be dropped.

**Do not expose this list to the agent.** It is the correct answer in the
"find similar games" eval task, and the agent would simply copy it.

### SteamSpy - catalogue, tags, scores
```
https://steamspy.com/api.php?request=all&page=<N>       # 1000 games per page, by owners
https://steamspy.com/api.php?request=appdetails&appid=<appid>
```
Provides `positive`/`negative` (for deriving the rating band), `owners` (a range),
`tags` with weights, and `price`.

### Current player count
```
https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=<appid>
```

### Store details
```
https://store.steampowered.com/api/appdetails?appids=<appid>&l=<language>
```
Description, genres, categories, release date, publisher, price.
**The strictest endpoint of all for request rate.** Cache aggressively, pause
between calls, back off on failure. The response is wrapped as
`{"<appid>": {...}}`.

`l=russian` returns a genuinely localised description. `l=romanian` silently
returns the English one - Steam does not localise to every language it accepts,
and the fallback is not signalled.

## Being a good citizen

Steam publishes no rate limits but starts refusing when called frequently. A
1.5 second gap between requests caused no trouble while building the fixtures.
Identify yourself in `User-Agent`. Cache everything you fetch and never fetch it
twice.
