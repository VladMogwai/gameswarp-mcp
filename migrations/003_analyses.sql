-- Answers the agent produced, kept because they are expensive and because a
-- page cannot wait a minute for one. Old rating drops in particular can only be
-- explained offline: Steam will not serve reviews from an arbitrary past window,
-- so the analysis is computed once here and served instantly from the row.
create table analyses (
  id            bigserial primary key,
  appid         integer not null references games(appid) on delete cascade,
  kind          text not null check (kind in ('drop', 'summary')),
  language      text not null,
  -- The period the analysis is about, so a game can have several.
  period_start  date,
  period_end    date,
  question      text not null,
  answer        text not null,
  -- What the agent actually did: tool names, arguments and how long each took.
  -- Without this a wrong answer is unexplainable after the fact.
  steps         jsonb not null default '[]',
  model         text not null,
  input_tokens  integer,
  output_tokens integer,
  duration_ms   integer,
  created_at    timestamptz not null default now()
);
create index analyses_lookup_idx on analyses (appid, kind, language, period_start);
create index analyses_recent_idx on analyses (created_at desc);

-- Rating history is needed by every game page and never changes for past
-- months, so it is stored rather than re-fetched from Steam on each view.
create table review_timeline_cache (
  appid       integer not null references games(appid) on delete cascade,
  month       date not null,
  up          integer not null,
  down        integer not null,
  fetched_at  timestamptz not null default now(),
  primary key (appid, month)
);
