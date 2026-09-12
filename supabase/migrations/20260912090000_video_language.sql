-- Uploaders now say which language they speak instead of picking a team. The team
-- (area) is assigned automatically when exactly one active area has that language,
-- otherwise reviewers assign it. Applied 2026-09-12.
alter table public.videos add column language text;
create index videos_language_idx on public.videos (lower(language));
