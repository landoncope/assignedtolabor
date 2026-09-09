-- =============================================
-- WagePeace — run once in Supabase SQL Editor
-- =============================================

create extension if not exists "uuid-ossp";

-- Tables

create table if not exists public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.email_optins (
  id         uuid primary key default uuid_generate_v4(),
  email      text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.videos (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.users(id) on delete cascade,
  file_url       text not null,
  file_name      text,
  file_size      bigint,
  country        text not null,
  demographic    text not null check (demographic in ('Children','Teens','Young Adults','Adults','Seniors','General Audience')),
  language       text not null,
  platform       text[] not null default '{}',
  status         text not null default 'pending' check (status in ('pending','approved','rejected','posted')),
  rejection_note text,
  created_at     timestamptz not null default now(),
  posted_at      timestamptz
);

-- Indexes

create index if not exists idx_users_role        on public.users(role);
create index if not exists idx_videos_user_id    on public.videos(user_id);
create index if not exists idx_videos_status     on public.videos(status);
create index if not exists idx_videos_created_at on public.videos(created_at desc);

-- Row Level Security

alter table public.users        enable row level security;
alter table public.email_optins enable row level security;
alter table public.videos       enable row level security;

-- users policies
create policy "own_user_select"  on public.users for select using (auth.uid() = id);
create policy "own_user_update"  on public.users for update using (auth.uid() = id);
create policy "admin_user_select" on public.users for select using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- email_optins policies
create policy "anon_optin_insert" on public.email_optins for insert with check (true);
create policy "admin_optin_select" on public.email_optins for select using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- videos policies
create policy "own_video_select" on public.videos for select using (auth.uid() = user_id);
create policy "own_video_insert" on public.videos for insert with check (auth.uid() = user_id);
create policy "own_video_update" on public.videos for update using (auth.uid() = user_id);
create policy "admin_video_select" on public.videos for select using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);
create policy "admin_video_update" on public.videos for update using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- Auto-create user row on sign-up

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'role','user'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Storage bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos','videos', false, 524288000,
  array['video/mp4','video/quicktime','video/x-msvideo','video/webm','video/mpeg','video/ogg'])
on conflict (id) do nothing;

-- Storage policies
create policy "storage_own_insert" on storage.objects for insert with check (
  bucket_id = 'videos' and auth.uid()::text = (storage.foldername(name))[1]
);
create policy "storage_own_select" on storage.objects for select using (
  bucket_id = 'videos' and auth.uid()::text = (storage.foldername(name))[1]
);
create policy "storage_admin_select" on storage.objects for select using (
  bucket_id = 'videos' and
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);
create policy "storage_own_delete" on storage.objects for delete using (
  bucket_id = 'videos' and auth.uid()::text = (storage.foldername(name))[1]
);
