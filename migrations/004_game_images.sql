-- Cover art URLs cannot be derived from the appid. Older games sit at a fixed
-- path, but anything recent carries a content hash in the URL, and recent games
-- are most of what a news feed is about. The URLs arrive with the store details
-- we already fetch, so they are stored rather than guessed.
alter table games add column header_image text;
alter table games add column capsule_image text;
