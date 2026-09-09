create extension if not exists vector;

create table games (
  appid          integer primary key,
  name           text not null,
  developer      text,
  publisher      text,
  release_date   date,
  tags           jsonb not null default '{}',
  positive       integer,
  negative       integer,
  owners_min     bigint,
  owners_max     bigint,
  price_cents    integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
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

create table news (
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
create index news_appid_date_idx on news (appid, published_at desc);
create index news_date_idx on news (published_at desc);
create index news_source_idx on news (appid, source, published_at desc);

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

-- No foreign key to games: the crawler learns about an appid before the game row exists.
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
