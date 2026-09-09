-- Per-source polling state. Feeds are polled, never pushed, so everything we
-- know about a source's health has to be recorded as we go.
create table source_state (
  source_id        text primary key,
  -- Conditional request headers, so an unchanged feed costs a 304 with no body.
  etag             text,
  last_modified    text,
  last_attempt_at  timestamptz,
  last_success_at  timestamptz,
  last_status      text,
  last_error       text,
  -- Newest publication date seen. A source can go quietly stale while still
  -- answering 200: VG247 kept serving a feed whose newest item was three months
  -- old, and nothing but this column would have caught it.
  newest_item_at   timestamptz,
  consecutive_failures integer not null default 0
);

-- Resumable deep crawls. Walking back to an old review window costs ~1300
-- requests, so the cursor is persisted and an interrupted crawl continues
-- instead of starting over.
alter table crawl_state add column cursor text;
alter table crawl_state add column oldest_reached_at timestamptz;
