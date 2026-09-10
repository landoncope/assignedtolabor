-- Assigned To Labor: initial schema.
-- Applied with `npm run db:push` (Supabase CLI) against the hosted project.

create extension if not exists pgcrypto;

-- ───────────────────────────── tables ─────────────────────────────

-- Mirror of auth.users with the app role. Managers are not a role; they are rows in
-- area_managers. Anonymous quick-upload sessions get a profile too (is_anonymous).
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'member' check (role in ('member', 'admin')),
  is_anonymous boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Emails that become admins automatically on first sign-in.
create table public.admin_seed_emails (
  email text primary key
);
insert into public.admin_seed_emails (email) values
  ('landoncope@gmail.com'),
  ('travis.lish@gmail.com');

-- A review area: a name plus a language. Each area has its own social accounts.
create table public.areas (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  language         text not null,
  instagram_handle text,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);

create table public.area_managers (
  area_id    uuid not null references public.areas(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (area_id, user_id)
);

-- Admin assigns a manager by email before that person has signed in; the trigger
-- below converts the invite into an area_managers row when they do.
create table public.manager_invites (
  email      text not null,
  area_id    uuid not null references public.areas(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (email, area_id)
);

create table public.videos (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  area_id          uuid references public.areas(id) on delete set null, -- null = admin queue
  storage_path     text,           -- key in the private `videos` bucket; null once purged
  file_name        text,
  file_size        bigint,
  mime_type        text,
  duration_seconds integer,
  thumbnail        text,           -- small JPEG data URL captured in the browser
  script           jsonb,          -- {hook, body, cta} from the script builder
  uploader_name    text,
  uploader_note    text,
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'posted')),
  rejection_note   text,
  reviewed_by      uuid references public.profiles(id) on delete set null,
  reviewed_at      timestamptz,
  posted_by        uuid references public.profiles(id) on delete set null,
  posted_at        timestamptz,
  post_url         text,
  file_purged_at   timestamptz,
  created_at       timestamptz not null default now()
);

create index videos_area_status_idx on public.videos (area_id, status, created_at desc);
create index videos_user_idx        on public.videos (user_id, created_at desc);
create index videos_status_idx      on public.videos (status, created_at desc);
create index area_managers_user_idx on public.area_managers (user_id);

-- ───────────────────────────── helpers ─────────────────────────────

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.can_manage_area(aid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.area_managers
                 where area_id = aid and user_id = auth.uid());
$$;

-- Areas the caller manages (used by the review queue).
create or replace function public.my_area_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select area_id from public.area_managers where user_id = auth.uid();
$$;

-- Apply pending manager invites and admin seeding for a (user, email) pair.
create or replace function public.apply_email_grants(uid uuid, addr text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if addr is null then return; end if;
  if exists (select 1 from public.admin_seed_emails where lower(email) = lower(addr)) then
    update public.profiles set role = 'admin' where id = uid;
  end if;
  insert into public.area_managers (area_id, user_id)
    select area_id, uid from public.manager_invites where lower(email) = lower(addr)
    on conflict do nothing;
  delete from public.manager_invites where lower(email) = lower(addr);
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, is_anonymous)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do nothing;
  perform public.apply_email_grants(new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Anonymous users that add an email (and any later email change) are mirrored.
create or replace function public.handle_user_updated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email or new.is_anonymous is distinct from old.is_anonymous then
    update public.profiles
       set email = new.email,
           is_anonymous = coalesce(new.is_anonymous, false),
           display_name = coalesce(display_name,
                                   new.raw_user_meta_data->>'full_name',
                                   new.raw_user_meta_data->>'name')
     where id = new.id;
    perform public.apply_email_grants(new.id, new.email);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function public.handle_user_updated();

-- ───────────────────────────── row level security ─────────────────────────────

alter table public.profiles         enable row level security;
alter table public.admin_seed_emails enable row level security;
alter table public.areas            enable row level security;
alter table public.area_managers    enable row level security;
alter table public.manager_invites  enable row level security;
alter table public.videos           enable row level security;

-- profiles
create policy profiles_select_own   on public.profiles for select using (id = auth.uid());
create policy profiles_update_own   on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all    on public.profiles for all using (public.is_admin()) with check (public.is_admin());

-- admin_seed_emails: admins only
create policy admin_seed_admin_all  on public.admin_seed_emails for all using (public.is_admin()) with check (public.is_admin());

-- areas: anyone (including anonymous visitors) can list active areas; admins manage
create policy areas_select_active   on public.areas for select using (is_active or public.is_admin());
create policy areas_admin_write     on public.areas for all using (public.is_admin()) with check (public.is_admin());

-- area_managers
create policy area_managers_select  on public.area_managers for select using (user_id = auth.uid() or public.is_admin());
create policy area_managers_admin   on public.area_managers for all using (public.is_admin()) with check (public.is_admin());

-- manager_invites: admins only
create policy manager_invites_admin on public.manager_invites for all using (public.is_admin()) with check (public.is_admin());

-- videos
create policy videos_insert_own     on public.videos for insert with check (user_id = auth.uid());
create policy videos_select_own     on public.videos for select using (user_id = auth.uid());
create policy videos_select_manage  on public.videos for select using (public.can_manage_area(area_id) or (area_id is null and public.is_admin()));
create policy videos_update_manage  on public.videos for update
  using (public.can_manage_area(area_id) or (area_id is null and public.is_admin()))
  with check (public.can_manage_area(area_id) or public.is_admin());
create policy videos_admin_delete   on public.videos for delete using (public.is_admin());

-- Uploaders may only ever change their own video while it is still pending, and
-- only descriptive fields. Enforced with a trigger rather than column grants.
create or replace function public.guard_video_update()
returns trigger language plpgsql as $$
begin
  if public.can_manage_area(old.area_id) or public.is_admin() then
    return new;
  end if;
  if old.user_id = auth.uid() and old.status = 'pending' then
    new.status := old.status;
    new.area_id := coalesce(new.area_id, old.area_id);
    new.user_id := old.user_id;
    new.storage_path := old.storage_path;
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    new.posted_by := old.posted_by; new.posted_at := old.posted_at; new.post_url := old.post_url;
    new.file_purged_at := old.file_purged_at;
    return new;
  end if;
  raise exception 'not allowed';
end;
$$;
create trigger videos_guard_update before update on public.videos
  for each row execute function public.guard_video_update();
create policy videos_update_own_pending on public.videos for update
  using (user_id = auth.uid() and status = 'pending') with check (user_id = auth.uid());

-- ───────────────────────────── storage ─────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', false, 524288000,
        array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/mpeg', 'video/3gpp'])
on conflict (id) do nothing;

-- Objects live at {user_id}/{filename}. Owners read/write their folder; admins and
-- the managers of the video's area can read.
create policy videos_storage_insert_own on storage.objects for insert
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy videos_storage_select_own on storage.objects for select
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy videos_storage_delete_own on storage.objects for delete
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy videos_storage_select_reviewers on storage.objects for select
  using (bucket_id = 'videos' and (
    public.is_admin() or exists (
      select 1 from public.videos v
      where v.storage_path = storage.objects.name and public.can_manage_area(v.area_id))));
