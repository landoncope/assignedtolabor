-- One worker at a time on a post (2026-11-01): the review page's polling, the render
-- route and the publish cron can all reach the Instagram step at the same moment once a
-- render finishes. The step claims the row first (null or stale lock -> now) and releases
-- it after its one Instagram call, so a container is never created twice and a specific
-- failure is never overwritten by a generic one.
alter table public.videos add column publish_lock_at timestamptz;
