-- Instagram connection health (2026-10-30). The day the dashboard shipped, a read-only
-- probe found all four teams' tokens rejected (code 190, "the session has been
-- invalidated because the user changed their password or Facebook has changed the
-- session for security reasons"), and nobody had known: a dead token only showed when
-- a lead tapped Post. Now the publish cron probes each connection once a day, a
-- rejected token is forgotten wherever it is met, the loss is written on the team row,
-- and the notification sweep emails the team's leads once to connect again.
alter table public.instagram_accounts add column checked_at timestamptz;  -- the last daily probe
alter table public.areas
  add column instagram_lost_at          timestamptz,  -- the connection was forgotten because Instagram rejected its token
  add column instagram_lost_reason      text,
  add column instagram_lost_notified_at timestamptz;  -- the leads were told
