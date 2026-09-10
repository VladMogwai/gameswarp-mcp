-- Steam does not always group review history by month: games released in the
-- last year or two come back weekly instead, and `rollup_type` says which. The
-- column was named `month` and weekly points collided in it, so every recent
-- game - which is most of what a news feed covers - had duplicated buckets and
-- labels a month wide for a week of data.
alter table review_timeline_cache rename column month to bucket;
alter table review_timeline_cache
  add column granularity text not null default 'month'
  check (granularity in ('week', 'month'));

-- Existing rows were written under the old assumption and cannot be trusted.
delete from review_timeline_cache;
