-- Instagram posting from the site (2026-10-13). One connected Instagram professional
-- account per team, and the state of each video's one-tap publish.

-- Tokens live here and nowhere else. RLS is on with NO policies: browsers can never read
-- or write this table; the server uses the service role after checking who is asking.
create table public.instagram_accounts (
  area_id          uuid primary key references public.areas(id) on delete cascade,
  ig_user_id       text not null,              -- the Instagram professional account id
  app_scoped_id    text,                       -- "id" from /me, differs from ig_user_id
  username         text,
  account_type     text,                       -- BUSINESS or MEDIA_CREATOR
  access_token     text not null,              -- long-lived (60 days), refreshed by the cron
  token_expires_at timestamptz,
  scopes           text[] not null default '{}',
  connected_by     uuid references auth.users(id) on delete set null,
  connected_at     timestamptz not null default now(),
  refreshed_at     timestamptz,
  last_error       text,
  updated_at       timestamptz not null default now()
);
create unique index instagram_accounts_ig_user on public.instagram_accounts (ig_user_id);
alter table public.instagram_accounts enable row level security;

-- What pages may know about a connection (no token): kept on the team row itself.
alter table public.areas
  add column instagram_user_id      text,
  add column instagram_connected_at timestamptz;

-- One-tap publish bookkeeping. status stays 'approved' while a post is in flight and
-- becomes 'posted' when Instagram confirms; a failure leaves it 'approved' with the
-- reason, so the lead can retry or post by hand.
alter table public.videos
  add column publish_state        text check (publish_state in ('queued', 'processing', 'published', 'failed')),
  add column publish_requested_at timestamptz,
  add column publish_requested_by uuid references auth.users(id) on delete set null,
  add column publish_container_id text,
  add column publish_attempts     integer not null default 0,
  add column publish_error        text,
  add column post_caption         text,
  add column post_media_id        text;

create index videos_publishing on public.videos (publish_state) where publish_state in ('queued', 'processing');
