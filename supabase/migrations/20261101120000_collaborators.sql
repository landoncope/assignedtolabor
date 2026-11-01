-- Collaborator invites on one-tap posts (2026-11-01, Travis's request): up to three
-- Instagram usernames go with the Reel container; each invitee accepts in the Instagram
-- app and the Reel then appears on their profile too.
alter table public.areas  add column instagram_collaborators text[] not null default '{}';  -- the team's usual invitees, prefilled on every post
alter table public.videos add column post_collaborators text[];                              -- what was sent with this post
