create extension if not exists vector;

-- Games are created lazily: a stub row (appid + name) appears as soon as an
-- article resolves to a game, and is enriched only when someone asks about it.
-- `details_fetched_at` distinguishes a stub from an enriched row.
create table games (
  appid               integer primary key,
  name                text not null,
  developer           text,
  publisher           text,
  release_date        date,
  genres              text[] not null default '{}',
  categories          text[] not null default '{}',
  -- From appreviews query_summary, which is Steam's own count and carries the
  -- official rating band - the ground truth for the rating-prediction eval.
  total_positive      integer,
  total_negative      integer,
  review_score        smallint,
  review_score_desc   text,
  price_cents         integer,
  details_fetched_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- A separate table rather than per-language columns: Steam returns a real
-- Russian description but silently falls back to English for languages it does
-- not localise, and the two cases must stay distinguishable.
create table game_locales (
  appid                 integer not null references games(appid) on delete cascade,
  language              text not null,
  short_description     text,
  detailed_description  text,
  is_fallback           boolean not null default false,
  primary key (appid, language)
);

-- Press articles pulled from outlet RSS feeds. This is the feed users see, and
-- it exists independently of Steam: an article need not resolve to any game.
create table articles (
  id            bigserial primary key,
  guid          text not null unique,
  outlet        text not null,
  url           text not null,
  title         text not null,
  summary       text,
  published_at  timestamptz not null,
  language      text,
  -- Eurogamer, RPS and VG247 carry the game name here, mixed in with platform,
  -- genre, studio and perspective tags. Kept raw so resolution can be re-run.
  categories    jsonb not null default '[]',
  fetched_at    timestamptz not null default now()
);
create index articles_published_idx on articles (published_at desc);
create index articles_outlet_idx on articles (outlet, published_at desc);

-- One article may be about several games, and many are about none.
-- `method` records how the link was established so it can be audited later.
create table article_games (
  article_id  bigint not null references articles(id) on delete cascade,
  appid       integer not null references games(appid) on delete cascade,
  method      text not null check (method in ('category', 'title', 'manual')),
  confidence  real,
  primary key (article_id, appid)
);
create index article_games_appid_idx on article_games (appid);

-- Per-appid items from Steam itself: developer announcements and the press
-- Steam syndicates. Distinct from `articles` in source, purpose and lifecycle -
-- these are fetched on demand, to explain what happened to one game.
create table steam_news (
  gid           text primary key,
  appid         integer not null references games(appid) on delete cascade,
  published_at  timestamptz not null,
  title         text not null,
  body          text not null,
  raw           text not null,
  source        text not null check (source in ('developer', 'press')),
  outlet        text not null,
  url           text not null,
  -- The API does not report the language; we detect it ourselves, null until then
  language      text,
  created_at    timestamptz not null default now()
);
create index steam_news_appid_date_idx on steam_news (appid, published_at desc);
create index steam_news_source_idx on steam_news (appid, source, published_at desc);

create table review_timeline (
  appid  integer not null references games(appid) on delete cascade,
  month  date not null,
  up     integer not null,
  down   integer not null,
  primary key (appid, month)
);

create table reviews (
  recommendation_id           bigint primary key,
  appid                       integer not null references games(appid) on delete cascade,
  language                    text not null,
  voted_up                    boolean not null,
  votes_up                    integer not null default 0,
  votes_funny                 integer not null default 0,
  weighted_vote_score         real,
  playtime_at_review_minutes  integer,
  playtime_forever_minutes    integer,
  posted_at                   timestamptz not null,
  body                        text not null,
  created_at                  timestamptz not null default now()
);
create index reviews_appid_date_idx on reviews (appid, posted_at desc);
create index reviews_appid_sentiment_idx on reviews (appid, voted_up, posted_at desc);
create index reviews_appid_lang_idx on reviews (appid, language);

-- Maps a name seen in the wild to an appid, so storesearch is called once per
-- distinct name rather than once per article. `appid` null means "not a game",
-- which is the answer for most category tags.
create table name_resolutions (
  name        text primary key,
  appid       integer,
  resolved_at timestamptz not null default now()
);

-- No foreign key to games: the crawler tracks endpoints for appids that may not
-- have a row yet, and records dead ones (Steam answers 403).
create table crawl_state (
  appid            integer not null,
  endpoint         text not null,
  last_success_at  timestamptz,
  last_error       text,
  attempts         integer not null default 0,
  dead             boolean not null default false,
  primary key (appid, endpoint)
);
create index crawl_state_pending_idx on crawl_state (endpoint, last_success_at nulls first) where not dead;
