-- =============================================
-- Migration: Add district_leader role, channels, video_channels
-- Run this in the Supabase SQL Editor
-- =============================================

-- 1. Add district_leader to the users role constraint
alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check
  check (role in ('user', 'admin', 'district_leader'));

-- 2. Channels table — social media accounts managed by district leaders
create table if not exists public.channels (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  platform    text not null,
  url         text,
  assigned_to uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 3. Video-channel approval/posting junction table
create table if not exists public.video_channels (
  id          uuid primary key default uuid_generate_v4(),
  video_id    uuid not null references public.videos(id) on delete cascade,
  channel_id  uuid not null references public.channels(id) on delete cascade,
  approved_at timestamptz not null default now(),
  approved_by uuid references public.users(id),
  posted_at   timestamptz,
  posted_by   uuid references public.users(id),
  unique(video_id, channel_id)
);

-- 4. Indexes
create index if not exists idx_channels_assigned_to    on public.channels(assigned_to);
create index if not exists idx_video_channels_video_id  on public.video_channels(video_id);
create index if not exists idx_video_channels_channel_id on public.video_channels(channel_id);

-- 5. RLS
alter table public.channels      enable row level security;
alter table public.video_channels enable row level security;

-- Channels: admins can do everything; district leaders can read their own
create policy "admin_channels_all" on public.channels for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);
create policy "leader_channels_select" on public.channels for select using (
  assigned_to = auth.uid()
);

-- Video channels: admins full access; district leaders can see + update their channel rows
create policy "admin_video_channels_all" on public.video_channels for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);
create policy "leader_video_channels_select" on public.video_channels for select using (
  exists (
    select 1 from public.channels
    where channels.id = video_channels.channel_id
    and channels.assigned_to = auth.uid()
  )
);
create policy "leader_video_channels_update" on public.video_channels for update using (
  exists (
    select 1 from public.channels
    where channels.id = video_channels.channel_id
    and channels.assigned_to = auth.uid()
  )
);

-- Users can see their own video_channels rows (for impact view)
create policy "user_video_channels_select" on public.video_channels for select using (
  exists (
    select 1 from public.videos
    where videos.id = video_channels.video_id
    and videos.user_id = auth.uid()
  )
);

-- Allow admin to read all users (needed for user management tab)
drop policy if exists "admin_user_select" on public.users;
create policy "admin_user_all" on public.users for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- Storage: district leaders can read videos approved for their channel
create policy "storage_leader_select" on storage.objects for select using (
  bucket_id = 'videos' and
  exists (select 1 from public.users where id = auth.uid() and role in ('admin', 'district_leader'))
);

-- =============================================
-- Migration: Update videos table for new audience fields
-- =============================================

-- Multi-select countries (replaces single country text field)
alter table public.videos
  add column if not exists countries text[] not null default '{}';

-- Audience targeting fields
alter table public.videos
  add column if not exists belief_system text;

alter table public.videos
  add column if not exists church_relationship text;

alter table public.videos
  add column if not exists video_style text;
